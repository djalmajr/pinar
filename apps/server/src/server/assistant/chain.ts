// Assistant model chain (F4 contract §1, decisions A38 and A40).
//
// ASSISTANT_CHAIN is a CSV of `hub:model` links, tried in order. The chain
// is one LanguageModel built with wrapLanguageModel: its doStream wrapper
// opens the first link whose circuit breaker is closed and holds the parts
// that come before the first text or tool chunk (stream start, response
// metadata, reasoning). An error in that window passes to the next link
// when it is transient (429, 5xx, timeout, network) and ends the call when
// it is not (400/401/403 and other 4xx; 402 ends it as out of budget).
// Once the first text or tool chunk is out, the link is committed: a later
// error goes on to the turn and no other link is tried.
//
// Every committed call adds its billing under providerMetadata
// [ASSISTANT_CHAIN_METADATA_KEY] of the finish part: the link, its
// `hub:model`, whether it was a fallback and the cost in USD micros, read
// from providerMetadata.gateway.cost (decimal USD string, rounded up), or
// else the worst-case ASSISTANT_MODEL_PRICES table; the appliance costs 0.
// The turn adds the steps up (assistantTurnBilling). The UI message stream
// drops finish metadata (finish-step is sent bare), so the client stream
// does not change.
//
// Errors never carry the provider's URL, key or body: the chain throws
// AssistantChainError with a fixed message and no cause.

import { createGateway, wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware } from "ai";
import { assistantLanguageModel, assistantProviderOptions, guardRedirects, type ProviderOptions } from "./models";
import type { AssistantTurnBilling, AssistantTurnUsage } from "./turn";

export type { AssistantTurnBilling } from "./turn";

export type AssistantHub = "appliance" | "gateway";

export interface AssistantChainLink {
  hub: AssistantHub;
  model: string; // the hub's model id, e.g. "anthropic/claude-haiku-5.5"
}

export type AssistantDeployment = "production" | "staging" | "development";

export const ASSISTANT_CHAIN_MAX_LINKS = 4;

export type AssistantChainConfigReason =
  | "appliance_in_production"
  | "duplicate_link"
  | "empty"
  | "malformed_link"
  | "missing_hub_config"
  | "too_many_links"
  | "unknown_hub";

// The message and `reason` never quote the configuration.
export class AssistantChainConfigError extends Error {
  readonly reason: AssistantChainConfigReason;
  constructor(reason: AssistantChainConfigReason) {
    super(`invalid assistant chain: ${reason}`);
    this.name = "AssistantChainConfigError";
    this.reason = reason;
  }
}

const LINK_PATTERN = /^([^:\s]+):(\S+)$/;

/**
 * Reads ASSISTANT_CHAIN: 1 to 4 comma-separated `hub:model` links, no
 * repetition, hubs "appliance" and "gateway". Production refuses an
 * appliance link here, before any request.
 */
export function parseAssistantChain(csv: string, deployment: AssistantDeployment): AssistantChainLink[] {
  const items = csv.split(",").map((item) => item.trim());
  if (items.length === 1 && items[0] === "") throw new AssistantChainConfigError("empty");
  if (items.length > ASSISTANT_CHAIN_MAX_LINKS) throw new AssistantChainConfigError("too_many_links");
  const seen = new Set<string>();
  const chain: AssistantChainLink[] = [];
  for (const item of items) {
    const match = LINK_PATTERN.exec(item);
    if (!match) throw new AssistantChainConfigError("malformed_link");
    const [, hub, model] = match;
    if (hub !== "appliance" && hub !== "gateway") throw new AssistantChainConfigError("unknown_hub");
    if (seen.has(item)) throw new AssistantChainConfigError("duplicate_link");
    seen.add(item);
    chain.push({ hub, model });
  }
  if (deployment === "production" && chain.some((link) => link.hub === "appliance")) {
    throw new AssistantChainConfigError("appliance_in_production");
  }
  return chain;
}

export function assistantChainLinkName(link: AssistantChainLink): string {
  return `${link.hub}:${link.model}`;
}

// ---------- circuit breaker ----------

export const ASSISTANT_BREAKER_FAILURES = 3;
export const ASSISTANT_BREAKER_WINDOW_MS = 60_000;
export const ASSISTANT_BREAKER_OPEN_MS = 120_000;

/** Per link: 3 transient failures within 60 s open the link for 120 s. */
export interface AssistantCircuitBreaker {
  isOpen(link: AssistantChainLink): boolean;
  recordFailure(link: AssistantChainLink): void;
}

