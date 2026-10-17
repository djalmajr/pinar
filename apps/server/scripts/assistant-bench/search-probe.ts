// Retrieval probe: indexes the bench fixture with the real F3 core
// (indexSession and searchPins, src/server/assistant/retrieval/index.ts) in
// an in-memory store and measures the top-5 hits and the MRR of fixed pin
// questions with real embeddings.
//
//   bun apps/server/scripts/assistant-bench/search-probe.ts \
//     [--embedding-model <id>] [--out <file.json>]
//
// The fixture has no screenshots and the probe passes no chat endpoint, so
// the index has no captions (no vision). The embedding endpoint is
// ASSISTANT_BENCH_BASE_URL with ASSISTANT_BENCH_API_KEY and the model given
// by --embedding-model (default embeddinggemma-300m).
//
// Every question runs searchPins with limit 5. A question is a top-5 hit
// when one of its expected pins is among the 5 hits; its reciprocal rank is
// 1/rank of the first expected pin among them (0 when none), and the MRR is
// the mean over the questions (MRR@5). searchPins falls back to its text
// ranking when embedding the query fails, without saying so: the probe
// checks every query response it gets with the production rules (a 2xx, as
// postEndpointJson requires, and parseEmbeddings with one input) and marks
// a question whose response they refuse as `text-fallback`, which fails the
// run.
//
// Output: one line per question and the total on stdout, the JSON at --out
// (default <tmp>/assistant-bench-out/search-probe-<model>-<timestamp>.json).
// The key is never printed nor written: the JSON carries no key field and
// every printed or written text goes through redactSecret. Exit codes: 0 ok,
// 1 indexing failed or a query fell back to the text ranking, 2 bad
// configuration/environment.

import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseEmbeddings, type EmbeddingEndpoint } from "../../src/server/assistant/retrieval/embeddings";
import {
  indexSession,
  searchPins,
  type PinIndexDeps,
  type PinIndexEntry,
  type PinIndexStore,
  type PinSource,
} from "../../src/server/assistant/retrieval/index";
import { redactSecret } from "./client";
import { FIXTURE, pinBySessionAndNumber, sessionByTitle } from "./fixtures";

export const PROBE_LIMIT = 5;
export const DEFAULT_EMBEDDING_MODEL = "embeddinggemma-300m";

// ---------- questions ----------

export interface ProbeQuestion {
  // Pin ids of the fixture that answer the question.
  expected: string[];
  id: string;
  language: "en" | "pt-BR";
  query: string;
}

// The pin ids of [session title, pin number] pairs; a pair the fixture no
// longer has fails at load time instead of measuring nothing.
function fixturePins(...refs: Array<[string, number]>): string[] {
  return refs.map(([title, number]) => {
    const session = sessionByTitle(title);
    const pin = session ? pinBySessionAndNumber(session, number) : undefined;
    if (!pin) throw new Error(`search-probe: a fixture não tem o pin ${number} de "${title}"`);
    return pin.pinId;
  });
}

const CONTRAST_PINS = fixturePins(["Configurações do Cinzel", 1], ["Tela de checkout da loja", 1], ["Login da Pinar", 1]);

export const PROBE_QUESTIONS: ProbeQuestion[] = [
  { expected: CONTRAST_PINS, id: "q01", language: "pt-BR", query: "onde comentei sobre contraste?" },
  { expected: CONTRAST_PINS, id: "q02", language: "en", query: "Where did I comment about contrast?" },
  {
    // Faturas and Planos mention checkout only in their conversation.
    expected: fixturePins(["Tela de checkout da loja", 3], ["Faturas do Skedly", 1], ["Planos da Pinar", 3]),
    id: "q03",
    language: "pt-BR",
    query: "quais pins falam do checkout?",
  },
  { expected: fixturePins(["Faturas do Skedly", 2]), id: "q04", language: "en", query: "Which pins mention the PDF download?" },
  { expected: fixturePins(["Dashboard da Pinar", 1]), id: "q05", language: "pt-BR", query: "qual gráfico está sem legenda?" },
  { expected: fixturePins(["Planos da Pinar", 2]), id: "q06", language: "en", query: "Where does the table break on mobile?" },
  { expected: fixturePins(["Editor do Cinzel", 2]), id: "q07", language: "pt-BR", query: "tem algum pin sobre atalho de teclado?" },
  { expected: fixturePins(["Zonas DNS no cPanel", 1]), id: "q08", language: "en", query: "Which pin is about sorting the DNS records?" },
  {
    expected: fixturePins(["Login da Pinar", 2], ["Post sobre tokenização", 1]),
    id: "q09",
    language: "pt-BR",
    query: "onde a fonte ficou pequena?",
  },
  { expected: fixturePins(["Agenda do Skedly", 1]), id: "q10", language: "en", query: "Find the pin about the weekend highlight color." },
  { expected: fixturePins(["E-mails no cPanel", 2]), id: "q11", language: "pt-BR", query: "qual pin fala do aviso de quota do e-mail?" },
];

