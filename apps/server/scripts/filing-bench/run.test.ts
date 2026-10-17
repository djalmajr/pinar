import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPinDocument } from "../../src/server/assistant/retrieval/document";
import { EMBEDDING_BATCH_SIZE, PIN_EMBEDDING_DIMENSIONS } from "../../src/server/assistant/retrieval/embeddings";
import { captureFilingText } from "../../src/server/filing/capture-text";
import { chooseCollection, FILING_NONE_OPTION } from "../../src/server/filing/choose";
import { FILING_BENCH_CAPTURES, FILING_BENCH_COLLECTIONS, filingCandidates, type FilingBenchCollection } from "./fixture";
import {
  currentThresholds,
  DECISIONS_GRID,
  evaluateThresholds,
  fileAt,
  main,
  measureFiling,
  metricsAt,
  SIMILARITY_MARGIN_GRID,
  SIMILARITY_MIN_GRID,
  type RawChoice,
} from "./run";

const API_KEY = "sk-test-NAO-VAZAR";
const BASE_URL = "https://appliance.example/v1";
const ENV = { ASSISTANT_BENCH_API_KEY: API_KEY, ASSISTANT_BENCH_BASE_URL: BASE_URL };

const labelOf = new Map(FILING_BENCH_COLLECTIONS.map((collection) => [collection.collectionId, collection.label]));
const captureByText = new Map(FILING_BENCH_CAPTURES.map((item) => [captureFilingText(item), item]));

interface Request {
  authorization: string | undefined;
  body: Record<string, unknown>;
  url: string;
}

function recordingFetch(respond: (request: Request) => Response) {
  const requests: Request[] = [];
  const fetchImpl = (async (target: RequestInfo | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const request = { authorization: headers["Authorization"], body: JSON.parse(String(init?.body)) as Record<string, unknown>, url: String(target) };
    requests.push(request);
    return respond(request);
  }) as typeof fetch;
  return { fetchImpl, requests };
}

function decisionsResponse(choice: string, probabilities: Record<string, number>): Response {
  return Response.json({ decisions: [{ choice, id: "collection", probabilities }], model: "qwen", object: "decision.list" });
}

// The fake appliance files every capture in its expected collection at 0.9
// and sends the Inbox ones to None of these at 0.9, except:
// f03 → Pinar / Histórico at 0.8 (wrong collection), n06 → Loja Aurora /
// Checkout at 0.75 (should stay in the Inbox), f06 → Pinar / Site at 0.6
// (right, but below 0.7). `fail` answers those capture ids with a 500 whose
// body carries the key.
function fakeAppliance(fail: string[] = []) {
  return recordingFetch((request) => {
    const capture = captureByText.get(String(request.body["state"]));
    if (!capture) return new Response("unknown capture", { status: 400 });
    if (fail.includes(capture.id)) return new Response(`upstream rejected ${API_KEY}`, { status: 500 });
    const answer: Record<string, [string, number]> = {
      f03: ["pinar-historico", 0.8],
      f06: ["pinar-site", 0.6],
      n06: ["aurora-checkout", 0.75],
    };
    const [collectionId, probability] = answer[capture.id] ?? [capture.expected, 0.9];
    if (collectionId === null) return decisionsResponse(FILING_NONE_OPTION, { [FILING_NONE_OPTION]: 0.9, [labelOf.get("pinar-site")!]: 0.1 });
    const label = labelOf.get(collectionId)!;
    return decisionsResponse(label, { [FILING_NONE_OPTION]: 1 - probability, [label]: probability });
  });
}

// A lexical stand-in for an embedding model: one dimension per hashed term.
function lexicalVector(text: string): number[] {
  const values = new Array<number>(PIN_EMBEDDING_DIMENSIONS).fill(0);
  values[0] = 0.01;
  for (const term of text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((item) => item !== "")) {
    let hash = 0;
    for (const char of term) hash = (hash * 31 + char.charCodeAt(0)) % 255;
    values[hash + 1]! += 1;
  }
  return values;
}

