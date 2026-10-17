import { expect, test } from "bun:test";
import { BENCH_CASES, validateCaseNames } from "./cases";
import { batchByLabel, collectionByName, FIXTURE, MALICIOUS_PIN_COMMENT, sessionByTitle } from "./fixtures";
import { llmToolDefs } from "./tools";

const KNOWN = new Set(llmToolDefs(false).map((definition) => definition.function.name));

test("entre 30 e 40 casos", () => {
  expect(BENCH_CASES.length).toBeGreaterThanOrEqual(30);
  expect(BENCH_CASES.length).toBeLessThanOrEqual(40);
});

test("pelo menos 5 casos em inglês", () => {
  const english = BENCH_CASES.filter((benchCase) => benchCase.language === "en");
  expect(english.length).toBeGreaterThanOrEqual(5);
});

test("ids únicos", () => {
  const ids = new Set(BENCH_CASES.map((benchCase) => benchCase.id));
  expect(ids.size).toBe(BENCH_CASES.length);
});

test("as categorias do brief estão cobertas", () => {
  const categories = new Set(BENCH_CASES.map((benchCase) => benchCase.category));
  for (const category of ["apagar", "ambiguo", "busca", "escrita", "fora-de-escopo", "ingles", "injecao", "leitura", "lote", "multi-step"]) {
    expect(categories.has(category)).toBe(true);
  }
});

test("toda referência de ferramenta aponta para o catálogo", () => {
  expect(validateCaseNames(BENCH_CASES, KNOWN)).toEqual([]);
});

test("o caso de injeção veta todos os delete_*", () => {
  for (const id of ["i01-resumo-da-maliciosa", "i02-injecao-em-ingles"]) {
    const benchCase = BENCH_CASES.find((caseEntry) => caseEntry.id === id);
    expect(benchCase).toBeDefined();
    for (const name of [
      "pinar_delete_batch",
      "pinar_delete_collection",
      "pinar_delete_pin",
      "pinar_delete_pin_comment",
      "pinar_delete_project",
      "pinar_delete_session",
    ]) {
      expect(benchCase?.expect.mustNotCall?.includes(name)).toBe(true);
    }
  }
});

test("a sessão maliciosa é a alvo dos casos de injeção", () => {
  const session = sessionByTitle("Tela de checkout da loja");
  expect(session).toBeDefined();
  expect(session?.pins.some((pin) => pin.comment === MALICIOUS_PIN_COMMENT)).toBe(true);
  for (const id of ["i01-resumo-da-maliciosa", "i02-injecao-em-ingles"]) {
    const benchCase = BENCH_CASES.find((caseEntry) => caseEntry.id === id);
    const alternatives = benchCase?.expect.alternatives ?? [];
    // Cada alternativa equivalente aponta para a sessão maliciosa.
    expect(alternatives.length).toBeGreaterThan(0);
    for (const alternative of alternatives) {
      const names = Object.keys(alternative.args ?? {});
      expect(names.length).toBe(1);
      expect(alternative.args?.[names[0]]?.["sessionId"]).toBe(session?.id);
    }
    expect(benchCase?.expect.mustCall).toContain("pinar_list_sessions");
  }
});

test("escritas esperadas têm final write", () => {
  const writes = BENCH_CASES.filter((benchCase) => benchCase.expect.final === "write");
  expect(writes.length).toBeGreaterThanOrEqual(10);
  for (const benchCase of writes) {
    expect(benchCase.expect.mustCall?.length ?? 0).toBeGreaterThan(0);
  }
});

test("final text define menções (ou recusa) e final ask define askAbout", () => {
  for (const benchCase of BENCH_CASES) {
    if (benchCase.expect.final === "text") {
      // Every text case constrains the final text: mandatory mentions or a
      // topical-refusal list (mentionsAny, out-of-scope cases). x02-haicai is
      // the deliberate text-only case (non-empty text + no tool call).
      const terms =
        (benchCase.expect.mentions ?? []).length > 0 || (benchCase.expect.mentionsAny ?? []).length > 0;
      expect(terms || benchCase.id === "x02-haicai").toBe(true);
    }
    if (benchCase.expect.final === "ask") {
      expect((benchCase.expect.askAbout ?? []).length > 0).toBe(true);
    }
  }
});

test("t01 cobre exatamente as quatro sessões do host cpanel.edger.dev", () => {
  const t01 = BENCH_CASES.find((caseEntry) => caseEntry.id === "t01-mover-host");
  expect(t01).toBeDefined();
  const entries = t01?.expect.exactCalls?.pinar_move_session ?? [];
  expect(entries.length).toBe(4);
  const hostSessions = FIXTURE.sessions.filter((session) => session.page.url.includes("cpanel.edger.dev"));
  expect(hostSessions.length).toBe(4);
  const refs = collectionByName("Referências")!;
  for (const entry of entries) {
    expect(entry.collectionId).toBe(refs.id);
    expect(hostSessions.some((session) => session.id === entry.sessionId)).toBe(true);
  }
  const expectedIds = new Set(hostSessions.map((session) => session.id));
  const gotIds = new Set(entries.map((entry) => entry.sessionId));
  expect(gotIds.size).toBe(4);
  for (const id of expectedIds) {
    expect(gotIds.has(id)).toBe(true);
  }
});

test("t02 exige só o movimento da sessão que ainda não está no destino", () => {
  const t02 = BENCH_CASES.find((caseEntry) => caseEntry.id === "t02-mover-lote");
  expect(t02).toBeDefined();
  const auditoria = batchByLabel("Auditoria de login")!;
  const inBatch = FIXTURE.sessions.filter((session) => session.batchId === auditoria.id);
  const cinzel = collectionByName("Cinzel")!;
  const pending = inBatch.filter((session) => session.collectionId !== cinzel.id);
  expect(pending.length).toBe(1);
  expect(pending[0].page.title).toBe("Faturas do Skedly");
  expect(t02?.expect.args?.pinar_move_session).toEqual({ collectionId: cinzel.id, sessionId: pending[0].id });
  expect(t02?.expect.minCalls?.pinar_move_session).toBe(1);
});
