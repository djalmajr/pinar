// Tools only the assistant has, in the McpToolDefinition shape but outside
// the MCP catalog (the MCP lists do not change). buildAssistantToolSet adds
// them under their LLM names, pinar_move_sessions, pinar_ask and
// pinar_pins_search. Behavior rules live in the system prompt, not in these
// descriptions.
//
// validateArgs covers types, maxLength, minimum/maximum, item bounds and
// undeclared properties; assistantExtraToolProblems adds the constraints it
// does not read (minLength, unique items and a query that is empty once
// trimmed).

import type { McpToolDefinition } from "../mcp-protocol";
import { ASSISTANT_BULK_MAX } from "./proposals";
import { validateArgs, type ToolInputSchema } from "./validate";

export const ASSISTANT_ASK_QUESTION_MAX = 300;
export const ASSISTANT_ASK_OPTIONS_MIN = 2;
export const ASSISTANT_ASK_OPTIONS_MAX = 5;
export const ASSISTANT_ASK_OPTION_MAX = 80;
export const ASSISTANT_PINS_SEARCH_QUERY_MAX = 500;
export const ASSISTANT_PINS_SEARCH_LIMIT_DEFAULT = 20;
// Same value as PIN_SEARCH_MAX_LIMIT (retrieval/index.ts), kept here because
// importing the retrieval modules would close an import cycle through
// turn.ts (vision.ts reads ASSISTANT_TURN_TIMEOUT_MS at load time).
export const ASSISTANT_PINS_SEARCH_LIMIT_MAX = 50;

// Kept as standalone constants so the JSON Schema keys McpToolDefinition
// does not declare (additionalProperties, minLength, uniqueItems) reach the
// model unchanged.
const moveSessionsSchema = {
  additionalProperties: false,
  properties: {
    collectionId: { type: "string" },
    sessionIds: { items: { type: "string" }, maxItems: ASSISTANT_BULK_MAX, minItems: 1, type: "array", uniqueItems: true },
  },
  required: ["collectionId", "sessionIds"],
  type: "object" as const,
};

const askSchema = {
  additionalProperties: false,
  properties: {
    options: {
      items: { maxLength: ASSISTANT_ASK_OPTION_MAX, minLength: 1, type: "string" },
      maxItems: ASSISTANT_ASK_OPTIONS_MAX,
      minItems: ASSISTANT_ASK_OPTIONS_MIN,
      type: "array",
    },
    question: { maxLength: ASSISTANT_ASK_QUESTION_MAX, minLength: 1, type: "string" },
  },
  required: ["question", "options"],
  type: "object" as const,
};

const pinsSearchSchema = {
  additionalProperties: false,
  properties: {
    limit: { maximum: ASSISTANT_PINS_SEARCH_LIMIT_MAX, minimum: 1, type: "integer" },
    query: { maxLength: ASSISTANT_PINS_SEARCH_QUERY_MAX, minLength: 1, type: "string" },
  },
  required: ["query"],
  type: "object" as const,
};

export const ASSISTANT_MOVE_SESSIONS_TOOL: McpToolDefinition = {
  description: "Move several sessions to one collection.",
  inputSchema: moveSessionsSchema,
  name: "pinar.move_sessions",
};

export const ASSISTANT_ASK_TOOL: McpToolDefinition = {
  description: "Ask the person one question with 2 to 5 clickable options.",
  inputSchema: askSchema,
  name: "pinar.ask",
};

export const ASSISTANT_PINS_SEARCH_TOOL: McpToolDefinition = {
  description: "Search pins by meaning: comments, page, element and screenshot content.",
  inputSchema: pinsSearchSchema,
  name: "pinar.pins_search",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Problems with the arguments of an extra tool; empty means acceptable. */
export function assistantExtraToolProblems(definition: McpToolDefinition, args: unknown): string[] {
  const problems = validateArgs(definition.inputSchema as unknown as ToolInputSchema, args);
  if (problems.length > 0 || !isRecord(args)) return problems;
  if (definition.name === ASSISTANT_MOVE_SESSIONS_TOOL.name) {
    const ids = args.sessionIds as string[];
    if (new Set(ids).size !== ids.length) problems.push("sessionIds has repeated items");
  }
  if (definition.name === ASSISTANT_ASK_TOOL.name) {
    if ((args.question as string).length === 0) problems.push("question is empty");
    (args.options as string[]).forEach((option, index) => {
      if (option.length === 0) problems.push(`options[${index}] is empty`);
    });
  }
  if (definition.name === ASSISTANT_PINS_SEARCH_TOOL.name) {
    if ((args.query as string).trim().length === 0) problems.push("query is empty");
  }
  return problems;
}

/** The question and options of a pinar.ask call, or null when its arguments are invalid. */
export function assistantAskFrom(args: unknown): { options: string[]; question: string } | null {
  if (assistantExtraToolProblems(ASSISTANT_ASK_TOOL, args).length > 0 || !isRecord(args)) return null;
  return { options: [...(args.options as string[])], question: args.question as string };
}