function embeddingsResponse(vectors: number[][]): Response {
  return Response.json({ data: vectors.map((embedding, index) => ({ embedding, index })) });
}

const createdDirs: string[] = [];
afterEach(() => {
  for (const dir of createdDirs.splice(0)) rmSync(dir, { force: true, recursive: true });
});

function outDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "filing-bench-test-"));
  createdDirs.push(dir);
  return dir;
}

async function runCli(argv: string[], fetchImpl: typeof fetch, env: Record<string, string | undefined> = ENV) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await main(argv, {
    env,
    fetch: fetchImpl,
    now: () => new Date("2026-10-17T00:00:00Z"),
    stderr: (line) => stderr.push(line),
    stdout: (line) => stdout.push(line),
  });
  return { code, stderr, stdout };
}

// ---------- fixture ----------

test("fixture: 10 coleções de 3 a 5 sessões e 40 capturas, 10 delas para a Inbox, com inglês e fronteiras", () => {
  expect(FILING_BENCH_COLLECTIONS.length).toBe(10);
  const ids = new Set(FILING_BENCH_COLLECTIONS.map((collection) => collection.collectionId));
  const labels = new Set(FILING_BENCH_COLLECTIONS.map((collection) => collection.label));
  expect(ids.size).toBe(10);
  expect(labels.size).toBe(10);
  for (const collection of FILING_BENCH_COLLECTIONS) {
    expect(collection.label).toMatch(/^[^/]+ \/ [^/]+$/);
    expect(collection.sessions.length).toBeGreaterThanOrEqual(3);
    expect(collection.sessions.length).toBeLessThanOrEqual(5);
    for (const item of collection.sessions) expect(item.pins.length).toBeGreaterThan(0);
  }

  expect(FILING_BENCH_CAPTURES.length).toBe(40);
  expect(new Set(FILING_BENCH_CAPTURES.map((item) => item.id)).size).toBe(40);
  expect(FILING_BENCH_CAPTURES.filter((item) => item.expected === null).length).toBe(10);
  for (const item of FILING_BENCH_CAPTURES) {
    if (item.expected !== null) expect(ids.has(item.expected)).toBe(true);
    if (item.confusableWith !== undefined) {
      expect(ids.has(item.confusableWith)).toBe(true);
      expect(item.confusableWith).not.toBe(item.expected);
    }
  }
  expect(FILING_BENCH_CAPTURES.filter((item) => item.language === "en").length).toBeGreaterThanOrEqual(8);
  expect(FILING_BENCH_CAPTURES.filter((item) => item.expected !== null && item.confusableWith).length).toBeGreaterThanOrEqual(8);
  expect(FILING_BENCH_CAPTURES.filter((item) => item.expected === null && item.confusableWith).length).toBeGreaterThanOrEqual(3);
});

test("fixture: os candidatos levam os 3 títulos mais recentes e a última captura", () => {
  const candidates = filingCandidates();
  expect(candidates.map((candidate) => candidate.label)).toEqual(FILING_BENCH_COLLECTIONS.map((collection) => collection.label));
  expect(candidates[0]).toEqual({
    collectionId: "pinar-extensao",
    examples: ["Opções da extensão Pinar", "Popup da Pinar", "Sobreposição de anotação da Pinar"],
    label: "Pinar / Extensão",
    lastUsedAt: "2026-10-14T13:10:00.000Z",
  });
  // Out of order on purpose: the most recent session is not the first.
  const shuffled: FilingBenchCollection = {
    collectionId: "x",
    label: "X / Y",
    sessions: [
      { capturedAt: "2026-10-01T00:00:00.000Z", page: { title: "a", url: "https://x/a" }, pins: [] },
      { capturedAt: "2026-10-09T00:00:00.000Z", page: { title: "b", url: "https://x/b" }, pins: [] },
      { capturedAt: "2026-10-05T00:00:00.000Z", page: { title: "c", url: "https://x/c" }, pins: [] },
      { capturedAt: "2026-10-07T00:00:00.000Z", page: { title: "d", url: "https://x/d" }, pins: [] },
    ],
  };
  expect(filingCandidates([shuffled])[0]).toMatchObject({ examples: ["b", "d", "c"], lastUsedAt: "2026-10-09T00:00:00.000Z" });
});

