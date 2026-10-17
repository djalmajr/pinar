// Filing bench (F3.5 contract §4): runs the fixture's new captures through
// one engine of the capture filing (src/server/filing) and measures, at the
// current thresholds (the deployment's FILING_SIMILARITY_* variables when
// set, the defaults otherwise) and over a grid of thresholds, how many
// captures with a good collection are filed into it and how many are filed
// where they should not be.
//
//   bun apps/server/scripts/filing-bench/run.ts --engine decisions|similarity \
//     [--model <id>] [--embedding-model <id>] [--out <file.json>]
//
// Each capture (captureFilingText) is asked once, through the S1 engines:
// - decisions: decideCollection with the fixture's candidates
//   (filingCandidates); the raw choice is the option the appliance chose
//   (a label or None of these) and the probability of the best label;
// - similarity: the pins of the example sessions are embedded as F3
//   documents (buildPinDocument, kind "document") and averaged into one
//   centroid per collection (collectionCentroid); rankBySimilarity ranks the
//   collections for the capture, and the raw choice is the best one, its
//   cosine and its margin over the second.
// Every call runs under chooseCollection's deadline: it gets a signal that
// aborts at FILING_TIMEOUT_MS and is raced against it, and its elapsed time
// is recorded. A capture with no answer by then, or an answer that took
// longer, is a timeout and stays in the Inbox at every threshold, as
// chooseCollection's reason "timeout".
// fileAt applies chooseCollection's rule to a raw choice under any
// thresholds, so the grid is recomputed without new requests (run.test.ts
// checks that, at the current thresholds, the metrics are the ones of
// calling chooseCollection per capture, with immediate, slow and failing
// answers).
//
// Metrics: accuracy = captures with a good collection filed into it / the
// captures with a good collection; false positives = captures filed where
// they should not be (the Inbox was expected, or another collection) / all
// captures; Inbox = captures left in the Inbox / all captures. A capture
// whose engine failed or timed out counts as left in the Inbox, as in
// production; the output and the JSON count the timeouts. Gates: false
// positives <= 5% and accuracy >= 80%.
//
// The endpoint is ASSISTANT_BENCH_BASE_URL (HTTPS) with
// ASSISTANT_BENCH_API_KEY. The key is never printed nor written: the JSON
// has no key field and every printed or written text goes through
// redactSecret. Exit codes: 0 ok (whatever the gates and the timeouts
// say), 1 the run failed or a capture failed in the engine (the result
// would not measure it), 2 bad configuration/environment.

import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { AssistantEndpoint } from "../../src/server/assistant/models";
import { buildPinDocument } from "../../src/server/assistant/retrieval/document";
import { embedTexts, type EmbeddingEndpoint } from "../../src/server/assistant/retrieval/embeddings";
import { captureFilingText } from "../../src/server/filing/capture-text";
import {
  FILING_DECISIONS_MIN,
  FILING_NONE_OPTION,
  FILING_TIMEOUT_MS,
  filingSimilarityThresholds,
  type FilingCandidate,
} from "../../src/server/filing/choose";
import { decideCollection } from "../../src/server/filing/decisions";
import { collectionCentroid, rankBySimilarity } from "../../src/server/filing/similarity";
import { redactSecret } from "../assistant-bench/client";
import {
  FILING_BENCH_CAPTURES,
  FILING_BENCH_COLLECTIONS,
  filingCandidates,
  type FilingBenchCapture,
  type FilingBenchCollection,
} from "./fixture";

export const DEFAULT_EMBEDDING_MODEL = "embeddinggemma-300m";
export const FALSE_POSITIVE_MAX = 0.05;
export const ACCURACY_MIN = 0.8;
export const DECISIONS_GRID = [0.3, 0.4, 0.5, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95];
export const SIMILARITY_MIN_GRID = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8];
export const SIMILARITY_MARGIN_GRID = [0, 0.02, 0.05, 0.08, 0.1];

