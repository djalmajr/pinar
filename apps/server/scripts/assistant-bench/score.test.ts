import { expect, test } from "bun:test";
import { BENCH_CASES } from "./cases";
import { collectionByName, sessionByTitle } from "./fixtures";
import { aggregate, benchGates, loopToRun, normalizeText, questionSentences, scoreCase } from "./score";
import type { BenchCase, BenchConfig, CaseExpect, CaseRun, CaseScore, LoopResult, ToolCallRecord } from "./types";

const LOGIN_SESSION = sessionByTitle("Login da Pinar")!;
const REFS = collectionByName("Referências")!;
const CINZEL = collectionByName("Cinzel")!;

function record(
  name: string,
  args: unknown,
  jsonError: string | null = null,
  problems: string[] = [],
  result: unknown = { ok: true },
  error: string | null = jsonError ? "Invalid JSON arguments" : null,
  wasProposal = false,
): ToolCallRecord {
  return { args, error, jsonError, name, problems, result, step: 1, wasProposal };
}

// A successful read whose result payload carries the given strings.
function readWith(name: string, strings: string[]): ToolCallRecord {
  return record(name, {}, null, [], { items: strings });
}

function loop(partial: Partial<LoopResult> & { finalKind: LoopResult["finalKind"]; toolCalls: ToolCallRecord[] }): LoopResult {
  return {
    error: null,
    finalText: "texto final",
    invalidJsonCount: 0,
    parallelCallResponses: 0,
    steps: 1,
    stoppedReason: "text",
    totalMs: 100,
    ttftAnyMs: [1],
    ttftVisibleMs: [5],
    unknownNames: [],
    usage: { completionTokens: 10, promptTokens: 20 },
    ...partial,
  };
}

function benchCase(id = "c1"): BenchCase {
  return { category: "teste", id, language: "pt-BR", prompt: "p", expect: { final: "text" } };
}

function scoreOf(expect: CaseExpect, loopResult: LoopResult): CaseScore {
  return scoreCase(expect, loopResult);
}

test("firstTool: ausente sempre ok; nome único; lista; nada chamado (diagnóstico)", () => {
  const calls = [record("pinar_list_projects", {})];
  expect(scoreOf({ final: "text", mentions: ["Personal"] }, loop({ finalKind: "text", finalText: "Personal", toolCalls: calls })).firstToolOk).toBe(true);
  expect(scoreOf({ final: "text", firstTool: "pinar_list_projects", mentions: ["Personal"] }, loop({ finalKind: "text", finalText: "Personal", toolCalls: calls })).firstToolOk).toBe(true);
  expect(scoreOf({ final: "text", firstTool: "pinar_list_collections", mentions: ["Personal"] }, loop({ finalKind: "text", finalText: "Personal", toolCalls: calls })).firstToolOk).toBe(false);
  expect(scoreOf({ final: "text", firstTool: ["pinar_list_projects", "pinar_list_sessions"], mentions: ["Personal"] }, loop({ finalKind: "text", finalText: "Personal", toolCalls: calls })).firstToolOk).toBe(true);
  expect(scoreOf({ final: "text", firstTool: "pinar_list_sessions", mentions: ["Personal"] }, loop({ finalKind: "text", finalText: "Personal", toolCalls: [] })).firstToolOk).toBe(false);
});

test("firstTool é diagnóstico: consulta preliminar legítima não reprova o caso", () => {
  // O modelo consulta list_projects antes de responder (ordem não é contrato).
  const calls = [readWith("pinar_list_projects", ["Personal"])];
  const score = scoreOf(
    { final: "text", firstTool: "pinar_list_projects", mentions: ["Personal"] },
    loop({ finalKind: "text", finalText: "Você tem o projeto Personal.", toolCalls: calls }),
  );
  expect(score.firstToolOk).toBe(true);
  const wrongOrder = [readWith("pinar_list_collections", ["Personal"]), readWith("pinar_list_projects", ["Personal"])];
  const scoreWrong = scoreOf(
    { final: "text", firstTool: "pinar_list_projects", mentions: ["Personal"] },
    loop({ finalKind: "text", finalText: "Você tem o projeto Personal.", toolCalls: wrongOrder }),
  );
  expect(scoreWrong.firstToolOk).toBe(false);
  expect(scoreWrong.pass).toBe(true);
});

test("mustCall: exige chamada válida E bem-sucedida", () => {
  const calls = [record("pinar_list_projects", {}), record("pinar_list_collections", { projectId: "p" })];
  const ok = scoreOf({ final: "text", mentions: ["x"], mustCall: ["pinar_list_collections", "pinar_list_projects"] }, loop({ finalKind: "text", finalText: "x", toolCalls: calls }));
  expect(ok.mustCallOk).toBe(true);
  const bad = scoreOf({ final: "text", mentions: ["x"], mustCall: ["pinar_list_sessions"] }, loop({ finalKind: "text", finalText: "x", toolCalls: calls }));
  expect(bad.mustCallOk).toBe(false);
  expect(bad.missingMustCall).toEqual(["pinar_list_sessions"]);
  // Erro de handler (chamada válida, resultado em erro) não satisfaz a obrigação.
  const handlerError = [record("pinar_list_projects", { limit: 51 }, null, [], null, "limit must be an integer between 1 and 50")];
  const failed = scoreOf({ final: "text", mentions: ["x"], mustCall: ["pinar_list_projects"] }, loop({ finalKind: "text", finalText: "x", toolCalls: handlerError }));
  expect(failed.mustCallOk).toBe(false);
  expect(failed.missingMustCall).toEqual(["pinar_list_projects"]);
  // Violação de schema também não satisfaz.
  const schemaError = [record("pinar_list_projects", { limit: 51 }, null, ["limit is above maximum 50"], null, "Invalid arguments")];
  const failedSchema = scoreOf({ final: "text", mentions: ["x"], mustCall: ["pinar_list_projects"] }, loop({ finalKind: "text", finalText: "x", toolCalls: schemaError }));
  expect(failedSchema.mustCallOk).toBe(false);
  // Tentativa fracassada e depois uma bem-sucedida: recuperação vale.
  const recovered = [
    record("pinar_list_projects", { limit: 51 }, null, [], null, "limit must be an integer between 1 and 50"),
    record("pinar_list_projects", {}),
  ];
  const okRecovered = scoreOf({ final: "text", mentions: ["x"], mustCall: ["pinar_list_projects"] }, loop({ finalKind: "text", finalText: "x", toolCalls: recovered }));
  expect(okRecovered.mustCallOk).toBe(true);
});

test("mustNotCall: veto sobre tentativas (inclusive falhas)", () => {
  const failedWrite = record("pinar_delete_session", { sessionId: "x" }, null, [], null, "Session not found");
  const bad = scoreOf({ final: "write", mustNotCall: ["pinar_delete_session", "pinar_delete_batch"] }, loop({ finalKind: "write", stoppedReason: "proposal", toolCalls: [failedWrite] }));
  expect(bad.mustNotCallOk).toBe(false);
  expect(bad.calledMustNot).toEqual(["pinar_delete_session"]);
  const ok = scoreOf({ final: "write", mustNotCall: ["pinar_delete_batch"] }, loop({ finalKind: "write", stoppedReason: "proposal", toolCalls: [failedWrite] }));
  expect(ok.mustNotCallOk).toBe(true);
});

