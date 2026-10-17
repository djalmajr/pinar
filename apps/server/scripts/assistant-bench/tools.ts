// Bench-local view over the real Pinar MCP catalog.
//
// The 36 tool definitions come straight from LOCAL_MCP_TOOLS; their names
// keep the dots, while the OpenAI/Anthropic-compatible chat API only accepts
// names matching ^[a-zA-Z0-9_-]{1,64}$. This file holds the bench-local dot
// -> underscore mapping (a later slice ships the official mapping; keep this
// isolated so it can be swapped then) and the inputSchema validator the
// agent loop uses to flag invalid arguments.

import { LOCAL_MCP_TOOLS } from "../../src/server/local-mcp";
import { validateArgs } from "../../src/server/assistant/validate";
import type { BenchToolDef, LlmToolDef, ToolInputSchema } from "./types";

export { validateArgs };

export const LLM_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The real definitions type their schema as a loose JSON object; these are
// JSON Schema objects, so the bench's ToolInputSchema view is safe at this
// boundary (the validator only reads the declared keys).
export const BENCH_TOOLS: BenchToolDef[] = LOCAL_MCP_TOOLS.map((tool) => ({
  description: tool.description,
  inputSchema: tool.inputSchema as unknown as ToolInputSchema,
  name: tool.name,
}));

// MCP name -> LLM name: the single dot becomes an underscore.
export function llmToolName(mcpName: string): string {
  return mcpName.replace(".", "_");
}

// LLM name -> MCP name: the first underscore is the dot.
// Returns null for names the catalog does not own.
export function mcpToolName(llmName: string): string | null {
  if (!llmName.startsWith("pinar_")) return null;
  return llmName.replace("_", ".");
}

export function toolByMcpName(mcpName: string): BenchToolDef | undefined {
  return BENCH_TOOLS.find((tool) => tool.name === mcpName);
}

export function toolByLlmName(llmName: string): BenchToolDef | undefined {
  const mcpName = mcpToolName(llmName);
  return mcpName ? toolByMcpName(mcpName) : undefined;
}

// The tool list as sent to the chat API. strict:true is only added when the
// bench runs with --strict on; otherwise the field is omitted, not falsed.
export function llmToolDefs(strict: boolean): LlmToolDef[] {
  return BENCH_TOOLS.map((tool) => ({
    function: {
      description: tool.description,
      name: llmToolName(tool.name),
      parameters: tool.inputSchema,
      ...(strict ? { strict: true } : {}),
    },
    type: "function",
  }));
}
