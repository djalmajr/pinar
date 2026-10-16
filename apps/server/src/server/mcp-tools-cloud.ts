// Definition-only module for the Cloud MCP tool list: no handlers, no
// state. It is the single source of truth for CLOUD_MCP_TOOLS; cloud-api.ts
// imports it and re-exports it under the same name so existing importers are
// unaffected. The JSON and order of the list must stay byte-for-byte
// identical; the assistant tool-policy snapshot test guards that.
import type { McpToolDefinition } from "./mcp-protocol";

export const MCP_MAX_ARGUMENT_LENGTH = 256;
export const MCP_MAX_LIST_SIZE = 100;
export const MCP_MAX_SESSION_TEXT_LENGTH = 2000;
export type McpResourceType = "batch" | "collection" | "project" | "session";
export const MCP_RESOURCE_TYPES: McpResourceType[] = ["batch", "collection", "project", "session"];
export const MCP_PAGE_PROPERTIES = {
  limit: { maximum: MCP_MAX_LIST_SIZE, minimum: 1, type: "integer" },
  offset: { maximum: 10_000, minimum: 0, type: "integer" },
};

export function mcpTool(
  name: string,
  description: string,
  properties: Record<string, unknown> = {},
  required: string[] = [],
): McpToolDefinition {
  return {
    description,
    inputSchema: { properties, required, type: "object" },
    name,
  };
}