export function createAssistantCircuitBreaker(options: { now?: () => number } = {}): AssistantCircuitBreaker {
  const now = options.now ?? Date.now;
  const links = new Map<string, { failures: number[]; openUntil: number }>();
  return {
    isOpen(link) {
      const state = links.get(assistantChainLinkName(link));
      return state !== undefined && state.openUntil > now();
    },
    recordFailure(link) {
      const key = assistantChainLinkName(link);
      const at = now();
      const state = links.get(key) ?? { failures: [], openUntil: 0 };
      state.failures = state.failures.filter((failedAt) => at - failedAt < ASSISTANT_BREAKER_WINDOW_MS);
      state.failures.push(at);
      if (state.failures.length >= ASSISTANT_BREAKER_FAILURES) {
        state.openUntil = at + ASSISTANT_BREAKER_OPEN_MS;
        state.failures = [];
      }
      links.set(key, state);
    },
  };
}

/** True when every link of the chain is open: the turn is unavailable. */
export function assistantChainOpen(chain: AssistantChainLink[], breaker: AssistantCircuitBreaker): boolean {
  return chain.every((link) => breaker.isOpen(link));
}

// ---------- prices and cost ----------

/** USD per token, as decimal strings from the gateway catalog. */
export interface AssistantModelPrice {
  effectiveFrom: string;
  input: string;
  inputCacheRead: string;
  inputCacheWrite: string | null;
  output: string;
}

// The chain models of D4 at the public gateway catalog of 2026-10-17, in
// the worst case: the most expensive tier of each price, regional and
// "fast" variants included (/tmp/pinar-ai-assistant/f4/
// gateway-models-2026-10-17.json). Only a fallback for a gateway answer
// without providerMetadata.gateway.cost.
export const ASSISTANT_MODEL_PRICES: Readonly<Record<string, AssistantModelPrice>> = {
  "anthropic/claude-haiku-5.5": {
    effectiveFrom: "2026-10-17",
    input: "0.00000055",
    inputCacheRead: "0.000000055",
    inputCacheWrite: "0.0000006875",
    output: "0.00000275",
  },
  "deepseek/deepseek-v4.1-flash": {
    effectiveFrom: "2026-10-17",
    input: "0.0000006",
    inputCacheRead: "0.000000014",
    inputCacheWrite: null,
    output: "0.0000024",
  },
  "zai/glm-5.3-flash": {
    effectiveFrom: "2026-10-17",
    input: "0.00000015",
    inputCacheRead: "0.00000003",
    inputCacheWrite: null,
    output: "0.0000005",
  },
};

// Exact decimal arithmetic: amounts are BigInt counts of 1e-15 USD, enough
// for every catalog price (the smallest has 10 decimal places).
const FEMTO_DIGITS = 15;
const FEMTO_PER_MICRO = 10n ** 9n;
const DECIMAL_USD = /^\d+(\.\d+)?$/;

function femtoUsd(decimal: string): bigint | null {
  if (!DECIMAL_USD.test(decimal)) return null;
  const [whole, fraction = ""] = decimal.split(".");
  if (fraction.length > FEMTO_DIGITS) {
    // Round up past the 15th decimal place.
    const kept = BigInt(whole + fraction.slice(0, FEMTO_DIGITS));
    return /[1-9]/.test(fraction.slice(FEMTO_DIGITS)) ? kept + 1n : kept;
  }
  return BigInt(whole + fraction.padEnd(FEMTO_DIGITS, "0"));
}

function femtoToMicrosCeil(femto: bigint): number {
  return Number((femto + FEMTO_PER_MICRO - 1n) / FEMTO_PER_MICRO);
}

/** A decimal USD string to USD micros, rounded up; null when it is not a plain non-negative decimal. */
export function usdToMicrosCeil(decimal: string): number | null {
  const femto = femtoUsd(decimal);
  return femto === null ? null : femtoToMicrosCeil(femto);
}

interface ChainCallUsage {
  inputTokens: { cacheRead: number | undefined; cacheWrite: number | undefined; total: number | undefined };
  outputTokens: { total: number | undefined };
}

function tokens(value: number | undefined): bigint {
  return value !== undefined && Number.isFinite(value) && value > 0 ? BigInt(Math.ceil(value)) : 0n;
}

/**
 * The worst-case cost of one call from the price table: cache reads and
 * writes at their prices (a write without its own price at the input
 * price), the other input tokens at the input price and every output token
 * at the output price. Null without a price for the model.
 */