// ---------- fixture source and in-memory store ----------

// The fixture as a PinSource: every session is accessible, newest first
// (updatedAt is its createdAt), conversation comments by pin id in fixture
// order, and no screenshot.
export function fixturePinSource(): PinSource {
  const ordered = [...FIXTURE.sessions].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return {
    async listSessions({ limit, offset }) {
      return ordered.slice(offset, offset + limit).map((session) => ({ id: session.id, updatedAt: session.createdAt }));
    },
    async session(id) {
      const session = FIXTURE.sessions.find((item) => item.id === id);
      if (!session) return null;
      return {
        id: session.id,
        page: { title: session.page.title, url: session.page.url },
        pinIds: session.pins.map((pin) => pin.pinId),
        pins: session.pins.map((pin) => ({ comment: pin.comment, number: pin.number, ...(pin.selector ? { selector: pin.selector } : {}) })),
      };
    },
    async comments(sessionId) {
      const byPin = new Map<string, Array<{ author: string; body: string }>>();
      const session = FIXTURE.sessions.find((item) => item.id === sessionId);
      for (const comment of session?.comments ?? []) {
        const list = byPin.get(comment.pinId) ?? [];
        list.push({ author: comment.actorLabel, body: comment.body });
        byPin.set(comment.pinId, list);
      }
      return byPin;
    },
    async shot() {
      return null;
    },
  };
}

function copyEntry(entry: PinIndexEntry): PinIndexEntry {
  return { ...entry, vector: entry.vector === null ? null : new Uint8Array(entry.vector) };
}

function byNumber(left: PinIndexEntry, right: PinIndexEntry): number {
  return left.number - right.number;
}

// A PinIndexStore in memory, with the semantics of the shared store cases
// (store.test-helpers.ts): copies in and out, entries by pin number, a
// replacement that is checked whole before it is written.
export function memoryPinIndexStore(): PinIndexStore {
  const sessions = new Map<string, PinIndexEntry[]>();
  const read = (sessionId: string) => (sessions.get(sessionId) ?? []).map(copyEntry).sort(byNumber);
  return {
    async entries(sessionId) {
      return read(sessionId);
    },
    async replaceSession(sessionId, entries) {
      const pinIds = new Set<string>();
      for (const entry of entries) {
        if (entry.sessionId !== sessionId) throw new Error("pin index entry belongs to another session");
        if (entry.vector !== null && !(entry.vector instanceof Uint8Array)) throw new Error("pin index vector must be a Uint8Array or null");
        if (pinIds.has(entry.pinId)) throw new Error("pin index entry repeats a pin");
        pinIds.add(entry.pinId);
      }
      if (entries.length === 0) sessions.delete(sessionId);
      else sessions.set(sessionId, entries.map(copyEntry));
    },
    async deleteSession(sessionId) {
      sessions.delete(sessionId);
    },
    async entriesFor(sessionIds) {
      return [...new Set(sessionIds)].flatMap(read);
    },
    async staleSessions({ limit, sessions: candidates }) {
      const stale: string[] = [];
      const seen = new Set<string>();
      for (const candidate of candidates) {
        if (stale.length >= limit) break;
        if (seen.has(candidate.id)) continue;
        seen.add(candidate.id);
        const entries = sessions.get(candidate.id) ?? [];
        const oldest = entries.reduce<string | null>((min, entry) => (min === null || entry.updatedAt < min ? entry.updatedAt : min), null);
        if (oldest === null || candidate.updatedAt > oldest) stale.push(candidate.id);
      }
      return stale;
    },
  };
}