export const CLOUD_MCP_TOOLS: McpToolDefinition[] = [
  mcpTool("pinar.key_scope", "Show this key's permission and resource scope, including its resource ID."),
  mcpTool("pinar.list_projects", "List projects visible to this key.", MCP_PAGE_PROPERTIES),
  mcpTool("pinar.get_project_markdown", "Read private Markdown for an owned project.", { projectId: { type: "string" } }, ["projectId"]),
  mcpTool("pinar.list_collections", "List collections in a visible project.", { ...MCP_PAGE_PROPERTIES, projectId: { type: "string" } }, ["projectId"]),
  mcpTool("pinar.get_collection_markdown", "Read private Markdown for an owned collection.", { collectionId: { type: "string" } }, ["collectionId"]),
  mcpTool("pinar.list_sessions", "List visible sessions with optional bounded filtering.", {
    batchId: { type: "string" },
    collectionId: { type: "string" },
    limit: { maximum: MCP_MAX_LIST_SIZE, minimum: 1, type: "integer" },
    offset: { maximum: 10_000, minimum: 0, type: "integer" },
    query: { maxLength: MCP_MAX_ARGUMENT_LENGTH, type: "string" },
  }),
  mcpTool("pinar.get_session_markdown", "Read private Markdown for an owned session.", { sessionId: { type: "string" } }, ["sessionId"]),
  mcpTool("pinar.list_batches", "List visible session batches.", MCP_PAGE_PROPERTIES),
  mcpTool("pinar.get_batch_markdown", "Read private Markdown for an owned batch.", { batchId: { type: "string" } }, ["batchId"]),
  mcpTool("pinar.create_project", "Create a project in the account workspace.", { name: { type: "string" } }, ["name"]),
  mcpTool("pinar.rename_project", "Rename an owned project.", { name: { type: "string" }, projectId: { type: "string" } }, ["projectId", "name"]),
  mcpTool("pinar.reorder_projects", "Set the order of owned projects.", { ids: { items: { type: "string" }, type: "array" } }, ["ids"]),
  mcpTool("pinar.create_collection", "Create a collection in an owned project.", { name: { type: "string" }, parentId: { type: "string" }, projectId: { type: "string" } }, ["projectId", "name"]),
  mcpTool("pinar.rename_collection", "Rename an owned collection.", { collectionId: { type: "string" }, name: { type: "string" } }, ["collectionId", "name"]),
  mcpTool("pinar.reorder_collections", "Set the order and parent relationships of owned collections.", {
    items: { items: { properties: { id: { type: "string" }, parentId: { type: ["string", "null"] } }, type: "object" }, type: "array" },
    projectId: { type: "string" },
  }, ["projectId", "items"]),
  mcpTool("pinar.move_session", "Move an owned session to an owned collection.", { collectionId: { type: "string" }, sessionId: { type: "string" } }, ["sessionId", "collectionId"]),
  mcpTool("pinar.reorder_sessions", "Set the order of sessions in an owned collection.", { collectionId: { type: "string" }, ids: { items: { type: "string" }, type: "array" } }, ["collectionId", "ids"]),
  mcpTool("pinar.publish_share", "Explicitly publish a share link for an owned resource.", {
    expiresAt: { type: "string" },
    resourceId: { type: "string" },
    resourceType: { enum: MCP_RESOURCE_TYPES, type: "string" },
  }, ["resourceType", "resourceId"]),
  mcpTool("pinar.revoke_share", "Revoke an active share link for an owned resource.", {
    resourceId: { type: "string" },
    resourceType: { enum: MCP_RESOURCE_TYPES, type: "string" },
  }, ["resourceType", "resourceId"]),
  mcpTool("pinar.list_pin_comments", "List the conversation comments on a pin, with ids, authorship, and bodies.", {
    pinId: { type: "string" },
    sessionId: { type: "string" },
  }, ["sessionId", "pinId"]),
  mcpTool("pinar.add_pin_comment", "Add an agent comment to a pin conversation; the author is derived from this key.", {
    body: { type: "string" },
    pinId: { type: "string" },
    sessionId: { type: "string" },
  }, ["sessionId", "pinId", "body"]),
  mcpTool("pinar.edit_pin_comment", "Edit a comment this key authored; id, authorship, and createdAt are preserved.", {
    body: { type: "string" },
    commentId: { type: "string" },
    pinId: { type: "string" },
    sessionId: { type: "string" },
  }, ["sessionId", "pinId", "commentId", "body"]),
  mcpTool("pinar.edit_pin_note", "Edit the original note on a pin, preserving the session and pin ids.", {
    comment: { type: "string" },
    pinId: { type: "string" },
    sessionId: { type: "string" },
  }, ["sessionId", "pinId", "comment"]),
  mcpTool("pinar.delete_project", "Delete an owned project; its sessions move to the default Inbox. Protected projects cannot be deleted.", {
    projectId: { type: "string" },
  }, ["projectId"]),
  mcpTool("pinar.delete_collection", "Delete an owned collection; its sessions move to the default Inbox. Protected collections cannot be deleted.", {
    collectionId: { type: "string" },
  }, ["collectionId"]),
  mcpTool("pinar.delete_batch", "Delete an owned batch; its sessions are kept and detached from the batch.", {
    batchId: { type: "string" },
  }, ["batchId"]),
  mcpTool("pinar.finish_batch", "Mark an owned batch as finished, recording the server timestamp.", {
    batchId: { type: "string" },
  }, ["batchId"]),
  mcpTool("pinar.create_batch", "Create a batch with a server-generated id and start time.", {
    label: { type: "string" },
  }, ["label"]),
  mcpTool("pinar.rename_batch", "Rename an owned batch; its id, owner, timestamps and session membership are preserved.", {
    batchId: { type: "string" },
    label: { type: "string" },
  }, ["batchId", "label"]),
  mcpTool("pinar.create_session", "Create a metadata-only session note (no screenshot, zero stored bytes) with a server-generated id in an owned collection or batch.", {
    batchId: { type: "string" },
    collectionId: { type: "string" },
    page: {
      properties: {
        description: { maxLength: MCP_MAX_SESSION_TEXT_LENGTH, type: "string" },
        title: { maxLength: MCP_MAX_SESSION_TEXT_LENGTH, type: "string" },
        url: { type: "string" },
      },
      required: ["title", "url"],
      type: "object",
    },
  }, ["page"]),
  mcpTool("pinar.update_session", "Update a session's page title, url or description and/or its reproduction; identity, owner, plan, bytes, permanence, batch and position are preserved.", {
    page: {
      properties: {
        description: { maxLength: MCP_MAX_SESSION_TEXT_LENGTH, type: "string" },
        title: { maxLength: MCP_MAX_SESSION_TEXT_LENGTH, type: "string" },
        url: { type: "string" },
      },
      type: "object",
    },
    reproduction: { type: ["object", "null"] },
    sessionId: { type: "string" },
  }, ["sessionId"]),
  mcpTool("pinar.delete_session", "Delete an owned session and its pinned content.", {
    sessionId: { type: "string" },
  }, ["sessionId"]),
  mcpTool("pinar.list_pins", "List the pins of an owned session as bounded notes: id, number, comment, locator, location and review status. No screenshots or measured geometry.", {
    limit: { type: "integer" },
    offset: { type: "integer" },
    sessionId: { type: "string" },
  }, ["sessionId"]),
  mcpTool("pinar.get_pin", "Read one pin of an owned session as a bounded note; legacy captureId:pN pin ids are accepted.", {
    pinId: { type: "string" },
    sessionId: { type: "string" },
  }, ["sessionId", "pinId"]),
  mcpTool("pinar.create_pin", "Create a note pin on an owned session: server-generated UUID id and next number, optional locator, explicitly unresolved location, zero stored bytes.", {
    comment: { type: "string" },
    locator: {
      properties: {
        cssSelector: { type: "string" },
        domPath: { type: "string" },
        innerText: { type: "string" },
      },
      type: "object",
    },
    sessionId: { type: "string" },
  }, ["sessionId", "comment"]),
  mcpTool("pinar.delete_pin", "Delete a pin and its current reviews, events and comments; remaining pins keep their numbers and the execution audit is preserved.", {
    pinId: { type: "string" },
    sessionId: { type: "string" },
  }, ["sessionId", "pinId"]),
  mcpTool("pinar.delete_pin_comment", "Delete a comment this key authored from a pin conversation.", {
    commentId: { type: "string" },
    pinId: { type: "string" },
    sessionId: { type: "string" },
  }, ["sessionId", "pinId", "commentId"]),
  mcpTool("pinar.conclude_pin", "Conclude a pin review as accepted, following the review state machine.", {
    pinId: { type: "string" },
    sessionId: { type: "string" },
  }, ["sessionId", "pinId"]),
  mcpTool("pinar.reopen_pin", "Reopen an accepted pin review, following the review state machine.", {
    pinId: { type: "string" },
    sessionId: { type: "string" },
  }, ["sessionId", "pinId"]),
];