export type BenchEngine = { endpoint: AssistantEndpoint; kind: "decisions" } | { embedding: EmbeddingEndpoint; kind: "similarity" };

// `margin` only for similarity.
export interface Thresholds {
  margin?: number;
  min: number;
}

export interface RawChoice {
  // The engine's best collection before any threshold; null when the
  // appliance chose None of these, no collection has a centroid, or the
  // engine failed or did not answer in time.
  best: string | null;
  elapsedMs: number;
  error: string | null; // the engine failed within the deadline
  margin: number | null; // similarity: best cosine minus the second (null without a second)
  option: string | null; // decisions: the option the appliance chose
  score: number | null; // decisions: probability of the best label; similarity: the best cosine
  timedOut: boolean; // no answer within FILING_TIMEOUT_MS: the Inbox at every threshold
}

type EngineAnswer = Pick<RawChoice, "best" | "margin" | "option" | "score">;

export interface CaptureResult extends RawChoice {
  confusableWith: string | null;
  expected: string | null;
  id: string;
  language: FilingBenchCapture["language"];
}

export interface FilingMetrics {
  accuracy: number | null;
  correct: number;
  falsePositiveRate: number | null;
  falsePositives: number;
  inbox: number;
  inboxRate: number | null;
  total: number;
  withCollection: number;
}

export interface GridPoint {
  gates: { accuracy: boolean; falsePositive: boolean };
  metrics: FilingMetrics;
  pass: boolean;
  thresholds: Thresholds;
}

// ---------- rule and metrics (no requests) ----------

// chooseCollection's rule (src/server/filing/choose.ts) under `thresholds`:
// nothing after a timeout; otherwise the best collection when its score
// reaches the minimum and, with a margin threshold, when it leads the
// second by at least that margin (a lone collection has no rival).
export function fileAt(raw: RawChoice, thresholds: Thresholds): string | null {
  if (raw.timedOut) return null;
  if (raw.best === null || raw.score === null || raw.score < thresholds.min) return null;
  if (thresholds.margin !== undefined && raw.margin !== null && raw.margin < thresholds.margin) return null;
  return raw.best;
}

export function metricsAt(results: Array<RawChoice & { expected: string | null }>, thresholds: Thresholds): FilingMetrics {
  let correct = 0;
  let falsePositives = 0;
  let inbox = 0;
  let withCollection = 0;
  for (const result of results) {
    const filed = fileAt(result, thresholds);
    if (result.expected !== null) withCollection += 1;
    if (filed === null) inbox += 1;
    else if (filed === result.expected) correct += 1;
    else falsePositives += 1;
  }
  const total = results.length;
  return {
    accuracy: withCollection > 0 ? correct / withCollection : null,
    correct,
    falsePositiveRate: total > 0 ? falsePositives / total : null,
    falsePositives,
    inbox,
    inboxRate: total > 0 ? inbox / total : null,
    total,
    withCollection,
  };
}

export function currentThresholds(kind: BenchEngine["kind"]): Thresholds {
  // The same variables the production chooseCollection reads (F3.5 §1),
  // the defaults when they are absent or invalid.
  if (kind === "decisions") return { min: FILING_DECISIONS_MIN };
  const { margin, min } = filingSimilarityThresholds((name) => process.env[name]);
  return { margin, min };
}

export function thresholdGrid(kind: BenchEngine["kind"]): Thresholds[] {
  if (kind === "decisions") return DECISIONS_GRID.map((min) => ({ min }));
  return SIMILARITY_MIN_GRID.flatMap((min) => SIMILARITY_MARGIN_GRID.map((margin) => ({ margin, min })));
}

function gridPoint(results: Array<RawChoice & { expected: string | null }>, thresholds: Thresholds): GridPoint {
  const metrics = metricsAt(results, thresholds);
  const gates = {
    accuracy: metrics.accuracy !== null && metrics.accuracy >= ACCURACY_MIN,
    falsePositive: metrics.falsePositiveRate !== null && metrics.falsePositiveRate <= FALSE_POSITIVE_MAX,
  };
  return { gates, metrics, pass: gates.accuracy && gates.falsePositive, thresholds };
}

