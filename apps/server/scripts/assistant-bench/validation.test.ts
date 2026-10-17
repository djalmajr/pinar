import { expect, test } from "bun:test";
import { toolByLlmName, validateArgs } from "./tools";

function problemsFor(tool: string, args: unknown): string[] {
  const definition = toolByLlmName(tool);
  if (!definition) throw new Error(`ferramenta desconhecida: ${tool}`);
  return validateArgs(definition.inputSchema, args);
}

test("argumentos ausentes ou não-objeto falham", () => {
  expect(problemsFor("pinar_list_projects", null).length).toBeGreaterThan(0);
  expect(problemsFor("pinar_list_projects", ["x"]).length).toBeGreaterThan(0);
  expect(problemsFor("pinar_list_projects", {}).length).toBe(0);
});

test("required ausente é reportado", () => {
  const problems = problemsFor("pinar_list_sessions", {});
  expect(problems.length).toBe(0); // list_sessions não tem required
  const missing = problemsFor("pinar_list_pins", { limit: 5 });
  expect(missing.some((problem) => problem.includes("sessionId is missing"))).toBe(true);
  const pageMissing = problemsFor("pinar_create_session", {});
  expect(pageMissing.some((problem) => problem.includes("page is missing"))).toBe(true);
});

test("tipos são validados, incluindo integer estrito", () => {
  expect(problemsFor("pinar_list_sessions", { limit: "5" }).length).toBeGreaterThan(0);
  expect(problemsFor("pinar_list_sessions", { limit: 2.5 }).length).toBeGreaterThan(0);
  expect(problemsFor("pinar_list_sessions", { limit: 5 }).length).toBe(0);
  const badType = problemsFor("pinar_list_pins", { sessionId: 42 });
  expect(badType.some((problem) => problem.includes("sessionId"))).toBe(true);
});

test("minimum/maximum de inteiro", () => {
  expect(problemsFor("pinar_list_sessions", { limit: 0 }).some((p) => p.includes("below minimum"))).toBe(true);
  expect(problemsFor("pinar_list_sessions", { limit: 51 }).some((p) => p.includes("above maximum"))).toBe(true);
  expect(problemsFor("pinar_list_sessions", { offset: -1 }).some((p) => p.includes("below minimum"))).toBe(true);
  expect(problemsFor("pinar_list_sessions", { offset: 10_001 }).some((p) => p.includes("above maximum"))).toBe(true);
});

test("maxLength é validado, inclusive em aninhados", () => {
  expect(problemsFor("pinar_list_sessions", { query: "x".repeat(257) }).length).toBeGreaterThan(0);
  expect(problemsFor("pinar_list_sessions", { query: "x".repeat(256) }).length).toBe(0);
  const page = problemsFor("pinar_create_session", {
    page: { title: "t".repeat(2001), url: "https://x.dev" },
  });
  expect(page.some((problem) => problem.includes("page.title"))).toBe(true);
});

test("propriedade não declarada é rejeitada", () => {
  const problems = problemsFor("pinar_list_sessions", { query: "a", inventado: true });
  expect(problems.some((problem) => problem.includes("inventado"))).toBe(true);
});

test("anyOf aceita string ou null", () => {
  expect(problemsFor("pinar_create_collection", { projectId: "p", name: "n", parentId: null }).length).toBe(0);
  expect(problemsFor("pinar_create_collection", { projectId: "p", name: "n", parentId: "abc" }).length).toBe(0);
  expect(problemsFor("pinar_create_collection", { projectId: "p", name: "n", parentId: 5 }).length).toBeGreaterThan(0);
});

test("união de tipos [object, null]", () => {
  expect(problemsFor("pinar_update_session", { sessionId: "s", reproduction: null }).length).toBe(0);
  expect(problemsFor("pinar_update_session", { sessionId: "s", reproduction: { steps: [] } }).length).toBe(0);
  expect(problemsFor("pinar_update_session", { sessionId: "s", reproduction: "x" }).length).toBeGreaterThan(0);
});

test("arrays: minItems, maxItems e itens", () => {
  expect(problemsFor("pinar_reorder_projects", { ids: [] }).length).toBeGreaterThan(0);
  const items = problemsFor("pinar_reorder_projects", { ids: ["a", 2] });
  expect(items.some((problem) => problem.includes("[1]"))).toBe(true);
  const long = problemsFor("pinar_reorder_projects", { ids: ["x".repeat(257)] });
  expect(long.length).toBeGreaterThan(0);
});

test("objetos em array exigem o required interno", () => {
  const problems = problemsFor("pinar_reorder_collections", {
    projectId: "p",
    items: [{ parentId: null }],
  });
  expect(problems.some((problem) => problem.includes("items[0].id is missing"))).toBe(true);
});

test("navegador de localizadores só aceita as chaves conhecidas", () => {
  expect(
    problemsFor("pinar_create_pin", { sessionId: "s", comment: "ok", locator: { cssSelector: "a" } }).length,
  ).toBe(0);
  expect(
    problemsFor("pinar_create_pin", { sessionId: "s", comment: "ok", locator: { bogus: 1 } }).length,
  ).toBeGreaterThan(0);
});
