import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertPinIndexReplaceAtomic, assertPinIndexStore } from "../../src/server/assistant/retrieval/store.test-helpers";
import { FIXTURE, pinBySessionAndNumber, sessionByTitle } from "./fixtures";
import {
  DEFAULT_EMBEDDING_MODEL,
  fixturePinSource,
  main,
  memoryPinIndexStore,
  PROBE_QUESTIONS,
  runSearchProbe,
  type ProbeQuestion,
} from "./search-probe";

const API_KEY = "sk-test-NAO-VAZAR";
const BASE_URL = "https://appliance.example/v1";

// ---------- fake embeddings endpoint ----------

interface EmbeddingRequest {
  authorization: string | undefined;
  body: { dimensions: number; input: string[]; model: string; prompt_name: "document" | "query" };
  url: string;
}

function vector(components: Record<number, number>): number[] {
  const values = new Array<number>(256).fill(0);
  for (const [index, value] of Object.entries(components)) values[Number(index)] = value;
  return values;
}

// A fake POST /embeddings: `embed` maps each input text (and its kind) to a
// vector; `fail` answers a kind with an error status, whose body carries
// the key, so a leak would show.
function fakeEmbeddings(embed: (text: string, kind: "document" | "query") => number[], fail?: { kind: "document" | "query"; status: number }) {
  const requests: EmbeddingRequest[] = [];
  const fetchImpl = (async (target: RequestInfo | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = JSON.parse(String(init?.body)) as EmbeddingRequest["body"];
    requests.push({ authorization: headers["Authorization"], body, url: String(target) });
    if (fail && body.prompt_name === fail.kind) {
      return new Response(JSON.stringify({ error: `bad key ${API_KEY}` }), { status: fail.status });
    }
    const data = body.input.map((text, index) => ({ embedding: embed(text, body.prompt_name), index }));
    return new Response(JSON.stringify({ data }), { headers: { "Content-Type": "application/json" }, status: 200 });
  }) as typeof fetch;
  return { fetchImpl, requests };
}

// Which fixture pin a document is: its "Page:" line and its "Pin #n:" line.
function isPin(text: string, title: string, number: number): boolean {
  const lines = text.split("\n");
  return lines[0] === `Page: ${title}` && (lines[2] ?? "").startsWith(`Pin #${number}: `);
}

function pinId(title: string, number: number): string {
  return pinBySessionAndNumber(sessionByTitle(title)!, number)!.pinId;
}

// A lexical stand-in for a real model: one dimension per hashed term.
function lexicalVector(text: string): number[] {
  const values = new Array<number>(256).fill(0);
  values[0] = 0.01;
  for (const term of text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((item) => item !== "")) {
    let hash = 0;
    for (const char of term) hash = (hash * 31 + char.charCodeAt(0)) % 255;
    values[hash + 1] += 1;
  }
  return values;
}

// ---------- store and source ----------

test("o store em memória cumpre os casos compartilhados dos stores", async () => {
  await assertPinIndexStore(memoryPinIndexStore());
  await assertPinIndexReplaceAtomic(memoryPinIndexStore());
});

test("a fonte da fixture: sessões da mais nova para a mais antiga, pins, conversa por pin e nenhuma screenshot", async () => {
  const source = fixturePinSource();
  const all = await source.listSessions({ limit: 100, offset: 0 });
  expect(all.length).toBe(25);
  const newestFirst = [...FIXTURE.sessions].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  expect(all).toEqual(newestFirst.map((session) => ({ id: session.id, updatedAt: session.createdAt })));
  expect(await source.listSessions({ limit: 2, offset: 3 })).toEqual(all.slice(3, 5));
  const login = sessionByTitle("Login da Pinar")!;
  expect(await source.session(login.id)).toEqual({
    id: login.id,
    page: { title: "Login da Pinar", url: "https://pina.dev/login" },
    pinIds: login.pins.map((pin) => pin.pinId),
    pins: [
      { comment: "O botão de entrar fica meio apagado", number: 1, selector: "main button.primary" },
      { comment: "A fonte do título parece pequena", number: 2 },
    ],
  });
  expect(await source.session("nao-existe")).toBeNull();
  const comments = await source.comments(login.id);
  expect([...comments.keys()]).toEqual([login.pins[0].pinId]);
  expect(comments.get(login.pins[0].pinId)).toEqual([
    { author: "Você", body: "Confirmado, parece realmente apagado." },
    { author: "agente", body: "O contraste do botão está em 2.9:1; o mínimo é 4.5:1." },
  ]);
  expect(await source.shot(login.id)).toBeNull();
});