// The current thresholds, every grid point, and the grid point that passes
// both gates with the best accuracy (then the fewest false positives, then
// the strictest thresholds), or null when none passes.
export function evaluateThresholds(results: Array<RawChoice & { expected: string | null }>, kind: BenchEngine["kind"]) {
  const current = gridPoint(results, currentThresholds(kind));
  const grid = thresholdGrid(kind).map((thresholds) => gridPoint(results, thresholds));
  const best =
    grid
      .filter((point) => point.pass)
      .sort(
        (left, right) =>
          right.metrics.correct - left.metrics.correct ||
          left.metrics.falsePositives - right.metrics.falsePositives ||
          right.thresholds.min - left.thresholds.min ||
          (right.thresholds.margin ?? 0) - (left.thresholds.margin ?? 0),
      )[0] ?? null;
  return { best, current, grid };
}

// ---------- measurement ----------

// One centroid per collection from the F3 documents of its sessions' pins.
async function similarityCentroids(collections: FilingBenchCollection[], embedding: EmbeddingEndpoint, fetchImpl?: typeof fetch) {
  const owners: string[] = [];
  const texts: string[] = [];
  for (const collection of collections) {
    for (const item of collection.sessions) {
      for (const pin of item.pins) {
        const document = await buildPinDocument({ caption: null, comments: [], page: item.page, pin });
        owners.push(collection.collectionId);
        texts.push(document.text);
      }
    }
  }
  const vectors = await embedTexts({ endpoint: embedding, fetch: fetchImpl, kind: "document", texts });
  const centroids = new Map<string, number[] | null>();
  for (const collection of collections) {
    centroids.set(collection.collectionId, collectionCentroid(vectors.filter((_, index) => owners[index] === collection.collectionId)));
  }
  return { centroids, documents: texts.length };
}

async function engineAnswer(
  engine: BenchEngine,
  candidates: FilingCandidate[],
  text: string,
  centroids: Map<string, number[] | null>,
  fetchImpl: typeof fetch | undefined,
  signal: AbortSignal,
): Promise<EngineAnswer> {
  if (engine.kind === "decisions") {
    const decision = await decideCollection({ candidates, endpoint: engine.endpoint, fetch: fetchImpl, signal, text });
    const option = candidates.find((candidate) => candidate.collectionId === decision.collectionId)?.label ?? FILING_NONE_OPTION;
    return { best: decision.collectionId, margin: null, option, score: decision.confidence };
  }
  const ranked = await rankBySimilarity({
    candidates,
    centroid: async (collectionId) => centroids.get(collectionId) ?? null,
    embedding: engine.embedding,
    fetch: fetchImpl,
    signal,
    text,
  });
  const [first, second] = ranked;
  return {
    best: first?.candidate.collectionId ?? null,
    margin: first && second ? first.score - second.score : null,
    option: null,
    score: first?.score ?? null,
  };
}

// One engine call under chooseCollection's deadline (src/server/filing/
// choose.ts): the signal aborts at FILING_TIMEOUT_MS and the call is raced
// against it, so the wait ends there even for a fetch that ignores the
// signal. No answer by then, or an answer that took longer, is a timeout; a
// late answer is kept for the record but never filed (fileAt).
async function underDeadline(run: (signal: AbortSignal) => Promise<EngineAnswer>, clock: () => number): Promise<RawChoice> {
  const deadline = AbortSignal.timeout(FILING_TIMEOUT_MS);
  const started = clock();
  let onAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(deadline.reason);
    deadline.addEventListener("abort", onAbort, { once: true });
  });
  let answer: EngineAnswer = { best: null, margin: null, option: null, score: null };
  let error: string | null = null;
  try {
    answer = await Promise.race([run(deadline), aborted]);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    deadline.removeEventListener("abort", onAbort);
  }
  const elapsed = clock() - started;
  const timedOut = deadline.aborted || elapsed > FILING_TIMEOUT_MS;
  return { ...answer, elapsedMs: Math.round(elapsed), error: timedOut ? null : error, timedOut };
}