export function assistantTableCostMicros(model: string, usage: ChainCallUsage): number | null {
  const price = Object.hasOwn(ASSISTANT_MODEL_PRICES, model) ? ASSISTANT_MODEL_PRICES[model] : undefined;
  if (!price) return null;
  const input = femtoUsd(price.input)!;
  const cacheReadPrice = femtoUsd(price.inputCacheRead)!;
  const cacheWritePrice = price.inputCacheWrite === null ? input : femtoUsd(price.inputCacheWrite)!;
  const total = tokens(usage.inputTokens.total);
  const cacheRead = tokens(usage.inputTokens.cacheRead);
  const cacheWrite = tokens(usage.inputTokens.cacheWrite);
  const plain = total > cacheRead + cacheWrite ? total - cacheRead - cacheWrite : 0n;
  const femto = plain * input + cacheRead * cacheReadPrice + cacheWrite * cacheWritePrice
    + tokens(usage.outputTokens.total) * femtoUsd(price.output)!;
  return femtoToMicrosCeil(femto);
}

// ---------- errors ----------

export type AssistantChainErrorKind = "budget" | "fatal" | "transient";

/**
 * budget: 402; fatal: 400/401/403 and the other 4xx; transient: 408, 429,
 * 5xx, timeout and network. A status below 400 is a response that broke
 * while it was read (the gateway reports it with the response's 200), so
 * it is transient like an error with no status at all.
 */
export function classifyAssistantChainError(error: unknown): AssistantChainErrorKind {
  const status = typeof error === "object" && error !== null ? (error as { statusCode?: unknown }).statusCode : undefined;
  if (typeof status === "number" && status >= 400 && status < 500) {
    if (status === 402) return "budget";
    if (status === 408 || status === 429) return "transient";
    return "fatal";
  }
  return "transient";
}

export type AssistantChainFailure = "budget" | "fatal" | "unavailable";

const CHAIN_FAILURE_MESSAGES: Record<AssistantChainFailure, string> = {
  budget: "assistant chain out of budget",
  fatal: "assistant chain request refused",
  unavailable: "assistant_unavailable",
};

// What the chain throws: a fixed message, the failure kind and the HTTP
// status when there was one; never the provider's error.
export class AssistantChainError extends Error {
  readonly failure: AssistantChainFailure;
  readonly statusCode: number | undefined;
  constructor(failure: AssistantChainFailure, statusCode?: number) {
    super(CHAIN_FAILURE_MESSAGES[failure]);
    this.name = "AssistantChainError";
    this.failure = failure;
    this.statusCode = statusCode;
  }
}

// ---------- the chain model ----------

export interface AssistantChainAttempt {
  link: number;
  model: string; // "hub:model"
  // answered: committed (first text or tool chunk); skipped: breaker open
  outcome: "answered" | "skipped" | AssistantChainErrorKind;
}

/** What each committed call adds under providerMetadata[ASSISTANT_CHAIN_METADATA_KEY]. */
export const ASSISTANT_CHAIN_METADATA_KEY = "pinarChain";

interface ChainCallBilling {
  [key: string]: string | number | boolean | null;
  costSource: AssistantTurnBilling["costSource"];
  costUsdMicros: number | null;
  fallback: boolean;
  link: number;
  model: string;
}

type WrapStream = NonNullable<LanguageModelMiddleware["wrapStream"]>;
type ChainCallOptions = Parameters<WrapStream>[0]["params"];
type ChainModel = Parameters<WrapStream>[0]["model"];
type ChainStreamResult = Awaited<ReturnType<WrapStream>>;
type ChainStreamPart = ChainStreamResult["stream"] extends ReadableStream<infer Part> ? Part : never;
type FinishPart = Extract<ChainStreamPart, { type: "finish" }>;

// Parts that may come before the first text or tool chunk; they are held
// until the link commits and dropped if it fails.
const PREAMBLE_PARTS = new Set<string>([
  "raw",
  "reasoning-delta",
  "reasoning-end",
  "reasoning-file",
  "reasoning-start",
  "response-metadata",
  "stream-start",
  "text-start",
]);

function v4Model(model: LanguageModel): ChainModel {
  if (typeof model === "string" || model.specificationVersion !== "v4") {
    throw new Error("assistant chain link is not a v4 language model");
  }
  return model;
}