test("as perguntas da sonda: pelo menos 8, em pt-BR e inglês, cada uma com pins da fixture", () => {
  expect(PROBE_QUESTIONS.length).toBeGreaterThanOrEqual(8);
  expect(new Set(PROBE_QUESTIONS.map((question) => question.id)).size).toBe(PROBE_QUESTIONS.length);
  expect(PROBE_QUESTIONS.some((question) => question.language === "pt-BR")).toBe(true);
  expect(PROBE_QUESTIONS.some((question) => question.language === "en")).toBe(true);
  const known = new Set(FIXTURE.sessions.flatMap((session) => session.pins.map((pin) => pin.pinId)));
  for (const question of PROBE_QUESTIONS) {
    expect(question.expected.length).toBeGreaterThan(0);
    for (const id of question.expected) expect(known.has(id)).toBe(true);
  }
  // As perguntas de busca da bancada estão na sonda.
  const queries = PROBE_QUESTIONS.map((question) => question.query);
  for (const query of ["onde comentei sobre contraste?", "quais pins falam do checkout?", "Which pins mention the PDF download?"]) {
    expect(queries).toContain(query);
  }
});

// ---------- acerto top-5 e MRR ----------

// Hand-built case: q-alpha finds its pin first (RR 1), q-beta finds its pin
// third behind two stronger ones (RR 1/3), and q-gamma has five stronger
// pins ahead of its own (outside the top 5, RR 0). Top-5 2/3, MRR 4/9.
const HAND_QUESTIONS: ProbeQuestion[] = [
  { expected: [pinId("Login da Pinar", 1)], id: "alpha", language: "pt-BR", query: "q-alpha" },
  { expected: [pinId("Agenda do Skedly", 1)], id: "beta", language: "en", query: "q-beta" },
  { expected: [pinId("Editor do Cinzel", 1)], id: "gamma", language: "pt-BR", query: "q-gamma" },
];

const HAND_DOCUMENTS: Array<{ number: number; title: string; vector: number[] }> = [
  { number: 1, title: "Login da Pinar", vector: vector({ 0: 1, 1: 2 }) }, // alpha: 2/√5
  { number: 1, title: "Dashboard da Pinar", vector: vector({ 0: 1, 2: 3 }) }, // beta: 3/√10
  { number: 2, title: "Dashboard da Pinar", vector: vector({ 0: 1, 2: 2 }) }, // beta: 2/√5
  { number: 1, title: "Agenda do Skedly", vector: vector({ 0: 1, 2: 1 }) }, // beta: 1/√2, third
  ...[
    ["Teste de captura 01", 1],
    ["Teste de captura 02", 1],
    ["Teste de captura 02", 2],
    ["Teste de captura 03", 1],
    ["Galeria do Cinzel", 1],
  ].map(([title, number]) => ({ number: number as number, title: title as string, vector: vector({ 0: 1, 3: 1 }) })), // gamma: 1/√2
];

const HAND_QUERIES: Record<string, number[]> = {
  "q-alpha": vector({ 1: 1 }),
  "q-beta": vector({ 2: 1 }),
  "q-gamma": vector({ 3: 1 }),
};

function handEmbed(text: string, kind: "document" | "query"): number[] {
  if (kind === "query") return HAND_QUERIES[text] ?? vector({});
  return HAND_DOCUMENTS.find((document) => isPin(text, document.title, document.number))?.vector ?? vector({ 0: 1 });
}