export async function measureFiling(input: {
  captures?: FilingBenchCapture[];
  collections?: FilingBenchCollection[];
  // Milliseconds for the elapsed time of each call (default performance.now).
  clock?: () => number;
  engine: BenchEngine;
  fetch?: typeof fetch;
}): Promise<{ documents: number; results: CaptureResult[] }> {
  const collections = input.collections ?? FILING_BENCH_COLLECTIONS;
  const candidates = filingCandidates(collections);
  const prepared =
    input.engine.kind === "similarity"
      ? await similarityCentroids(collections, input.engine.embedding, input.fetch)
      : { centroids: new Map<string, number[] | null>(), documents: 0 };

  const results: CaptureResult[] = [];
  for (const item of input.captures ?? FILING_BENCH_CAPTURES) {
    const text = captureFilingText({ page: item.page, pins: item.pins });
    const raw = await underDeadline(
      (signal) => engineAnswer(input.engine, candidates, text, prepared.centroids, input.fetch, signal),
      input.clock ?? (() => performance.now()),
    );
    results.push({ ...raw, confusableWith: item.confusableWith ?? null, expected: item.expected, id: item.id, language: item.language });
  }
  return { documents: prepared.documents, results };
}

// ---------- CLI ----------

const HELP = [
  "Uso: run.ts --engine decisions|similarity [--model <id>] [--embedding-model <id>] [--out <arquivo.json>]",
  `Passa as ${FILING_BENCH_CAPTURES.length} capturas da fixture (${FILING_BENCH_COLLECTIONS.length} coleções) por um motor do arquivamento automático e mede acerto, falso positivo e Inbox no limiar atual e numa grade de limiares.`,
  "--engine: decisions (POST /v1/decisions) ou similarity (embeddings e centróides). --model: modelo do decisions (obrigatório com --engine decisions).",
  `--embedding-model: modelo de embedding da similarity (padrão ${DEFAULT_EMBEDDING_MODEL}). --out: arquivo do JSON (padrão <tmp>/filing-bench-out/filing-<motor>-<modelo>-<timestamp>.json).`,
  "Ambiente: ASSISTANT_BENCH_BASE_URL (HTTPS) e ASSISTANT_BENCH_API_KEY.",
].join("\n");

interface BenchArgs {
  embeddingModel: string;
  engine: BenchEngine["kind"];
  model?: string;
  out?: string;
}

function parseArgs(argv: string[]): { args?: BenchArgs; error?: string } {
  let engine: string | undefined;
  const args: Omit<BenchArgs, "engine"> = { embeddingModel: DEFAULT_EMBEDDING_MODEL };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case "--engine":
        if (!value) return { error: "--engine exige decisions ou similarity" };
        engine = value;
        i += 1;
        break;
      case "--model":
        if (!value) return { error: "--model exige um valor" };
        args.model = value;
        i += 1;
        break;
      case "--embedding-model":
        if (!value) return { error: "--embedding-model exige um valor" };
        args.embeddingModel = value;
        i += 1;
        break;
      case "--out":
        if (!value) return { error: "--out exige um arquivo" };
        args.out = value;
        i += 1;
        break;
      case "--help":
      case "-h":
        return { error: HELP };
      default:
        return { error: `flag desconhecida: ${flag}\n\n${HELP}` };
    }
  }
  if (engine !== "decisions" && engine !== "similarity") return { error: `--engine exige decisions ou similarity\n\n${HELP}` };
  if (engine === "decisions" && !args.model) return { error: "--engine decisions exige --model" };
  return { args: { ...args, engine } };
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function percent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function describeThresholds(kind: BenchEngine["kind"], thresholds: Thresholds): string {
  if (kind === "decisions") return `probabilidade ≥ ${thresholds.min.toFixed(2)}`;
  return `cosseno ≥ ${thresholds.min.toFixed(2)}, margem ≥ ${(thresholds.margin ?? 0).toFixed(2)}`;
}

