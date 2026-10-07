import { readAiSettings } from "@pinar/cli/ai-settings";
import { readDeliveryPreferences } from "@pinar/cli/preferences";
import { extractJsonObject } from "../cloud-api";
import { AiInferenceError } from "./inference";
import {
  configuredProvider,
  inferenceError,
  json,
  localAiVault,
} from "./local-ai";
import {
  MAX_DURATION_SECONDS,
  parseVoicePinForm,
  parseVoicePinResult,
  voicePinStructuringInstructions,
} from "./voice-common";

// Same limits as the cloud voice spec for the optional structuring pass.
const STRUCTURING_LIMITS = { maxTokens: 768, timeoutMs: 60_000 } as const;

// The client file name is never forwarded to the provider: a hostile name is
// only attacker-controlled data, while the audio type is already validated
// against ACCEPTED_AUDIO_TYPES, so the provider gets a fixed name per type.
function fixedAudioName(audioType: string): string {
  switch (audioType) {
    case "audio/mp4": return "audio.mp4";
    case "audio/mpeg": return "audio.mpeg";
    case "audio/ogg": return "audio.ogg";
    case "audio/wav": return "audio.wav";
    case "audio/webm":
    case "video/webm": return "audio.webm";
    default: return "audio.webm";
  }
}

/**
 * POST /api/ai/voice-pin (local) — same request and result contract as the
 * cloud route, without credits: the transcription uses the configured
 * OpenAI-compatible provider and the optional structuring pass uses its LLM
 * model. The audio stays in request memory only and is never written to disk.
 */
export async function handleLocalVoiceRequest(request: Request, root: string): Promise<Response> {
  const settings = await readAiSettings(root, localAiVault());
  if (settings.mode === "disabled" || !settings.transcriptionModel) {
    return json({ code: "ai_unavailable", error: "Configure a transcription model in Settings → AI" }, 503);
  }
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
  const { audio, audioType, durationSeconds, language } = parsed;
  const postProcess = readDeliveryPreferences(root).voicePostProcessing && Boolean(settings.model);
  try {
    const transcription = await (await configuredProvider(root, { model: settings.transcriptionModel }))
      .transcribe(audio, {
        filename: fixedAudioName(audioType),
        language,
        model: settings.transcriptionModel,
      });
    if ((transcription.duration || durationSeconds) > MAX_DURATION_SECONDS + 1) {
      return json({
        code: "invalid_audio_duration",
        error: "audio duration must be between 1 and 120 seconds",
      }, 400);
    }
    const detectedLanguage = transcription.language ?? null;
    const base = {
      creditsCharged: 0,
      ...(transcription.truncated ? { truncated: true } : {}),
      ok: true,
    };
    if (!postProcess) {
      return json({
        ...base,
        result: {
          acceptanceCriteria: [],
          comment: transcription.text.slice(0, 2_000),
          detectedLanguage,
          transcript: transcription.text.slice(0, 8_000),
        },
        usage: {
          costUsdMicros: 0,
          inputTokens: 0,
          model: settings.transcriptionModel,
          outputTokens: 0,
          provider: settings.mode,
        },
      });
    }
    const structured = await (await configuredProvider(root, { model: settings.model })).run({
      jsonObject: true,
      messages: [
        { content: voicePinStructuringInstructions(), role: "system" },
        { content: JSON.stringify({ language, transcript: transcription.text }), role: "user" },
      ],
      temperature: 0.1,
    }, STRUCTURING_LIMITS);
    const structuredJson = extractJsonObject(structured.text);
    const result = parseVoicePinResult(JSON.stringify({
      acceptanceCriteria: structuredJson?.acceptanceCriteria,
      comment: structuredJson?.comment,
      detectedLanguage,
      transcript: transcription.text,
    }));
    if (!result) {
      throw new AiInferenceError("invalid_ai_response", "The model returned a response that Pinar could not understand");
    }
    return json({
      ...base,
      result,
      usage: {
        costUsdMicros: 0,
        inputTokens: structured.usage.inputTokens,
        model: `${settings.transcriptionModel} + ${settings.model}`,
        outputTokens: structured.usage.outputTokens,
        provider: settings.mode,
      },
    });
  } catch (error) {
    return inferenceError(error);
  }
}
