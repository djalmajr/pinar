// Text embeddings over an OpenAI-compatible /embeddings endpoint (F3
// contract §1.2).
//
// embedTexts sends POST {baseUrl}/embeddings with exactly
// { dimensions: 256, input, model, prompt_name: kind }, in batches of up to
// EMBEDDING_BATCH_SIZE texts with at most EMBEDDING_CONCURRENCY requests in
// flight, each bounded by EMBEDDING_TIMEOUT_MS. A response whose count or
// dimensions differ from the request rejects the whole call; the first
// failing batch stops new batches from starting. Nothing is logged.
//
// Vectors are stored as Float32 little-endian bytes (encodeVector /
// decodeVector) and ranked by cosine.

import { postEndpointJson } from "./endpoint";

export const PIN_EMBEDDING_DIMENSIONS = 256;
export const EMBEDDING_BATCH_SIZE = 32;
export const EMBEDDING_CONCURRENCY = 3;
export const EMBEDDING_TIMEOUT_MS = 15_000;

export interface EmbeddingEndpoint {
  apiKey?: string;
  baseUrl: string;
  model: string;
}

const INVALID_RESPONSE = "embedding response invalid";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// One vector per input, in input order. Items are placed by `index` when
// every item carries one (OpenAI shape) and by position when none does; a
// mix of both is refused, since either reading may pair a vector with the
// wrong text.
function parseEmbeddings(body: unknown, count: number): number[][] {
  const data = isRecord(body) ? body["data"] : undefined;
  if (!Array.isArray(data) || data.length !== count) throw new Error(INVALID_RESPONSE);
  const withIndex = data.filter((item) => isRecord(item) && item["index"] !== undefined).length;
  if (withIndex !== 0 && withIndex !== data.length) throw new Error(INVALID_RESPONSE);
  const indexed = withIndex > 0;
  const vectors: Array<number[] | undefined> = new Array(count);
  data.forEach((item, position) => {
    if (!isRecord(item)) throw new Error(INVALID_RESPONSE);
    const slot = indexed ? item["index"] : position;
    if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 0 || slot >= count || vectors[slot] !== undefined) {
      throw new Error(INVALID_RESPONSE);
    }
    const embedding = item["embedding"];
    if (!Array.isArray(embedding) || embedding.length !== PIN_EMBEDDING_DIMENSIONS) throw new Error(INVALID_RESPONSE);
    if (!embedding.every((value) => typeof value === "number" && Number.isFinite(value))) throw new Error(INVALID_RESPONSE);
    vectors[slot] = embedding as number[];
  });
  return vectors as number[][];
}

export async function embedTexts(input: {
  endpoint: EmbeddingEndpoint;
  fetch?: typeof fetch;
  kind: "document" | "query";
  texts: string[];
  timeoutMs?: number;
}): Promise<number[][]> {
  if (input.texts.length === 0) return [];
  const batches: string[][] = [];
  for (let start = 0; start < input.texts.length; start += EMBEDDING_BATCH_SIZE) {
    batches.push(input.texts.slice(start, start + EMBEDDING_BATCH_SIZE));
  }
  const results: number[][][] = new Array(batches.length);
  let next = 0;
  let failed = false;

  async function worker(): Promise<void> {
    while (!failed && next < batches.length) {
      const current = next++;
      const batch = batches[current]!;
      try {
        const body = await postEndpointJson({
          apiKey: input.endpoint.apiKey,
          baseUrl: input.endpoint.baseUrl,
          body: { dimensions: PIN_EMBEDDING_DIMENSIONS, input: batch, model: input.endpoint.model, prompt_name: input.kind },
          fetch: input.fetch,
          label: "embedding request",
          path: "/embeddings",
          timeoutMs: input.timeoutMs ?? EMBEDDING_TIMEOUT_MS,
        });
        results[current] = parseEmbeddings(body, batch.length);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }

  const workers = Math.min(EMBEDDING_CONCURRENCY, batches.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results.flat();
}

// Float32 little-endian, 4 bytes per dimension.
export function encodeVector(vector: number[]): Uint8Array {
  const bytes = new Uint8Array(vector.length * 4);
  const view = new DataView(bytes.buffer);
  vector.forEach((value, index) => view.setFloat32(index * 4, value, true));
  return bytes;
}

export function decodeVector(bytes: Uint8Array): Float32Array {
  if (bytes.byteLength % 4 !== 0) throw new Error("invalid vector bytes");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const vector = new Float32Array(bytes.byteLength / 4);
  for (let index = 0; index < vector.length; index += 1) vector[index] = view.getFloat32(index * 4, true);
  return vector;
}

// Cosine similarity in [-1, 1]; 0 when the lengths differ or either
// vector is all zeros.
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const x = a[index]!;
    const y = b[index]!;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / Math.sqrt(normA * normB);
}
