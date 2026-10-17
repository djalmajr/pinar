// MCP -> AI SDK tool adapter for the assistant.
//
// buildAssistantToolSet turns the policy-approved MCP tools of a surface
// (assistantToolsFor) into AI SDK tools keyed by their LLM name
// (pinar_list_sessions, ...). Every execute first validates the arguments
// with validateArgs (invalid arguments never reach the host or the
// proposal sink), then:
// - a read calls the host with the original MCP name (pinar.list_sessions);
// - a write never calls the host: it hands the MCP name and the arguments
//   to the proposal sink, which stores and emits the proposal, and the
//   model only gets { status: "awaiting_confirmation", summary }.
// The assistant-only tools (extra-tools.ts) follow the policy order:
// pinar_move_sessions joins whenever writes are offered, on both surfaces,
// and pinar_ask whenever there is an emit to send its data-ask part.
// pinar_pins_search is a read: it joins when reads are offered and the
// runtime passed a pin search service, and its hits reach the model in the
// same capped, escaped <dados> block as the MCP reads. The search gets the
// turn's abort signal.

import { jsonSchema, tool, type ToolSet } from "ai";
import { McpToolError, type McpToolDefinition } from "../mcp-protocol";
import {
  ASSISTANT_ASK_TOOL,
  ASSISTANT_MOVE_SESSIONS_TOOL,
  ASSISTANT_PINS_SEARCH_LIMIT_DEFAULT,
  ASSISTANT_PINS_SEARCH_TOOL,
  assistantAskFrom,
  assistantExtraToolProblems,
} from "./extra-tools";
import type { PinSearchHit, PinSearchService } from "./retrieval/index";
import { assistantToolsFor, toLlmToolName, type AssistantSurface, type AssistantToolKind } from "./tool-policy";
import type { AssistantStreamEmit } from "./turn";
import { validateArgs, type ToolInputSchema } from "./validate";

export interface AssistantToolHost {
  callTool(mcpName: string, args: Record<string, unknown>): Promise<unknown>;
}

export interface AssistantProposalSink {
  /** Validated args in; the proposal is stored and emitted by the sink. */
  propose(tool: string, args: Record<string, unknown>): Promise<
    | { status: "awaiting_confirmation"; summary: string }
    | { problems: string[]; status: "invalid_arguments" }
    | { message: string; status: "error" }
  >;
}

// Characters of data per tool result, measured on the escaped content
// between <dados> and </dados>.
export const ASSISTANT_TOOL_DATA_MAX = 20_000;

// Generic error message for tool failures. The original error (which may
// carry provider secrets or internals) never reaches the model.
const TOOL_FAILED_MESSAGE = "Tool failed";

// Escapes the data the model sees so third-party content cannot inject
// markup: & first, then < and >. The characters are escaped one by one
// into a budget: the content stops before it would cross `max`, so the
// escaped content never exceeds the cap and never ends in a torn entity
// (&amp;, &lt;, &gt;). `truncated` is true only when something of the
// original was left out.
function escapeCapped(text: string, max: number): { data: string; truncated: boolean } {
  let data = "";
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const entity = character === "&" ? "&amp;" : character === "<" ? "&lt;" : character === ">" ? "&gt;" : character;
    if (data.length + entity.length > max) return { data, truncated: true };
    data += entity;
  }
  return { data, truncated: false };
}

function toolSchema(def: { inputSchema: McpToolDefinition["inputSchema"] }): ToolInputSchema {
  // The MCP definitions type the schema as a loose JSON object; these are
  // JSON Schema objects, so the ToolInputSchema view is safe at this
  // boundary (the validator only reads the declared keys).
  return def.inputSchema as unknown as ToolInputSchema;
}

// The data block of a read result: the text escaped and capped.
function dataResult(text: string) {
  const { data, truncated } = escapeCapped(text, ASSISTANT_TOOL_DATA_MAX);
  return { data: `<dados>${data}</dados>`, status: "ok" as const, truncated };
}

// One pinar_pins_search hit as the model sees it (contract §3.1): the pin
// number as `pin`, the session title as `session`, the score with two
// decimals and a null caption when there is none.
function pinSearchHitData(hit: PinSearchHit) {
  return {
    caption: hit.caption,
    comment: hit.comment,
    pin: hit.number,
    pinId: hit.pinId,
    score: Math.round(hit.score * 100) / 100,
    session: hit.sessionTitle,
    sessionId: hit.sessionId,
    url: hit.url,
  };
}