function describeMetrics(metrics: FilingMetrics): string {
  return [
    `acerto ${metrics.correct}/${metrics.withCollection} (${percent(metrics.accuracy)})`,
    `falso positivo ${metrics.falsePositives}/${metrics.total} (${percent(metrics.falsePositiveRate)})`,
    `Inbox ${metrics.inbox}/${metrics.total} (${percent(metrics.inboxRate)})`,
  ].join(", ");
}

function describeRaw(result: CaptureResult, labels: Map<string, string>): string {
  if (result.timedOut) return `timeout (${result.elapsedMs} ms)`;
  if (result.error !== null) return `erro: ${result.error}`;
  const score = result.score === null ? "—" : result.score.toFixed(3);
  if (result.option === FILING_NONE_OPTION) return `${FILING_NONE_OPTION} (melhor rótulo p ${score})`;
  if (result.option !== null) return `${result.option} (p ${score})`;
  if (result.best === null) return "nenhuma coleção com centróide";
  const margin = result.margin === null ? "sem segunda" : `margem ${result.margin.toFixed(3)}`;
  return `${labels.get(result.best) ?? result.best} (cosseno ${score}, ${margin})`;
}

function describeOutcome(expected: string | null, filed: string | null): string {
  if (filed === null) return expected === null ? "Inbox (certo)" : "Inbox (perdeu a coleção)";
  if (filed === expected) return "acerto";
  return expected === null ? "falso positivo (era Inbox)" : "falso positivo (coleção errada)";
}

export interface BenchIo {
  clock?: () => number;
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  now?: () => Date;
  stderr: (line: string) => void;
  stdout: (line: string) => void;
}

