// The `similarity` engine (F3.5 contract §1): the capture text is embedded
// as a query and compared by cosine with each collection's centroid, the
// normalized mean of the F3 index vectors of its recent sessions. The
// embedding request has the F3 protections, a FILING_TIMEOUT_MS deadline,
// and the caller's signal also cuts it.

import { cosine, embedTexts, type EmbeddingEndpoint } from "../assistant/retrieval/embeddings";
import { withAbortSignal } from "../assistant/retrieval/index";
import { FILING_TIMEOUT_MS, type FilingCandidate } from "./constants";

// The mean of `vectors` scaled to unit length (the sum points the same
// way); null without vectors or when they cancel out.
export function collectionCentroid(vectors: number[][]): number[] | null {
  if (vectors.length === 0) return null;
  const sum = new Array<number>(vectors[0]!.length).fill(0);
  for (const vector of vectors) {
    if (vector.length !== sum.length) throw new Error("invalid vector");
    vector.forEach((value, index) => {
      sum[index]! += value;
    });
  }
  const norm = Math.sqrt(sum.reduce((total, value) => total + value * value, 0));
  if (!Number.isFinite(norm)) throw new Error("invalid vector");
  return norm === 0 ? null : sum.map((value) => value / norm);
}

// Candidates by cosine, best first (ties keep the caller's order). A
// candidate whose centroid is null is left out; a centroid that does not
// match the query's dimensions is refused.
export async function rankBySimilarity(input: {
  candidates: FilingCandidate[];
  centroid(collectionId: string): Promise<number[] | null>;
  embedding: EmbeddingEndpoint;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  text: string;
}): Promise<Array<{ candidate: FilingCandidate; score: number }>> {
  input.signal?.throwIfAborted();
  const [vectors, centroids] = await Promise.all([
    embedTexts({
      endpoint: input.embedding,
      fetch: withAbortSignal(input.fetch, input.signal),
      kind: "query",
      texts: [input.text],
      timeoutMs: FILING_TIMEOUT_MS,
    }),
    Promise.all(input.candidates.map((candidate) => input.centroid(candidate.collectionId))),
  ]);
  const query = vectors[0]!;
  const ranked: Array<{ candidate: FilingCandidate; score: number }> = [];
  input.candidates.forEach((candidate, index) => {
    const centroid = centroids[index];
    if (!centroid) return;
    if (centroid.length !== query.length || !centroid.every(Number.isFinite)) throw new Error("collection centroid invalid");
    ranked.push({ candidate, score: cosine(query, centroid) });
  });
  return ranked.sort((a, b) => b.score - a.score);
}