// ---------- metrics ----------

function raw(best: string | null, score: number | null, margin: number | null = null): RawChoice {
  return { best, error: null, margin, option: null, score };
}

// Six captures computed by hand:
// a: A expected, A at 0.9 · b: B expected, B at 0.6 · c: A expected, B at 0.8 ·
// d: Inbox expected, A at 0.75 · e: Inbox expected, nothing · f: B expected, engine error.
const HAND = [
  { ...raw("A", 0.9), expected: "A" },
  { ...raw("B", 0.6), expected: "B" },
  { ...raw("B", 0.8), expected: "A" },
  { ...raw("A", 0.75), expected: null },
  { ...raw(null, 0.2), expected: null },
  { ...raw(null, null), error: "decisions request failed (status 500)", expected: "B" },
];

test("métricas: acerto, falso positivo e Inbox batem com o caso calculado à mão", () => {
  // Mutation captured: counting no false positives reports 0 instead of c (wrong collection) and d (should be Inbox).
  expect(metricsAt(HAND, { min: 0.7 })).toEqual({
    accuracy: 1 / 4,
    correct: 1,
    falsePositiveRate: 2 / 6,
    falsePositives: 2,
    inbox: 3,
    inboxRate: 3 / 6,
    total: 6,
    withCollection: 4,
  });
  expect(metricsAt(HAND, { min: 0.5 })).toMatchObject({ correct: 2, falsePositives: 2, inbox: 2 });
  expect(metricsAt(HAND, { min: 0.85 })).toMatchObject({ correct: 1, falsePositives: 0, inbox: 5 });
});

test("métricas: a margem manda para a Inbox só quando há uma segunda coleção perto", () => {
  const results = [
    { ...raw("A", 0.8, 0.04), expected: "A" },
    { ...raw("A", 0.8, 0.2), expected: "A" },
    { ...raw("A", 0.6, null), expected: "A" },
  ];
  expect(metricsAt(results, { margin: 0.05, min: 0.55 })).toMatchObject({ correct: 2, inbox: 1 });
  expect(metricsAt(results, { margin: 0.02, min: 0.55 })).toMatchObject({ correct: 3, inbox: 0 });
  expect(metricsAt(results, { margin: 0, min: 0.7 })).toMatchObject({ correct: 2, inbox: 1 });
});

test("limiares: gates no limiar atual e o melhor da grade que passa nos dois", () => {
  // 10 captures: 8 with a collection (5 at 0.9, 3 at 0.65), 2 for the Inbox (one filed at 0.68).
  const results = [
    ...Array.from({ length: 5 }, () => ({ ...raw("A", 0.9), expected: "A" })),
    ...Array.from({ length: 3 }, () => ({ ...raw("B", 0.65), expected: "B" })),
    { ...raw("A", 0.68), expected: null },
    { ...raw(null, 0.1), expected: null },
  ];
  const { best, current, grid } = evaluateThresholds(results, "decisions");
  expect(current.thresholds).toEqual({ min: 0.7 });
  // At 0.7: 5/8 correct (62.5%), no false positive.
  expect(current.gates).toEqual({ accuracy: false, falsePositive: true });
  expect(grid.map((point) => point.thresholds.min)).toEqual(DECISIONS_GRID);
  // At 0.65 and below: 8/8 but the 0.68 one is filed (1/10 = 10%): fails. Nothing passes both.
  expect(grid.find((point) => point.thresholds.min === 0.65)!.gates).toEqual({ accuracy: true, falsePositive: false });
  expect(best).toBeNull();

  const fixed = results.map((result) => (result.expected === null && result.best === "A" ? { ...result, score: 0.62 } : result));
  const evaluated = evaluateThresholds(fixed, "decisions");
  // 0.65 files the 8 and leaves the 0.62 one out; it beats 0.3..0.6 (which file it) and 0.7+ (5/8).
  expect(evaluated.best?.thresholds).toEqual({ min: 0.65 });
  expect(evaluated.best?.metrics).toMatchObject({ correct: 8, falsePositives: 0 });

  const similarity = evaluateThresholds(fixed, "similarity");
  expect(similarity.current.thresholds).toEqual({ margin: 0.05, min: 0.55 });
  expect(similarity.grid.length).toBe(SIMILARITY_MIN_GRID.length * SIMILARITY_MARGIN_GRID.length);
});