function callBilling(index: number, link: AssistantChainLink, finish: FinishPart): ChainCallBilling {
  const base = { fallback: index > 0, link: index, model: assistantChainLinkName(link) };
  if (link.hub === "appliance") return { ...base, costSource: "appliance", costUsdMicros: 0 };
  const cost = finish.providerMetadata?.["gateway"]?.["cost"];
  const fromGateway = typeof cost === "string" ? usdToMicrosCeil(cost) : null;
  if (fromGateway !== null) return { ...base, costSource: "gateway", costUsdMicros: fromGateway };
  const fromTable = assistantTableCostMicros(link.model, finish.usage);
  return fromTable === null
    ? { ...base, costSource: "none", costUsdMicros: null }
    : { ...base, costSource: "table", costUsdMicros: fromTable };
}

/**
 * One model over the chain (F4 contract §1). Each call opens the first
 * link whose breaker is closed; a transient error before the first text or
 * tool chunk records a breaker failure and moves to the next link. With
 * every link open or failed the call throws AssistantChainError
 * "unavailable". The caller's abort is rethrown as is and is never a
 * failure.
 *
 * The provider options of each call are the chain's own, whatever the
 * caller passed: a gateway link gets providerOptions.gateway with
 * disallowPromptTraining, caching "auto", sessionId (the conversation id)
 * and zeroDataRetention only when `gateway.zeroDataRetention`; never `only`
 * nor `order`. An appliance link gets enable_thinking false
 * (assistantProviderOptions) and the appliance headers.
 */
export function assistantChainModel(input: {
  appliance: { apiKey: string; baseUrl: string } | null;
  breaker: AssistantCircuitBreaker;
  chain: AssistantChainLink[];
  // the turn's thread (sessionId and X-Conversation-Id) and request
  context?: { conversationId: string; requestId: string };
  fetch?: typeof fetch;
  gateway: { apiKey: string; zeroDataRetention?: boolean } | null;
  onAttempt?: (attempt: AssistantChainAttempt) => void;
}): LanguageModel {
  if (input.chain.length === 0) throw new AssistantChainConfigError("empty");
  const context = input.context ?? { conversationId: crypto.randomUUID(), requestId: crypto.randomUUID() };
  // The key never follows a redirect (models.ts guardRedirects).
  const gateway = input.gateway
    ? createGateway({ apiKey: input.gateway.apiKey, fetch: guardRedirects(input.fetch ?? fetch) })
    : null;
  const gatewayOptions: ProviderOptions = {
    gateway: {
      caching: "auto",
      disallowPromptTraining: true,
      sessionId: context.conversationId,
      ...(input.gateway?.zeroDataRetention ? { zeroDataRetention: true } : {}),
    },
  };
  const applianceOptions = assistantProviderOptions({
    baseUrl: input.appliance?.baseUrl ?? "",
    kind: "appliance",
    model: "",
    thinkingControl: true,
  });
  const links = input.chain.map((link) => {
    if (link.hub === "gateway") {
      if (!gateway) throw new AssistantChainConfigError("missing_hub_config");
      return { link, model: v4Model(gateway.languageModel(link.model)), providerOptions: gatewayOptions };
    }
    if (!input.appliance) throw new AssistantChainConfigError("missing_hub_config");
    const model = assistantLanguageModel(
      { apiKey: input.appliance.apiKey, baseUrl: input.appliance.baseUrl, kind: "appliance", model: link.model, thinkingControl: true },
      { conversationId: context.conversationId, fetch: input.fetch, requestId: context.requestId },
    );
    return { link, model: v4Model(model), providerOptions: applianceOptions };
  });
  const report = (attempt: AssistantChainAttempt) => {
    try {
      input.onAttempt?.(attempt);
    } catch {
      // A reporting failure never changes the call.
    }
  };

  const stream = async (params: ChainCallOptions): Promise<ChainStreamResult> => {
    const signal = params.abortSignal;
    let lastStatus: number | undefined;
    for (const [index, entry] of links.entries()) {
      const name = assistantChainLinkName(entry.link);
      if (input.breaker.isOpen(entry.link)) {
        report({ link: index, model: name, outcome: "skipped" });
        continue;
      }
      signal?.throwIfAborted();
      let failure: unknown;
      let failed = false;
      let result: ChainStreamResult | undefined;
      let reader: ReadableStreamDefaultReader<ChainStreamPart> | undefined;
      const held: ChainStreamPart[] = [];
      try {
        result = await entry.model.doStream({ ...params, providerOptions: entry.providerOptions });
        reader = result.stream.getReader();
        // Hold the parts until the first text or tool chunk (or the end).
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          if (next.value.type === "error") {
            failed = true;
            failure = next.value.error;
            break;
          }
          held.push(next.value);
          if (!PREAMBLE_PARTS.has(next.value.type)) break;
        }
      } catch (error) {
        failed = true;
        failure = error;
      }
      if (failed) {
        reader?.cancel().catch(() => {});
        // The caller's abort is not the link's failure.
        signal?.throwIfAborted();
        const kind = classifyAssistantChainError(failure);
        const status = (failure as { statusCode?: unknown } | null)?.statusCode;
        lastStatus = typeof status === "number" ? status : undefined;
        report({ link: index, model: name, outcome: kind });
        if (kind === "budget") throw new AssistantChainError("budget", lastStatus);
        if (kind === "fatal") throw new AssistantChainError("fatal", lastStatus);
        input.breaker.recordFailure(entry.link);
        continue;
      }
      report({ link: index, model: name, outcome: "answered" });
      const committed = reader!;
      const withBilling = (part: ChainStreamPart): ChainStreamPart => {
        if (part.type !== "finish") return part;
        return {
          ...part,
          providerMetadata: { ...part.providerMetadata, [ASSISTANT_CHAIN_METADATA_KEY]: callBilling(index, entry.link, part) },
        };
      };
      let brokenAfterCommit = false;
      const afterCommitFailure = (error: unknown) => {
        // A transient failure after the commit still counts against the
        // link (once per call), unless the caller aborted.
        if (brokenAfterCommit || signal?.aborted) return;
        brokenAfterCommit = true;
        if (classifyAssistantChainError(error) === "transient") input.breaker.recordFailure(entry.link);
      };
      return {
        ...result!,
        stream: new ReadableStream<ChainStreamPart>({
          async pull(controller) {
            const heldPart = held.shift();
            if (heldPart) {
              controller.enqueue(withBilling(heldPart));
              return;
            }
            try {
              const next = await committed.read();
              if (next.done) {
                controller.close();
                return;
              }
              if (next.value.type === "error") afterCommitFailure(next.value.error);
              controller.enqueue(withBilling(next.value));
            } catch (error) {
              afterCommitFailure(error);
              controller.error(error);
            }
          },
          cancel(reason) {
            return committed.cancel(reason);
          },
        }),
      };
    }
    throw new AssistantChainError("unavailable", lastStatus);
  };

  const middleware: LanguageModelMiddleware = {
    specificationVersion: "v4",
    // The assistant turn only streams; a generate call would bypass the
    // chain, so it is refused.
    wrapGenerate: async () => {
      throw new AssistantChainError("fatal");
    },
    wrapStream: ({ params }) => stream(params),
  };
  return wrapLanguageModel({ middleware, model: links[0].model });
}

