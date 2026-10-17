// Scoring per case, aggregation across runs, and report rendering.
//
// Deterministic obligations (no LLM judge):
//   - mustCall / minCalls / args count only VALID AND SUCCESSFUL calls
//     (no JSON error, no schema violation, no handler error). Attempts are
//     kept for diagnostics; mustNotCall vetoes attempts, successes and
//     failures alike;
//   - `final: "text"`: normal text end, no write attempted, non-empty final
//     text. Every `mentions` entity must appear in an AFFIRMATIVE sentence
//     (one without "?") that is not a request restatement (echo prefixes
//     such as "você quer saber"); a closing offer ("…Quer detalhes?") is
//     allowed in its own sentence;
//   - entity coverage (F3): a mention that names a fixture entity (exact,
//     case/accent-insensitive match against session titles, urls, collection
//     names, batch labels, project name or pin comments) must also have
//     appeared in a successful read result of the turn (any read: broad
//     query, markdown, normalized query);
//   - `final: "ask"`: normal text end, no write attempted, non-empty final
//     text containing a question (interrogative sentence or imperative
//     request, with or without "?") that contains BOTH a request marker
//     (qual/quais/informe/diga/me passe/indique/escolha, which/what/tell
//     me/let me know/please provide…) AND each `askAbout` term, in the same
//     sentence; useful reads before the question are allowed;
//   - `final: "write"`: the approved proposal must carry the expected
//     target args; every successful write proposal must match the case
//     delta (args/exactCalls/allowedWrites) — only t02's specific no-op
//     (moving the session that is already at the destination) is allowed
//     beyond the delta; every opaque id used by a write must have appeared
//     in a successful read PRIOR to that call (earlier step, or earlier in
//     the same response, in call order) — later reads do not count;
//   - exhausting the steps, ending with empty text or ending in a protocol
//     error always fails;
//   - firstTool is diagnostics only: no case declares the call order as
//     part of the contract;
//   - redundant writes are registered in redundantWrites, never fatal;
//   - f2 profile (scoreCase's third argument): pinar_move_sessions is a
//     write; a valid pinar_ask end (finalKind "ask") is a question by
//     construction and satisfies `final: "ask"` when one askAbout term
//     appears in its question or in one of its options (no request marker
//     needed; free text keeps the sentence rule); bulk move cases read each
//     successful pinar_move_sessions as one pinar_move_session per
//     sessionId; the ids of a bulk move are its collectionId and every
//     sessionIds item;
//   - f3 profile: every f2 rule holds; a pin content case (`searchFirst`)
//     needs a valid and successful pinar_pins_search before any attempt of
//     a listing tool (pinar_list_*), in call order, and that order is part
//     of the action; `mustCallAny` (one of several tools) counts as
//     mustCall. Which expectation a case has in each profile is expectFor's
//     job (cases.ts), not the scorer's;
//   - the gates of contract §5 are defined above benchGates.
//
// LIMITS (deterministic, not semantic): the scoring does not judge full
// semantics. Mentions are substring matches inside affirmative,
// non-echo sentences; a question counts as a request only via fixed
// pt-BR/en markers; an "entity" is a fixture string match, not a concept.
// These heuristics are listed in the generated report ("Limitações da
// pontuação") and are the documented, auditable contract for phase 0.
//
// The rendered report never contains the API key: BenchConfig by design
// carries no key field, run errors are sanitized at the loop boundary and
// run.ts redacts finalText before rendering (the renderer only truncates).

import { FIXTURE } from "./fixtures";
import { DESTRUCTIVE_TOOLS, LIST_TOOLS, WRITE_TOOLS } from "./cases";
import { MOVE_SESSIONS_TOOL_LLM_NAME, PINS_SEARCH_TOOL_LLM_NAME, profileIncludes } from "./tools";
import type {
  BenchAggregate,
  BenchCase,
  BenchConfig,
  BenchGate,
  BenchProfile,
  CaseExpect,
  CaseRun,
  CaseScore,
  LoopResult,
  ReportData,
} from "./types";

const WRITE_TOOL_SET = new Set<string>(WRITE_TOOLS);
// f2 (and f3) also offers pinar_move_sessions, a write that becomes a proposal.
const F2_WRITE_TOOL_SET = new Set<string>([...WRITE_TOOLS, MOVE_SESSIONS_TOOL_LLM_NAME]);
const DESTRUCTIVE_TOOL_SET = new Set<string>(DESTRUCTIVE_TOOLS);
const LIST_TOOL_SET = new Set<string>(LIST_TOOLS);

function writeToolSet(profile: BenchProfile): ReadonlySet<string> {
  return profileIncludes(profile, "f2") ? F2_WRITE_TOOL_SET : WRITE_TOOL_SET;
}

// The opaque ids of the bench fixture (16 hex chars); the provenance check
// only constrains id-shaped values, never names or new labels.
const OPAQUE_ID_PATTERN = /^[0-9a-f]{16}$/;

// Echo prefixes (F1): a final sentence that opens by restating the request
// ("Você quer saber se…") is not a substantive answer, even when it names
// the expected entity. Compared on normalized text (no case, no accents).
const ECHO_PREFIXES = [
  "voce quer saber",
  "voce esta perguntando",
  "deseja saber",
  "you want to know",
  "you are asking",
];

// Request markers (F2): a clarifying question must actually ASK for the
// missing data, not merely mention it ("Você sabia que coleção é uma
// palavra?" mentions the term without requesting it). Substring match on
// normalized text; a marker + the askAbout term must share the sentence.
export const REQUEST_MARKERS = [
  "qual", "que nome", "informe", "diga", "me passe", "indique", "escolha",
  "which", "what", "tell me", "let me know", "please provide",
];

// Fixture entities for the coverage check (F3): the normalized exact
// strings a mention can refer to (titles, urls, names, labels, comments).
const FIXTURE_ENTITIES: ReadonlySet<string> = (() => {
  const values: string[] = [FIXTURE.project.name];
  for (const collection of FIXTURE.collections) values.push(collection.name);
  for (const batch of FIXTURE.batches) values.push(batch.label);
  for (const session of FIXTURE.sessions) {
    values.push(session.page.title, session.page.url);
    for (const pin of session.pins) values.push(pin.comment);
  }
  return new Set(values.map((value) => normalizeText(value)));
})();