// ---------- the rule is chooseCollection's ----------

test("regra: no limiar atual, fileAt arquiva onde o chooseCollection arquiva (decisions)", async () => {
  const capture = FILING_BENCH_CAPTURES[0]!;
  const text = captureFilingText(capture);
  const site = labelOf.get("pinar-site")!;
  const cases: Array<[string, Record<string, number>]> = [
    [site, { [FILING_NONE_OPTION]: 0.3, [site]: 0.7 }],
    [site, { [FILING_NONE_OPTION]: 0.31, [site]: 0.69 }],
    [site, { [FILING_NONE_OPTION]: 0.05, [site]: 0.95 }],
    [FILING_NONE_OPTION, { [FILING_NONE_OPTION]: 0.9, [site]: 0.1 }],
  ];
  const endpoint = { apiKey: API_KEY, baseUrl: BASE_URL, kind: "appliance" as const, model: "qwen", thinkingControl: false };
  const filed: Array<string | null> = [];
  for (const [choice, probabilities] of cases) {
    const fake = recordingFetch(() => decisionsResponse(choice, probabilities));
    const { results } = await measureFiling({ captures: [capture], engine: { endpoint, kind: "decisions" }, fetch: fake.fetchImpl });
    const chosen = await chooseCollection({ candidates: filingCandidates(), engine: { endpoint, kind: "decisions" }, fetch: fake.fetchImpl, text });
    expect(fileAt(results[0]!, currentThresholds("decisions"))).toBe(chosen.collectionId);
    filed.push(chosen.collectionId);
  }
  expect(filed).toEqual(["pinar-site", null, "pinar-site", null]);
});

test("regra: no limiar atual, fileAt arquiva onde o chooseCollection arquiva (similarity)", async () => {
  // Two collections whose only pin embeds to e0 and e1; the query vector sets the cosines.
  const collections = FILING_BENCH_COLLECTIONS.slice(0, 2).map((collection) => ({ ...collection, sessions: collection.sessions.slice(0, 1) }));
  const first = collections[0]!.sessions[0]!;
  const axis = (index: number) => Array.from({ length: PIN_EMBEDDING_DIMENSIONS }, (_, position) => (position === index ? 1 : 0));
  const padded = (...components: number[]) => [...components, ...new Array<number>(PIN_EMBEDDING_DIMENSIONS - components.length).fill(0)];
  const queries = [
    padded(4, 3), // 0.8 over 0.6: filed
    padded(11, 0, 15, 7, 2, 1), // 0.55 alone over 0: filed
    padded(27, 0, 42, 2, 1, 1, 1), // 0.54: Inbox
    padded(30, 29, 27, 5, 2, 1), // 0.6 over 0.58: margin 0.02, Inbox
  ];
  const filed: Array<string | null> = [];
  for (const query of queries) {
    const fake = recordingFetch((request) => {
      const inputs = request.body["input"] as string[];
      if (request.body["prompt_name"] === "query") return embeddingsResponse([query]);
      return embeddingsResponse(inputs.map((text) => (text.startsWith(`Page: ${first.page.title}\n`) ? axis(0) : axis(1))));
    });
    const embedding = { apiKey: API_KEY, baseUrl: BASE_URL, model: "embeddinggemma-300m" };
    const capture = FILING_BENCH_CAPTURES[0]!;
    const { results } = await measureFiling({ captures: [capture], collections, engine: { embedding, kind: "similarity" }, fetch: fake.fetchImpl });
    const centroids = new Map([
      [collections[0]!.collectionId, axis(0)],
      [collections[1]!.collectionId, axis(1)],
    ]);
    const chosen = await chooseCollection({
      candidates: filingCandidates(collections),
      engine: { centroid: async (id) => centroids.get(id) ?? null, embedding, kind: "similarity" },
      fetch: fake.fetchImpl,
      text: captureFilingText(capture),
    });
    expect(fileAt(results[0]!, currentThresholds("similarity"))).toBe(chosen.collectionId);
    filed.push(chosen.collectionId);
  }
  expect(filed).toEqual(["pinar-extensao", "pinar-extensao", null, null]);
});

