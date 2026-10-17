import { expect, test } from "bun:test";
import { llmToolDefs, LLM_TOOL_NAME_PATTERN, mcpToolName, toolByLlmName, toolByMcpName, BENCH_TOOLS } from "./tools";

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
