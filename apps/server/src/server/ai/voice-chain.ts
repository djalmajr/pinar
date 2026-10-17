// Voice and text chains (D5, decision of 17/10): AI_TRANSCRIPTION_CHAIN
// (voice transcription) and AI_TEXT_CHAIN (the short text calls without
// tools: the reproduction steps and the voice-note structuring), in the
// same CSV `hub:model` format as ASSISTANT_CHAIN (assistant/chain.ts).
// The environment never decides the provider (A50): an "appliance" link
// uses the AI binding, or the OpenAI-compatible endpoint of AI_BASE_URL
// with the link's model (as the rest of the code does), and a "gateway"
// link uses the AI SDK's Vercel AI Gateway provider
// (createGateway().transcriptionModel(id) / .languageModel(id)) with
// AI_GATEWAY_API_KEY.
//
// The per-call privacy options are the assistant's: disallowPromptTraining
// always, zeroDataRetention only when AI_GATEWAY_ZERO_DATA_RETENTION is
// "true" (gatewayPrivacyOptions, assistant/retrieval/gateway.ts).
//
// Link switching: a transient error (429, 5xx, network, timeout) before
// any result moves to the next link; 400/401/403 (and 402) end the call
// (classifyAssistantChainError, assistant/chain.ts).
//
// Cost: a gateway call reports providerMetadata.gateway.marketCost (with
// BYOK the cost is 0 and the real cost is in marketCost), else cost;
// without either the caller keeps its own estimate.
//
// The AI SDK imports stay lazy (loaded only when a chain is actually
// used), as the assistant's chain.
//
// Errors never carry the provider's URL, key or body: the chain throws
// VoiceChainError with a fixed message and no cause.

import type { AssistantChainLink, AssistantHub } from "../assistant/chain";
import { cloudflareAiProvider, type AiInferenceResult, type AiPrompt } from "./inference";
import type { CloudEnv } from "../cloud-api";
import { createOpenAiCompatibleAi } from "../edger/openai-compatible-ai";

export type VoiceChainHub = AssistantHub;
export type VoiceChainLink = AssistantChainLink;

export type VoiceChainFailure = "out_of_budget" | "refused" | "unavailable";

const VOICE_CHAIN_FAILURE_MESSAGES: Record<VoiceChainFailure, string> = {
  out_of_budget: "voice chain out of budget",
  refused: "voice chain request refused",
  unavailable: "voice chain unavailable",
};

export class VoiceChainError extends Error {
  readonly failure: VoiceChainFailure;
  constructor(failure: VoiceChainFailure) {
    super(VOICE_CHAIN_FAILURE_MESSAGES[failure]);
    this.name = "VoiceChainError";
    this.failure = failure;
  }
}

// ---------- configuration ----------

// An invalid chain is logged once per process per variable (the reason
// only, never a value) and counts as absent.
const configErrorsLogged = new Set<string>();

async function parseVoiceChain(csv: string | undefined, variable: string): Promise<VoiceChainLink[] | null> {
  const value = csv?.trim();
  if (!value) return null;
  const { AssistantChainConfigError, parseAssistantChain } = await import("../assistant/chain");
  try {
    return parseAssistantChain(value);
  } catch (error) {
    if (!configErrorsLogged.has(variable)) {
      configErrorsLogged.add(variable);
      console.error(JSON.stringify({
        message: "voice_chain_config_error",
        reason: error instanceof AssistantChainConfigError ? error.reason : "invalid",
        variable,
      }));
    }
    return null;
  }
}

/** The voice transcription chain (AI_TRANSCRIPTION_CHAIN); null when absent or invalid. */
export async function transcriptionChain(env: CloudEnv): Promise<VoiceChainLink[] | null> {
  return parseVoiceChain(env.AI_TRANSCRIPTION_CHAIN, "AI_TRANSCRIPTION_CHAIN");
}

/** The short text chain (AI_TEXT_CHAIN); null when absent or invalid. */
export async function textChain(env: CloudEnv): Promise<VoiceChainLink[] | null> {
  return parseVoiceChain(env.AI_TEXT_CHAIN, "AI_TEXT_CHAIN");
}

export function hubUsable(env: CloudEnv, hub: VoiceChainHub): boolean {
  if (hub === "gateway") return env.AI_GATEWAY_API_KEY !== undefined;
  return env.AI !== undefined || (env.AI_BASE_URL !== undefined && env.AI_API_KEY !== undefined);
}

export function chainUsable(env: CloudEnv, links: VoiceChainLink[] | null): boolean {
  return links !== null && links.some((link) => hubUsable(env, link.hub));
}

