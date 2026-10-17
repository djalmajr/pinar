// Bench-local view over the real Pinar MCP catalog.
//
// The 36 tool definitions come straight from LOCAL_MCP_TOOLS; their names
// keep the dots, while the OpenAI/Anthropic-compatible chat API only accepts
// names matching ^[a-zA-Z0-9_-]{1,64}$. This file holds the bench-local dot
// -> underscore mapping (a later slice ships the official mapping; keep this
// isolated so it can be swapped then) and the inputSchema validator the
// agent loop uses to flag invalid arguments.
//
// The f2 profile adds the assistant-only tools of extra-tools.ts
// (pinar.move_sessions, pinar.ask) with their own schema objects, and
// validates them with assistantExtraToolProblems, as the runtime does.

import { LOCAL_MCP_TOOLS } from "../../src/server/local-mcp";
import {
  ASSISTANT_ASK_TOOL,
  ASSISTANT_MOVE_SESSIONS_TOOL,
  assistantExtraToolProblems,
} from "../../src/server/assistant/extra-tools";
import type { McpToolDefinition } from "../../src/server/mcp-protocol";
import { validateArgs } from "../../src/server/assistant/validate";
import type { BenchProfile, BenchToolDef, LlmToolDef, ToolInputSchema } from "./types";

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

const EXTRA_DEFINITIONS: McpToolDefinition[] = [ASSISTANT_MOVE_SESSIONS_TOOL, ASSISTANT_ASK_TOOL];

// The two assistant-only tools, same schema objects as the runtime sends.
export const F2_EXTRA_TOOLS: BenchToolDef[] = EXTRA_DEFINITIONS.map((tool) => ({
  description: tool.description,
  inputSchema: tool.inputSchema as unknown as ToolInputSchema,
  name: tool.name,
}));

const F2_TOOLS: BenchToolDef[] = [...BENCH_TOOLS, ...F2_EXTRA_TOOLS];

// The catalog a profile offers to the model.
export function benchTools(profile: BenchProfile = "f0"): BenchToolDef[] {
  return profile === "f2" ? F2_TOOLS : BENCH_TOOLS;
}

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

export const ASK_TOOL_LLM_NAME = llmToolName(ASSISTANT_ASK_TOOL.name);
export const MOVE_SESSIONS_TOOL_LLM_NAME = llmToolName(ASSISTANT_MOVE_SESSIONS_TOOL.name);

export function toolByMcpName(mcpName: string, profile: BenchProfile = "f0"): BenchToolDef | undefined {
  return benchTools(profile).find((tool) => tool.name === mcpName);
}

export function toolByLlmName(llmName: string, profile: BenchProfile = "f0"): BenchToolDef | undefined {
  const mcpName = mcpToolName(llmName);
  return mcpName ? toolByMcpName(mcpName, profile) : undefined;
}

// Argument problems for a catalog tool: validateArgs for the MCP tools,
// assistantExtraToolProblems (adds minLength and unique items) for the
// assistant-only ones. Empty means acceptable.
export function toolArgProblems(tool: BenchToolDef, args: unknown): string[] {
  const extra = EXTRA_DEFINITIONS.find((definition) => definition.name === tool.name);
  return extra ? assistantExtraToolProblems(extra, args) : validateArgs(tool.inputSchema, args);
}

// The tool list as sent to the chat API. strict:true is only added when the
// bench runs with --strict on; otherwise the field is omitted, not falsed.
export function llmToolDefs(strict: boolean, profile: BenchProfile = "f0"): LlmToolDef[] {
  return benchTools(profile).map((tool) => ({
    function: {
      description: tool.description,
      name: llmToolName(tool.name),
      parameters: tool.inputSchema,
      ...(strict ? { strict: true } : {}),
    },
    type: "function",
  }));
}
