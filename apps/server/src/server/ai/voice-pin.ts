import {
  byokErrorResponse,
  byokRateLimitedResponse,
  byokSuccessJson,
  type AiFeatureSpec,
  type CloudEnv,
  extractJsonObject,
  json,
  readOwnerDeliveryPreferences,
  resolvePrincipal,
  runMeteredAiFeature,
  runMeteredAiFeaturePath,
} from "../cloud-api";
import { ByokCallError, byokChat, byokTranscribe } from "../byok/call";
import type { ByokRoute } from "../byok/route";
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
 *
 * F5/S3b (contract §5): with the transcription capability tested ok (and
 * without useCredits) the transcription runs on the user's endpoint — no
 * credits, one link, no gateway fallback; the structuring, when enabled, runs
 * on the user's chat when it is ok (no credit) or on the gateway with one
 * credit (the mixed case). The plan and the per-minute limit run on both
 * paths, exactly as today.
 */
export async function transcribeVoicePin(request: Request, env: CloudEnv): Promise<Response> {
  const principal = await resolvePrincipal(request, env);
  if (!principal) return json({ error: "Unauthorized" }, 401);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "multipart form data required" }, 400);
  }
  // F5/S3b (contract §5): useCredits is the form field, "true" or
  // "false" (the multipart body has no JSON types); any other value is 400.
  let useCredits = false;
  const useCreditsEntry = form.get("useCredits");
  if (useCreditsEntry !== null) {
    if (useCreditsEntry === "true") useCredits = true;
    else if (useCreditsEntry !== "false") {
      return json({ error: "useCredits must be \"true\" or \"false\"" }, 400);
    }
  }
  const parsed = parseVoicePinForm(form);
  if (!parsed.ok) {
    return json(parsed.code ? { code: parsed.code, error: parsed.error } : { error: parsed.error }, parsed.status);
  }
  const { audio, audioType, durationSeconds, language, requestId } = parsed;

  const postProcess = (await readOwnerDeliveryPreferences(env, principal.id)).voicePostProcessing;
  const spec = voicePinSpec(durationSeconds, postProcess);
  const transcriptionUnavailable = async (): Promise<Response | null> => {
    // D5: a configured and usable AI_TRANSCRIPTION_CHAIN keeps the route
    // available without the AI binding; the environment never decides the
    // provider (A50). F5/S3b: the gate runs only on the metered path —
    // the BYOK route never passes it (contract §5).
    if (env.AI) return null;
    const availability = await voiceAvailability(env);
    return availability.transcription ? null : json({ code: "ai_unavailable", error: "AI is not configured" }, 503);
  };
  const textUnavailable = async (): Promise<Response | null> => {
    // The mixed case's gate: the structuring is the metered call, so the
    // text path must be usable for the request to take the BYOK route.
    if (env.AI) return null;
    const availability = await voiceAvailability(env);
    return availability.text ? null : json({ code: "ai_unavailable", error: "AI is not configured" }, 503);
  };
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
    unavailable: transcriptionUnavailable,
    unavailableMessage: "Voice transcription unavailable",
    useCredits,
    byok: async () => {
      // F5/S3b (contract §5): the transcription decides the route. One slot
      // per request (the chat resolves without a second one — the calls are
      // sequential) and it is released exactly once in the finally; a cap
      // answers byok_error rate_limited (no queue), never a gateway
      // fallback.
      const { cloudByokRoute } = await import("../byok/route");
      const transcriptionRoute = await cloudByokRoute(env, principal, "transcription");
      if (transcriptionRoute === null) return null; // no route: the metered path
      if ("cause" in transcriptionRoute) return byokRateLimitedResponse();
      let structuringRoute: ByokRoute | null = null;
      const runTranscription = async (): Promise<{ detectedLanguage: string | null; transcript: string }> => {
        // The transcription on the user's endpoint: one call, the per-call
        // deadline, no retry on 429/503 (contract §5).
        const transcription = await byokTranscribe(transcriptionRoute, {
          audio,
          audioType,
          timeoutMs: 45_000,
        });
        const transcript = transcription.text.trim();
        // The 2xx without a usable transcript is the invalid_response of
        // the common table (the metered path's invalid_ai_response, the
        // same refusal, without a credit to refund).
        if (transcript === "") throw new ByokCallError({ cause: "invalid_response", retryAfterSeconds: null });
        const actualDuration = transcription.duration ?? durationSeconds;
        // F5 review F5 (rejected for this slice): the duration keeps
        // today's source — the metered path uses the same form field, the
        // BYOK's provider is the user's own, and the 5 MiB limit still
        // applies.
        if (actualDuration > MAX_DURATION_SECONDS + 1) {
          throw new ByokCallError({ cause: "invalid_response", retryAfterSeconds: null });
        }
        return { detectedLanguage: transcription.language, transcript };
      };
      // F5 review F4: the whole preparation (the chat's route, the text's
      // availability, the mixed's reservation) is inside the try/finally —
      // the slot is released exactly once, even when the preparation
      // throws.
      try {
        let mixed = false;
        if (postProcess) {
          // F5 review F2: the request's slot covers the whole sequence —
          // the transcription and the structuring are sequential, so the
          // chat resolves without a second slot (acquire: false).
          const chatRoute = await cloudByokRoute(env, principal, "chat", { acquire: false });
          if (chatRoute !== null && "cause" in chatRoute) {
            return byokRateLimitedResponse();
          }
          if (chatRoute === null) {
            // F5 review F1: the gateway's structuring is unavailable — the
            // same response as today for an unavailable structuring (the
            // mixed path's gate, no credit), keeping the BYOK decision:
            // never the "no route" sentinel after the transcription route
            // exists (that would send the audio to the gateway).
            const gate = await textUnavailable();
            if (gate !== null) return gate;
            mixed = true;
          } else {
            structuringRoute = chatRoute;
          }
        }
        if (mixed) {
          // The structuring goes to the metered path (the gateway, one
          // credit — the transcription does not charge): the pre-checks
          // (the plan, the limit) already ran in runMeteredAiFeature; the
          // success reports source byok (the origin of the request). F5
          // review F3: the mixed's reservation keeps its own identity
          // (voice:mixed:<requestId>), distinct from the full metered
          // path's (voice:<requestId>) — a reused requestId on the other
          // path conflicts (409) before any provider call, and the replay
          // returns the stored result's origin. The transcription runs
          // inside the path's execute, after the reservation, so a failed
          // transcription refunds the reserved credit.
          const mixedSpec: AiFeatureSpec = { ...spec, credits: 1, model: STRUCTURING_MODEL };
          // F5 review round 2: R2 — `return await`: the finally releases the
          // slot only after the protected work ends (the mixed path runs the
          // BYOK transcription inside `execute`); R1 — the transcription's
          // ByokCallError is mapped back to the byok_error with its cause
          // after the refund (the gateway's error — the structuring — stays
          // as today).
          return await runMeteredAiFeaturePath<VoicePinResult>({
            env,
            execute: async () => {
              const { detectedLanguage, transcript } = await runTranscription();
              const instructions = voicePinStructuringInstructions();
              const structureInput = JSON.stringify({ language, transcript });
              // D5: the AI_TEXT_CHAIN links when configured and usable,
              // else the AI binding, exactly as before.
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
              const costUsdMicros = structuringCost ?? Math.ceil(
                usage.inputTokens * STRUCTURING_INPUT_USD_PER_MILLION_TOKENS
                + usage.outputTokens * STRUCTURING_OUTPUT_USD_PER_MILLION_TOKENS,
              );
              return {
                result,
                telemetry: { costUsdMicros, ...usage },
              };
            },
            origin: "byok",
            onInferenceError: (error) => byokErrorResponse(error),
            parse: parseVoicePinResult,
            principal,
            request,
            requestId,
            resourceId: `voice:mixed:${requestId}`,
            spec: mixedSpec,
            unavailable: textUnavailable,
            unavailableMessage: "Voice transcription unavailable",
          });
        }
        const { detectedLanguage, transcript } = await runTranscription();
        if (!postProcess) {
          return await byokSuccessJson(env, principal, {
            acceptanceCriteria: [],
            comment: transcript.slice(0, 2_000),
            detectedLanguage,
            transcript: transcript.slice(0, 8_000),
          }, {
            costUsdMicros: 0,
            inputTokens: 0,
            model: transcriptionRoute.model,
            outputTokens: 0,
          });
        }
        // The structuring on the BYOK's chat (no credit): the same prompt
        // and the same parse as the metered path (contract §5).
        const structureInput = JSON.stringify({ language, transcript });
        const { inputTokens, outputTokens, text } = await byokChat(structuringRoute!, {
          maxTokens: spec.maxTokens,
          messages: [
            { content: voicePinStructuringInstructions(), role: "system" },
            { content: structureInput, role: "user" },
          ],
          timeoutMs: spec.timeoutMs,
        });
        const structuredJson = extractJsonObject(text);
        const result = parseVoicePinResult(JSON.stringify({
          acceptanceCriteria: structuredJson?.acceptanceCriteria,
          comment: structuredJson?.comment,
          detectedLanguage,
          transcript,
        }));
        if (!result) {
          // The structuring's refusal on the BYOK: the request fails with
          // the cause (today's gateway failure delivers nothing either),
          // without calling the gateway in its place and without a credit
          // to refund.
          throw new ByokCallError({ cause: "invalid_response", retryAfterSeconds: null });
        }
        return await byokSuccessJson(env, principal, result, {
          costUsdMicros: 0,
          inputTokens,
          model: `${transcriptionRoute.model} + ${structuringRoute!.model}`,
          outputTokens,
        });
      } catch (error) {
        const response = byokErrorResponse(error);
        if (response !== null) return response;
        // A failure that is not the classified BYOK (a server bug, not the
        // endpoint): it propagates like today's metered path (the global
        // handler's error), never a byok_error and never the gateway.
        throw error;
      } finally {
        // F5 review F4: the slot is released exactly once — the chat's
        // release is a no-op (it resolves without a slot, acquire: false).
        transcriptionRoute.release();
        structuringRoute?.release();
      }
    },
  });
}