/**
 * The voice features' availability and /api/health's hasAi (D5): the AI
 * binding, or a configured and usable chain — the environment never decides
 * the provider (A50). `transcription` gates the voice route, `text` the
 * reproduction route and `any` is hasAi.
 */
export async function voiceAvailability(env: CloudEnv): Promise<{ any: boolean; text: boolean; transcription: boolean }> {
  const [transcription, text] = await Promise.all([transcriptionChain(env), textChain(env)]);
  const hasTranscription = env.AI !== undefined || chainUsable(env, transcription);
  const hasText = env.AI !== undefined || chainUsable(env, text);
  return { any: hasTranscription || hasText, text: hasText, transcription: hasTranscription };
}

// ---------- the link loop ----------

/**
 * The links in order: a transient error before any result records nothing
 * and moves to the next link; 400/401/403 (and 402) end the call. A link
 * whose hub has no configuration (no AI_GATEWAY_API_KEY; no AI binding and
 * no AI_BASE_URL/AI_API_KEY pair) is skipped. With every link failed or
 * skipped the chain throws VoiceChainError "unavailable".
 */
async function runLinks<T>(
  env: CloudEnv,
  links: VoiceChainLink[],
  call: (link: VoiceChainLink, index: number) => Promise<T>,
): Promise<{ hub: VoiceChainHub; index: number; model: string; value: T }> {
  const { classifyAssistantChainError } = await import("../assistant/chain");
  for (const [index, link] of links.entries()) {
    if (!hubUsable(env, link.hub)) continue;
    try {
      const value = await call(link, index);
      return { hub: link.hub, index, model: `${link.hub}:${link.model}`, value };
    } catch (error) {
      const kind = classifyAssistantChainError(error);
      if (kind === "transient") continue;
      throw new VoiceChainError(kind === "budget" ? "out_of_budget" : "refused");
    }
  }
  throw new VoiceChainError("unavailable");
}

// ---------- cost ----------

/**
 * The USD micros of providerMetadata.gateway: marketCost (the real cost
 * with BYOK, where cost comes 0), else cost. Null without a usable one.
 */
async function gatewayCostMicros(providerMetadata: Record<string, unknown> | undefined): Promise<number | null> {
  if (providerMetadata === undefined) return null;
  const gateway = providerMetadata["gateway"];
  if (typeof gateway !== "object" || gateway === null) return null;
  const record = gateway as Record<string, unknown>;
  const { usdToMicrosCeil } = await import("../assistant/chain");
  for (const key of ["marketCost", "cost"]) {
    const value = record[key];
    if (typeof value !== "string") continue;
    const micros = usdToMicrosCeil(value);
    if (micros !== null) return micros;
  }
  return null;
}

function positiveToken(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.ceil(value) : 0;
}

// ---------- transcription ----------