// A sink failure is reported generically, like a host failure: its
// message never reaches the model.
async function propose(sink: AssistantProposalSink, mcpName: string, args: Record<string, unknown>) {
  try {
    return await sink.propose(mcpName, args);
  } catch {
    return { message: TOOL_FAILED_MESSAGE, status: "error" as const };
  }
}

export function buildAssistantToolSet(input: {
  emit?: AssistantStreamEmit; // required when "ask" is offered
  host: AssistantToolHost;
  kinds: readonly AssistantToolKind[];
  pinSearch?: PinSearchService; // pinar_pins_search, offered with "read"
  proposals?: AssistantProposalSink; // required when kinds includes "write"
  surface: AssistantSurface;
}): ToolSet {
  const sink = input.proposals;
  if (input.kinds.includes("write") && !sink) {
    throw new Error("buildAssistantToolSet: write tools need a proposal sink");
  }
  const tools: ToolSet = {};
  for (const def of assistantToolsFor(input.surface)) {
    if (!input.kinds.includes(def.policy.kind)) continue;
    const schema = toolSchema(def);
    if (def.policy.kind === "write") {
      tools[def.llmName] = tool({
        description: def.description,
        inputSchema: jsonSchema(schema),
        execute: async (args) => {
          const problems = validateArgs(schema, args);
          if (problems.length > 0) {
            return { problems, status: "invalid_arguments" };
          }
          return propose(sink as AssistantProposalSink, def.name, args as Record<string, unknown>);
        },
      });
      continue;
    }
    tools[def.llmName] = tool({
      description: def.description,
      inputSchema: jsonSchema(schema),
      execute: async (args) => {
        const problems = validateArgs(schema, args);
        if (problems.length > 0) {
          return { problems, status: "invalid_arguments" };
        }
        try {
          const result = await input.host.callTool(def.name, args as Record<string, unknown>);
          return dataResult(typeof result === "string" ? result : JSON.stringify(result));
        } catch (error) {
          // McpToolError carries a message meant to be surfaced; any other
          // error is reported generically so its message never leaks.
          if (error instanceof McpToolError) {
            return { message: error.message, status: "error" };
          }
          return { message: TOOL_FAILED_MESSAGE, status: "error" };
        }
      },
    });
  }
  const pinSearch = input.pinSearch;
  if (pinSearch && input.kinds.includes("read")) {
    const def = ASSISTANT_PINS_SEARCH_TOOL;
    tools[toLlmToolName(def.name)] = tool({
      description: def.description,
      inputSchema: jsonSchema(toolSchema(def)),
      execute: async (args, options) => {
        const problems = assistantExtraToolProblems(def, args);
        if (problems.length > 0) {
          return { problems, status: "invalid_arguments" };
        }
        const { limit, query } = args as { limit?: number; query: string };
        try {
          // The turn's signal: once the turn aborts, the search starts no new request.
          const signal = options?.abortSignal;
          const hits = await pinSearch.search({
            limit: limit ?? ASSISTANT_PINS_SEARCH_LIMIT_DEFAULT,
            query: query.trim(),
            ...(signal ? { signal } : {}),
          });
          return dataResult(JSON.stringify({ hits: hits.map(pinSearchHitData) }));
        } catch {
          // The service error (endpoint, store) never reaches the model.
          return { message: TOOL_FAILED_MESSAGE, status: "error" };
        }
      },
    });
  }
  if (sink && input.kinds.includes("write")) {
    const def = ASSISTANT_MOVE_SESSIONS_TOOL;
    tools[toLlmToolName(def.name)] = tool({
      description: def.description,
      inputSchema: jsonSchema(toolSchema(def)),
      execute: async (args) => {
        const problems = assistantExtraToolProblems(def, args);
        if (problems.length > 0) {
          return { problems, status: "invalid_arguments" };
        }
        return propose(sink, def.name, args as Record<string, unknown>);
      },
    });
  }
  const emit = input.emit;
  if (emit) {
    const def = ASSISTANT_ASK_TOOL;
    tools[toLlmToolName(def.name)] = tool({
      description: def.description,
      inputSchema: jsonSchema(toolSchema(def)),
      execute: async (args) => {
        const ask = assistantAskFrom(args);
        if (!ask) {
          return { problems: assistantExtraToolProblems(def, args), status: "invalid_arguments" };
        }
        emit({ data: ask, type: "data-ask" });
        return { status: "asked" };
      },
    });
  }
  return tools;
}