// ---------- CLI ----------

test("CLI decisions: uma chamada por captura, a grade sem chamadas novas, as métricas do caso à mão e nenhuma chave", async () => {
  const out = join(outDir(), "nested", "decisions.json");
  const fake = fakeAppliance();
  const { code, stderr, stdout } = await runCli(["--engine", "decisions", "--model", "qwen3.8-27b", "--out", out], fake.fetchImpl);
  expect(code).toBe(0);

  // Mutation captured: a grid that asks the engine again makes more than 40 requests.
  expect(fake.requests.length).toBe(40);
  expect(fake.requests.every((request) => request.url === `${BASE_URL}/decisions` && request.authorization === `Bearer ${API_KEY}`)).toBe(true);
  expect(fake.requests.every((request) => request.body["model"] === "qwen3.8-27b")).toBe(true);

  expect(stdout.slice(0, 40).map((line) => line.split(" ")[0])).toEqual(FILING_BENCH_CAPTURES.map((item) => item.id));
  expect(stdout).toContain(
    "f03 [pt-BR] esperado Pinar / Extensão [fronteira: Pinar / Histórico] — Pinar / Histórico (p 0.800) → falso positivo (coleção errada)",
  );
  expect(stdout).toContain("n01 [pt-BR] esperado Inbox — None of these (melhor rótulo p 0.100) → Inbox (certo)");
  expect(stdout).toContain("f06 [pt-BR] esperado Pinar / Site [fronteira: Skedly / Faturas] — Pinar / Site (p 0.600) → Inbox (perdeu a coleção)");
  const at = stdout.indexOf("Grade:");
  expect(stdout.slice(40, at)).toEqual([
    "Limiar atual (probabilidade ≥ 0.70): acerto 28/30 (93.3%), falso positivo 2/40 (5.0%), Inbox 10/40 (25.0%)",
    "Gate falso positivo ≤ 5.0%: 5.0% — pass",
    "Gate acerto ≥ 80.0%: 93.3% — pass",
  ]);
  expect(stdout.slice(at + 1, at + 1 + DECISIONS_GRID.length).map((line) => line.split(":")[0]!.trim())).toEqual(
    DECISIONS_GRID.map((min) => `probabilidade ≥ ${min.toFixed(2)}`),
  );
  expect(stdout).toContain("  probabilidade ≥ 0.85: acerto 28/30 (93.3%), falso positivo 0/40 (0.0%), Inbox 12/40 (30.0%) — pass");
  expect(stdout).toContain("  probabilidade ≥ 0.95: acerto 0/30 (0.0%), falso positivo 0/40 (0.0%), Inbox 40/40 (100.0%) — fail");
  expect(stdout.at(-1)).toBe(
    "Melhor limiar da grade que passa nos dois gates: probabilidade ≥ 0.60 — acerto 29/30 (96.7%), falso positivo 2/40 (5.0%), Inbox 9/40 (22.5%)",
  );
  expect(stderr).toContain(`JSON: ${out}`);

  const written = readFileSync(out, "utf8");
  const report = JSON.parse(written) as {
    best: { thresholds: { min: number } };
    captures: Array<{ filed: string | null; id: string; option: string | null; score: number | null }>;
    config: Record<string, unknown>;
    current: { metrics: { correct: number; falsePositives: number; inbox: number } };
    errors: number;
    generatedAt: string;
    grid: unknown[];
  };
  expect(report.config).toEqual({
    baseUrl: BASE_URL,
    engine: "decisions",
    gates: { accuracyMin: 0.8, falsePositiveMax: 0.05 },
    model: "qwen3.8-27b",
    thresholds: { min: 0.7 },
  });
  expect(report.generatedAt).toBe("2026-10-17T00:00:00.000Z");
  expect(report.current.metrics).toMatchObject({ correct: 28, falsePositives: 2, inbox: 10 });
  expect(report.best.thresholds).toEqual({ min: 0.6 });
  expect(report.grid.length).toBe(DECISIONS_GRID.length);
  expect(report.errors).toBe(0);
  expect(report.captures.find((item) => item.id === "n06")).toMatchObject({ filed: "aurora-checkout", option: "Loja Aurora / Checkout", score: 0.75 });

  for (const text of [...stdout, ...stderr, written]) {
    expect(text).not.toContain(API_KEY);
    expect(text).not.toContain("Bearer");
  }
});

