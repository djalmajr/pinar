import type { McpToolDefinition } from "../mcp-protocol";
import { CLOUD_MCP_TOOLS } from "../mcp-tools-cloud";
import { LOCAL_MCP_TOOLS } from "../mcp-tools-local";

// Policy layer for the future Pinar AI assistant. It sits ON TOP of the two
// existing MCP tool lists (LOCAL_MCP_TOOLS and CLOUD_MCP_TOOLS), imported
// from the definition-only modules, and never mutates them: the MCP output
// stays byte-for-byte identical.
//
// Each MCP tool name gets one literal entry (not generated) with:
// - kind: what the call does (read = no state change, write = state change);
// - risk: read -> always "none"; write -> "reversible", "irreversible", or
//   "external" (affects people outside the account);
// - assistant: whether the assistant may call the tool; every "exclude"
//   carries a reason.
//
// Contract for "reversible": the tools themselves offer a restoration with
// FUNCTIONAL fidelity. Accepted residue: updatedAt differences and position
// normalization to 0..N-1. The undo executor (future phase) must store the
// previous state it needs, e.g. the complete order of both collections for a
// move_session. Promoting a tool from irreversible to reversible requires
// a tested undo plan. Risk decisions were made from the handlers in
// local-mcp.ts and cloud-api.ts:
// - create_* (pin/project/collection/batch/session) undo with the matching
//   delete_* of what was created;
// - rename_*/reorder_*/move_session/edit_pin_comment restore the previous
//   value or order, which the reads expose;
// - conclude_pin/reopen_pin append permanent timeline events and
//   "reopened" is not "open" nor "correction_ready" -> irreversible;
// - edit_pin_note cannot restore an empty previous note (parsePinCommentBody
//   rejects empty/whitespace text) -> irreversible;
// - update_session accumulates privacy categories when the URL changes and
//   the MCP cannot restore the previous privacy report -> irreversible;
// - every delete_* destroys its record (sessions lose comments, reviews and
//   screenshot; projects/collections move captures to the Inbox and lose
//   their organization) -> irreversible;
// - delete_batch removes only the batch record and clears batch_id on the
//   kept sessions; its id/timestamps are not re-creatable -> irreversible;
// - finish_batch stamps a server-side finishedAt that no MCP call can clear
//   (local-mcp.ts:932 stamps new Date(); cloud-api.ts:7775-7776 rejects a
//   caller finishedAt and stamps currentDate()), so the previous state
//   (finishedAt null) is not restorable with fidelity -> irreversible;
// - publish_share/revoke_share change what external visitors can read ->
//   external.

export type AssistantToolKind = "read" | "write";
export type AssistantToolRisk = "none" | "reversible" | "irreversible" | "external";
export type AssistantToolExposure = "include" | "exclude";

export interface AssistantToolPolicyEntry {
  kind: AssistantToolKind;
  risk: AssistantToolRisk;
  assistant: AssistantToolExposure;
  reason?: string;
}

