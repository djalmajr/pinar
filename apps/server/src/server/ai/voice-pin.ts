import {
  type AiFeatureSpec,
  type CloudEnv,
  extractJsonObject,
  json,
  readOwnerDeliveryPreferences,
  resolvePrincipal,
  runMeteredAiFeature,
} from "../cloud-api";
import {
  MAX_DURATION_SECONDS,
  parseVoicePinForm,
  parseVoicePinResult,
  voicePinStructuringInstructions,
  type VoicePinResult,
} from "./voice-common";
import {
  chainUsable,
  runTextChain,
  runTranscriptionChain,
  textChain,
  transcriptionChain,
  voiceAvailability,
} from "./voice-chain";

export { parseVoicePinResult, voicePinStructuringInstructions };
export type { VoicePinResult };

const TRANSCRIPTION_MODEL = "@cf/openai/whisper-large-v3-turbo";
const STRUCTURING_MODEL = "@cf/openai/gpt-oss-20b";
const WHISPER_USD_MICROS_PER_MINUTE = 513;
const STRUCTURING_INPUT_USD_PER_MILLION_TOKENS = 0.2;
const STRUCTURING_OUTPUT_USD_PER_MILLION_TOKENS = 0.3;

function voicePinSpec(durationSeconds: number, postProcess: boolean): AiFeatureSpec {
  return {
    credits: Math.max(1, Math.ceil(durationSeconds / 60)),
    feature: "voice_pin",
    inputUsdPerMillionTokens: postProcess ? STRUCTURING_INPUT_USD_PER_MILLION_TOKENS : 0,
    maxTokens: postProcess ? 768 : 1,
    model: postProcess ? `${TRANSCRIPTION_MODEL} + ${STRUCTURING_MODEL}` : TRANSCRIPTION_MODEL,
    outputUsdPerMillionTokens: postProcess ? STRUCTURING_OUTPUT_USD_PER_MILLION_TOKENS : 0,
    timeoutMs: 60_000,
  };
}

function responseText(output: unknown) {
  if (!output || typeof output !== "object") return "";
  const record = output as Record<string, unknown>;
  if (typeof record.output_text === "string") return record.output_text;
  if (typeof record.response === "string") return record.response;
  if (!Array.isArray(record.output)) return "";
  const text: string[] = [];
  for (const item of record.output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part && typeof part === "object" && (part as Record<string, unknown>).type === "output_text"
        && typeof (part as Record<string, unknown>).text === "string") {
        text.push(String((part as Record<string, unknown>).text));
      }
    }
  }
  return text.join("\n");
}

function tokenUsage(output: unknown, input: string, response: string) {
  const record = output && typeof output === "object" ? output as Record<string, unknown> : {};
  const usage = record.usage && typeof record.usage === "object" ? record.usage as Record<string, unknown> : {};
  const inputTokens = Number(usage.input_tokens || usage.prompt_tokens) || Math.ceil(input.length / 4);
  const outputTokens = Number(usage.output_tokens || usage.completion_tokens) || Math.ceil(response.length / 4);
  return { inputTokens: Math.max(0, inputTokens), outputTokens: Math.max(0, outputTokens) };
}

/**
 * POST /api/ai/voice-pin — transcribes an ephemeral audio clip and turns it
 * into a concise pin comment. The audio is held only in request memory and is
 * never written to D1, R2, logs, or the metering result.
 */
