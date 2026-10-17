// Retrieval over the Vercel AI Gateway (F4 contract §4, decision A44): the
// OpenAI-compatible endpoint, the privacy options of each call and the cost
// log the margin monitor (S3) reads.
//
// The gateway's OpenAI-compatible API takes its options in the request
// body as `providerOptions.gateway` (chat completions and embeddings) and
// reports the cost of a call as `providerMetadata.gateway.cost`, a decimal
// USD string, in the response body. The calls send only what the chain
// sends for privacy: disallowPromptTraining always, zeroDataRetention only
// when AI_GATEWAY_ZERO_DATA_RETENTION is "true".
//
// The calls of a deployment with a recorder (GatewayCallOptions.record) also
// hand each cost to it (recordIndexCost), for the margin monitor's durable
// assistant_index_costs (F4 contract §3); a failing recorder is logged as
// assistant_index_cost_record_failed and never fails the call.
//
// assistantIndexCostLog writes one JSON line per embedding batch or caption
// that got a response body: the kind, the gateway model id, the cost in USD
// micros and where it came from. costSource is "gateway" for
// providerMetadata.gateway.cost, "table" for the catalog price × tokens
// (embeddings: the model's pricing.input × usage.prompt_tokens; captions:
// ASSISTANT_MODEL_PRICES of chain.ts), and "none", with a null cost, without
// either. It never carries the key, a URL or any text of the person.

import { usdToMicrosCeil } from "../chain";

/** The gateway's OpenAI-compatible base URL (F4 contract §4). */
export const GATEWAY_OPENAI_BASE_URL = "https://ai-gateway.vercel.sh/v1";

/** How a retrieval call goes through the gateway. */
export interface GatewayCallOptions {
  // Records each call's cost durably (the margin monitor); none in tests or
  // without a database.
  record?: (entry: IndexCostEntry) => Promise<void>;
  zeroDataRetention: boolean;
}

/** An embedding call through the gateway: its options and the catalog's pricing.input of the model. */
export interface GatewayEmbeddingOptions extends GatewayCallOptions {
  inputPrice: string | null;
}

export type IndexCostSource = "gateway" | "none" | "table";

export interface IndexCost {
  costSource: IndexCostSource;
  costUsdMicros: number | null;
}

/** One index call's cost: the fields of the assistant_index_cost line. */
export type IndexCostEntry = IndexCost & { kind: "caption" | "embedding"; model: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The body field that carries the privacy options of one call. */
export function gatewayPrivacyOptions(options: GatewayCallOptions): { gateway: Record<string, boolean> } {
  return {
    gateway: {
      disallowPromptTraining: true,
      ...(options.zeroDataRetention ? { zeroDataRetention: true } : {}),
    },
  };
}

/** USD micros of `providerMetadata.gateway.cost` in a response body, rounded up; null without a valid one. */
export function gatewayResponseCostMicros(body: unknown): number | null {
  const metadata = isRecord(body) ? body["providerMetadata"] : undefined;
  const gateway = isRecord(metadata) ? metadata["gateway"] : undefined;
  const cost = isRecord(gateway) ? gateway["cost"] : undefined;
  return typeof cost === "string" ? usdToMicrosCeil(cost) : null;
}

const DECIMAL_USD = /^\d+(\.\d+)?$/;

/** `price` (decimal USD per token) × `tokens`, in USD micros rounded up; null when either is not usable. */
export function priceTimesTokensMicros(price: string | null, tokens: number | null): number | null {
  if (price === null || !DECIMAL_USD.test(price)) return null;
  if (tokens === null || !Number.isInteger(tokens) || tokens < 0) return null;
  const [whole, fraction = ""] = price.split(".");
  const numerator = BigInt(whole + fraction) * BigInt(tokens) * 1_000_000n;
  const denominator = 10n ** BigInt(fraction.length);
  return Number((numerator + denominator - 1n) / denominator);
}

/** The token count a response body reports in `usage[field]`, or null. */
export function usageTokens(body: unknown, field: string): number | null {
  const usage = isRecord(body) ? body["usage"] : undefined;
  const value = isRecord(usage) ? usage[field] : undefined;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/** The cost of one call: the gateway's own figure, else `table()`, else none. */
export function gatewayIndexCost(body: unknown, table: () => number | null): IndexCost {
  const reported = gatewayResponseCostMicros(body);
  if (reported !== null) return { costSource: "gateway", costUsdMicros: reported };
  const estimated = table();
  return estimated === null ? { costSource: "none", costUsdMicros: null } : { costSource: "table", costUsdMicros: estimated };
}

/** One `assistant_index_cost` line: kind, model, cost and its source; nothing else. */
export function assistantIndexCostLog(entry: IndexCostEntry): void {
  console.log(JSON.stringify({
    message: "assistant_index_cost",
    kind: entry.kind,
    model: entry.model,
    costUsdMicros: entry.costUsdMicros,
    costSource: entry.costSource,
  }));
}

/** Hands `entry` to the call's recorder, if any; a failure is logged with the kind and model only. */
export async function recordIndexCost(options: GatewayCallOptions, entry: IndexCostEntry): Promise<void> {
  if (!options.record) return;
  try {
    await options.record(entry);
  } catch {
    console.error(JSON.stringify({ message: "assistant_index_cost_record_failed", kind: entry.kind, model: entry.model }));
  }
}