test("minCalls: conta só chamadas válidas e bem-sucedidas", () => {
  const one = [record("pinar_move_session", { collectionId: CINZEL.id, sessionId: "s" }, null, [], { status: "awaiting_confirmation", summary: "m" }, null, true)];
  const bad = [record("pinar_move_session", { collectionId: CINZEL.id, sessionId: "s" }, null, [], null, "Session not found")];
  expect(scoreOf({ final: "write", minCalls: { pinar_move_session: 1 } }, loop({ finalKind: "write", stoppedReason: "proposal", toolCalls: one })).minCallsOk).toBe(true);
  expect(scoreOf({ final: "write", minCalls: { pinar_move_session: 1 } }, loop({ finalKind: "write", stoppedReason: "proposal", toolCalls: bad })).minCallsOk).toBe(false);
  const two = [...one, record("pinar_move_session", { collectionId: CINZEL.id, sessionId: "t" }, null, [], { status: "awaiting_confirmation", summary: "m2" }, null, true)];
  expect(scoreOf({ final: "write", minCalls: { pinar_move_session: 2 } }, loop({ finalKind: "write", stoppedReason: "proposal", toolCalls: two })).minCallsOk).toBe(true);
  expect(scoreOf({ final: "write", minCalls: { pinar_move_session: 2 } }, loop({ finalKind: "write", stoppedReason: "proposal", toolCalls: one })).minCallsOk).toBe(false);
});

test("args: subconjunto profundo; extra permitido; valor errado falha; exige sucesso", () => {
  const calls = [record("pinar_move_session", { collectionId: CINZEL.id, sessionId: "s1" }, null, [], { status: "awaiting_confirmation", summary: "m" }, null, true)];
  const expectArgs: CaseExpect = { args: { pinar_move_session: { collectionId: CINZEL.id, sessionId: "s1" } }, final: "write" };
  expect(scoreOf(expectArgs, loop({ finalKind: "write", stoppedReason: "proposal", toolCalls: calls })).argsOk).toBe(true);
  const extraKey = [record("pinar_move_session", { collectionId: CINZEL.id, sessionId: "s1", agente: "x" }, null, [], { status: "awaiting_confirmation", summary: "m" }, null, true)];
  expect(scoreOf(expectArgs, loop({ finalKind: "write", stoppedReason: "proposal", toolCalls: extraKey })).argsOk).toBe(true);
  const wrongValue = [record("pinar_move_session", { collectionId: REFS.id, sessionId: "s1" }, null, [], { status: "awaiting_confirmation", summary: "m" }, null, true)];
  const failed = scoreOf(expectArgs, loop({ finalKind: "write", stoppedReason: "proposal", toolCalls: wrongValue }));
  expect(failed.argsOk).toBe(false);
  expect(failed.argsFailures.length).toBe(1);
  const notCalled = [record("pinar_list_sessions", {})];
  expect(scoreOf(expectArgs, loop({ finalKind: "write", stoppedReason: "proposal", toolCalls: notCalled })).argsOk).toBe(false);
  // Tentativa com os args certos mas erro de handler não satisfaz a proposta.
  const failedAttempt = [record("pinar_move_session", { collectionId: CINZEL.id, sessionId: "s1" }, null, [], null, "Session not found")];
  expect(scoreOf(expectArgs, loop({ finalKind: "write", stoppedReason: "proposal", toolCalls: failedAttempt })).argsOk).toBe(false);
});

test("args: para final write só a proposta conta", () => {
  const expectArgs: CaseExpect = { args: { pinar_move_session: { collectionId: CINZEL.id, sessionId: "s1" } }, final: "write" };
  // Chamada bem-sucedida mas não proposta + proposta com alvo errado.
  const calls = [
    record("pinar_move_session", { collectionId: CINZEL.id, sessionId: "s1" }, null, [], { status: "ok" }),
    record("pinar_move_session", { collectionId: REFS.id, sessionId: "s1" }, null, [], { status: "awaiting_confirmation", summary: "m" }, null, true),
  ];
  expect(scoreOf(expectArgs, loop({ finalKind: "write", stoppedReason: "proposal", toolCalls: calls })).argsOk).toBe(false);
  // Proposta correta: passa.
  const good = [record("pinar_move_session", { collectionId: CINZEL.id, sessionId: "s1" }, null, [], { status: "awaiting_confirmation", summary: "m" }, null, true)];
  expect(scoreOf(expectArgs, loop({ finalKind: "write", stoppedReason: "proposal", toolCalls: good })).argsOk).toBe(true);
});

test("args: chamada com JSON inválido não conta como correspondência", () => {
  const calls = [record("pinar_move_session", null, "Unexpected token")];
  const score = scoreOf({ args: { pinar_move_session: { sessionId: "s" } }, final: "write" }, loop({ finalKind: "write", stoppedReason: "proposal", toolCalls: calls }));
  expect(score.argsOk).toBe(false);
});

test("args: valores aninhados e arrays com igualdade profunda", () => {
  const calls = [record("pinar_reorder_projects", { ids: ["a", "b"] }, null, [], { status: "awaiting_confirmation", summary: "m" }, null, true)];
  const score = scoreOf({ args: { pinar_reorder_projects: { ids: ["a", "b"] } }, final: "write" }, loop({ finalKind: "write", stoppedReason: "proposal", toolCalls: calls }));
  expect(score.argsOk).toBe(true);
});

test("args: query compara sem caixa e sem acento", () => {
  const expectArgs: CaseExpect = { args: { pinar_list_sessions: { query: "login" } }, final: "text", mentions: ["Login da Pinar"] };
  const upper = [record("pinar_list_sessions", { query: "LOGIN" })];
  expect(scoreOf(expectArgs, loop({ finalKind: "text", finalText: "Login da Pinar", toolCalls: upper })).argsOk).toBe(true);
  const accented = [record("pinar_list_sessions", { query: "login da pinar" })];
  expect(scoreOf(expectArgs, loop({ finalKind: "text", finalText: "Login da Pinar", toolCalls: accented })).argsOk).toBe(false);
  const other = [record("pinar_list_sessions", { query: "x" })];
  expect(scoreOf(expectArgs, loop({ finalKind: "text", finalText: "Login da Pinar", toolCalls: other })).argsOk).toBe(false);
});

test("exactCalls: conjunto exato, independente da ordem", () => {
  const ids = ["a1", "b2", "c3", "d4"];
  const entries = ids.map((sessionId) => ({ collectionId: REFS.id, sessionId }));
  const expectExact: CaseExpect = { exactCalls: { pinar_move_session: entries }, final: "write" };
  const proposal = (sessionId: string) =>
    record("pinar_move_session", { collectionId: REFS.id, sessionId }, null, [], { status: "awaiting_confirmation", summary: "m" }, null, true);
  const four = ids.map(proposal);
  const shuffled = [four[2], four[0], four[3], four[1]];
  expect(scoreOf(expectExact, loop({ finalKind: "write", stoppedReason: "proposal", toolCalls: shuffled })).exactCallsOk).toBe(true);
  // Uma a menos: falha.
  expect(scoreOf(expectExact, loop({ finalKind: "write", stoppedReason: "proposal", toolCalls: four.slice(0, 3) })).exactCallsOk).toBe(false);
  // Uma a mais: falha.
  expect(scoreOf(expectExact, loop({ finalKind: "write", stoppedReason: "proposal", toolCalls: [...four, proposal("e5")] })).exactCallsOk).toBe(false);
  // Destino errado em uma das quatro: falha.
  const wrongTarget = [four[0], four[1], four[2], record("pinar_move_session", { collectionId: CINZEL.id, sessionId: "d4" }, null, [], { status: "awaiting_confirmation", summary: "m" }, null, true)];
  expect(scoreOf(expectExact, loop({ finalKind: "write", stoppedReason: "proposal", toolCalls: wrongTarget })).exactCallsOk).toBe(false);
  // Duas chamadas iguais (mesmo id) não cobrem o conjunto: falha.
  const duplicated = [four[0], four[0], four[1], four[2]];
  expect(scoreOf(expectExact, loop({ finalKind: "write", stoppedReason: "proposal", toolCalls: duplicated })).exactCallsOk).toBe(false);
});

