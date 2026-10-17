// Client of the appliance's POST /v1/decisions (F3.5 contract §1).
//
// decideCollection asks one question whose options are the candidate
// labels followed by FILING_NONE_OPTION; the capture text is the `state`
// and the `instructions` list each label with its example titles. The
// request goes through postEndpointJson, so it has the F1 protections (base
// URL validated, redirects refused, key only in Authorization, errors that
// never carry the URL, the key or a body) and a FILING_TIMEOUT_MS deadline;
// the caller's signal also cuts it, and an aborted signal sends nothing.
//
// A response that is not exactly one decision for the question, with a
// choice among the options at the highest probability and every
// probability a number in [0, 1], is refused as a whole.

import type { AssistantEndpoint } from "../assistant/models";
import { oneLine } from "../assistant/retrieval/document";
import { postEndpointJson } from "../assistant/retrieval/endpoint";
import { withAbortSignal } from "../assistant/retrieval/index";
import { FILING_NONE_OPTION, FILING_TIMEOUT_MS, type FilingCandidate } from "./constants";

const QUESTION_ID = "collection";
const QUESTION = "Which collection should this capture go to?";
const INVALID_RESPONSE = "decisions response invalid";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Labels and titles are written as JSON strings: each stays on its line and
// a label reads exactly as its option.
function instructionsFor(candidates: FilingCandidate[]): string {
  const collections = candidates.map(({ examples, label }) =>
    examples.length > 0
      ? `- ${JSON.stringify(label)} (recent captures: ${examples.map((title) => JSON.stringify(oneLine(title))).join(", ")})`
      : `- ${JSON.stringify(label)} (no captures yet)`,
  );
  return [
    "A web page capture is filed into one of these collections, listed with titles of captures already in them:",
    ...collections,
    `Answer ${JSON.stringify(FILING_NONE_OPTION)} when no collection clearly fits the capture.`,
  ].join("\n");
}

// How far from 1 the returned probabilities may sum (rounding in the reply).
const PROBABILITY_SUM_TOLERANCE = 0.01;

function readDecision(body: unknown, options: string[]): { choice: string; probabilities: Map<string, number> } {
  const decisions = isRecord(body) ? body["decisions"] : undefined;
  if (!Array.isArray(decisions) || decisions.length !== 1) throw new Error(INVALID_RESPONSE);
  const decision: unknown = decisions[0];
  if (!isRecord(decision) || decision["id"] !== QUESTION_ID) throw new Error(INVALID_RESPONSE);
  const choice = decision["choice"];
  const returned = decision["probabilities"];
  if (typeof choice !== "string" || !options.includes(choice) || !isRecord(returned)) throw new Error(INVALID_RESPONSE);
  const probabilities = new Map<string, number>();
  for (const [option, value] of Object.entries(returned)) {
    if (!options.includes(option) || typeof value !== "number" || !(value >= 0 && value <= 1)) {
      throw new Error(INVALID_RESPONSE);
    }
    probabilities.set(option, value);
  }
  const chosen = probabilities.get(choice);
  if (chosen === undefined || [...probabilities.values()].some((value) => value > chosen)) throw new Error(INVALID_RESPONSE);
  // The appliance renormalizes over the valid options, so the values sum to
  // 1; a distribution that does not would make the confidence floor meaningless.
  const total = [...probabilities.values()].reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 1) > PROBABILITY_SUM_TOLERANCE) throw new Error(INVALID_RESPONSE);
  return { choice, probabilities };
}

// collectionId is null when the appliance chose FILING_NONE_OPTION;
// confidence is the highest probability among the candidate labels (an
// option missing from the response counts as 0).
export async function decideCollection(input: {
  candidates: FilingCandidate[];
  endpoint: AssistantEndpoint;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  text: string;
}): Promise<{ collectionId: string | null; confidence: number }> {
  input.signal?.throwIfAborted();
  const options = [...input.candidates.map((candidate) => candidate.label), FILING_NONE_OPTION];
  const body = await postEndpointJson({
    apiKey: input.endpoint.apiKey,
    baseUrl: input.endpoint.baseUrl,
    body: {
      instructions: instructionsFor(input.candidates),
      model: input.endpoint.model,
      questions: [{ id: QUESTION_ID, options, question: QUESTION }],
      state: input.text,
    },
    fetch: withAbortSignal(input.fetch, input.signal),
    label: "decisions request",
    path: "/decisions",
    timeoutMs: FILING_TIMEOUT_MS,
  });
  const { choice, probabilities } = readDecision(body, options);
  const confidence = Math.max(0, ...input.candidates.map((candidate) => probabilities.get(candidate.label) ?? 0));
  const chosen = input.candidates.find((candidate) => candidate.label === choice);
  return { collectionId: chosen?.collectionId ?? null, confidence };
}