export async function transcribeVoicePin(request: Request, env: CloudEnv): Promise<Response> {
  if (!env.AI) {
    // D5: a configured and usable AI_TRANSCRIPTION_CHAIN keeps the route
    // available without the AI binding; the environment never decides the
    // provider (A50).
    const availability = await voiceAvailability(env);
    if (!availability.transcription) return json({ code: "ai_unavailable", error: "AI is not configured" }, 503);
  }
  const principal = await resolvePrincipal(request, env);
  if (!principal) return json({ error: "Unauthorized" }, 401);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "multipart form data required" }, 400);
  }
  const parsed = parseVoicePinForm(form);
  if (!parsed.ok) {
    return json(parsed.code ? { code: parsed.code, error: parsed.error } : { error: parsed.error }, parsed.status);
  }
  const { audio, audioType, durationSeconds, language, requestId } = parsed;

  const postProcess = (await readOwnerDeliveryPreferences(env, principal.id)).voicePostProcessing;
  const spec = voicePinSpec(durationSeconds, postProcess);
  return runMeteredAiFeature<VoicePinResult>({
    env,
    execute: async () => {
      // D5: the AI_TRANSCRIPTION_CHAIN links when configured and usable,
      // else the AI binding, exactly as before.
      const links = await transcriptionChain(env);
      let transcriptionCost: number | null = null;
      let transcription: unknown;
      if (links !== null && chainUsable(env, links)) {
        const outcome = await runTranscriptionChain(env, links, {
          audio,
          audioType,
          language,
          timeoutMs: 45_000,
        });
        transcription = outcome.output;
        transcriptionCost = outcome.costUsdMicros;
      } else {
        transcription = await env.AI!.run(
          TRANSCRIPTION_MODEL,
          {
            audio: {
              body: audio.stream(),
              contentType: audioType,
            },
            language,
            task: "transcribe",
            vad_filter: true,
          },
          { signal: AbortSignal.timeout(45_000) },
        );
      }
      const transcriptionRecord = transcription && typeof transcription === "object"
        ? transcription as Record<string, unknown>
        : {};
      const transcript = typeof transcriptionRecord.text === "string" ? transcriptionRecord.text.trim() : "";
      if (!transcript) throw new Error("invalid_ai_response");
      const transcriptionInfo = transcriptionRecord.transcription_info && typeof transcriptionRecord.transcription_info === "object"
        ? transcriptionRecord.transcription_info as Record<string, unknown>
        : {};
      const actualDuration = Number(transcriptionInfo.duration) || durationSeconds;
      if (actualDuration > MAX_DURATION_SECONDS + 1) throw new Error("invalid_audio_duration");
      const detectedLanguage = typeof transcriptionInfo.language === "string" ? transcriptionInfo.language : null;
      if (!postProcess) {
        return {
          result: {
            acceptanceCriteria: [],
            comment: transcript.slice(0, 2_000),
            detectedLanguage,
            transcript: transcript.slice(0, 8_000),
          },
          telemetry: {
            // D5: the gateway's reported cost (marketCost, else cost);
            // without it, the estimate of this file.
            costUsdMicros: transcriptionCost ?? Math.ceil(actualDuration / 60 * WHISPER_USD_MICROS_PER_MINUTE),
            inputTokens: 0,
            outputTokens: 0,
          },
        };
      }
      const instructions = voicePinStructuringInstructions();
      const structureInput = JSON.stringify({ language, transcript });
      // D5: the AI_TEXT_CHAIN links when configured and usable, else the AI
      // binding, exactly as before.
      const textLinks = await textChain(env);
      let structuringCost: number | null = null;
      let structuredText: string;
      let usage: { inputTokens: number; outputTokens: number };
      if (textLinks !== null && chainUsable(env, textLinks)) {
        const outcome = await runTextChain(env, textLinks, {
          maxTokens: spec.maxTokens,
          prompt: {
            messages: [
              { content: instructions, role: "system" },
              { content: structureInput, role: "user" },
            ],
          },
          timeoutMs: spec.timeoutMs,
        });
        structuringCost = outcome.costUsdMicros;
        structuredText = outcome.text;
        usage = outcome.usage;
      } else {
        const structured: unknown = await env.AI!.run(
          STRUCTURING_MODEL,
          {
            input: structureInput,
            instructions,
            max_output_tokens: spec.maxTokens,
            reasoning: { effort: "low" },
          },
          { signal: AbortSignal.timeout(spec.timeoutMs) },
        );
        structuredText = responseText(structured);
        usage = tokenUsage(structured, structureInput, structuredText);
      }
      const structuredJson = extractJsonObject(structuredText);
      const result = parseVoicePinResult(JSON.stringify({
        acceptanceCriteria: structuredJson?.acceptanceCriteria,
        comment: structuredJson?.comment,
        detectedLanguage,
        transcript,
      }));
      if (!result) throw new Error("invalid_ai_response");
      // D5: each call's real gateway cost (marketCost, else cost); without
      // either, the estimate this file already computes.
      const costUsdMicros = transcriptionCost === null && structuringCost === null
        ? Math.ceil(actualDuration / 60 * WHISPER_USD_MICROS_PER_MINUTE
            + usage.inputTokens * STRUCTURING_INPUT_USD_PER_MILLION_TOKENS
            + usage.outputTokens * STRUCTURING_OUTPUT_USD_PER_MILLION_TOKENS)
        : (transcriptionCost ?? Math.ceil(actualDuration / 60 * WHISPER_USD_MICROS_PER_MINUTE))
          + (structuringCost ?? Math.ceil(usage.inputTokens * STRUCTURING_INPUT_USD_PER_MILLION_TOKENS
            + usage.outputTokens * STRUCTURING_OUTPUT_USD_PER_MILLION_TOKENS));
      return {
        result,
        telemetry: {
          costUsdMicros,
          ...usage,
        },
      };
    },
    parse: parseVoicePinResult,
    principal,
    request,
    requestId,
    resourceId: `voice:${requestId}`,
    spec,
    unavailableMessage: "Voice transcription unavailable",
  });
}