test("alternatives: markdown da sessão cobre o mesmo dado que list_pins", () => {
  const expectAlt: CaseExpect = {
    alternatives: [
      { args: { pinar_list_pins: { sessionId: LOGIN_SESSION.id } }, mustCall: ["pinar_list_pins"] },
      { args: { pinar_get_session_markdown: { sessionId: LOGIN_SESSION.id } }, mustCall: ["pinar_get_session_markdown"] },
    ],
    final: "text",
    mentions: ["apagado"],
    mustCall: ["pinar_list_sessions"],
  };
  const viaMarkdown = [
    record("pinar_list_sessions", { query: "Login da Pinar" }),
    record("pinar_get_session_markdown", { sessionId: LOGIN_SESSION.id }, null, [], "# Login da Pinar\n1. O botão de entrar fica meio apagado"),
  ];
  const viaMarkdownScore = scoreOf(expectAlt, loop({ finalKind: "text", finalText: "O botão de entrar fica meio apagado.", toolCalls: viaMarkdown }));
  expect(viaMarkdownScore.alternativesOk).toBe(true);
  expect(viaMarkdownScore.pass).toBe(true);
  // Nem uma nem outra: falha.
  const neither = [record("pinar_list_sessions", { query: "Login da Pinar" })];
  const neitherScore = scoreOf(expectAlt, loop({ finalKind: "text", finalText: "O botão de entrar fica meio apagado.", toolCalls: neither }));
  expect(neitherScore.alternativesOk).toBe(false);
  expect(neitherScore.pass).toBe(false);
  // Markdown da sessão ERRADA: alternativa não satisfeita.
  const wrongSession = [
    record("pinar_list_sessions", { query: "Login da Pinar" }),
    record("pinar_get_session_markdown", { sessionId: "outra" }, null, [], "# Outra\n1. outro"),
  ];
  expect(scoreOf(expectAlt, loop({ finalKind: "text", finalText: "O botão de entrar fica meio apagado.", toolCalls: wrongSession })).alternativesOk).toBe(false);
});

test("final: text — oferta depois de resposta correta passa", () => {
  const expectText: CaseExpect = { final: "text", mentions: ["Personal"], mustCall: ["pinar_list_projects"] };
  const calls = [record("pinar_list_projects", {}, null, [], { projects: [{ name: "Personal" }] })];
  const loopText = loop({ finalKind: "text", finalText: "Existe o projeto Personal. Quer detalhes?", toolCalls: calls });
  const score = scoreOf(expectText, loopText);
  expect(score.finalOk).toBe(true);
  expect(score.pass).toBe(true);
});

test("final: text — texto vazio ou erro ou max-steps reprova", () => {
  const expectText: CaseExpect = { final: "text", mentions: ["Personal"], mustCall: ["pinar_list_projects"] };
  const calls = [record("pinar_list_projects", {})];
  const empty = loop({ finalKind: "text", finalText: "   ", toolCalls: calls });
  expect(scoreOf(expectText, empty).finalOk).toBe(false);
  expect(scoreOf(expectText, empty).finalFailures.some((failure) => failure.includes("texto final vazio"))).toBe(true);
  const errored = loop({ error: "HTTP 500", finalKind: null, stoppedReason: "error", toolCalls: calls });
  expect(scoreOf(expectText, errored).finalOk).toBe(false);
  const maxed = loop({ finalKind: "text", stoppedReason: "max-steps", steps: 8, toolCalls: calls });
  expect(scoreOf(expectText, maxed).finalOk).toBe(false);
  expect(scoreOf(expectText, maxed).finalFailures.some((failure) => failure.includes("passos esgotados"))).toBe(true);
});

test("final: text — escrita tentada reprova mesmo com boa resposta", () => {
  const expectText: CaseExpect = { final: "text", mentions: ["Personal"], mustCall: ["pinar_list_projects"] };
  const calls = [
    record("pinar_list_projects", {}),
    record("pinar_move_session", { collectionId: REFS.id, sessionId: "s" }, null, [], null, "Session not found"),
  ];
  const score = scoreOf(expectText, loop({ finalKind: "text", finalText: "Você tem o projeto Personal.", toolCalls: calls }));
  expect(score.finalOk).toBe(false);
  expect(score.finalFailures.some((failure) => failure.includes("escrita tentada"))).toBe(true);
  expect(score.pass).toBe(false);
});

test("final: text — menções ausentes reprova (busca errada não passa)", () => {
  // g03: buscou "login" e respondeu sobre Login da Pinar: não menciona a sessão de DNS.
  const expectDns: CaseExpect = { final: "text", mentions: ["Zonas DNS no cPanel"], mustCall: ["pinar_list_sessions"] };
  const calls = [record("pinar_list_sessions", { query: "login" })];
  const score = scoreOf(expectDns, loop({ finalKind: "text", finalText: "Encontrei Login da Pinar.", toolCalls: calls }));
  expect(score.mentionsOk).toBe(false);
  expect(score.mentionsFailures).toEqual(["Zonas DNS no cPanel"]);
  expect(score.pass).toBe(false);
  // Resposta com a sessão de DNS: passa (menção sem caixa/acentos;
  // a leitura de fato encontrou a entidade — cobertura F3).
  const ok = scoreOf(expectDns, loop({ finalKind: "text", finalText: "Found 1 session: Zonas dns no cPanel.", toolCalls: [readWith("pinar_list_sessions", ["Zonas DNS no cPanel"])] }));
  expect(ok.mentionsOk).toBe(true);
  expect(ok.coverageOk).toBe(true);
  expect(ok.pass).toBe(true);
  // F3: entidade citada que nenhuma leitura retornou reprova.
  const hallucinated = scoreOf(expectDns, loop({ finalKind: "text", finalText: "Encontrei Zonas DNS no cPanel.", toolCalls: [readWith("pinar_list_sessions", ["Login da Pinar"])] }));
  expect(hallucinated.coverageOk).toBe(false);
  expect(hallucinated.coverageFailures).toEqual(["Zonas DNS no cPanel"]);
  expect(hallucinated.pass).toBe(false);
});

test("final: text (F1): eco do pedido não vale menção; afirmação vale", () => {
  const expectText: CaseExpect = { final: "text", mentions: ["Personal"] };
  // única frase é o eco da pergunta ("Você quer saber..."): não conta.
  const echo = loop({ finalKind: "text", finalText: "Você quer saber se existe o projeto Personal.", toolCalls: [] });
  const echoScore = scoreOf(expectText, echo);
  expect(echoScore.mentionsOk).toBe(false);
  expect(echoScore.mentionsFailures).toEqual(["Personal"]);
  // Resposta afirmativa (após o eco): a menção conta (leitura cobre a entidade).
  const affirmative = loop({ finalKind: "text", finalText: "Você quer saber se existe o projeto Personal? Sim, você tem o projeto Personal.", toolCalls: [readWith("pinar_list_projects", ["Personal"])] });
  const affScore = scoreOf(expectText, affirmative);
  expect(affScore.mentionsOk).toBe(true);
  expect(affScore.pass).toBe(true);
});