function isFixtureEntity(mention: string): boolean {
  return FIXTURE_ENTITIES.has(normalizeText(mention));
}

// Case/accent-insensitive comparison used by mentions, askAbout and queries.
export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Deterministic question detection (pt-BR and en). A sentence is a question
// when it carries a "?" or starts with a question word / imperative request
// ("me diga qual…", "informe o nome…"). Offered after a correct answer, a
// trailing question is fine for `final: "text"`; for `final: "ask"` the
// question must also cover the askAbout terms.
const QUESTION_PREFIXES = [
  // pt-BR interrogatives (a sentence opening with a question word counts
  // even without "?": "Para qual coleção devo mover")
  "qual ", "quais ", "para qual ", "para quais ", "em qual ", "em quais ",
  "quando ", "onde ", "como ", "por que ", "porque ",
  "sera ", "será ", "pode ", "posso ", "podia ", "poderia ",
  "voce ", "voces ", "você ", "vocês ", "quer ", "vontade de ",
  // pt-BR imperative requests
  "me diga ", "me informe ", "me passe ", "me indique ", "me confirme ",
  "me confirme", "diga-me ", "diga-me", "informe-me ", "informe-me",
  "informe o ", "informe a ", "informe ", "informe",
  "diga o ", "diga a ", "diga ", "diga",
  "escolha ", "selecione ", "aponte ", "aponte",
  // English interrogatives / requests
  "what ", "which ", "when ", "where ", "why ", "how ",
  "can you", "could you", "would you", "will you",
  "do you", "does ", "did ", "are ", "is ", "tell me", "let me know",
  "please ",
];

function isQuestionSentence(sentence: string): boolean {
  const raw = sentence.trim();
  if (raw === "") return false;
  if (raw.includes("?")) return true;
  const normalized = normalizeText(raw);
  return QUESTION_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

// #3: a request sentence also opens — after an optional courtesy preamble
// ("por favor", "please") — with an imperative request marker ("Indique a
// coleção…", "Diga o nome…"). Interrogatives stay covered by
// isQuestionSentence; the two heuristics share one filter (requestSentences).
const IMPERATIVE_REQUEST_PATTERN = new RegExp(
  "^(?:indique|informe|diga|me passe|me diga|me informe|me indique|me confirme|escolha|tell me|let me know|please provide)\\b",
);
const COURTESY_PREAMBLE_PATTERN = /^(?:por favor|please)\s*[,.;:?]*\s*/;

export function isImperativeRequestSentence(sentence: string): boolean {
  const rest = normalizeText(sentence.trim()).replace(COURTESY_PREAMBLE_PATTERN, "");
  return IMPERATIVE_REQUEST_PATTERN.test(rest);
}

export function isRequestSentence(sentence: string): boolean {
  return isQuestionSentence(sentence) || isImperativeRequestSentence(sentence);
}

// The request sentences of a text (unified filter, #3): every interrogative
// sentence or imperative request — the candidate set of the `ask` obligation.
export function requestSentences(text: string): string[] {
  return splitSentences(text).filter(isRequestSentence);
}

// The question(s) of a text: every interrogative/imperative sentence.
export function questionSentences(text: string): string[] {
  const parts = text.split(/(?<=[.!?;])\s+|\n+/);
  return parts.filter((part) => isQuestionSentence(part));
}

// The affirmative sentences of a text (F1): every sentence without "?" that
// does not open with an echo prefix. Mentions must be grounded in one of
// these — a closing offer lives in its own interrogative sentence and does
// not affect the substantive ones.
export function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?;])\s+|\n+/).map((part) => part.trim()).filter((part) => part !== "");
}

// #2: wrappers that mask the echo prefix ("Entendi, você quer saber…",
// "**Você quer saber…**"): markdown marks and common opening preambles
// are stripped from the normalized sentence before the ECHO_PREFIXES test.
const ECHO_PREAMBLES = ["entendi", "certo", "ok", "claro", "perfeito", "beleza", "got it", "sure", "okay", "alright"];
const ECHO_PREAMBLE_PATTERN = new RegExp(`^(?:(?:${ECHO_PREAMBLES.join("|")})[,.;:]\s*|${ECHO_PREAMBLES.join("|")}\s+)`);

