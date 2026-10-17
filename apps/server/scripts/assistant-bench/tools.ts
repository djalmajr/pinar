// Bench-local view over the real Pinar MCP catalog.
//
// The 36 tool definitions come straight from LOCAL_MCP_TOOLS; their names
// keep the dots, while the OpenAI/Anthropic-compatible chat API only accepts
// names matching ^[a-zA-Z0-9_-]{1,64}$. This file holds the bench-local dot
// -> underscore mapping (a later slice ships the official mapping; keep this
// isolated so it can be swapped then) and the inputSchema validator the
// agent loop uses to flag invalid arguments.

import { LOCAL_MCP_TOOLS } from "../../src/server/local-mcp";
import type { BenchToolDef, LlmToolDef, ToolInputSchema } from "./types";

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

// ---------- inputSchema validation ----------

function typeMatches(type: string, value: unknown): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    case "object":
      return isRecord(value);
    case "array":
      return Array.isArray(value);
    default:
      return false;
  }
}

function schemaTypes(schema: ToolInputSchema): string[] {
  const type = schema.type;
  if (type === undefined) return [];
  return Array.isArray(type) ? type : [type];
}

// Validates a value against one schema node; pushes human-readable problems.
function validateNode(schema: ToolInputSchema, value: unknown, path: string, problems: string[]): void {
  if (schema.anyOf && schema.anyOf.length > 0) {
    const matchesAny = schema.anyOf.some((branch) => {
      const branchProblems: string[] = [];
      validateNode(branch, value, path, branchProblems);
      return branchProblems.length === 0;
    });
    if (!matchesAny) problems.push(`${path} does not match any allowed variant`);
    return;
  }
  const types = schemaTypes(schema);
  if (types.length > 0 && !types.some((type) => typeMatches(type, value))) {
    problems.push(`${path} has invalid type (expected ${types.join(" | ")})`);
    return;
  }
  if (typeof value === "string" && schema.maxLength !== undefined && value.length > schema.maxLength) {
    problems.push(`${path} exceeds maxLength ${schema.maxLength}`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) problems.push(`${path} is below minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) problems.push(`${path} is above maximum ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) problems.push(`${path} has fewer than ${schema.minItems} item(s)`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) problems.push(`${path} has more than ${schema.maxItems} item(s)`);
    if (schema.items) {
      value.forEach((item, index) => validateNode(schema.items as ToolInputSchema, item, `${path}[${index}]`, problems));
    }
    return;
  }
  if (isRecord(value) && schema.properties) {
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(value, required) || value[required] === undefined) {
        problems.push(`${path ? `${path}.` : ""}${required} is missing`);
      }
    }
    for (const [key, sub] of Object.entries(value)) {
      const child = schema.properties[key];
      const childPath = path ? `${path}.${key}` : key;
      if (!child) {
        problems.push(`${childPath} is not declared`);
        continue;
      }
      validateNode(child, sub, childPath, problems);
    }
  }
}

// Validates tool arguments against a tool inputSchema: required fields,
// types, minimum/maximum, maxLength, array item bounds and undeclared
// properties. An empty result means the arguments are acceptable.
export function validateArgs(schema: ToolInputSchema, args: unknown): string[] {
  if (!isRecord(args)) {
    return ["arguments must be a JSON object"];
  }
  const problems: string[] = [];
  validateNode(schema, args, "", problems);
  return problems;
}