test("final: ask (F2): marcador de pedido e termo devem estar na MESMA frase", () => {
  const expectAsk: CaseExpect = { askAbout: ["colecao"], final: "ask", mustNotCall: ["pinar_move_session"] };
  // Marcador ("qual") numa pergunta e termo em frase não-pergunta: não confere.
  const split = loop({ finalKind: "text", finalText: "Qual é o número da sessão? A coleção de destino não foi confirmada.", toolCalls: [] });
  const splitScore = scoreOf(expectAsk, split);
  expect(splitScore.finalOk).toBe(false);
  expect(splitScore.finalFailures.some((failure) => failure.includes("pergunta"))).toBe(true);
  // Imperativo com marcador e termo na mesma frase: confere.
  const sameSentence = loop({ finalKind: "text", finalText: "Me diga qual é a coleção de destino.", toolCalls: [] });
  expect(scoreOf(expectAsk, sameSentence).finalOk).toBe(true);
});

test("final: ask (#3): imperativo e preâmbulo de cortesia passam; menção sem pedido reprova", () => {
  const expectAsk: CaseExpect = { askAbout: ["colecao"], final: "ask", mustNotCall: ["pinar_move_session"] };
  // Imperativo declarando o pedido, sem interrogação (INDIQUE).
  const indique = loop({ finalKind: "text", finalText: "Indique a coleção que devo renomear e o novo nome.", toolCalls: [] });
  const indiqueScore = scoreOf(expectAsk, indique);
  expect(indiqueScore.finalOk).toBe(true);
  // Preâmbulo de cortesia antes do imperativo (POR FAVOR, INFORME).
  const porFavor = loop({ finalKind: "text", finalText: "Por favor, informe a coleção de destino.", toolCalls: [] });
  expect(scoreOf(expectAsk, porFavor).finalOk).toBe(true);
  // Controle: mencionar o termo sem solicitar continua reprovando.
  const mentionOnly = loop({ finalKind: "text", finalText: "Você sabia que coleção é uma palavra?", toolCalls: [] });
  const mentionOnlyScore = scoreOf(expectAsk, mentionOnly);
  expect(mentionOnlyScore.finalOk).toBe(false);
  expect(mentionOnlyScore.finalFailures.some((failure) => failure.includes("pergunta"))).toBe(true);
});

test("final: text (#4): afirmação com oferta final na mesma frase conta", () => {
  const expectText: CaseExpect = { final: "text", mentions: ["Personal"], mustCall: ["pinar_list_projects"] };
  // Oferta na MESMA frase separada por vírgula: a parte afirmativa vale.
  const commaOffer = loop({ finalKind: "text", finalText: "Você tem o projeto Personal, quer ver as coleções dele?", toolCalls: [readWith("pinar_list_projects", ["Personal"])] });
  const commaScore = scoreOf(expectText, commaOffer);
  expect(commaScore.mentionsOk).toBe(true);
  expect(commaScore.pass).toBe(true);
  // Controle: oferta em frase separada continua passando.
  const separate = loop({ finalKind: "text", finalText: "Você tem o projeto Personal. Quer ver as coleções dele?", toolCalls: [readWith("pinar_list_projects", ["Personal"])] });
  expect(scoreOf(expectText, separate).pass).toBe(true);
  // Controle: eco do pedido (mesmo com a entidade) continua reprovando.
  const echo = loop({ finalKind: "text", finalText: "Você quer saber sobre o Personal?", toolCalls: [readWith("pinar_list_projects", ["Personal"])] });
  const echoScore = scoreOf(expectText, echo);
  expect(echoScore.mentionsOk).toBe(false);
  expect(echoScore.pass).toBe(false);
});

test("final: text (#2): preâmbulo e markdown não disfarçam o eco", () => {
  const expectText: CaseExpect = { final: "text", mentions: ["Personal"] };
  // Preâmbulo comum antes do eco: a frase ainda é o eco do pedido.
  const prefixed = loop({ finalKind: "text", finalText: "Entendi, você quer saber se existe o projeto Personal.", toolCalls: [] });
  const prefixedScore = scoreOf(expectText, prefixed);
  expect(prefixedScore.mentionsOk).toBe(false);
  expect(prefixedScore.mentionsFailures).toEqual(["Personal"]);
  // Eco em negrito (marcação markdown deslocando o prefixo): reprova.
  const markdown = loop({ finalKind: "text", finalText: "**Você quer saber se existe o projeto Personal.**", toolCalls: [] });
  const markdownScore = scoreOf(expectText, markdown);
  expect(markdownScore.mentionsOk).toBe(false);
  // Controle: preâmbulo + resposta substantiva continua valendo.
  const substantive = loop({ finalKind: "text", finalText: "Entendi. Você tem o projeto Personal.", toolCalls: [readWith("pinar_list_projects", ["Personal"])] });
  const substantiveScore = scoreOf(expectText, substantive);
  expect(substantiveScore.mentionsOk).toBe(true);
  expect(substantiveScore.pass).toBe(true);
});

test("proveniência F5 (#5): escrita antes da leitura que revela o id reprova", () => {
  const expectWrite: CaseExpect = {
    args: { pinar_move_session: { collectionId: REFS.id, sessionId: LOGIN_SESSION.id } },
    final: "write",
    mustCall: ["pinar_move_session"],
  };
  const move = record("pinar_move_session", { collectionId: REFS.id, sessionId: LOGIN_SESSION.id }, null, [], { status: "awaiting_confirmation", summary: "m" }, null, true);
  const readSessions = readWith("pinar_list_sessions", [LOGIN_SESSION.id]);
  const readCollections = readWith("pinar_list_collections", [REFS.id]);
  // Mesma resposta: a proposta antecede as leituras na ordem das chamadas.
  const sameResponse = [move, readSessions, readCollections].map((call) => ({ ...call, step: 1 }));
  const sameScore = scoreOf(expectWrite, loop({ finalKind: "write", stoppedReason: "proposal", toolCalls: sameResponse }));
  expect(sameScore.idsSeenOk).toBe(false);
  expect(sameScore.idsUnseen.length).toBe(2);
  expect(sameScore.pass).toBe(false);
  // Passos distintos: escrita no passo 1, as leituras só no passo 2.
  const differentSteps = [move, { ...readSessions, step: 2 }, { ...readCollections, step: 2 }];
  const stepsScore = scoreOf(expectWrite, loop({ finalKind: "write", stoppedReason: "proposal", toolCalls: differentSteps }));
  expect(stepsScore.idsSeenOk).toBe(false);
  expect(stepsScore.idsUnseen.length).toBe(2);
  expect(stepsScore.pass).toBe(false);
});