export const ASSISTANT_TOOL_POLICY: Record<string, AssistantToolPolicyEntry> = {
  "pinar.add_pin_comment": { kind: "write", risk: "reversible", assistant: "include" },
  // Review findings 1 and 5 (cloud-api.ts and local-mcp.ts handlers):
  // conclude/reopen append permanent timeline events and never return to the
  // previous review state; edit_pin_note cannot restore an empty previous
  // note. All three are irreversible, not just conclude/reopen.
  "pinar.conclude_pin": { kind: "write", risk: "irreversible", assistant: "include" },
  "pinar.create_batch": { kind: "write", risk: "reversible", assistant: "include" },
  // Cloud provisions the protected Personal project / Inbox on first access
  // (ensureDefaultDestination, cloud-api.ts:4720-4792; reads reach it too:
  // listProjects, cloud-api.ts:4823-4825), so this provisioning is an
  // account first-access effect, not an effect of the creation itself.
  "pinar.create_collection": { kind: "write", risk: "reversible", assistant: "include" },
  "pinar.create_pin": { kind: "write", risk: "reversible", assistant: "include" },
  // Same Cloud first-access provisioning as create_collection above
  // (createProject reaches it via listProjects, cloud-api.ts:4868-4874).
  "pinar.create_project": { kind: "write", risk: "reversible", assistant: "include" },
  // Same Cloud first-access provisioning as create_collection above
  // (createMcpSession reaches it via resolveDestination, cloud-api.ts:2751).
  "pinar.create_session": { kind: "write", risk: "reversible", assistant: "include" },
  "pinar.delete_batch": { kind: "write", risk: "irreversible", assistant: "include" },
  "pinar.delete_collection": { kind: "write", risk: "irreversible", assistant: "include" },
  "pinar.delete_pin": { kind: "write", risk: "irreversible", assistant: "include" },
  "pinar.delete_pin_comment": { kind: "write", risk: "irreversible", assistant: "include" },
  "pinar.delete_project": { kind: "write", risk: "irreversible", assistant: "include" },
  "pinar.delete_session": { kind: "write", risk: "irreversible", assistant: "include" },
  "pinar.edit_pin_comment": { kind: "write", risk: "reversible", assistant: "include" },
  // The previous note cannot be restored when it was empty: both handlers
  // validate the new comment with parsePinCommentBody, which rejects empty
  // and whitespace-only text (local-mcp.ts:690-700; cloud-api.ts:7725-7749).
  "pinar.edit_pin_note": { kind: "write", risk: "irreversible", assistant: "include" },
  "pinar.finish_batch": { kind: "write", risk: "irreversible", assistant: "include" },
  "pinar.get_batch_markdown": { kind: "read", risk: "none", assistant: "include" },
  "pinar.get_collection_markdown": { kind: "read", risk: "none", assistant: "include" },
  "pinar.get_pin": { kind: "read", risk: "none", assistant: "include" },
  "pinar.get_project_markdown": { kind: "read", risk: "none", assistant: "include" },
  "pinar.get_session_markdown": { kind: "read", risk: "none", assistant: "include" },
  "pinar.key_scope": {
    kind: "read",
    risk: "none",
    assistant: "exclude",
    reason: "Describes the agent API key's scope; the assistant acts as the logged-in user, not with a key.",
  },
  "pinar.list_batches": { kind: "read", risk: "none", assistant: "include" },
  "pinar.list_collections": { kind: "read", risk: "none", assistant: "include" },
  "pinar.list_pin_comments": { kind: "read", risk: "none", assistant: "include" },
  "pinar.list_pins": { kind: "read", risk: "none", assistant: "include" },
  "pinar.list_projects": { kind: "read", risk: "none", assistant: "include" },
  "pinar.list_sessions": { kind: "read", risk: "none", assistant: "include" },
  "pinar.move_session": { kind: "write", risk: "reversible", assistant: "include" },
  "pinar.publish_share": { kind: "write", risk: "external", assistant: "include" },
  "pinar.reorder_collections": { kind: "write", risk: "reversible", assistant: "include" },
  "pinar.reorder_projects": { kind: "write", risk: "reversible", assistant: "include" },
  "pinar.reorder_sessions": { kind: "write", risk: "reversible", assistant: "include" },
  "pinar.rename_batch": { kind: "write", risk: "reversible", assistant: "include" },
  "pinar.rename_collection": { kind: "write", risk: "reversible", assistant: "include" },
  "pinar.rename_project": { kind: "write", risk: "reversible", assistant: "include" },
  // Review finding 1: re-accepting keeps the added timeline events, so the
  // previous review state (open/correction_ready) is not restored.
  "pinar.reopen_pin": { kind: "write", risk: "irreversible", assistant: "include" },
  "pinar.revoke_share": { kind: "write", risk: "external", assistant: "include" },
  // Review finding 2: changing the URL accumulates privacy categories
  // (privacy.redacted) that the MCP cannot restore to the previous report
  // (local-mcp.ts:610-640; cloud-api.ts:2791-2830).
  "pinar.update_session": { kind: "write", risk: "irreversible", assistant: "include" },
};

// LLM-facing names: the MCP name with "." replaced by "_". OpenAI and
// Anthropic function-calling APIs only accept ^[a-zA-Z0-9_-]{1,64}$, and the
// round-trip fromLlmToolName/toLlmToolName must be collision-free.
export function toLlmToolName(mcpName: string): string {
  return mcpName.replace(/\./g, "_");
}

const llmNameToMcpName = new Map<string, string>(
  Object.keys(ASSISTANT_TOOL_POLICY).map((name) => [toLlmToolName(name), name]),
);

// Returns the MCP name for a known LLM name, or undefined for an unknown one.
export function fromLlmToolName(llmName: string): string | undefined {
  return llmNameToMcpName.get(llmName);
}

export interface AssistantTool {
  description: string;
  inputSchema: McpToolDefinition["inputSchema"];
  llmName: string;
  name: string;
  policy: AssistantToolPolicyEntry;
}

const MCP_SURFACES = {
  cloud: CLOUD_MCP_TOOLS,
  local: LOCAL_MCP_TOOLS,
} as const;

export type AssistantSurface = "local" | "cloud";

// The "include" tools of a surface, in the exact order of that surface's MCP
// list (stable order matters for the model's prefix cache), each with its
// original definition (name, description and inputSchema untouched), its
// LLM name and its policy.
export function assistantToolsFor(surface: AssistantSurface): AssistantTool[] {
  return MCP_SURFACES[surface]
    .filter((tool) => ASSISTANT_TOOL_POLICY[tool.name].assistant === "include")
    .map((tool) => ({
      description: tool.description,
      inputSchema: tool.inputSchema,
      llmName: toLlmToolName(tool.name),
      name: tool.name,
      policy: ASSISTANT_TOOL_POLICY[tool.name],
    }));
}