// ---------- probe ----------

export interface ProbeQuestionResult {
  expected: string[];
  hit: boolean;
  hits: Array<{ pin: number; pinId: string; score: number; session: string }>;
  id: string;
  language: "en" | "pt-BR";
  query: string;
  // 1-based position of the first expected pin among the hits, or null.
  rank: number | null;
  ranking: "embedding" | "text-fallback";
  reciprocalRank: number;
}

export interface ProbeResult {
  index: { embedded: number; pins: number; sessions: number };
  questions: ProbeQuestionResult[];
  totals: { fallbacks: number; hits: number; hitRate: number | null; mrr: number | null; questions: number };
}

// Whether searchPins could rank with a query embedding response: a 2xx
// whose JSON the production parser accepts for one input (count, index,
// dimensions and finite values are its rules, not the probe's).
async function usableQueryResponse(response: Response): Promise<boolean> {
  if (!response.ok) return false;
  try {
    parseEmbeddings(await response.json(), 1);
    return true;
  } catch {
    return false;
  }
}

// Counts the query embedding requests (prompt_name "query") that failed or
// came back unusable; the documents' requests pass through untouched.
function watchQueries(baseFetch: typeof fetch, failures: { count: number }): typeof fetch {
  return (async (target: RequestInfo | URL, init?: RequestInit) => {
    let query = false;
    try {
      query = typeof init?.body === "string" && (JSON.parse(init.body) as { prompt_name?: unknown }).prompt_name === "query";
    } catch {
      query = false;
    }
    let response: Response;
    try {
      response = await baseFetch(target, init);
    } catch (error) {
      if (query) failures.count += 1;
      throw error;
    }
    if (query && !(await usableQueryResponse(response.clone()))) failures.count += 1;
    return response;
  }) as typeof fetch;
}

export async function runSearchProbe(input: {
  embedding: EmbeddingEndpoint;
  fetch?: typeof fetch;
  now?: () => Date;
  questions?: ProbeQuestion[];
}): Promise<ProbeResult> {
  const failures = { count: 0 };
  const source = fixturePinSource();
  const deps: PinIndexDeps = {
    chat: null,
    embedding: input.embedding,
    fetch: watchQueries(input.fetch ?? fetch, failures),
    now: input.now ?? (() => new Date()),
    source,
    store: memoryPinIndexStore(),
  };

  const sessions = await source.listSessions({ limit: FIXTURE.sessions.length, offset: 0 });
  const index = { embedded: 0, pins: 0, sessions: 0 };
  for (const session of sessions) {
    const result = await indexSession(deps, session.id);
    index.embedded += result.embedded;
    index.pins += result.pins;
    index.sessions += 1;
  }

  const questions: ProbeQuestionResult[] = [];
  for (const question of input.questions ?? PROBE_QUESTIONS) {
    const before = failures.count;
    const hits = await searchPins(deps, { limit: PROBE_LIMIT, query: question.query });
    const expected = new Set(question.expected);
    const position = hits.findIndex((hit) => expected.has(hit.pinId));
    const rank = position === -1 ? null : position + 1;
    questions.push({
      expected: [...question.expected],
      hit: rank !== null,
      hits: hits.map((hit) => ({ pin: hit.number, pinId: hit.pinId, score: hit.score, session: hit.sessionTitle })),
      id: question.id,
      language: question.language,
      query: question.query,
      rank,
      ranking: failures.count > before ? "text-fallback" : "embedding",
      reciprocalRank: rank === null ? 0 : 1 / rank,
    });
  }

  const total = questions.length;
  return {
    index,
    questions,
    totals: {
      fallbacks: questions.filter((question) => question.ranking === "text-fallback").length,
      hits: questions.filter((question) => question.hit).length,
      hitRate: total > 0 ? questions.filter((question) => question.hit).length / total : null,
      mrr: total > 0 ? questions.reduce((sum, question) => sum + question.reciprocalRank, 0) / total : null,
      questions: total,
    },
  };
}

