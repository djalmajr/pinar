// MCP -> AI SDK tool adapter for the assistant.
//
// buildAssistantToolSet turns the policy-approved MCP tools of a surface
// (assistantToolsFor) into AI SDK tools keyed by their LLM name
// (pinar_list_sessions, ...). Every execute first validates the arguments
// with validateArgs (invalid arguments never reach the host), then calls the
// host with the original MCP name (pinar.list_sessions).

import { jsonSchema, tool, type ToolSet } from "ai";
import { McpToolError } from "../mcp-protocol";
import { assistantToolsFor, type AssistantSurface, type AssistantToolKind } from "./tool-policy";
import { validateArgs, type ToolInputSchema } from "./validate";

export interface AssistantToolHost {
  callTool(mcpName: string, args: Record<string, unknown>): Promise<unknown>;
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

function toolSchema(def: { inputSchema: { properties?: Record<string, unknown>; required?: string[]; type: "object" } }): ToolInputSchema {
  // The MCP definitions type the schema as a loose JSON object; these are
  // JSON Schema objects, so the ToolInputSchema view is safe at this
  // boundary (the validator only reads the declared keys).
  return def.inputSchema as unknown as ToolInputSchema;
}

export function buildAssistantToolSet(input: {
  host: AssistantToolHost;
  kinds: readonly AssistantToolKind[];
  surface: AssistantSurface;
}): ToolSet {
  const tools: ToolSet = {};
  for (const def of assistantToolsFor(input.surface)) {
    if (!input.kinds.includes(def.policy.kind)) continue;
    const schema = toolSchema(def);
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
          const text = typeof result === "string" ? result : JSON.stringify(result);
          const { data, truncated } = escapeCapped(text, ASSISTANT_TOOL_DATA_MAX);
          return { data: `<dados>${data}</dados>`, status: "ok", truncated };
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
  return tools;
}