export interface TranscriptionChainInput {
  audio: Blob;
  audioType: string;
  language: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

/**
 * The normalized output the route reads (the Workers AI /
 * OpenAI-compatible shape: text and, when the provider reports it,
 * transcription_info.duration/language), plus the link that answered.
 */
export interface TranscriptionChainResult {
  costUsdMicros: number | null;
  hub: VoiceChainHub;
  index: number;
  model: string;
  output: { text: string; transcription_info?: { duration?: number; language?: string } };
}

/** Runs the AI_TRANSCRIPTION_CHAIN links in order over one clip. */
export async function runTranscriptionChain(
  env: CloudEnv,
  links: VoiceChainLink[],
  input: TranscriptionChainInput,
): Promise<TranscriptionChainResult> {
  const zeroDataRetention = env.AI_GATEWAY_ZERO_DATA_RETENTION === "true";
  const { hub, index, model, value } = await runLinks(env, links, async (link) => {
    if (link.hub === "gateway") {
      const { createGateway, transcribe } = await import("ai");
      const { gatewayPrivacyOptions } = await import("../assistant/retrieval/gateway");
      const { guardRedirects } = await import("../assistant/models");
      const gateway = createGateway({
        apiKey: env.AI_GATEWAY_API_KEY!,
        fetch: guardRedirects(input.fetch ?? fetch),
      });
      const result = await transcribe({
        model: gateway.transcriptionModel(link.model),
        audio: new Uint8Array(await input.audio.arrayBuffer()),
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(input.timeoutMs),
        providerOptions: gatewayPrivacyOptions({ zeroDataRetention }),
      });
      const info: { duration?: number; language?: string } = {};
      if (typeof result.durationInSeconds === "number" && Number.isFinite(result.durationInSeconds)) {
        info.duration = result.durationInSeconds;
      }
      if (typeof result.language === "string" && result.language !== "") info.language = result.language;
      return {
        costUsdMicros: await gatewayCostMicros(result.providerMetadata),
        output: { ...(Object.keys(info).length > 0 ? { transcription_info: info } : {}), text: result.text },
      };
    }
    const ai = env.AI ?? createOpenAiCompatibleAi({
      apiKey: env.AI_API_KEY!,
      baseUrl: env.AI_BASE_URL!,
      chatModel: link.model,
      ...(input.fetch !== undefined ? { fetch: input.fetch } : {}),
      transcriptionModel: link.model,
    });
    const output: unknown = await ai.run(
      link.model,
      {
        audio: { body: input.audio.stream(), contentType: input.audioType },
        language: input.language,
        task: "transcribe",
        vad_filter: true,
      },
      { signal: AbortSignal.timeout(input.timeoutMs) },
    );
    return { costUsdMicros: null, output: output as TranscriptionChainResult["output"] };
  });
  return { costUsdMicros: value.costUsdMicros, hub, index, model, output: value.output };
}

// ---------- text ----------

export interface TextChainInput {
  maxTokens: number;
  // The same prompt shape cloudflareAiProvider sends to the appliance.
  prompt: { jsonObject?: boolean; messages: AiPrompt["messages"]; temperature?: number };
  timeoutMs: number;
  fetch?: typeof fetch;
}

export interface TextChainResult {
  costUsdMicros: number | null;
  hub: VoiceChainHub;
  index: number;
  model: string;
  text: string;
  usage: { inputTokens: number; outputTokens: number };
}

/** Runs the AI_TEXT_CHAIN links in order over one short text call. */
export async function runTextChain(
  env: CloudEnv,
  links: VoiceChainLink[],
  input: TextChainInput,
): Promise<TextChainResult> {
  const zeroDataRetention = env.AI_GATEWAY_ZERO_DATA_RETENTION === "true";
  const { hub, index, model, value } = await runLinks(env, links, async (link) => {
    if (link.hub === "gateway") {
      const { createGateway } = await import("ai");
      const { gatewayPrivacyOptions } = await import("../assistant/retrieval/gateway");
      const { guardRedirects } = await import("../assistant/models");
      const gateway = createGateway({
        apiKey: env.AI_GATEWAY_API_KEY!,
        fetch: guardRedirects(input.fetch ?? fetch),
      });
      // The call goes through doGenerate (the assistant chain's pattern,
      // chain.ts), not generateText: ai@7's generateText wraps the
      // gateway's 401 and drops its statusCode, which would turn a fatal
      // refusal into a transient one. The gateway's errors keep theirs.
      const systemContent = input.prompt.messages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n\n");
      const userContent = input.prompt.messages
        .filter((message) => message.role === "user")
        .map((message) => message.content)
        .join("\n\n");
      const result = await gateway.languageModel(link.model).doGenerate({
        prompt: [
          ...(systemContent ? [{ content: systemContent, role: "system" as const }] : []),
          { content: [{ text: userContent, type: "text" as const }], role: "user" as const },
        ],
        maxOutputTokens: input.maxTokens,
        ...(input.prompt.temperature !== undefined ? { temperature: input.prompt.temperature } : {}),
        ...(input.prompt.jsonObject ? { responseFormat: { type: "json" as const } } : {}),
        providerOptions: gatewayPrivacyOptions({ zeroDataRetention }),
        abortSignal: AbortSignal.timeout(input.timeoutMs),
      });
      const text = result.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
      // The same length/4 estimate the file already uses when the
      // provider reports no usage.
      const usage = {
        inputTokens: positiveToken(result.usage?.inputTokens?.total) || Math.ceil(userContent.length / 4),
        outputTokens: positiveToken(result.usage?.outputTokens?.total) || Math.ceil(text.length / 4),
      };
      return {
        costUsdMicros: await gatewayCostMicros(result.providerMetadata),
        text,
        usage,
      };
    }
    const ai = env.AI ?? createOpenAiCompatibleAi({
      apiKey: env.AI_API_KEY!,
      baseUrl: env.AI_BASE_URL!,
      chatModel: link.model,
      ...(input.fetch !== undefined ? { fetch: input.fetch } : {}),
      transcriptionModel: link.model,
    });
    const inference: AiInferenceResult = await cloudflareAiProvider(ai as Ai, link.model).run(
      {
        ...(input.prompt.jsonObject !== undefined ? { jsonObject: input.prompt.jsonObject } : {}),
        messages: input.prompt.messages,
        ...(input.prompt.temperature !== undefined ? { temperature: input.prompt.temperature } : {}),
      },
      { maxTokens: input.maxTokens, timeoutMs: input.timeoutMs },
    );
    return { costUsdMicros: null, text: inference.text, usage: inference.usage };
  });
  return { costUsdMicros: value.costUsdMicros, hub, index, model, text: value.text, usage: value.usage };
}