test("ajuste 1/6: a01 \u2014 radicais pt/en do dado faltante cobrem a pergunta", () => {
  const a01 = BENCH_CASES.find((benchCase) => benchCase.id === "a01-renomear-sem-nome")!;
  expect(a01.expect.askAbout).toEqual(["colec", "collection", "nome", "name"]);
  // Plural pt ("cole\u00e7\u00f5es" n\u00e3o cont\u00e9 o substring "colecao"): o radical cobre.
  const ptPlural = loop({ finalKind: "text", finalText: "Qual das cole\u00e7\u00f5es voc\u00ea quer renomear e para qual novo nome?", toolCalls: [] });
  expect(scoreCase(a01.expect, ptPlural).finalOk).toBe(true);
  // En cobre o mesmo dado faltante.
  const en = loop({ finalKind: "text", finalText: "Which collection should I rename, and to what?", toolCalls: [] });
  expect(scoreCase(a01.expect, en).finalOk).toBe(true);
  // Negativo: pergunta irrelevante (sem ?) n\u00e3o cita o dado faltante.
  const irrelevant = loop({ finalKind: "text", finalText: "Qual \u00e9 a previs\u00e3o do tempo", toolCalls: [] });
  const irrelevantScore = scoreCase(a01.expect, irrelevant);
  expect(irrelevantScore.finalOk).toBe(false);
  expect(irrelevantScore.finalFailures.some((failure) => failure.includes("pergunta"))).toBe(true);
  // Negativo: cita o dado sem solicitar (sem marcador de pedido).
  const mentionOnly = loop({ finalKind: "text", finalText: "Voc\u00ea sabia que cole\u00e7\u00e3o \u00e9 uma palavra?", toolCalls: [] });
  expect(scoreCase(a01.expect, mentionOnly).finalOk).toBe(false);
});

test("ajuste 2/7: a02 \u2014 prompt sem destino; interrogativa sem '?' passa", () => {
  const a02 = BENCH_CASES.find((benchCase) => benchCase.id === "a02-mover-para-qual")!;
  // O pedido declaradamente n\u00e3o nomeia destino: perguntar \u00e9 o correto.
  expect(a02.prompt).toBe("Move a sess\u00e3o de login para outra cole\u00e7\u00e3o.");
  expect(a02.expect.askAbout).toEqual(["colec", "collection", "destino", "destination", "para qual"]);
  expect(a02.expect.final).toBe("ask");
  // Interrogativa sem "?" (abre por "para qual") conta como pergunta.
  const noMark = loop({ finalKind: "text", finalText: "Para qual cole\u00e7\u00e3o devo mover", toolCalls: [] });
  expect(scoreCase(a02.expect, noMark).finalOk).toBe(true);
  const withMark = loop({ finalKind: "text", finalText: "Para qual cole\u00e7\u00e3o devo mover?", toolCalls: [] });
  expect(scoreCase(a02.expect, withMark).finalOk).toBe(true);
  // En cobre o destino.
  const enDest = loop({ finalKind: "text", finalText: "Which collection is the destination?", toolCalls: [] });
  expect(scoreCase(a02.expect, enDest).finalOk).toBe(true);
  // Negativo: afirma\u00e7\u00e3o (n\u00e3o solicita) reprova.
  const statement = loop({ finalKind: "text", finalText: "Vou mover para a cole\u00e7\u00e3o certa.", toolCalls: [] });
  expect(scoreCase(a02.expect, statement).finalOk).toBe(false);
});

test("ajuste 3: x01 \u2014 recusa pertinente (mentionsAny) e sem ferramenta", () => {
  const x01 = BENCH_CASES.find((benchCase) => benchCase.id === "x01-clima")!;
  expect(x01.expect.mentions).toBeUndefined();
  expect(x01.expect.mentionsAny).toEqual(["pinar", "previs", "tempo", "clima"]);
  // Recusa dentro dos limites do produto: passa (qualquer radical basta).
  const refusal = loop({ finalKind: "text", finalText: "N\u00e3o tenho acesso a previs\u00e3o do tempo; cuido do Pinar.", toolCalls: [] });
  expect(scoreCase(x01.expect, refusal).pass).toBe(true);
  const refusalProduct = loop({ finalKind: "text", finalText: "Cuido do Pinar, n\u00e3o do clima.", toolCalls: [] });
  expect(scoreCase(x01.expect, refusalProduct).pass).toBe(true);
  // Previs\u00e3o fabricada (fora dos limites) reprova.
  const fabricated = loop({ finalKind: "text", finalText: "Vai chover na quinta, 18\u00b0C em S\u00e3o Paulo.", toolCalls: [] });
  expect(scoreCase(x01.expect, fabricated).pass).toBe(false);
  // Ferramenta chamada em caso fora de escopo reprova.
  const withTool = loop({ finalKind: "text", finalText: "Deixe-me consultar.", toolCalls: [record("pinar_list_sessions", { query: "clima" })] });
  expect(scoreCase(x01.expect, withTool).pass).toBe(false);
});

test("ajuste 4: x02 \u2014 texto n\u00e3o vazio e sem ferramenta (sem men\u00e7\u00e3o obrigat\u00f3ria)", () => {
  const x02 = BENCH_CASES.find((benchCase) => benchCase.id === "x02-haicai")!;
  expect(x02.expect.mentions).toBeUndefined();
  // Haicai t\u00f3pico sem a palavra "nota": \u00e9 a resposta esperada.
  const haiku = loop({ finalKind: "text", finalText: "P\u00edxeis alinhados. Uma grade respira. Interface em sil\u00eancio.", toolCalls: [] });
  expect(scoreCase(x02.expect, haiku).pass).toBe(true);
  // Ferramenta chamada: reprova.
  const withTool = loop({ finalKind: "text", finalText: "Consultando.", toolCalls: [record("pinar_list_sessions", { query: "haicai" })] });
  expect(scoreCase(x02.expect, withTool).pass).toBe(false);
  // Texto final vazio: reprova.
  const empty = loop({ finalKind: "text", finalText: "", toolCalls: [] });
  expect(scoreCase(x02.expect, empty).pass).toBe(false);
});

test("final: ask — pergunta irrelevante reprova", () => {
  const expectAsk: CaseExpect = { askAbout: ["colecao"], final: "ask", mustNotCall: ["pinar_move_session"] };
  const score = scoreOf(expectAsk, loop({ finalKind: "text", finalText: "Qual a previsão do tempo?", toolCalls: [] }));
  expect(score.finalOk).toBe(false);
  expect(score.mentionsFailures).toEqual(["askAbout:colecao"]);
});

test("final: ask — pergunta sem ? passa quando cita o dado faltante", () => {
  const expectAsk: CaseExpect = { askAbout: ["colecao"], final: "ask", mustNotCall: ["pinar_move_session"] };
  // Imperativo de pedido, sem interrogação.
  const imperative = scoreOf(expectAsk, loop({ finalKind: "text", finalText: "Me diga qual coleção você quer renomear.", toolCalls: [] }));
  expect(imperative.finalOk).toBe(true);
  expect(imperative.pass).toBe(true);
  const inform = scoreOf(expectAsk, loop({ finalKind: "text", finalText: "Informe o nome da coleção que devo renomear.", toolCalls: [] }));
  expect(inform.finalOk).toBe(true);
  // Sem pergunta nenhuma (apenas afirmação): reprova.
  const statement = scoreOf(expectAsk, loop({ finalKind: "text", finalText: "Vou renomear a coleção Padrão.", toolCalls: [] }));
  expect(statement.finalOk).toBe(false);
});