test("CLI decisions: uma captura que falha no motor vai para a Inbox, sai com 1 e não vaza a chave", async () => {
  const out = join(outDir(), "failed.json");
  const { code, stderr, stdout } = await runCli(["--engine", "decisions", "--model", "qwen", "--out", out], fakeAppliance(["f01", "n02"]).fetchImpl);
  expect(code).toBe(1);
  expect(stdout).toContain("f01 [pt-BR] esperado Pinar / Extensão — erro: decisions request failed (status 500) → Inbox (perdeu a coleção)");
  expect(stdout).toContain("n02 [en] esperado Inbox — erro: decisions request failed (status 500) → Inbox (certo)");
  expect(stderr.at(-1)).toBe("Erro: 2 captura(s) falharam no motor; o resultado não mede o motor.");
  const written = readFileSync(out, "utf8");
  expect((JSON.parse(written) as { errors: number }).errors).toBe(2);
  for (const text of [...stdout, ...stderr, written]) {
    expect(text).not.toContain(API_KEY);
    expect(text).not.toContain("upstream rejected");
  }
});

test("CLI similarity: embeda os pins de exemplo como documentos e cada captura como pergunta, uma vez", async () => {
  const out = join(outDir(), "similarity.json");
  const fake = recordingFetch((request) => embeddingsResponse((request.body["input"] as string[]).map(lexicalVector)));
  const { code, stderr, stdout } = await runCli(["--engine", "similarity", "--embedding-model", "gemma-x", "--out", out], fake.fetchImpl);
  expect(code).toBe(0);

  const documents: string[] = [];
  for (const collection of FILING_BENCH_COLLECTIONS) {
    for (const item of collection.sessions) {
      for (const pin of item.pins) documents.push((await buildPinDocument({ caption: null, comments: [], page: item.page, pin })).text);
    }
  }
  const documentRequests = fake.requests.filter((request) => request.body["prompt_name"] === "document");
  const queryRequests = fake.requests.filter((request) => request.body["prompt_name"] === "query");
  expect(documentRequests.length).toBe(Math.ceil(documents.length / EMBEDDING_BATCH_SIZE));
  expect(documentRequests.flatMap((request) => request.body["input"] as string[]).sort()).toEqual([...documents].sort());
  expect(queryRequests.map((request) => (request.body["input"] as string[])[0])).toEqual(FILING_BENCH_CAPTURES.map((item) => captureFilingText(item)));
  expect(fake.requests.length).toBe(documentRequests.length + 40);
  expect(fake.requests.every((request) => request.body["model"] === "gemma-x" && request.authorization === `Bearer ${API_KEY}`)).toBe(true);

  expect(stderr).toContain(`Centróides: ${documents.length} pins embedados como documentos.`);
  expect(stdout.find((line) => line.startsWith("Limiar atual"))).toMatch(/^Limiar atual \(cosseno ≥ 0\.55, margem ≥ 0\.05\): acerto \d+\/30 /);
  const at = stdout.indexOf("Grade:");
  expect(stdout.slice(at + 1).filter((line) => line.startsWith("  cosseno ≥ ")).length).toBe(SIMILARITY_MIN_GRID.length * SIMILARITY_MARGIN_GRID.length);
  const written = readFileSync(out, "utf8");
  const report = JSON.parse(written) as { captures: Array<{ margin: number | null; option: null; score: number }>; config: Record<string, unknown> };
  expect(report.config).toMatchObject({ engine: "similarity", model: "gemma-x", thresholds: { margin: 0.05, min: 0.55 } });
  expect(report.captures.every((item) => item.option === null && typeof item.score === "number" && typeof item.margin === "number")).toBe(true);
  for (const text of [...stdout, ...stderr, written]) expect(text).not.toContain(API_KEY);
});