// ---------- the turn's billing ----------

const COST_SOURCE_RANK: Record<AssistantTurnBilling["costSource"], number> = {
  appliance: 0,
  gateway: 1,
  none: 3,
  table: 2,
};

function chainBillingOf(metadata: unknown): ChainCallBilling | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const value = (metadata as Record<string, unknown>)[ASSISTANT_CHAIN_METADATA_KEY];
  if (typeof value !== "object" || value === null) return null;
  const billing = value as Partial<ChainCallBilling>;
  if (typeof billing.link !== "number" || typeof billing.model !== "string" || typeof billing.fallback !== "boolean") return null;
  if (billing.costSource === undefined || !(billing.costSource in COST_SOURCE_RANK)) return null;
  if (billing.costUsdMicros !== null && typeof billing.costUsdMicros !== "number") return null;
  return billing as ChainCallBilling;
}

/**
 * The turn's billing from its steps' chain metadata, or undefined when no
 * step went through the chain (the local app). Link and model are the last
 * chain step's; fallback is true when any step was answered by a later
 * link; the cost is the sum (null when a step had no cost) and its source
 * the least reliable one (none, then table, then gateway, then appliance).
 * `usage` is the turn's total.
 */
export function assistantTurnBilling(
  steps: ReadonlyArray<{ providerMetadata?: unknown }>,
  usage: AssistantTurnUsage,
): AssistantTurnBilling | undefined {
  const calls = steps.map((step) => chainBillingOf(step.providerMetadata)).filter((call) => call !== null);
  const last = calls.at(-1);
  if (!last) return undefined;
  let costUsdMicros: number | null = 0;
  let costSource: AssistantTurnBilling["costSource"] = "appliance";
  for (const call of calls) {
    costUsdMicros = costUsdMicros === null || call.costUsdMicros === null ? null : costUsdMicros + call.costUsdMicros;
    if (COST_SOURCE_RANK[call.costSource] > COST_SOURCE_RANK[costSource]) costSource = call.costSource;
  }
  return {
    costSource,
    costUsdMicros,
    fallback: calls.some((call) => call.fallback),
    link: last.link,
    model: last.model,
    usage,
  };
}