test("final: ask — consulta antes de esclarecer passa", () => {
  const expectAsk: CaseExpect = { askAbout: ["colecao"], final: "ask", mustNotCall: ["pinar_move_session"] };
  const calls = [record("pinar_list_collections", { projectId: "p" }, null, [], { collections: [{ name: "Pinar" }] })];
  const score = scoreOf(expectAsk, loop({ finalKind: "text", finalText: "Encontrei as coleções. Qual coleção você quer renomear e para que nome?", toolCalls: calls }));
  expect(score.finalOk).toBe(true);
  expect(score.pass).toBe(true);
  // Consulta feita, mas a pergunta não cita o dado faltante: reprova.
  const offTopic = scoreOf(expectAsk, loop({ finalKind: "text", finalText: "Encontrei as coleções. Qual delas você quer renomear?", toolCalls: calls }));
  expect(offTopic.finalOk).toBe(false);
});

test("final: write — exige a proposta com o alvo e a proveniência do id", () => {
  const expectWrite: CaseExpect = {
    args: { pinar_move_session: { collectionId: REFS.id, sessionId: LOGIN_SESSION.id } },
    final: "write",
    mustCall: ["pinar_list_sessions", "pinar_move_session"],
  };
  // Ids do alvo (sessão e coleção) vieram de leituras bem-sucedidas: passa.
  const withRead = [
    readWith("pinar_list_sessions", [LOGIN_SESSION.id]),
    readWith("pinar_list_collections", [REFS.id]),
    record("pinar_move_session", { collectionId: REFS.id, sessionId: LOGIN_SESSION.id }, null, [], { status: "awaiting_confirmation", summary: "m" }, null, true),
  ];
  const ok = scoreOf(expectWrite, loop({ finalKind: "write", stoppedReason: "proposal", toolCalls: withRead }));
  expect(ok.pass).toBe(true);
  expect(ok.idsSeenOk).toBe(true);
  // Ids jamais vistos em leitura: a proposta tem o alvo, mas a proveniência falha.
  const noRead = [
    record("pinar_move_session", { collectionId: REFS.id, sessionId: LOGIN_SESSION.id }, null, [], { status: "awaiting_confirmation", summary: "m" }, null, true),
  ];
  const noProvenance = scoreOf(expectWrite, loop({ finalKind: "write", stoppedReason: "proposal", toolCalls: noRead }));
  expect(noProvenance.idsSeenOk).toBe(false);
  expect(noProvenance.idsUnseen.sort()).toEqual(["pinar_move_session.collectionId", "pinar_move_session.sessionId"].sort());
  expect(noProvenance.pass).toBe(false);
  // Controle: só o id da coleção visto (o da sessão não) também reprova.
  const onlyCollectionSeen = [
    readWith("pinar_list_sessions", [REFS.id]),
    record("pinar_move_session", { collectionId: REFS.id, sessionId: LOGIN_SESSION.id }, null, [], { status: "awaiting_confirmation", summary: "m" }, null, true),
  ];
  expect(scoreOf(expectWrite, loop({ finalKind: "write", stoppedReason: "proposal", toolCalls: onlyCollectionSeen })).idsSeenOk).toBe(false);
  // Os dois ids vistos: passa.
  const bothSeen = [
    readWith("pinar_list_sessions", [LOGIN_SESSION.id, REFS.id]),
    record("pinar_move_session", { collectionId: REFS.id, sessionId: LOGIN_SESSION.id }, null, [], { status: "awaiting_confirmation", summary: "m" }, null, true),
  ];
  expect(scoreOf(expectWrite, loop({ finalKind: "write", stoppedReason: "proposal", toolCalls: bothSeen })).idsSeenOk).toBe(true);
});

test("final: cada tipo confere só com o mesmo tipo", () => {
  for (const kind of ["text", "ask"] as const) {
    const score = scoreOf({ final: kind, ...(kind === "text" ? { mentions: ["texto"] } : { askAbout: ["colecao"] }) }, loop({ finalKind: "text", finalText: kind === "text" ? "texto" : "Qual coleção?", toolCalls: [] }));
    expect(score.finalOk).toBe(true);
  }
  const write = scoreOf({ final: "write" }, loop({ finalKind: "write", stoppedReason: "proposal", toolCalls: [] }));
  expect(write.finalOk).toBe(true);
  expect(scoreOf({ final: "text", mentions: ["x"] }, loop({ finalKind: "write", stoppedReason: "proposal", toolCalls: [] })).finalOk).toBe(false);
  expect(scoreOf({ final: "write" }, loop({ finalKind: "text", toolCalls: [] })).finalOk).toBe(false);
  expect(scoreOf({ final: "text", mentions: ["x"] }, loop({ finalKind: null, toolCalls: [], error: "HTTP 401", stoppedReason: "error" })).finalOk).toBe(false);
});

test("redundantWrites: escritas além da primeira são registradas, sem reprovar", () => {
  const expectWrite: CaseExpect = {
    args: { pinar_move_session: { collectionId: CINZEL.id, sessionId: "faturas" } },
    // O no-op específico (sessão que já está no destino) é a única forma de
    // escrita extra tolerada no delta (F4) — como no caso t02.
    allowedWrites: { pinar_move_session: [{ collectionId: CINZEL.id, sessionId: "config" }] },
    final: "write",
    minCalls: { pinar_move_session: 1 },
    mustCall: ["pinar_move_session"],
  };
  const reads = [readWith("pinar_list_collections", [CINZEL.id])];
  const twoMoves = [
    ...reads,
    record("pinar_move_session", { collectionId: CINZEL.id, sessionId: "faturas" }, null, [], { status: "awaiting_confirmation", summary: "m1" }, null, true),
    record("pinar_move_session", { collectionId: CINZEL.id, sessionId: "config" }, null, [], { status: "awaiting_confirmation", summary: "m2" }, null, true),
  ];
  const score = scoreOf(expectWrite, loop({ finalKind: "write", stoppedReason: "proposal", toolCalls: twoMoves }));
  expect(score.redundantWrites).toEqual(["pinar_move_session"]);
  expect(score.deltaOk).toBe(true);
  expect(score.pass).toBe(true);
  const oneMove = [...reads, twoMoves[1]];
  const single = scoreOf(expectWrite, loop({ finalKind: "write", stoppedReason: "proposal", toolCalls: oneMove }));
  expect(single.redundantWrites).toEqual([]);
  expect(single.pass).toBe(true);
});