test("sonda: acerto top-5 e MRR batem com o caso calculado à mão", async () => {
  const fake = fakeEmbeddings(handEmbed);
  const result = await runSearchProbe({
    embedding: { apiKey: API_KEY, baseUrl: BASE_URL, model: DEFAULT_EMBEDDING_MODEL },
    fetch: fake.fetchImpl,
    now: () => new Date("2026-10-17T00:00:00Z"),
    questions: HAND_QUESTIONS,
  });
  expect(result.index).toEqual({ embedded: 36, pins: 36, sessions: 25 });
  expect(result.questions.map((question) => [question.id, question.rank, question.hit])).toEqual([
    ["alpha", 1, true],
    ["beta", 3, true],
    ["gamma", null, false],
  ]);
  expect(result.questions[0].reciprocalRank).toBe(1);
  expect(result.questions[1].reciprocalRank).toBeCloseTo(1 / 3, 12);
  expect(result.questions[2].reciprocalRank).toBe(0);
  expect(result.totals).toMatchObject({ fallbacks: 0, hits: 2, questions: 3 });
  expect(result.totals.hitRate).toBeCloseTo(2 / 3, 12);
  expect(result.totals.mrr).toBeCloseTo(4 / 9, 12);
  // Os scores são os cossenos calculados à mão; limite 5 por pergunta.
  expect(result.questions[0].hits[0].score).toBeCloseTo(2 / Math.sqrt(5), 6);
  expect(result.questions[1].hits.slice(0, 3).map((hit) => [hit.session, hit.pin])).toEqual([
    ["Dashboard da Pinar", 1],
    ["Dashboard da Pinar", 2],
    ["Agenda do Skedly", 1],
  ]);
  expect(result.questions[1].hits[2].score).toBeCloseTo(1 / Math.SQRT2, 6);
  expect(result.questions[2].hits.length).toBe(5);
  expect(result.questions[2].hits.every((hit) => hit.score > 0.7)).toBe(true);
  expect(result.questions.every((question) => question.ranking === "embedding")).toBe(true);
  // Só embeddings: os documentos ("document", 256 dimensões, o modelo pedido) e uma consulta por pergunta. Sem visão.
  expect(fake.requests.every((request) => request.url === `${BASE_URL}/embeddings`)).toBe(true);
  expect(fake.requests.every((request) => request.authorization === `Bearer ${API_KEY}`)).toBe(true);
  expect(fake.requests.every((request) => request.body.dimensions === 256 && request.body.model === DEFAULT_EMBEDDING_MODEL)).toBe(true);
  const documents = fake.requests.filter((request) => request.body.prompt_name === "document");
  expect(documents.reduce((total, request) => total + request.body.input.length, 0)).toBe(36);
  expect(fake.requests.filter((request) => request.body.prompt_name === "query").map((request) => request.body.input)).toEqual([
    ["q-alpha"],
    ["q-beta"],
    ["q-gamma"],
  ]);
  // O documento indexado traz a conversa: o pin 1 do login fala de contraste nela.
  const loginDoc = documents.flatMap((request) => request.body.input).find((text) => isPin(text, "Login da Pinar", 1))!;
  expect(loginDoc).toContain("O contraste do botão está em 2.9:1");
});

test("sonda: uma consulta que falha cai no ranking textual e fica marcada", async () => {
  const fake = fakeEmbeddings(handEmbed, { kind: "query", status: 500 });
  const result = await runSearchProbe({
    embedding: { apiKey: API_KEY, baseUrl: BASE_URL, model: DEFAULT_EMBEDDING_MODEL },
    fetch: fake.fetchImpl,
    questions: [{ expected: [pinId("Configurações do Cinzel", 1)], id: "contraste", language: "pt-BR", query: "contraste" }],
  });
  expect(result.questions[0].ranking).toBe("text-fallback");
  expect(result.totals.fallbacks).toBe(1);
  // O ranking textual achou o pin pelo termo, o que embeddings quebrados nunca mostrariam.
  expect(result.questions[0].hit).toBe(true);
  // Controle: com a consulta respondida, o ranking é por embedding.
  const ok = await runSearchProbe({
    embedding: { apiKey: API_KEY, baseUrl: BASE_URL, model: DEFAULT_EMBEDDING_MODEL },
    fetch: fakeEmbeddings(handEmbed).fetchImpl,
    questions: [{ expected: [pinId("Configurações do Cinzel", 1)], id: "contraste", language: "pt-BR", query: "contraste" }],
  });
  expect(ok.questions[0].ranking).toBe("embedding");
  // Um vetor com outra dimensão também é falha da consulta.
  const short = await runSearchProbe({
    embedding: { apiKey: API_KEY, baseUrl: BASE_URL, model: DEFAULT_EMBEDDING_MODEL },
    fetch: fakeEmbeddings((text, kind) => (kind === "query" ? [1, 2, 3] : handEmbed(text, kind))).fetchImpl,
    questions: [{ expected: [pinId("Configurações do Cinzel", 1)], id: "contraste", language: "pt-BR", query: "contraste" }],
  });
  expect(short.questions[0].ranking).toBe("text-fallback");
});

// ---------- CLI ----------

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) rmSync(dir, { force: true, recursive: true });
});

function outDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "search-probe-test-"));
  createdDirs.push(dir);
  return dir;
}