test("CLI similarity: falha ao embedar os documentos sai com 1, sem a chave", async () => {
  const fake = recordingFetch(() => new Response(`bad key ${API_KEY}`, { status: 401 }));
  const { code, stderr, stdout } = await runCli(["--engine", "similarity", "--out", join(outDir(), "x.json")], fake.fetchImpl);
  expect(code).toBe(1);
  expect(stdout).toEqual([]);
  expect(stderr.at(-1)).toBe("Erro: embedding request failed (status 401)");
  for (const text of stderr) expect(text).not.toContain(API_KEY);
});

test("CLI: uso, ambiente e flags inválidas saem com 2 sem chamar o endpoint", async () => {
  const fake = recordingFetch(() => new Response("{}"));
  const help = await runCli(["--help"], fake.fetchImpl);
  expect(help.code).toBe(2);
  expect(help.stdout[0]!.split("\n")[0]).toBe("Uso: run.ts --engine decisions|similarity [--model <id>] [--embedding-model <id>] [--out <arquivo.json>]");

  const noEnv = await runCli(["--engine", "similarity"], fake.fetchImpl, {});
  expect(noEnv).toMatchObject({
    code: 2,
    stderr: ["Erro: defina ASSISTANT_BENCH_BASE_URL (HTTPS) e ASSISTANT_BENCH_API_KEY no ambiente antes de rodar a bancada."],
  });
  const noKey = await runCli(["--engine", "similarity"], fake.fetchImpl, { ASSISTANT_BENCH_BASE_URL: BASE_URL });
  expect(noKey.code).toBe(2);
  for (const baseUrl of ["http://appliance.example/v1", "ftp://appliance.example/v1"]) {
    const insecure = await runCli(["--engine", "similarity"], fake.fetchImpl, { ...ENV, ASSISTANT_BENCH_BASE_URL: baseUrl });
    expect(insecure).toMatchObject({ code: 2, stderr: ["Erro: ASSISTANT_BENCH_BASE_URL deve usar HTTPS."] });
  }
  const invalid = await runCli(["--engine", "similarity"], fake.fetchImpl, { ...ENV, ASSISTANT_BENCH_BASE_URL: "não é url" });
  expect(invalid).toMatchObject({ code: 2, stderr: ["Erro: ASSISTANT_BENCH_BASE_URL não é uma URL válida."] });

  const noEngine = await runCli([], fake.fetchImpl);
  expect(noEngine.code).toBe(2);
  expect(noEngine.stderr[0]!.startsWith("Erro: --engine exige decisions ou similarity")).toBe(true);
  const badEngine = await runCli(["--engine", "chat"], fake.fetchImpl);
  expect(badEngine.code).toBe(2);
  expect(badEngine.stderr[0]!.startsWith("Erro: --engine exige decisions ou similarity")).toBe(true);
  expect(await runCli(["--engine", "decisions"], fake.fetchImpl)).toMatchObject({ code: 2, stderr: ["Erro: --engine decisions exige --model"] });
  const unknown = await runCli(["--engine", "decisions", "--modelo", "x"], fake.fetchImpl);
  expect(unknown.code).toBe(2);
  expect(unknown.stderr[0]!.startsWith("Erro: flag desconhecida: --modelo")).toBe(true);
  expect(await runCli(["--engine", "similarity", "--out"], fake.fetchImpl)).toMatchObject({ code: 2, stderr: ["Erro: --out exige um arquivo"] });

  expect(fake.requests).toEqual([]);
  for (const result of [help, noEnv, noKey]) for (const text of [...result.stdout, ...result.stderr]) expect(text).not.toContain(API_KEY);
});