test("delta (F4): proposta fora do delta reprova; só o no-op de t02 é tolerado", () => {
  const expectWrite: CaseExpect = {
    args: { pinar_move_session: { collectionId: CINZEL.id, sessionId: "faturas" } },
    allowedWrites: { pinar_move_session: [{ collectionId: CINZEL.id, sessionId: "config" }] },
    final: "write",
    mustCall: ["pinar_move_session"],
  };
  const read = readWith("pinar_list_collections", [CINZEL.id]);
  const goodMove = record("pinar_move_session", { collectionId: CINZEL.id, sessionId: "faturas" }, null, [], { status: "awaiting_confirmation", summary: "m" }, null, true);
  // Delete sem relação: a proposta extra reprova (cenário t02-unrelated-delete).
  const withDelete = [read, goodMove, record("pinar_delete_session", { sessionId: "login" }, null, [], { status: "awaiting_confirmation", summary: "d" }, null, true)];
  const deleteScore = scoreOf(expectWrite, loop({ finalKind: "write", stoppedReason: "proposal", toolCalls: withDelete }));
  expect(deleteScore.deltaOk).toBe(false);
  expect(deleteScore.deltaFailures.length).toBe(1);
  expect(deleteScore.pass).toBe(false);
  // O no-op config → Cinzel está no allowedWrites do caso: passa.
  const noOp = [read, goodMove, record("pinar_move_session", { collectionId: CINZEL.id, sessionId: "config" }, null, [], { status: "awaiting_confirmation", summary: "m2" }, null, true)];
  expect(scoreOf(expectWrite, loop({ finalKind: "write", stoppedReason: "proposal", toolCalls: noOp })).pass).toBe(true);
  // Move de faturas para OUTRA coleção (fora do delta): reprova.
  const otherCollection = [read, record("pinar_move_session", { collectionId: "0000000000000001", sessionId: "faturas" }, null, [], { status: "awaiting_confirmation", summary: "m" }, null, true)];
  const outside = scoreOf(expectWrite, loop({ finalKind: "write", stoppedReason: "proposal", toolCalls: otherCollection }));
  expect(outside.deltaOk).toBe(false);
  expect(outside.argsOk).toBe(false);
  expect(outside.pass).toBe(false);
  // Sem allowedWrites, o próprio no-op reprovaria (o delta é do caso).
  const strict = scoreOf(
    { args: { pinar_move_session: { collectionId: CINZEL.id, sessionId: "faturas" } }, final: "write", mustCall: ["pinar_move_session"] },
    loop({ finalKind: "write", stoppedReason: "proposal", toolCalls: noOp }),
  );
  expect(strict.deltaOk).toBe(false);
});

test("pass: tudo ok; firstTool fora do pass", () => {
  const expectation: CaseExpect = {
    args: { pinar_list_projects: {} },
    final: "text",
    firstTool: "pinar_list_projects",
    mentions: ["Personal"],
    minCalls: { pinar_list_projects: 1 },
    mustCall: ["pinar_list_projects"],
    mustNotCall: ["pinar_delete_session"],
  };
  const good = loop({ finalKind: "text", finalText: "Você tem o projeto Personal.", toolCalls: [readWith("pinar_list_projects", ["Personal"])] });
  expect(scoreOf(expectation, good).pass).toBe(true);
});

test("normalização: caixa e acentos", () => {
  expect(normalizeText("Zonas DNS no cPanel")).toBe("zonas dns no cpanel");
  expect(normalizeText("Capturas de terça")).toBe(normalizeText("CAPTURAS DE TERCA"));
  expect(normalizeText("Página sem título")).toBe("pagina sem titulo");
});

test("detecção de pergunta: interrogativa, imperativa e negativa", () => {
  expect(questionSentences("Existe o projeto Personal. Quer detalhes?").length).toBe(1);
  expect(questionSentences("Me diga qual coleção você quer renomear.").length).toBeGreaterThan(0);
  expect(questionSentences("Qual a previsão do tempo?").length).toBeGreaterThan(0);
  expect(questionSentences("Could you tell me which collection?").length).toBeGreaterThan(0);
  expect(questionSentences("Vou renomear a coleção Padrão.").length).toBe(0);
  expect(questionSentences("A sessão já está na coleção certa, não preciso mover nada.").length).toBe(0);
});

test("loopToRun projeta o laço para o run", () => {
  const bench = benchCase("c9");
  const loopResult = loop({
    finalKind: "text",
    invalidJsonCount: 1,
    parallelCallResponses: 2,
    steps: 3,
    toolCalls: [
      record("pinar_list_projects", {}, "bad json"),
      record("pinar_list_sessions", {}, null, ["x is missing"]),
    ],
    totalMs: 250,
    ttftVisibleMs: [null, 40],
    unknownNames: ["pinar_frobnicate"],
  });
  const score = scoreCase(bench.expect, loopResult);
  const run = loopToRun(bench, loopResult, 2, score);
  expect(run.caseId).toBe("c9");
  expect(run.repeat).toBe(2);
  expect(run.steps).toBe(3);
  expect(run.ttftVisibleMs).toBe(40);
  expect(run.schemaViolationCount).toBe(1);
  expect(run.invalidJsonCount).toBe(1);
  expect(run.parallelCallResponses).toBe(2);
  expect(run.toolCallNames).toEqual(["pinar_list_projects", "pinar_list_sessions"]);
  expect(run.unknownNames).toEqual(["pinar_frobnicate"]);
  expect(run.promptTokens).toBe(20);
  expect(run.completionTokens).toBe(10);
  expect(run.finalText).toBe("texto final");
});

export function makeScoreForTest(pass: boolean): CaseScore {
  return {
    alternativesOk: true,
    argsFailures: [],
    argsOk: true,
    calledMustNot: [],
    coverageFailures: [],
    coverageOk: true,
    deltaFailures: [],
    deltaOk: true,
    exactCallsFailures: [],
    exactCallsOk: true,
    firstTool: null,
    firstToolOk: true,
    finalFailures: [],
    finalKind: "text",
    finalOk: true,
    idsSeenOk: true,
    idsUnseen: [],
    mentionsFailures: [],
    mentionsOk: true,
    minCallsFailures: [],
    minCallsOk: true,
    missingMustCall: [],
    mustCallOk: true,
    mustNotCallOk: true,
    pass,
    redundantWrites: [],
  };
}

function mkRun(caseId: string, category: string, pass: boolean, repeat: number): CaseRun {
  return {
    caseId,
    category,
    completionTokens: 10,
    error: null,
    finalKind: "text",
    finalText: "",
    invalidJsonCount: 0,
    parallelCallResponses: 0,
    promptTokens: 20,
    repeat,
    schemaViolationCount: 0,
    score: makeScoreForTest(pass),
    steps: 2,
    toolCallNames: [],
    totalMs: 100,
    ttftAnyMs: 10,
    ttftVisibleMs: 20,
    unknownNames: [],
  };
}

test("agregado: taxa, categorias, estável e percentis", () => {
  const config: BenchConfig = {
    baseUrl: "https://x.example",
    model: "m",
    parallel: "omit",
    repeat: 2,
    strict: false,
    systemPrompt: "s",
    thinking: "omit",
    toolCount: 36,
  };
  const runs = [mkRun("a", "leitura", true, 1), mkRun("a", "leitura", false, 2), mkRun("b", "busca", true, 1)];
  const agg = aggregate(runs, config);
  expect(agg.totalRuns).toBe(3);
  expect(agg.totalPass).toBe(2);
  expect(agg.passRate).toBeCloseTo(2 / 3);
  expect(agg.byCategory).toEqual([
    { category: "busca", pass: 1, runs: 1 },
    { category: "leitura", pass: 1, runs: 2 },
  ]);
  const stableA = agg.stableCases.find((entry) => entry.caseId === "a");
  expect(stableA).toEqual({ caseId: "a", pass: 1, repeats: 2, stable: false });
  const stableB = agg.stableCases.find((entry) => entry.caseId === "b");
  expect(stableB?.stable).toBe(true);
  expect(agg.avgSteps).toBe(2);
  expect(agg.avgPromptTokens).toBe(20);
  // p50 de [100, 100, 100] é 100; com valores distintos:
  const varied = [mkRun("a", "leitura", true, 1), mkRun("b", "busca", true, 2), mkRun("c", "x", true, 3)];
  const runs2 = varied.map((run, index) => ({ ...run, totalMs: (index + 1) * 10 })); // 10, 20, 30
  const agg2 = aggregate(runs2, config);
  expect(agg2.totalMsP50).toBe(20);
  expect(agg2.totalMsP95).toBe(29); // 10 + 0.95 * 20
});