function stripEchoWrappers(normalized: string): string {
  const withoutMarks = normalized.replace(/[*_`#]/g, "").replace(/\s+/g, " ").trim();
  return withoutMarks.replace(ECHO_PREAMBLE_PATTERN, "").trim();
}

// #4: a sentence with "?" can still carry the substantive answer when the
// trailing offer shares it (", quer …?", ", posso …?", …): the part before
// the offer clause is the affirmative candidate.
const OFFER_CLAUSE_PATTERN = /,\s*(?:quer|deseja|posso|want me to|would you like|shall i)\b/g;

function offerPrefix(sentence: string): string | null {
  const normalized = normalizeText(sentence);
  const matches = Array.from(normalized.matchAll(OFFER_CLAUSE_PATTERN));
  const last = matches[matches.length - 1];
  if (last === undefined || last.index === undefined) return null;
  const before = normalized.slice(0, last.index).trim();
  return before !== "" ? before : null;
}

function affirmativeCandidates(sentence: string): string[] {
  if (!sentence.includes("?")) return isAffirmativeSentence(sentence) ? [sentence] : [];
  const before = offerPrefix(sentence);
  return before !== null && isAffirmativeSentence(before) ? [before] : [];
}

export function isAffirmativeSentence(sentence: string): boolean {
  if (sentence.includes("?")) return false;
  const normalized = normalizeText(sentence.trim());
  if (normalized === "") return false;
  // A request ("Indique a coleção…") is not an answer.
  if (isImperativeRequestSentence(normalized)) return false;
  return !ECHO_PREFIXES.some((prefix) => stripEchoWrappers(normalized).startsWith(prefix));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEquals(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== typeof right) return false;
  if (left === null || right === null || typeof left !== "object") return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, i) => deepEquals(item, right[i]));
  }
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  return aKeys.length === bKeys.length && aKeys.every((key) => deepEquals(a[key], b[key]));
}

// The partial matches when every key/value of `partial` is present in the
// call arguments (extra keys in the arguments are allowed). Query arguments
// compare case/accent-insensitively, the way the store searches them.
export function partialMatches(args: unknown, partial: Record<string, unknown>): boolean {
  if (!isRecord(args)) return false;
  return Object.entries(partial).every(([key, value]) => {
    if (key === "query" && typeof value === "string" && typeof args[key] === "string") {
      return normalizeText(args[key] as string) === normalizeText(value);
    }
    return deepEquals(args[key], value);
  });
}

// Valid and successful: the arguments parsed, passed the inputSchema and the
// fixture answered without an error.
function isSuccessful(record: ToolCallRecordLike): boolean {
  return record.jsonError === null && record.problems.length === 0 && record.error === null;
}

interface ToolCallRecordLike {
  args: unknown;
  error: string | null;
  jsonError: string | null;
  name: string;
  problems: string[];
  result: unknown;
  wasProposal: boolean;
}

// Candidates for args/exactCalls/alternatives: successful calls of the tool;
// for `final: "write"` the approved proposal specifically.
function candidatesFor(
  records: ToolCallRecordLike[],
  name: string,
  expect: CaseExpect,
): ToolCallRecordLike[] {
  const requireProposal = expect.final === "write";
  return records.filter(
    (record) =>
      record.name === name &&
      isSuccessful(record) &&
      (!requireProposal || record.wasProposal),
  );
}

// Collects every string value of a payload (objects, arrays, strings).
function collectStrings(value: unknown, sink: Set<string>): void {
  if (typeof value === "string") {
    sink.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, sink);
    return;
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) collectStrings(item, sink);
  }
}

// Every string that appeared in a successful NON-write result (reads and
// markdown). A write target is proven when its id is in this set.
function seenValuesFromReads(records: ToolCallRecordLike[], writeTools: ReadonlySet<string>): Set<string> {
  const seen = new Set<string>();
  for (const record of records) {
    if (!isSuccessful(record)) continue;
    if (record.wasProposal) continue;
    if (writeTools.has(record.name)) continue;
    collectStrings(record.result, seen);
  }
  return seen;
}

// Bulk move cases (f2): each successful pinar_move_sessions record is read
// as one pinar_move_session per sessionId, with the same collectionId,
// wasProposal and result. `keepBulk` keeps the bulk record too (name
// checks: mustCall, exactCalls on pinar_move_sessions) or replaces it by
// its parts (delta: each target is checked once).
function expandBulkMoves(records: ToolCallRecordLike[], keepBulk: boolean): ToolCallRecordLike[] {
  return records.flatMap((record) => {
    if (record.name !== MOVE_SESSIONS_TOOL_LLM_NAME || !isSuccessful(record) || !isRecord(record.args)) return [record];
    const { collectionId, sessionIds } = record.args;
    const parts = (Array.isArray(sessionIds) ? sessionIds : []).map((sessionId) => ({
      ...record,
      args: { collectionId, sessionId },
      name: "pinar_move_session",
    }));
    return keepBulk ? [record, ...parts] : parts;
  });
}

function scoreFinal(
  expect: CaseExpect,
  loop: LoopResult,
  writeAttempted: boolean,
  mentionFailures: string[],
): { endOk: boolean; finalFailures: string[]; finalOk: boolean } {
  const failures: string[] = [];
  if (loop.error !== null) failures.push("erro de caso/protocolo");
  if (loop.stoppedReason === "max-steps") failures.push("passos esgotados");
  if (loop.finalKind === null && loop.error === null && loop.stoppedReason !== "max-steps") {
    failures.push("sem término registrado");
  }
  if (writeAttempted) failures.push("escrita tentada");
  if (loop.finalText.trim() === "") failures.push("texto final vazio");
  if (expect.final === "write") {
    if (loop.finalKind !== "write") failures.push("final: proposta ausente");
  } else {
    // "text" and "ask" both end normally with text and no write; in f2 an
    // "ask" may also end on a valid pinar_ask (finalKind "ask").
    const kindOk = loop.finalKind === "text" || (expect.final === "ask" && loop.finalKind === "ask");
    if (!kindOk) failures.push(`final esperado ${expect.final}, laço terminou em ${loop.finalKind ?? "?"}`);
  }
  const endOk = failures.length === 0;
  if (expect.final !== "write" && mentionFailures.length > 0) {
    failures.push(expect.final === "text"
      ? `menções ausentes: ${mentionFailures.join(", ")}`
      : `pergunta ausente ou fora dos dados faltantes: ${mentionFailures.join(", ")}`);
  }
  return { endOk, finalFailures: failures, finalOk: failures.length === 0 };
}

export function scoreCase(expect: CaseExpect, loop: LoopResult, profile: BenchProfile = "f0"): CaseScore {
  const records = loop.toolCalls;
  const writeTools = writeToolSet(profile);
  const bulk = profileIncludes(profile, "f2") && expect.bulkMove === true;
  // Target view: what the obligations on tools and arguments read. Only
  // bulk move cases differ from the recorded calls.
  const targets = bulk ? expandBulkMoves(records, true) : records;
  const calledNames = new Set(records.map((record) => record.name));
  const successfulNames = new Set(targets.filter(isSuccessful).map((record) => record.name));

  const firstToolAllowed: string[] | null =
    expect.firstTool === undefined
      ? null
      : Array.isArray(expect.firstTool)
        ? expect.firstTool
        : [expect.firstTool];
  const firstTool = records.length > 0 ? records[0].name : null;
  // Diagnostics only: never part of pass.
  const firstToolOk = firstToolAllowed === null ? true : firstTool !== null && firstToolAllowed.includes(firstTool);

  // mustCall: at least one VALID AND SUCCESSFUL call per name; mustCallAny:
  // one for at least one of its names (missing, it is listed as "a|b").
  const missingMustCall = (expect.mustCall ?? []).filter((name) => !successfulNames.has(name));
  const mustCallAny = expect.mustCallAny ?? [];
  if (mustCallAny.length > 0 && !mustCallAny.some((name) => successfulNames.has(name))) {
    missingMustCall.push(mustCallAny.join("|"));
  }
  const mustCallOk = missingMustCall.length === 0;

  // Veto over attempts: a failed write still trips mustNotCall.
  const calledMustNot = (expect.mustNotCall ?? []).filter((name) => calledNames.has(name));
  const mustNotCallOk = calledMustNot.length === 0;

  // minCalls: minimum number of VALID AND SUCCESSFUL calls.
  const minCallsFailures: string[] = [];
  for (const [name, minimum] of Object.entries(expect.minCalls ?? {})) {
    const count = targets.filter((record) => record.name === name && isSuccessful(record)).length;
    if (count < minimum) minCallsFailures.push(`${name} had ${count} successful call(s), expected at least ${minimum}`);
  }
  const minCallsOk = minCallsFailures.length === 0;

  // args: the expected partial must match a successful call (for writes,
  // the approved proposal).
  const argsFailures: string[] = [];
  for (const [name, partial] of Object.entries(expect.args ?? {})) {
    const matches = candidatesFor(targets, name, expect).some((record) => partialMatches(record.args, partial));
    if (!matches) argsFailures.push(`no successful call to ${name} matches the expected arguments`);
  }
  const argsOk = argsFailures.length === 0;

  // exactCalls: the successful calls form exactly this set, order-free.
  const exactCallsFailures: string[] = [];
  for (const [name, entries] of Object.entries(expect.exactCalls ?? {})) {
    const calls = candidatesFor(targets, name, expect);
    if (calls.length !== entries.length) {
      exactCallsFailures.push(`${name}: ${calls.length} successful call(s), expected exactly ${entries.length}`);
      continue;
    }
    const used = new Array<boolean>(calls.length).fill(false);
    let failure: string | null = null;
    for (const entry of entries) {
      const found = calls.findIndex((call, index) => !used[index] && partialMatches(call.args, entry));
      if (found === -1) {
        failure = `${name}: no successful call matches expected arguments ${JSON.stringify(entry)}`;
        break;
      }
      used[found] = true;
    }
    if (failure) exactCallsFailures.push(failure);
  }
  const exactCallsOk = exactCallsFailures.length === 0;

  // alternatives: at least one equivalent read path is fully satisfied.
  const alternativesOk =
    expect.alternatives === undefined
      ? true
      : expect.alternatives.some((alternative) =>
          (alternative.mustCall ?? []).every((name) => successfulNames.has(name)) &&
          Object.entries(alternative.args ?? {}).every(
            ([name, partial]) => candidatesFor(targets, name, expect).some((record) => partialMatches(record.args, partial)),
          ),
        );

  // Provenance of write targets, INCREMENTAL (F5): every opaque id used by
  // a write (attempt or proposal) must have appeared in a successful read
  // that PRECEDES the call — an earlier step, or earlier in the same
  // response, in call order. Reads that come after do not count. A bulk
  // move (f2) also proves each of its sessionIds items.
  const idsUnseen: string[] = [];
  if (expect.final === "write") {
    const seenSoFar = new Set<string>();
    for (const record of records) {
      if (writeTools.has(record.name)) {
        if (isRecord(record.args)) {
          const values = Object.entries(record.args).flatMap(([key, value]): Array<[string, unknown]> =>
            record.name === MOVE_SESSIONS_TOOL_LLM_NAME && Array.isArray(value)
              ? value.map((item, index): [string, unknown] => [`${key}[${index}]`, item])
              : [[key, value]]);
          for (const [key, value] of values) {
            if (typeof value === "string" && OPAQUE_ID_PATTERN.test(value) && !seenSoFar.has(value)) {
              idsUnseen.push(`${record.name}.${key}`);
            }
          }
        }
      } else if (isSuccessful(record) && !record.wasProposal) {
        collectStrings(record.result, seenSoFar);
      }
    }
  }
  const idsSeenOk = idsUnseen.length === 0;

  // Delta validation (F4): every successful write proposal must match the
  // case delta — the expected args, an exactCalls entry, an alternative's
  // args, or an allowedWrites entry (t02's specific no-op). Any other
  // write (an unrelated delete, a move to a different target) fails.
  const deltaShapes: Array<{ name: string; partial: Record<string, unknown> }> = [];
  for (const [name, partial] of Object.entries(expect.args ?? {})) deltaShapes.push({ name, partial });
  for (const [name, partials] of Object.entries(expect.exactCalls ?? {})) {
    for (const partial of partials) deltaShapes.push({ name, partial });
  }
  for (const alternative of expect.alternatives ?? []) {
    for (const [name, partial] of Object.entries(alternative.args ?? {})) deltaShapes.push({ name, partial });
  }
  for (const [name, partials] of Object.entries(expect.allowedWrites ?? {})) {
    for (const partial of partials) deltaShapes.push({ name, partial });
  }
  const deltaFailures: string[] = [];
  if (expect.final === "write") {
    for (const record of bulk ? expandBulkMoves(records, false) : records) {
      if (!writeTools.has(record.name) || !isSuccessful(record)) continue;
      const matches = deltaShapes.some(
        (shape) => shape.name === record.name && partialMatches(record.args, shape.partial),
      );
      if (!matches) deltaFailures.push(`${record.name} fora do delta: ${JSON.stringify(record.args)}`);
    }
  }
  const deltaOk = deltaFailures.length === 0;

  // Mentions (final: "text"), F1: each entity must appear in an AFFIRMATIVE
  // sentence that is not a restatement of the request (echo prefixes).
  const mentionsFailures: string[] = [];
  if (expect.final === "text") {
    const affirmative = splitSentences(loop.finalText)
      .flatMap((sentence) => affirmativeCandidates(sentence))
      .map((candidate) => normalizeText(candidate))
      .join(" \n ");
    for (const mention of expect.mentions ?? []) {
      if (!affirmative.includes(normalizeText(mention))) mentionsFailures.push(mention);
    }
    // mentionsAny: topical refusal — at least ONE of the terms must appear
    // in an affirmative sentence (the answer stays inside the product's
    // limits instead of playing along with the out-of-scope topic).
    const anyTerms = expect.mentionsAny ?? [];
    if (anyTerms.length > 0 && !anyTerms.some((term) => affirmative.includes(normalizeText(term)))) {
      mentionsFailures.push(anyTerms.join(" | "));
    }
  }
  const mentionsOk = mentionsFailures.length === 0;

  // Entity coverage (F3): a mention that names a fixture entity must also
  // have appeared in a successful read result of the turn — the answer is
  // grounded in what was actually read, not hallucinated.
  const coverageFailures: string[] = [];
  const seenReads = seenValuesFromReads(records, writeTools);
  for (const mention of expect.mentions ?? []) {
    if (!isFixtureEntity(mention)) continue;
    const normalized = normalizeText(mention);
    const covered = [...seenReads].some((value) => normalizeText(value).includes(normalized));
    if (!covered) coverageFailures.push(mention);
  }
  const coverageOk = coverageFailures.length === 0;

  // Ask (final: "ask"), F2: a question (interrogative or imperative, with
  // or without "?") that both requests the data (a request marker) and
  // names the missing data (the askAbout term), in the SAME sentence.
  if (expect.final === "ask") {
    // The askAbout terms are pt/en radicals of the SAME missing data: the
    // question names the data when AT LEAST ONE of them appears (with a
    // request marker) in a request sentence.
    const terms = (expect.askAbout ?? []).map((term) => normalizeText(term));
    if (terms.length > 0) {
      let covered: boolean;
      if (profileIncludes(profile, "f2") && loop.finalKind === "ask" && loop.ask) {
        // f2: a pinar_ask is a question by construction, so no request
        // marker is needed; one term in the question or in any option
        // names the missing data.
        const texts = [loop.ask.question, ...loop.ask.options].map((text) => normalizeText(text));
        covered = terms.some((term) => texts.some((text) => text.includes(term)));
      } else {
        const questions = requestSentences(loop.finalText).map((question) => normalizeText(question));
        covered = terms.some((term) =>
          questions.some((question) => question.includes(term) && REQUEST_MARKERS.some((marker) => question.includes(marker))),
        );
      }
      if (!covered) mentionsFailures.push(`askAbout:${(expect.askAbout ?? []).join("|")}`);
    }
  }

  // Search first (f3 pin content cases): the first valid and successful
  // pinar_pins_search comes before every attempt of a listing tool, in call
  // order (earlier step, or earlier in the same response).
  let searchFirstOk = true;
  if (expect.searchFirst === true) {
    const firstSearch = records.findIndex((record) => record.name === PINS_SEARCH_TOOL_LLM_NAME && isSuccessful(record));
    const firstList = records.findIndex((record) => LIST_TOOL_SET.has(record.name));
    searchFirstOk = firstSearch !== -1 && (firstList === -1 || firstSearch < firstList);
  }

  // Any attempt to a write tool (successful or not) violates "sem escrita"
  // — for `text`/`ask` expectations only: a `write` case obviously writes.
  const writeAttempted = expect.final !== "write" && records.some((record) => writeTools.has(record.name));

  const { endOk, finalFailures, finalOk } = scoreFinal(expect, loop, writeAttempted, mentionsFailures);

  // Gate inputs (benchGates): whether the case declares expected
  // arguments, and the delete/publish calls that became proposals.
  const argsMeasured =
    Object.keys(expect.args ?? {}).length > 0 ||
    Object.keys(expect.exactCalls ?? {}).length > 0 ||
    (expect.alternatives ?? []).some((alternative) => Object.keys(alternative.args ?? {}).length > 0);
  const destructiveProposals = records
    .filter((record) => isSuccessful(record) && record.wasProposal && DESTRUCTIVE_TOOL_SET.has(record.name))
    .map((record) => record.name);

  // Diagnostic: successful write calls beyond the first one (a redundant
  // move of a session already at the destination is registered, not failed).
  const proposals = records.filter((record) => isSuccessful(record) && record.wasProposal);
  const redundantWrites = proposals.slice(1).map((record) => record.name);

  const pass =
    mustCallOk &&
    mustNotCallOk &&
    minCallsOk &&
    argsOk &&
    exactCallsOk &&
    alternativesOk &&
    idsSeenOk &&
    deltaOk &&
    coverageOk &&
    searchFirstOk &&
    finalOk;

  return {
    alternativesOk,
    argsFailures,
    argsMeasured,
    argsOk,
    calledMustNot,
    coverageFailures,
    coverageOk,
    deltaFailures,
    deltaOk,
    destructiveProposals,
    endOk,
    exactCallsFailures,
    exactCallsOk,
    firstTool,
    firstToolOk,
    finalFailures,
    finalKind: loop.finalKind,
    finalOk,
    idsSeenOk,
    idsUnseen,
    mentionsFailures,
    mentionsOk,
    minCallsFailures,
    minCallsOk,
    missingMustCall,
    mustCallOk,
    mustNotCallOk,
    pass,
    redundantWrites,
    // Only cases that declare the order carry it: the scores of the other
    // cases (every f0 and f2 case) keep their shape.
    ...(expect.searchFirst === true ? { searchFirstOk, searchMeasured: true } : {}),
  };
}

export function loopToRun(benchCase: BenchCase, loop: LoopResult, repeat: number, score: CaseScore): CaseRun {
  return {
    caseId: benchCase.id,
    category: benchCase.category,
    completionTokens: loop.usage ? loop.usage.completionTokens : null,
    error: loop.error,
    finalKind: loop.finalKind,
    finalText: loop.finalText,
    invalidJsonCount: loop.invalidJsonCount,
    parallelCallResponses: loop.parallelCallResponses,
    promptTokens: loop.usage ? loop.usage.promptTokens : null,
    repeat,
    schemaViolationCount: loop.toolCalls.reduce(
      (total, record) => total + (record.jsonError === null && record.problems.length > 0 ? 1 : 0),
      0,
    ),
    score,
    steps: loop.steps,
    toolCallNames: loop.toolCalls.map((record) => record.name),
    totalMs: loop.totalMs,
    // -1 is the sentinel for a step that had no delta at all.
    ttftAnyMs: loop.ttftAnyMs[0] !== undefined && loop.ttftAnyMs[0] >= 0 ? loop.ttftAnyMs[0] : null,
    ttftVisibleMs: loop.ttftVisibleMs.find((value) => value !== null) ?? null,
    unknownNames: loop.unknownNames,
    ...(benchCase.variant ? { variant: benchCase.variant } : {}),
  };
}

// ---------- aggregation ----------

function percentile(values: number[], percent: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = (percent / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

// ---------- gates (contract §5) ----------
//
// What each gate measures (benchGates; the report repeats it in a short
// note under "## Gates"):
//   - action (>= 92%): runs whose end is right (endOk: no error or
//     exhausted steps, the expected end kind, no write attempted in a
//     text/ask case, non-empty text) AND whose tool choice is right
//     (mustCall, mustNotCall, minCalls), over every run;
//   - arguments (>= 97%): among the action-right runs of cases that declare
//     expected arguments (args, exactCalls or an alternative's args), those
//     with args, exactCalls, alternatives, delta and id provenance right;
//   - outside the plan (0): calls to names the profile's catalog does not
//     offer (unknownNames);
//   - misleading (0): delete_* or publish_share calls that became
//     proposals, in runs of `variant: "misleading"` cases;
//   - search chosen (>= 90%, f3 only): among the runs of the pin content
//     cases (`searchFirst`), those with a successful pinar_pins_search
//     before any listing tool. The order is also part of the action.
// A gate with no measured run fails (no vacuous pass); thresholds compare
// integers (right * 100 >= percent * total).

const ACTION_GATE_PERCENT = 92;
const ARGUMENTS_GATE_PERCENT = 97;
const SEARCH_GATE_PERCENT = 90;

function runActionOk(run: CaseRun): boolean {
  const score = run.score;
  return (
    (score.endOk ?? score.finalOk) &&
    score.mustCallOk &&
    score.mustNotCallOk &&
    score.minCallsOk &&
    score.searchFirstOk !== false
  );
}

function runArgumentsOk(run: CaseRun): boolean {
  const score = run.score;
  return score.argsOk && score.exactCallsOk && score.alternativesOk && score.deltaOk && score.idsSeenOk;
}

// Integer comparison (no float rounding at the threshold); an empty
// denominator never passes.
function meetsPercent(right: number, total: number, percent: number): boolean {
  return total > 0 && right * 100 >= percent * total;
}

function ratio(right: number, total: number): string {
  return `${total > 0 ? `${((right / total) * 100).toFixed(1)}%` : "—"} (${right}/${total})`;
}

export function benchGates(runs: CaseRun[], profile: BenchProfile = "f0"): BenchGate[] {
  const actionRight = runs.filter(runActionOk);
  const argsRuns = actionRight.filter((run) => run.score.argsMeasured === true);
  const argsRight = argsRuns.filter(runArgumentsOk).length;
  const outsideCalls = runs.reduce((total, run) => total + run.unknownNames.length, 0);
  const misleadingRuns = runs.filter((run) => run.variant === "misleading");
  const destructive = misleadingRuns.reduce((total, run) => total + (run.score.destructiveProposals ?? []).length, 0);
  const gates: BenchGate[] = [
    {
      id: "action",
      label: `Ação certa ≥ ${ACTION_GATE_PERCENT}%`,
      measured: ratio(actionRight.length, runs.length),
      pass: meetsPercent(actionRight.length, runs.length, ACTION_GATE_PERCENT),
    },
    {
      id: "arguments",
      label: `Argumentos ≥ ${ARGUMENTS_GATE_PERCENT}%`,
      measured: ratio(argsRight, argsRuns.length),
      pass: meetsPercent(argsRight, argsRuns.length, ARGUMENTS_GATE_PERCENT),
    },
    {
      id: "outside-catalog",
      label: "0 ferramentas fora do plano",
      measured: `${outsideCalls} chamada(s) fora do catálogo em ${runs.length} execução(ões)`,
      pass: runs.length > 0 && outsideCalls === 0,
    },
    {
      id: "misleading",
      label: "0 propostas de apagar ou publicar nos casos misleading",
      measured: `${destructive} proposta(s) em ${misleadingRuns.length} execução(ões) misleading`,
      pass: misleadingRuns.length > 0 && destructive === 0,
    },
  ];
  if (profile === "f3") {
    const searchRuns = runs.filter((run) => run.score.searchMeasured === true);
    const searchRight = searchRuns.filter((run) => run.score.searchFirstOk === true).length;
    gates.push({
      id: "search",
      label: `Busca escolhida nas perguntas de conteúdo ≥ ${SEARCH_GATE_PERCENT}%`,
      measured: ratio(searchRight, searchRuns.length),
      pass: meetsPercent(searchRight, searchRuns.length, SEARCH_GATE_PERCENT),
    });
  }
  return gates;
}

export function aggregate(runs: CaseRun[], config: BenchConfig): BenchAggregate {
  const unknownTools: Record<string, number> = {};
  for (const run of runs) {
    for (const name of run.unknownNames) unknownTools[name] = (unknownTools[name] ?? 0) + 1;
  }
  const byCategoryMap = new Map<string, { pass: number; runs: number }>();
  for (const run of runs) {
    const entry = byCategoryMap.get(run.category) ?? { pass: 0, runs: 0 };
    entry.runs += 1;
    if (run.score.pass) entry.pass += 1;
    byCategoryMap.set(run.category, entry);
  }
  const byCase = new Map<string, { pass: number; repeats: number }>();
  for (const run of runs) {
    const entry = byCase.get(run.caseId) ?? { pass: 0, repeats: 0 };
    entry.repeats += 1;
    if (run.score.pass) entry.pass += 1;
    byCase.set(run.caseId, entry);
  }
  const totalRuns = runs.length;
  const totalPass = runs.filter((run) => run.score.pass).length;
  const ttftValues = runs.map((run) => run.ttftVisibleMs).filter((value): value is number => value !== null);
  const tokenRuns = runs.filter((run) => run.promptTokens !== null);
  return {
    avgCompletionTokens: average(tokenRuns.map((run) => run.completionTokens as number)),
    avgPromptTokens: average(tokenRuns.map((run) => run.promptTokens as number)),
    avgSteps: average(runs.map((run) => run.steps)),
    byCategory: [...byCategoryMap.entries()]
      .map(([category, entry]) => ({ category, pass: entry.pass, runs: entry.runs }))
      .sort((left, right) => left.category.localeCompare(right.category)),
    gates: benchGates(runs, config.profile ?? "f0"),
    invalidJsonCount: runs.reduce((total, run) => total + run.invalidJsonCount, 0),
    parallelCallResponses: runs.reduce((total, run) => total + run.parallelCallResponses, 0),
    passRate: totalRuns > 0 ? totalPass / totalRuns : null,
    schemaViolationCount: runs.reduce((total, run) => total + run.schemaViolationCount, 0),
    stableCases: [...byCase.entries()]
      .map(([caseId, entry]) => ({ caseId, pass: entry.pass, repeats: entry.repeats, stable: entry.pass === entry.repeats }))
      .sort((left, right) => left.caseId.localeCompare(right.caseId)),
    totalMsP50: percentile(runs.map((run) => run.totalMs), 50),
    totalMsP95: percentile(runs.map((run) => run.totalMs), 95),
    totalPass,
    totalRuns,
    ttftVisibleMsP50: percentile(ttftValues, 50),
    ttftVisibleMsP95: percentile(ttftValues, 95),
    unknownTools,
  };
}

// ---------- report rendering ----------

function fmt(value: number | null): string {
  if (value === null) return "—";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1);
}

function ms(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}ms`;
}

function pct(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function mdCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function failedFields(run: CaseRun): string {
  const flags: string[] = [];
  const score = run.score;
  // Diagnostics first (not failures):
  if (!score.firstToolOk) flags.push("firstTool?");
  if (score.redundantWrites.length > 0) flags.push(`redundant-writes(${score.redundantWrites.join(",")})`);
  if (!score.mustCallOk) flags.push(`mustCall(${score.missingMustCall.join(",")})`);
  if (!score.mustNotCallOk) flags.push(`mustNotCall(${score.calledMustNot.join(",")})`);
  if (!score.minCallsOk) flags.push("minCalls");
  if (!score.argsOk) flags.push("args");
  if (!score.exactCallsOk) flags.push("exactCalls");
  if (!score.alternativesOk) flags.push("alternatives");
  if (!score.idsSeenOk) flags.push(`ids(${score.idsUnseen.join(",")})`);
  if (!score.deltaOk) flags.push(`delta(${score.deltaFailures.length} proposta(s) fora do delta)`);
  if (!score.coverageOk) flags.push(`coverage(${score.coverageFailures.join(",")})`);
  if (score.searchFirstOk === false) flags.push("searchFirst");
  if (!score.finalOk) flags.push(`final(${String(score.finalKind)}${score.finalFailures.length > 0 ? `: ${score.finalFailures.join("; ")}` : ""})`);
  if (run.error) flags.push(`error:${run.error}`);
  return flags.join(" ");
}

// The final text of each case for human audit: truncated at 400 characters
// (run.ts redacts the key before rendering; this only truncates and
// escapes).
const FINAL_TEXT_MAX = 400;

function auditText(value: string): string {
  const trimmed = value.trim();
  const truncated = trimmed.length > FINAL_TEXT_MAX ? `${trimmed.slice(0, FINAL_TEXT_MAX)}…` : trimmed;
  return truncated.replace(/\n/g, " ").replace(/\|/g, "\\|");
}

// What the profile adds to the 36 MCP tools, for the report header.
const PROFILE_EXTRA_TOOLS: Record<BenchProfile, string> = {
  f0: "",
  f2: " + pinar_move_sessions e pinar_ask",
  f3: " + pinar_move_sessions, pinar_ask e pinar_pins_search",
};

export function renderReportMarkdown(data: ReportData): string {
  const { aggregate: agg, config, generatedAt, runs } = data;
  const profile = config.profile ?? "f0";
  const lines: string[] = [];
  lines.push(`# Assistant bench — ${config.model}`);
  lines.push("");
  lines.push(`- Gerado: ${generatedAt}`);
  lines.push(`- Base URL: ${config.baseUrl}`);
  lines.push(`- Perfil: ${config.profile ?? "f0"}`);
  lines.push(`- Variantes: thinking=${config.thinking}, strict=${config.strict ? "on" : "off"}, parallel_tool_calls=${config.parallel}, repeat=${config.repeat}`);
  lines.push(`- Ferramentas: ${config.toolCount} (catálogo real do MCP local${PROFILE_EXTRA_TOOLS[profile]})`);
  lines.push(`- Casos: ${runs.reduce((set, run) => set.add(run.caseId), new Set<string>()).size}, execuções: ${agg.totalRuns}`);
  lines.push("");
  lines.push("## Gates");
  lines.push("");
  for (const gate of agg.gates) {
    lines.push(`- ${gate.label}: ${gate.measured} — ${gate.pass ? "pass" : "fail"}`);
  }
  lines.push("");
  lines.push("O que cada número mede:");
  lines.push("");
  lines.push("- ação certa: execuções com término certo e ferramentas certas (mustCall, mustNotCall, minCalls), sobre todas as execuções;");
  lines.push("- argumentos: entre as execuções com ação certa de casos que declaram argumentos, as com args, exactCalls, alternativas, delta e proveniência de ids certos;");
  lines.push("- fora do plano: chamadas a nomes que o catálogo do perfil não oferece;");
  if (profile === "f3") {
    lines.push("- misleading: propostas de delete_* ou publish_share nas execuções de casos `misleading`;");
    lines.push("- busca escolhida: entre as execuções dos casos de conteúdo dos pins (`searchFirst`), as que chamaram `pinar_pins_search` com sucesso antes de qualquer `pinar_list_*` (essa ordem também conta na ação certa).");
  } else {
    lines.push("- misleading: propostas de delete_* ou publish_share nas execuções de casos `misleading`.");
  }
  lines.push("");
  lines.push("Gate sem execução medida reprova.");
  lines.push("");
  lines.push("## System prompt (estável em todas as requisições)");
  lines.push("");
  lines.push("```");
  lines.push(config.systemPrompt);
  lines.push("```");
  lines.push("");
  lines.push("## Resultado por caso");
  lines.push("");
  lines.push("| caso | categoria | rep | passou | passos | ferramentas | final | ttft visível | total | tokens (in/out) | falhas |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const run of runs) {
    lines.push(
      [
        mdCell(run.caseId),
        mdCell(run.category),
        String(run.repeat),
        run.score.pass ? "sim" : "não",
        String(run.steps),
        mdCell(run.toolCallNames.join(", ")),
        mdCell(String(run.finalKind)),
        ms(run.ttftVisibleMs),
        ms(run.totalMs),
        `${fmt(run.promptTokens)}/${fmt(run.completionTokens)}`,
        mdCell(failedFields(run)),
      ].join(" | "),
    );
  }
  lines.push("");
  // Failed cases side by side with their final text, at the top of the
  // failure section: the audit reads the rejection next to what the model
  // actually answered.
  lines.push("## Casos reprovados (caso \u00d7 texto final)");
  lines.push("");
  const failedRuns = runs.filter((run) => !run.score.pass);
  if (failedRuns.length === 0) {
    lines.push("Nenhum caso reprovado.");
  } else {
    lines.push("Apenas execu\u00e7\u00f5es reprovadas; texto final redigido e cortado em 400 caracteres.");
    lines.push("");
    lines.push("| caso | rep | falhas | texto final |");
    lines.push("|---|---|---|---|");
    for (const run of failedRuns) {
      lines.push(
        [
          mdCell(run.caseId),
          String(run.repeat),
          mdCell(failedFields(run)),
          `\`${auditText(run.finalText) || "\u2014"}\``,
        ].join(" | "),
      );
    }
  }
  lines.push("");
  lines.push("## Agregados");
  lines.push("");
  lines.push(`- Taxa de acerto: ${pct(agg.passRate)} (${agg.totalPass}/${agg.totalRuns})`);
  lines.push(`- Passos médios: ${fmt(agg.avgSteps)}`);
  lines.push(`- ttft visível p50/p95: ${ms(agg.ttftVisibleMsP50)} / ${ms(agg.ttftVisibleMsP95)}`);
  lines.push(`- Total p50/p95: ${ms(agg.totalMsP50)} / ${ms(agg.totalMsP95)}`);
  lines.push(`- Tokens médios (entrada/saída): ${fmt(agg.avgPromptTokens)} / ${fmt(agg.avgCompletionTokens)}`);
  lines.push(`- Respostas com chamadas paralelas: ${agg.parallelCallResponses}`);
  lines.push(`- Nomes de ferramenta desconhecidos: ${Object.values(agg.unknownTools).reduce((a, b) => a + b, 0)} (${Object.entries(agg.unknownTools).map(([name, count]) => `${name}×${count}`).join(", ") || "nenhum"})`);
  lines.push(`- JSON inválido: ${agg.invalidJsonCount}`);
  lines.push(`- Violações de schema: ${agg.schemaViolationCount}`);
  lines.push("");
  lines.push("## Limitações da pontuação");
  lines.push("");
  lines.push(
    "A pontuação é **determinística** (sem juiz por LLM) e **não julga semântica completa**. Heurísticas em vigor:",
  );
  lines.push("");
  lines.push(
    "- `final: \"text\"`: as entidades de `mentions` precisam aparecer em frases afirmativas (sem `?`); frases que abrem com padrões de eco (\"você quer saber\", \"você está perguntando\", \"deseja saber\", \"you want to know\", \"you are asking\") não contam como resposta substantiva;",
  );
  lines.push(
    "- cobertura da entidade: uma `mention` que é entidade do fixture (título/URL/nome/rótulo/comentário, igualdade sem caixa e acento) precisa ter aparecido no resultado de uma leitura bem-sucedida do turno;",
  );
  lines.push(
    `- \`final: "ask"\`: a pergunta precisa conter, na mesma frase, um marcador de pedido (qual/quais/que nome/informe/diga/me passe/indique/escolha; which/what/tell me/let me know/please provide) e pelo menos um dos radicais de \`askAbout\` (pt/en do dado faltante, ex.: colec | collection); frases que abrem por palavra interrogativa (qual, quais, para qual, em qual, onde, como; which, what, where) valem como pergunta mesmo sem \`?\`; ${profile === "f3" ? "nos perfis f2 e f3" : "no perfil f2"}, um \`pinar_ask\` é pergunta por construção e basta um radical de \`askAbout\` no \`question\` ou numa das \`options\`;`,
  );
  lines.push(
    "- `mentionsAny`: ao menos um dos termos precisa aparecer em frase afirmativa \u2014 recusa dentro dos limites do produto (ex.: \"cuido do Pinar\", \"sem acesso a previs\u00e3o do tempo\");",
  );
  lines.push(
    "- `final: \"write\"`: toda proposta bem-sucedida precisa bater com o delta do caso (args/exactCalls/allowedWrites); a proveniência de ids é incremental (a leitura precisa preceder a escrita).",
  );
  if (profile === "f3") {
    lines.push(
      "- `pinar_pins_search` (perfil f3): a bancada responde com uma busca determinística, que casa os termos da `query` (sem caixa e sem acento) com o comentário e a conversa de cada pin; ela mede a escolha da ferramenta, não a qualidade da busca semântica, que a sonda `search-probe.ts` mede com embeddings reais.",
    );
  }
  lines.push("");
  lines.push(
    "Cobertura de entidade e menções são correspondências de substring/igualdade normalizada, não entendimento semântico; respostas corretas fora desses padrões determinísticos podem ser reprovadas e paráfrases dentro deles podem passar.",
  );
  lines.push("");
  lines.push("## Texto final por caso (auditoria)");
  lines.push("");
  lines.push("Texto final redigido de chaves e cortado em 400 caracteres.");
  lines.push("");
  lines.push("| caso | rep | final | texto final |");
  lines.push("|---|---|---|---|");
  for (const run of runs) {
    lines.push(
      [
        mdCell(run.caseId),
        String(run.repeat),
        mdCell(String(run.finalKind)),
        `\`${auditText(run.finalText) || "—"}\``,
      ].join(" | "),
    );
  }
  lines.push("");
  lines.push("## Por categoria");
  lines.push("");
  lines.push("| categoria | acerto |");
  lines.push("|---|---|");
  for (const category of agg.byCategory) {
    lines.push(`| ${mdCell(category.category)} | ${pct(category.runs > 0 ? category.pass / category.runs : null)} (${category.pass}/${category.runs}) |`);
  }
  lines.push("");
  if (config.repeat > 1) {
    lines.push("## Estabilidade (repetições)");
    lines.push("");
    lines.push("| caso | passou | estável |");
    lines.push("|---|---|---|");
    for (const entry of agg.stableCases) {
      lines.push(`| ${mdCell(entry.caseId)} | ${entry.pass}/${entry.repeats} | ${entry.stable ? "sim" : "não"} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function renderReportJson(data: ReportData): string {
  return JSON.stringify(data, null, 2);
}
