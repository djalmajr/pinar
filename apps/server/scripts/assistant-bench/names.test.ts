import { expect, test } from "bun:test";
import { ASSISTANT_ASK_TOOL, ASSISTANT_MOVE_SESSIONS_TOOL } from "../../src/server/assistant/extra-tools";
import {
  benchTools,
  llmToolDefs,
  LLM_TOOL_NAME_PATTERN,
  mcpToolName,
  toolArgProblems,
  toolByLlmName,
  toolByMcpName,
  BENCH_TOOLS,
  validateArgs,
} from "./tools";
import type { ToolInputSchema } from "./types";

test("o catálogo tem as 36 ferramentas reais", () => {
  expect(BENCH_TOOLS.length).toBe(36);
});

test("todo nome mapeado passa no padrão da API de chat", () => {
  const names = new Set<string>();
  for (const tool of BENCH_TOOLS) {
    const mapped = llmToolDefs(false).map((definition) => definition.function.name);
    for (const name of mapped) {
      expect(LLM_TOOL_NAME_PATTERN.test(name)).toBe(true);
      names.add(name);
    }
    expect(tool.name.startsWith("pinar.")).toBe(true);
  }
  expect(names.size).toBe(36);
});

test("o mapeamento troca o ponto por underline e volta", () => {
  for (const tool of BENCH_TOOLS) {
    const llmName = tool.name.replace(".", "_");
    expect(mcpToolName(llmName)).toBe(tool.name);
    const back = toolByLlmName(llmName);
    expect(back?.name).toBe(tool.name);
  }
});

test("nomes fora do catálogo não resolvem", () => {
  expect(mcpToolName("pinar_")).toBe("pinar.");
  expect(toolByMcpName("pinar.")).toBeUndefined();
  expect(mcpToolName("other_tool")).toBeNull();
  expect(toolByLlmName("other_tool")).toBeUndefined();
  expect(toolByLlmName("pinar_frobnicate")).toBeUndefined();
});

test("strict adiciona strict:true às funções; sem strict o campo some", () => {
  const plain = llmToolDefs(false);
  expect(plain[0].type).toBe("function");
  expect(plain[0].function.strict).toBeUndefined();
  const strict = llmToolDefs(true);
  for (const definition of strict) {
    expect(definition.function.strict).toBe(true);
  }
  expect(strict[0].function.name).toBe("pinar_list_sessions");
  expect(strict[0].function.parameters).toBe(BENCH_TOOLS[0].inputSchema);
});

test("perfil f2: o catálogo soma move_sessions e ask com os schemas do runtime", () => {
  expect(benchTools("f0")).toBe(BENCH_TOOLS);
  expect(llmToolDefs(false, "f0")).toEqual(llmToolDefs(false));
  const f2 = llmToolDefs(true, "f2");
  expect(f2.length).toBe(38);
  expect(f2.slice(0, 36)).toEqual(llmToolDefs(true));
  const byName = new Map(f2.map((definition) => [definition.function.name, definition]));
  const move = byName.get("pinar_move_sessions");
  const ask = byName.get("pinar_ask");
  // O mesmo objeto de schema que buildAssistantToolSet manda ao modelo.
  expect(move?.function.parameters).toBe(ASSISTANT_MOVE_SESSIONS_TOOL.inputSchema as unknown as ToolInputSchema);
  expect(ask?.function.parameters).toBe(ASSISTANT_ASK_TOOL.inputSchema as unknown as ToolInputSchema);
  expect(move?.function.description).toBe(ASSISTANT_MOVE_SESSIONS_TOOL.description);
  expect(move?.function.strict).toBe(true);
  for (const definition of f2) expect(LLM_TOOL_NAME_PATTERN.test(definition.function.name)).toBe(true);
  // f0 não resolve as extras; f2 resolve.
  expect(toolByLlmName("pinar_move_sessions")).toBeUndefined();
  expect(toolByLlmName("pinar_ask")).toBeUndefined();
  expect(toolByLlmName("pinar_move_sessions", "f2")?.name).toBe("pinar.move_sessions");
  expect(toolByLlmName("pinar_ask", "f2")?.name).toBe("pinar.ask");
});

test("perfil f2: as extras validam com assistantExtraToolProblems (repetição e texto vazio)", () => {
  const move = toolByLlmName("pinar_move_sessions", "f2")!;
  const ask = toolByLlmName("pinar_ask", "f2")!;
  expect(toolArgProblems(move, { collectionId: "c", sessionIds: ["a", "b"] })).toEqual([]);
  expect(toolArgProblems(move, { collectionId: "c", sessionIds: ["a", "a"] })).toEqual(["sessionIds has repeated items"]);
  expect(toolArgProblems(move, { collectionId: "c", sessionIds: [] }).length).toBeGreaterThan(0);
  expect(toolArgProblems(ask, { options: ["A", "B"], question: "Qual?" })).toEqual([]);
  expect(toolArgProblems(ask, { options: ["A", "B"], question: "" })).toEqual(["question is empty"]);
  expect(toolArgProblems(ask, { options: ["A"], question: "Qual?" }).length).toBeGreaterThan(0);
  // As ferramentas do MCP seguem no validateArgs.
  const list = toolByLlmName("pinar_list_sessions")!;
  expect(toolArgProblems(list, { limit: 51 })).toEqual(validateArgs(list.inputSchema, { limit: 51 }));
});