// ---------- CLI ----------

const HELP = [
  "Uso: search-probe.ts [--embedding-model <id>] [--out <arquivo.json>]",
  `Indexa a fixture da bancada com indexSession (sem screenshot, sem visão) e mede o acerto top-${PROBE_LIMIT} e o MRR de ${PROBE_QUESTIONS.length} perguntas com searchPins.`,
  `--embedding-model: modelo de embedding (padrão ${DEFAULT_EMBEDDING_MODEL}). --out: arquivo do JSON (padrão <tmp>/assistant-bench-out/search-probe-<modelo>-<timestamp>.json).`,
  "Ambiente: ASSISTANT_BENCH_BASE_URL (HTTPS) e ASSISTANT_BENCH_API_KEY.",
].join("\n");

interface ProbeArgs {
  embeddingModel: string;
  out?: string;
}

function parseArgs(argv: string[]): { args?: ProbeArgs; error?: string } {
  const args: ProbeArgs = { embeddingModel: DEFAULT_EMBEDDING_MODEL };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
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
  return { args };
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function percent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

export interface ProbeIo {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  now?: () => Date;
  stderr: (line: string) => void;
  stdout: (line: string) => void;
}

export async function main(argv: string[], io: ProbeIo): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.error) {
    if (parsed.error.startsWith("Uso:")) {
      io.stdout(parsed.error);
      return 2;
    }
    io.stderr(`Erro: ${parsed.error}`);
    return 2;
  }
  const args = parsed.args as ProbeArgs;
  const apiKey = io.env["ASSISTANT_BENCH_API_KEY"];
  const baseUrl = io.env["ASSISTANT_BENCH_BASE_URL"];
  if (!apiKey || !baseUrl) {
    io.stderr("Erro: defina ASSISTANT_BENCH_BASE_URL (HTTPS) e ASSISTANT_BENCH_API_KEY no ambiente antes de rodar a sonda.");
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
  const endpoint: EmbeddingEndpoint = { apiKey, baseUrl: baseUrl.replace(/\/+$/, ""), model: args.embeddingModel };

  let result: ProbeResult;
  try {
    result = await runSearchProbe({ embedding: endpoint, fetch: io.fetch, now });
  } catch (error) {
    stderr(`Erro: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  stderr(`Indexado: ${result.index.sessions} sessões, ${result.index.pins} pins, ${result.index.embedded} embeddings (${args.embeddingModel}).`);
  for (const question of result.questions) {
    const found = question.rank === null ? "fora do top-5" : `posição ${question.rank}`;
    const fallback = question.ranking === "text-fallback" ? " (ranking textual)" : "";
    stdout(`${question.id} [${question.language}] ${question.hit ? "acerto" : "erro"}: ${found}, RR ${question.reciprocalRank.toFixed(3)}${fallback} — ${question.query}`);
  }
  const { totals } = result;
  stdout(`Total: top-${PROBE_LIMIT} ${totals.hits}/${totals.questions} (${percent(totals.hitRate)}), MRR ${totals.mrr === null ? "—" : totals.mrr.toFixed(3)} — ${args.embeddingModel}`);

  const generatedAt = now().toISOString();
  const out = args.out ?? join(tmpdir(), "assistant-bench-out", `search-probe-${safeName(args.embeddingModel)}-${generatedAt.replace(/[:.]/g, "-").slice(0, 19)}.json`);
  const report = { config: { baseUrl: endpoint.baseUrl, embeddingModel: args.embeddingModel, limit: PROBE_LIMIT }, generatedAt, ...result };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, redactSecret(JSON.stringify(report, null, 2), apiKey));
  stderr(`JSON: ${out}`);
  if (totals.fallbacks > 0) {
    stderr(`Erro: ${totals.fallbacks} pergunta(s) caíram no ranking textual (falha ao embedar a pergunta); o resultado não mede os embeddings.`);
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