export async function main(argv: string[], io: BenchIo): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.error) {
    if (parsed.error.startsWith("Uso:")) {
      io.stdout(parsed.error);
      return 2;
    }
    io.stderr(`Erro: ${parsed.error}`);
    return 2;
  }
  const args = parsed.args as BenchArgs;
  const apiKey = io.env["ASSISTANT_BENCH_API_KEY"];
  const baseUrl = io.env["ASSISTANT_BENCH_BASE_URL"];
  if (!apiKey || !baseUrl) {
    io.stderr("Erro: defina ASSISTANT_BENCH_BASE_URL (HTTPS) e ASSISTANT_BENCH_API_KEY no ambiente antes de rodar a bancada.");
    return 2;
  }
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    io.stderr("Erro: ASSISTANT_BENCH_BASE_URL não é uma URL válida.");
    return 2;
  }
  if (base.protocol !== "https:") {
    io.stderr("Erro: ASSISTANT_BENCH_BASE_URL deve usar HTTPS.");
    return 2;
  }
  const stdout = (line: string) => io.stdout(redactSecret(line, apiKey));
  const stderr = (line: string) => io.stderr(redactSecret(line, apiKey));
  const now = io.now ?? (() => new Date());
  const endpointBase = baseUrl.replace(/\/+$/, "");
  const model = args.engine === "decisions" ? (args.model as string) : args.embeddingModel;
  const engine: BenchEngine =
    args.engine === "decisions"
      ? { endpoint: { apiKey, baseUrl: endpointBase, kind: "appliance", model, thinkingControl: false }, kind: "decisions" }
      : { embedding: { apiKey, baseUrl: endpointBase, model }, kind: "similarity" };

  const withCollection = FILING_BENCH_CAPTURES.filter((item) => item.expected !== null).length;
  stderr(
    `Motor: ${args.engine} (${model}), ${FILING_BENCH_COLLECTIONS.length} coleções, ${FILING_BENCH_CAPTURES.length} capturas (${withCollection} com coleção boa, ${FILING_BENCH_CAPTURES.length - withCollection} para a Inbox).`,
  );
  let measured: Awaited<ReturnType<typeof measureFiling>>;
  try {
    measured = await measureFiling({ clock: io.clock, engine, fetch: io.fetch });
  } catch (error) {
    stderr(`Erro: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  const { results } = measured;
  if (args.engine === "similarity") stderr(`Centróides: ${measured.documents} pins embedados como documentos.`);

  const labels = new Map(FILING_BENCH_COLLECTIONS.map((collection) => [collection.collectionId, collection.label]));
  const evaluation = evaluateThresholds(results, args.engine);
  for (const result of results) {
    const expected = result.expected === null ? "Inbox" : (labels.get(result.expected) ?? result.expected);
    const filed = fileAt(result, evaluation.current.thresholds);
    const boundary = result.confusableWith ? ` [fronteira: ${labels.get(result.confusableWith) ?? result.confusableWith}]` : "";
    stdout(`${result.id} [${result.language}] esperado ${expected}${boundary} — ${describeRaw(result, labels)} → ${describeOutcome(result.expected, filed)}`);
  }

  const { best, current, grid } = evaluation;
  const timeouts = results.filter((result) => result.timedOut).length;
  stdout(`Timeouts (prazo de ${FILING_TIMEOUT_MS} ms): ${timeouts}/${results.length}`);
  stdout(`Limiar atual (${describeThresholds(args.engine, current.thresholds)}): ${describeMetrics(current.metrics)}`);
  stdout(`Gate falso positivo ≤ ${percent(FALSE_POSITIVE_MAX)}: ${percent(current.metrics.falsePositiveRate)} — ${current.gates.falsePositive ? "pass" : "fail"}`);
  stdout(`Gate acerto ≥ ${percent(ACCURACY_MIN)}: ${percent(current.metrics.accuracy)} — ${current.gates.accuracy ? "pass" : "fail"}`);
  stdout("Grade:");
  for (const point of grid) {
    stdout(`  ${describeThresholds(args.engine, point.thresholds)}: ${describeMetrics(point.metrics)} — ${point.pass ? "pass" : "fail"}`);
  }
  stdout(
    best === null
      ? "Melhor limiar da grade que passa nos dois gates: nenhum."
      : `Melhor limiar da grade que passa nos dois gates: ${describeThresholds(args.engine, best.thresholds)} — ${describeMetrics(best.metrics)}`,
  );

  const generatedAt = now().toISOString();
  const out =
    args.out ?? join(tmpdir(), "filing-bench-out", `filing-${args.engine}-${safeName(model)}-${generatedAt.replace(/[:.]/g, "-").slice(0, 19)}.json`);
  const errors = results.filter((result) => result.error !== null).length;
  const report = {
    best,
    captures: results.map((result) => ({ ...result, filed: fileAt(result, current.thresholds) })),
    config: {
      baseUrl: endpointBase,
      deadlineMs: FILING_TIMEOUT_MS,
      engine: args.engine,
      gates: { accuracyMin: ACCURACY_MIN, falsePositiveMax: FALSE_POSITIVE_MAX },
      model,
      thresholds: current.thresholds,
    },
    current,
    errors,
    generatedAt,
    grid,
    timeouts,
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, redactSecret(JSON.stringify(report, null, 2), apiKey));
  stderr(`JSON: ${out}`);
  if (errors > 0) {
    stderr(`Erro: ${errors} captura(s) falharam no motor; o resultado não mede o motor.`);
    return 1;
  }
  return 0;
}

if (import.meta.main) {
  main(process.argv.slice(2), { env: process.env, stderr: (line) => console.error(line), stdout: (line) => console.log(line) })
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const key = process.env["ASSISTANT_BENCH_API_KEY"] ?? "";
      console.error(`Erro inesperado: ${redactSecret(error instanceof Error ? error.message : String(error), key)}`);
      process.exitCode = 1;
    });
}
