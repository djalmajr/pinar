// OpenAI-compatible AI adapter for the self-hosted EdgeR runtime. It
// replaces the Cloudflare Workers AI binding with any OpenAI-compatible
// endpoint (the lbvllm gateway first; Vercel AI Gateway or the Cloudflare
// API later by config alone). Routing is by the input shape, not the model
// name: an input with an `audio` key goes to POST {base}/audio/transcriptions,
// every other object goes to POST {base}/chat/completions. The `model`
// argument is always replaced by the configured chat/transcription model.

const AUDIO_EXTENSIONS: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/webm": "webm",
  "audio/x-m4a": "m4a",
  "audio/x-wav": "wav",
};

export interface AiRunner {
  run(model: string, input: unknown, options?: { signal?: AbortSignal }): Promise<unknown>;
}

export interface OpenAiCompatibleAiConfig {
  apiKey: string;
  baseUrl: string;
  chatModel: string;
  fetch?: typeof fetch;
  transcriptionModel: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// "audio/webm;codecs=opus" -> "webm": extra content-type parameters never
// change the extension, anything unknown -> "bin".
function audioExtension(contentType: string): string {
  const base = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return AUDIO_EXTENSIONS[base] ?? "bin";
}

const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";

// Qwen models can emit their reasoning inside the content: drop a leading
// think block, then trim. No closing tag -> the block is not delimited and
// the text is kept as-is.
function cleanChatText(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith(THINK_OPEN)) {
    const end = trimmed.indexOf(THINK_CLOSE);
    if (end !== -1) return trimmed.slice(end + THINK_CLOSE.length).trim();
  }
  return trimmed;
}

// A deadline that expires while the body is being read rejects
// response.json() with a DOMException named AbortError or TimeoutError.
// inference.ts distinguishes ai_timeout by that name, so the very same
// exception must surface instead of a sanitized empty body; other parsing
// errors stay sanitized.
function isBodyReadTimeout(error: unknown): error is DOMException {
  return error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError");
}

export function createOpenAiCompatibleAi(config: OpenAiCompatibleAiConfig): AiRunner {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const base = config.baseUrl.replace(/\/+$/, "");
  const auth = { Authorization: `Bearer ${config.apiKey}` };

  // No wrapping of transport errors on purpose: inference.ts distinguishes a
  // timeout by the DOMException name, so an AbortError/TimeoutError thrown
  // by fetch must surface as the very same exception.
  async function transcribe(input: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const audio = isRecord(input.audio) ? input.audio : {};
    const contentType = typeof audio.contentType === "string" ? audio.contentType : "";
    // The stream is read exactly once, into a Blob, before the first request:
    // a stream cannot be read twice, and the retry below resends the same
    // bytes. Pinar's upload limit is 5 MiB, so the audio stays bounded in
    // memory.
    const bytes = audio.body instanceof ReadableStream
      ? new Uint8Array(await new Response(audio.body).arrayBuffer())
      : new Uint8Array(0);
    const blob = new Blob([bytes], { type: contentType });
    const filename = `audio.${audioExtension(contentType)}`;
    // redirect: "error" so the Bearer key is never taken to another host.
    // The same signal applies to both requests: a rejection on the first one
    // propagates before the second can start.
    const send = (verbose: boolean): Promise<Response> => {
      const form = new FormData();
      form.append("file", blob, filename);
      form.append("model", config.transcriptionModel);
      // The Workers AI extras (task, vad_filter) are not part of the
      // OpenAI-compatible form and are not sent.
      if (typeof input.language === "string" && input.language.length > 0) {
        form.append("language", input.language);
      }
      if (verbose) form.append("response_format", "verbose_json");
      return fetchImpl(`${base}/audio/transcriptions`, {
        body: form,
        headers: auth,
        method: "POST",
        redirect: "error",
        signal,
      });
    };
    // The first request asks for verbose_json (the duration feeds the 120 s
    // limit). lbvllm's support is unconfirmed until staging: a 400/422
    // retries once, same fields and same blob, without response_format.
    const first = await send(true);
    const response = first.status === 400 || first.status === 422 ? await send(false) : first;
    // F4c: the statusCode rides on the error so the voice/text chain
    // (voice-chain.ts) can classify the refusal (401/403 fatal, 402 budget,
    // 429 transient) instead of passing to the next link; the message stays
    // as it was for the consumers that read it.
    if (!response.ok) throw Object.assign(new Error(`ai request failed: ${response.status}`), { statusCode: response.status });
    let parsed: unknown = {};
    try {
      parsed = await response.json();
    } catch (error) {
      if (isBodyReadTimeout(error)) throw error;
      parsed = {};
    }
    const record = isRecord(parsed) ? parsed : {};
    const info: { duration?: number; language?: string } = {};
    if (typeof record.language === "string") info.language = record.language;
    if (typeof record.duration === "number") info.duration = record.duration;
    return {
      text: typeof record.text === "string" ? record.text : "",
      transcription_info: info,
    };
  }

  async function chat(input: unknown, signal?: AbortSignal): Promise<unknown> {
    const record = isRecord(input) ? input : {};
    let body: Record<string, unknown>;
    if (Array.isArray(record.messages)) {
      // Chat format: forward the four fields as they came.
      body = {
        max_tokens: record.max_tokens,
        messages: record.messages,
        model: config.chatModel,
        stream: false,
      };
      if (record.response_format !== undefined) body.response_format = record.response_format;
      if (record.temperature !== undefined) body.temperature = record.temperature;
    } else {
      // Responses format: system (when not empty) + user, max_tokens =
      // max_output_tokens; reasoning is not sent.
      const instructions = typeof record.instructions === "string" ? record.instructions : "";
      const content = typeof record.input === "string" ? record.input : "";
      const messages = instructions
        ? [
            { content: instructions, role: "system" },
            { content, role: "user" },
          ]
        : [{ content, role: "user" }];
      body = {
        max_tokens: record.max_output_tokens,
        messages,
        model: config.chatModel,
        stream: false,
      };
    }
    // redirect: "error" so the Bearer key is never taken to another host.
    const response = await fetchImpl(`${base}/chat/completions`, {
      body: JSON.stringify(body),
      headers: { ...auth, "Content-Type": "application/json" },
      method: "POST",
      redirect: "error",
      signal,
    });
    // F4c: the statusCode rides on the error, as in transcribe, so the
    // chain's classification sees the refusal (voice-chain.ts).
    if (!response.ok) throw Object.assign(new Error(`ai request failed: ${response.status}`), { statusCode: response.status });
    let parsed: unknown = {};
    try {
      parsed = await response.json();
    } catch (error) {
      if (isBodyReadTimeout(error)) throw error;
      parsed = {};
    }
    const result = isRecord(parsed) ? parsed : {};
    const choice = Array.isArray(result.choices) && isRecord(result.choices[0]) ? result.choices[0] : {};
    const message = isRecord(choice.message) ? choice.message : {};
    const content = typeof message.content === "string" ? message.content : "";
    // The caller (cloudflareResponseText / responseText) reads the cleaned
    // text from `response`; `usage` stays intact for token metering.
    return { ...result, response: cleanChatText(content) };
  }

  return {
    // _model: the @cf/... name is ignored by design; the configured models
    // are what the provider endpoint actually knows.
    async run(_model, input, options) {
      if (isRecord(input) && "audio" in input) return transcribe(input, options?.signal);
      return chat(input, options?.signal);
    },
  };
}