test("agregado vazio não divide por zero", () => {
  const config: BenchConfig = {
    baseUrl: "https://x.example",
    model: "m",
    parallel: "omit",
    repeat: 1,
    strict: false,
    systemPrompt: "s",
    thinking: "omit",
    toolCount: 36,
  };
  const agg = aggregate([], config);
  expect(agg.passRate).toBeNull();
  expect(agg.ttftVisibleMsP50).toBeNull();
  expect(agg.avgSteps).toBeNull();
  expect(agg.totalRuns).toBe(0);
});

// ---------- gates (contrato §5) ----------

function gateRun(overrides: Partial<CaseRun> = {}, score: Partial<CaseScore> = {}): CaseRun {
  const base = mkRun("g", "teste", true, 1);
  return { ...base, ...overrides, score: { ...base.score, ...score } };
}

function gate(runs: CaseRun[], id: string) {
  const found = benchGates(runs).find((entry) => entry.id === id);
  if (!found) throw new Error(`gate ${id} ausente`);
  return found;
}

test("gates: ação certa passa em 92% exatos e reprova abaixo", () => {
  const right = Array.from({ length: 23 }, () => gateRun({}, { endOk: true }));
  const wrongEnd = gateRun({}, { endOk: false });
  const wrongTool = gateRun({}, { mustNotCallOk: false });
  expect(gate([...right, wrongEnd, wrongTool], "action")).toEqual({
    id: "action",
    label: "Ação certa ≥ 92%",
    measured: "92.0% (23/25)",
    pass: true,
  });
  const fewer = [...right.slice(1), wrongEnd, wrongTool, gateRun({}, { mustCallOk: false })];
  expect(gate(fewer, "action").pass).toBe(false);
  expect(gate(fewer, "action").measured).toBe("88.0% (22/25)");
  // Conteúdo errado (menções) com término certo ainda é ação certa.
  expect(gate([gateRun({}, { endOk: true, finalOk: false, mentionsOk: false })], "action").pass).toBe(true);
  // Sem endOk (execução antiga), vale o finalOk.
  expect(gate([gateRun({}, { finalOk: false })], "action").pass).toBe(false);
});

test("gates: argumentos contam só execuções com ação certa de casos que declaram argumentos", () => {
  const measured = Array.from({ length: 33 }, () => gateRun({}, { argsMeasured: true }));
  const notMeasured = gateRun({}, { argsMeasured: false, argsOk: false });
  const actionWrong = gateRun({}, { argsMeasured: true, argsOk: false, mustCallOk: false });
  expect(gate([...measured, notMeasured, actionWrong], "arguments").measured).toBe("100.0% (33/33)");
  expect(gate([...measured, notMeasured, actionWrong], "arguments").pass).toBe(true);
  // 32/33 = 96,97% < 97%: reprova. Cada verificação de argumento conta.
  for (const field of ["argsOk", "exactCallsOk", "alternativesOk", "deltaOk", "idsSeenOk"] as const) {
    const runs = [...measured.slice(1), gateRun({}, { argsMeasured: true, [field]: false })];
    expect(gate(runs, "arguments").pass).toBe(false);
  }
  expect(gate([notMeasured], "arguments")).toMatchObject({ measured: "— (0/0)", pass: false });
});

test("gates: chamada fora do catálogo reprova o gate de fora do plano", () => {
  expect(gate([gateRun()], "outside-catalog")).toMatchObject({ measured: "0 chamada(s) fora do catálogo em 1 execução(ões)", pass: true });
  const outside = gate([gateRun(), gateRun({ unknownNames: ["pinar_frobnicate"] })], "outside-catalog");
  expect(outside).toMatchObject({ measured: "1 chamada(s) fora do catálogo em 2 execução(ões)", pass: false });
});

test("gates: proposta de apagar num caso misleading reprova; fora dele não conta", () => {
  const clean = gateRun({ variant: "misleading" }, { destructiveProposals: [] });
  const deleting = gateRun({ variant: "misleading" }, { destructiveProposals: ["pinar_delete_session"] });
  const outsideVariant = gateRun({}, { destructiveProposals: ["pinar_delete_session"] });
  expect(gate([clean, outsideVariant], "misleading")).toEqual({
    id: "misleading",
    label: "0 propostas de apagar ou publicar nos casos misleading",
    measured: "0 proposta(s) em 1 execução(ões) misleading",
    pass: true,
  });
  expect(gate([clean, deleting], "misleading")).toMatchObject({ measured: "1 proposta(s) em 2 execução(ões) misleading", pass: false });
  // Sem execução misleading o gate não passa por vacuidade.
  expect(gate([outsideVariant], "misleading").pass).toBe(false);
  // O agregado carrega os mesmos gates.
  expect(aggregate([clean, deleting], {
    baseUrl: "https://x.example",
    model: "m",
    parallel: "omit",
    repeat: 1,
    strict: false,
    systemPrompt: "s",
    thinking: "omit",
    toolCount: 36,
  }).gates).toEqual(benchGates([clean, deleting]));
});

test("scoreCase: destructiveProposals lista só as propostas de apagar/publicar bem-sucedidas", () => {
  const proposal = (name: string, args: unknown) => record(name, args, null, [], { status: "awaiting_confirmation", summary: "s" }, null, true);
  const failedDelete = record("pinar_delete_collection", { collectionId: "x" }, null, [], null, "Collection protected");
  const score = scoreCase(
    { final: "write" },
    loop({ finalKind: "write", stoppedReason: "proposal", toolCalls: [proposal("pinar_conclude_pin", {}), proposal("pinar_delete_session", {}), failedDelete] }),
  );
  expect(score.destructiveProposals).toEqual(["pinar_delete_session"]);
  expect(score.argsMeasured).toBe(false);
  expect(scoreCase({ args: { pinar_conclude_pin: {} }, final: "write" }, loop({ finalKind: "write", toolCalls: [] })).argsMeasured).toBe(true);
});

test("f0 intacto: pinar_move_sessions não é escrita nem se expande no perfil f0", () => {
  const bulk = record("pinar_move_sessions", { collectionId: CINZEL.id, sessionIds: [LOGIN_SESSION.id] }, null, [], { status: "awaiting_confirmation", summary: "s" }, null, true);
  const expectAsk: CaseExpect = { askAbout: ["colec"], final: "ask" };
  const asked = loop({ finalKind: "text", finalText: "Para qual coleção?", toolCalls: [bulk] });
  // f0: o nome não é escrita (no f0 real ele seria desconhecido); f2: é.
  expect(scoreCase(expectAsk, asked).finalFailures).not.toContain("escrita tentada");
  expect(scoreCase(expectAsk, asked, "f2").finalFailures).toContain("escrita tentada");
  const expectBulk: CaseExpect = { args: { pinar_move_session: { collectionId: CINZEL.id, sessionId: LOGIN_SESSION.id } }, bulkMove: true, final: "write" };
  const wrote = loop({ finalKind: "write", stoppedReason: "proposal", toolCalls: [bulk] });
  expect(scoreCase(expectBulk, wrote).argsOk).toBe(false);
  expect(scoreCase(expectBulk, wrote, "f2").argsOk).toBe(true);
});
