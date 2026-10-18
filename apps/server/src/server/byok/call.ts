// F5/S3b: the raw BYOK calls of the voice transcription and the written
// reproduction (F5 contract §5): the user's OpenAI-compatible endpoint,
// one link, no gateway fallback (contract §1). The egress is the route's
// (byokFetch's refusal until S6, the fake the tests inject); the per-call
// deadline is the signal, and 429/503 are never repeated (one call, no
// queue — the concurrency of byok/route.ts already bounded the request).
//
// Every failure is a ByokCallError with the cause of the common table
// (cause.ts, shared with S2's detection and the assistant's turn): the
// provider's body, the URL and the key never cross the error — the
// classification reads the status, the guard's header and the body's
// error type/code marker, nothing else. A 2xx outside the expected shape
// is invalid_response, like S2's probes.

import {
  ByokCallError,
  byokEgressErrorCause,
  byokReadBody,
  byokResponseCause,
} from "./cause";
import type { ByokEgress } from "./fetch";

// The error body's read cap: enough for the 403/404 markers of the common
// table, never more (the turn's cap, route.ts).
const BYOK_CALL_BODY_LIMIT = 256 * 1024;

/** The BYOK call's target: the route's fields (the key, only on the server). */
export interface ByokCallTarget {
  apiKey: string;
  baseUrl: string;
  egress: ByokEgress;
  model: string;
}

// The single ByokCallError (byok/cause.ts, next to the cause table): the
// S3c retrieval and the S3b voice/reproduction share it, so the
// byokErrorResponse's instanceof (cloud-api.ts) maps every BYOK failure.
// Re-exported here for the S3b consumers' imports (ai/voice-pin.ts, the
// written reproduction).
export { ByokCallError };

/**
 * The egress call, classified: a throw (the refusal, the deadline, the
 * network) is the egress's cause; a non-2xx is the common table's (the
 * body read capped for the 403/404 markers); a 2xx returns the body text.
 * redirect: "error" — the key must never migrate to another origin (S2's
 * probes' rule), so a redirect is the refusal classified from the error,
 * not a second host with the Authorization header.
 */
async function byokCallEgress(egress: ByokEgress, url: string, init: RequestInit, timeoutMs: number): Promise<string> {
  let response: Response;
  let bodyText: string;
  try {
    response = await egress(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    bodyText = await byokReadBody(response, BYOK_CALL_BODY_LIMIT);
  } catch (error) {
    if (error instanceof ByokCallError) throw error;
    throw new ByokCallError(byokEgressErrorCause(error));
  }
  if (!response.ok) throw new ByokCallError(byokResponseCause(response, bodyText));
  return bodyText;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The BYOK transcription (contract §5, voice): POST {baseUrl}/audio/
 * transcriptions, multipart with the user's transcription model and the
 * clip — S2's probe format (file + model, the key in the Authorization
 * header, never the body). One call on the deadline, no retry on
 * 429/503. The 2xx answer must carry text (even empty — S2's probe passes
 * it; the caller decides what an empty transcript means); the duration and
 * the language ride when the provider reports them.
 */
export async function byokTranscribe(
  target: ByokCallTarget,
  input: { audio: Blob; audioType: string; timeoutMs: number },
): Promise<{ duration: number | null; language: string | null; text: string }> {
  const form = new FormData();
  form.append("file", input.audio);
  form.append("model", target.model);
  const bodyText = await byokCallEgress(
    target.egress,
    `${target.baseUrl}/audio/transcriptions`,
    {
      body: form,
      headers: new Headers({ Authorization: `Bearer ${target.apiKey}` }),
      method: "POST",
    },
    input.timeoutMs,
  );
  const body = parseJson(bodyText);
  if (!record(body) || typeof body.text !== "string") {
    throw new ByokCallError({ cause: "invalid_response", retryAfterSeconds: null });
  }
  const duration = typeof body.duration === "number" && Number.isFinite(body.duration) && body.duration > 0
    ? body.duration
    : null;
  const language = typeof body.language === "string" && body.language !== "" ? body.language : null;
  return { duration, language, text: body.text };
}

/**
 * The BYOK chat call (contract §5, the reproduction and the voice's
 * structuring): POST {baseUrl}/chat/completions, non-streaming, with the
 * same prompt the metered path sends (system + user), the user's chat
 * model and, with the JSON mode, the same response_format the metered
 * links send (jsonObject: true). One call on the deadline, no retry. The
 * 2xx answer must carry choices[0].message.content, else the cause is
 * invalid_response. The usage rides when the provider reports it; without
 * it the same length/4 estimate the metered paths use.
 */
export async function byokChat(
  target: ByokCallTarget,
  input: {
    jsonObject?: boolean;
    maxTokens: number;
    messages: Array<{ content: string; role: "system" | "user" }>;
    timeoutMs: number;
    temperature?: number;
  },
): Promise<{ inputTokens: number; outputTokens: number; text: string }> {
  const bodyText = await byokCallEgress(
    target.egress,
    `${target.baseUrl}/chat/completions`,
    {
      body: JSON.stringify({
        max_tokens: input.maxTokens,
        messages: input.messages,
        model: target.model,
        ...(input.jsonObject ? { response_format: { type: "json_object" } } : {}),
        ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      }),
      headers: new Headers({
        Authorization: `Bearer ${target.apiKey}`,
        "Content-Type": "application/json",
      }),
      method: "POST",
    },
    input.timeoutMs,
  );
  const body = parseJson(bodyText);
  const choices = record(body) && Array.isArray(body.choices) ? body.choices : null;
  const choice = choices !== null && record(choices[0]) ? choices[0]! : null;
  const message = choice !== null && record(choice.message) ? choice.message : null;
  if (message === null || typeof message.content !== "string") {
    throw new ByokCallError({ cause: "invalid_response", retryAfterSeconds: null });
  }
  const usage = record(body) && record(body.usage) ? body.usage : {};
  const promptLength = input.messages.map((item) => item.content).join("\n").length;
  const inputTokens = typeof usage.prompt_tokens === "number" && Number.isFinite(usage.prompt_tokens) && usage.prompt_tokens > 0
    ? Math.ceil(usage.prompt_tokens)
    : Math.ceil(promptLength / 4);
  const outputTokens = typeof usage.completion_tokens === "number" && Number.isFinite(usage.completion_tokens) && usage.completion_tokens > 0
    ? Math.ceil(usage.completion_tokens)
    : Math.ceil(message.content.length / 4);
  return { inputTokens, outputTokens, text: message.content };
}