async function runCli(argv: string[], fetchImpl: typeof fetch, env: Record<string, string | undefined> = { ASSISTANT_BENCH_API_KEY: API_KEY, ASSISTANT_BENCH_BASE_URL: BASE_URL }) {
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

test("CLI: uma linha por pergunta e o total, o JSON em --out e a chave em nenhum dos dois", async () => {
  const out = join(outDir(), "nested", "probe.json");
  const fake = fakeEmbeddings((text) => lexicalVector(text));
  const { code, stderr, stdout } = await runCli(["--embedding-model", "modelo-x", "--out", out], fake.fetchImpl);
  expect(code).toBe(0);
  expect(stdout.length).toBe(PROBE_QUESTIONS.length + 1);
  PROBE_QUESTIONS.forEach((question, index) => {
    expect(stdout[index].startsWith(`${question.id} [${question.language}] `)).toBe(true);
    expect(stdout[index].endsWith(` — ${question.query}`)).toBe(true);
  });
  expect(stdout.at(-1)).toMatch(/^Total: top-5 \d+\/11 \(\d+\.\d%\), MRR \d\.\d{3} — modelo-x$/);
  expect(stderr).toContain(`JSON: ${out}`);
  const written = readFileSync(out, "utf8");
  const report = JSON.parse(written) as {
    config: Record<string, unknown>;
    generatedAt: string;
    questions: Array<{ id: string; rank: number | null; reciprocalRank: number }>;
    totals: { hits: number; mrr: number; questions: number };
  };
  expect(report.config).toEqual({ baseUrl: BASE_URL, embeddingModel: "modelo-x", limit: 5 });
  expect(report.generatedAt).toBe("2026-10-17T00:00:00.000Z");
  expect(report.questions.map((question) => question.id)).toEqual(PROBE_QUESTIONS.map((question) => question.id));
  expect(report.totals.questions).toBe(PROBE_QUESTIONS.length);
  // O total impresso é o do JSON.
  expect(stdout.at(-1)).toContain(`${report.totals.hits}/${report.totals.questions}`);
  expect(stdout.at(-1)).toContain(`MRR ${report.totals.mrr.toFixed(3)}`);
  // A chave foi usada (Authorization) e não aparece na saída nem no arquivo.
  expect(fake.requests.length).toBeGreaterThan(0);
  expect(fake.requests.every((request) => request.authorization === `Bearer ${API_KEY}`)).toBe(true);
  expect(fake.requests.every((request) => request.body.model === "modelo-x")).toBe(true);
  for (const text of [...stdout, ...stderr, written]) {
    expect(text).not.toContain(API_KEY);
    expect(text).not.toContain("Bearer");
  }
});

test("CLI: falha ao indexar e queda no ranking textual saem com 1, sem a chave", async () => {
  const failed = await runCli(["--out", join(outDir(), "x.json")], fakeEmbeddings(handEmbed, { kind: "document", status: 500 }).fetchImpl);
  expect(failed.code).toBe(1);
  expect(failed.stdout).toEqual([]);
  expect(failed.stderr).toEqual(["Erro: embedding request failed (status 500)"]);
  const out = join(outDir(), "fallback.json");
  const fallback = await runCli(["--out", out], fakeEmbeddings(handEmbed, { kind: "query", status: 401 }).fetchImpl);
  expect(fallback.code).toBe(1);
  expect(fallback.stdout.slice(0, -1).every((line) => line.includes("(ranking textual)"))).toBe(true);
  expect(fallback.stderr.at(-1)).toBe(
    `Erro: ${PROBE_QUESTIONS.length} pergunta(s) caíram no ranking textual (falha ao embedar a pergunta); o resultado não mede os embeddings.`,
  );
  for (const text of [...failed.stdout, ...failed.stderr, ...fallback.stdout, ...fallback.stderr, readFileSync(out, "utf8")]) {
    expect(text).not.toContain(API_KEY);
  }
});

test("CLI: uso, ambiente e flags inválidas saem com 2 sem chamar o endpoint", async () => {
  const fake = fakeEmbeddings(handEmbed);
  const help = await runCli(["--help"], fake.fetchImpl);
  expect(help.code).toBe(2);
  expect(help.stdout[0].split("\n")[0]).toBe("Uso: search-probe.ts [--embedding-model <id>] [--out <arquivo.json>]");
  expect(help.stdout[0]).not.toContain(API_KEY);
  const noEnv = await runCli([], fake.fetchImpl, {});
  expect(noEnv.code).toBe(2);
  expect(noEnv.stderr[0]).toContain("ASSISTANT_BENCH_BASE_URL");
  const http = await runCli([], fake.fetchImpl, { ASSISTANT_BENCH_API_KEY: API_KEY, ASSISTANT_BENCH_BASE_URL: "http://appliance.example/v1" });
  expect(http).toMatchObject({ code: 2, stderr: ["Erro: ASSISTANT_BENCH_BASE_URL deve usar HTTPS."] });
  const unknown = await runCli(["--model", "x"], fake.fetchImpl);
  expect(unknown.code).toBe(2);
  expect(unknown.stderr[0].startsWith("Erro: flag desconhecida: --model")).toBe(true);
  const missing = await runCli(["--embedding-model"], fake.fetchImpl);
  expect(missing).toMatchObject({ code: 2, stderr: ["Erro: --embedding-model exige um valor"] });
  expect(fake.requests).toEqual([]);
});
