// Definition-only module for the local MCP tool list: no handlers, no state.
// It is the single source of truth for LOCAL_MCP_TOOLS; local-mcp.ts imports
// it and re-exports it under the same name so existing importers are
// unaffected. The JSON and order of the list must stay byte-for-byte
// identical; the assistant tool-policy snapshot test guards that.
import type { McpToolDefinition } from "./mcp-protocol";

export const MCP_MAX_LIST_SIZE = 50;
export const MCP_MAX_ORDER_SIZE = 1000;
export const MCP_MAX_SESSION_TEXT_LENGTH = 2000;

export function mcpTool(name: string, description: string, properties: Record<string, unknown>, required: string[] = []): McpToolDefinition {
  return { description, inputSchema: { properties, required, type: "object" }, name };
}

export const LOCAL_MCP_TOOLS: McpToolDefinition[] = [
  mcpTool("pinar.list_sessions", "List local sessions with optional bounded filtering.", {
    batchId: { type: "string" },
    collectionId: { type: "string" },
    limit: { maximum: MCP_MAX_LIST_SIZE, minimum: 1, type: "integer" },
    offset: { maximum: 10_000, minimum: 0, type: "integer" },
    query: { maxLength: 256, type: "string" },
  }),
  mcpTool("pinar.get_session_markdown", "Read local Markdown for a stored session.", { sessionId: { type: "string" } }, ["sessionId"]),
  mcpTool("pinar.list_pin_comments", "List the conversation comments on a pin, with ids, authorship, and bodies.", {
    pinId: { type: "string" },
    sessionId: { type: "string" },
  }, ["sessionId", "pinId"]),
  mcpTool("pinar.add_pin_comment", "Add a comment to a pin conversation. agentName is optional informational authorship for agents.", {
    agentName: { maxLength: 64, type: "string" },
    body: { type: "string" },
    pinId: { type: "string" },
    sessionId: { type: "string" },
  }, ["sessionId", "pinId", "body"]),
  mcpTool("pinar.edit_pin_comment", "Edit a stored comment on a pin. Id, authorship, and createdAt are preserved.", {
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
  mcpTool("pinar.list_pins", "List the pins of a local session as bounded notes: id, number, comment, locator, location and review status. No screenshots or measured geometry.", {
    limit: { maximum: MCP_MAX_LIST_SIZE, minimum: 1, type: "integer" },
    offset: { maximum: 10_000, minimum: 0, type: "integer" },
    sessionId: { type: "string" },
  }, ["sessionId"]),
  mcpTool("pinar.get_pin", "Read one pin of a local session as a bounded note; legacy captureId:pN pin ids are accepted.", {
    pinId: { type: "string" },
    sessionId: { type: "string" },
  }, ["sessionId", "pinId"]),
  mcpTool("pinar.create_pin", "Create a note pin on a local session: server-generated UUID id and next number, optional locator, explicitly unresolved location, zero stored bytes.", {
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
  mcpTool("pinar.list_projects", "List local projects as metadata only, without screenshots or session payloads.", {
    limit: { maximum: MCP_MAX_LIST_SIZE, minimum: 1, type: "integer" },
    offset: { maximum: 10_000, minimum: 0, type: "integer" },
  }),
  mcpTool("pinar.get_project_markdown", "Read local Markdown for a stored project with its collections and sessions.", { projectId: { type: "string" } }, ["projectId"]),
  mcpTool("pinar.list_collections", "List the collections of one local project as metadata only.", {
    limit: { maximum: MCP_MAX_LIST_SIZE, minimum: 1, type: "integer" },
    offset: { maximum: 10_000, minimum: 0, type: "integer" },
    projectId: { type: "string" },
  }, ["projectId"]),
  mcpTool("pinar.get_collection_markdown", "Read local Markdown for a stored collection with its sessions.", { collectionId: { type: "string" } }, ["collectionId"]),
  mcpTool("pinar.list_batches", "List local capture batches as metadata only.", {
    limit: { maximum: MCP_MAX_LIST_SIZE, minimum: 1, type: "integer" },
    offset: { maximum: 10_000, minimum: 0, type: "integer" },
  }),
  mcpTool("pinar.get_batch_markdown", "Read the local agent handoff Markdown for a stored batch.", { batchId: { type: "string" } }, ["batchId"]),
  mcpTool("pinar.create_project", "Create a local project.", {
    name: { maxLength: 256, type: "string" },
  }, ["name"]),
  mcpTool("pinar.rename_project", "Rename a local project.", {
    name: { maxLength: 256, type: "string" },
    projectId: { type: "string" },
  }, ["projectId", "name"]),
  mcpTool("pinar.reorder_projects", "Reorder local projects. ids must list every project exactly once, in the new order, because omitted projects would keep their old positions.", {
    ids: { items: { maxLength: 256, type: "string" }, maxItems: MCP_MAX_ORDER_SIZE, minItems: 1, type: "array" },
  }, ["ids"]),
  mcpTool("pinar.create_collection", "Create a local collection in a project. parentId null or omitted places it at the project root.", {
    name: { maxLength: 256, type: "string" },
    parentId: { anyOf: [{ maxLength: 256, type: "string" }, { type: "null" }] },
    projectId: { type: "string" },
  }, ["projectId", "name"]),
  mcpTool("pinar.rename_collection", "Rename a local collection.", {
    collectionId: { type: "string" },
    name: { maxLength: 256, type: "string" },
  }, ["collectionId", "name"]),
  mcpTool("pinar.reorder_collections", "Reorder the complete collection hierarchy of one project. items must cover every collection of the project exactly once; parentId null places a collection at the project root.", {
    items: {
      items: {
        properties: {
          id: { maxLength: 256, type: "string" },
          parentId: { anyOf: [{ maxLength: 256, type: "string" }, { type: "null" }] },
        },
        required: ["id"],
        type: "object",
      },
      maxItems: MCP_MAX_ORDER_SIZE,
      minItems: 1,
      type: "array",
    },
    projectId: { type: "string" },
  }, ["projectId", "items"]),
  mcpTool("pinar.move_session", "Move a stored session to another collection.", {
    collectionId: { type: "string" },
    sessionId: { type: "string" },
  }, ["sessionId", "collectionId"]),
  mcpTool("pinar.reorder_sessions", "Reorder the sessions of one collection. ids must list every session of the collection exactly once, in the new order, because omitted sessions would keep their old positions.", {
    collectionId: { type: "string" },
    ids: { items: { maxLength: 256, type: "string" }, maxItems: MCP_MAX_ORDER_SIZE, minItems: 1, type: "array" },
  }, ["collectionId", "ids"]),
  mcpTool("pinar.conclude_pin", "Conclude a pin review as accepted. Repeated actions follow the store transition contract.", {
    pinId: { type: "string" },
    sessionId: { type: "string" },
  }, ["sessionId", "pinId"]),
  mcpTool("pinar.reopen_pin", "Reopen an accepted pin review. Repeated actions follow the store transition contract.", {
    pinId: { type: "string" },
    sessionId: { type: "string" },
  }, ["sessionId", "pinId"]),
  mcpTool("pinar.delete_project", "Delete a local project. Its captures are moved to the default Inbox and its collections are removed; the protected Personal project cannot be deleted.", {
    projectId: { type: "string" },
  }, ["projectId"]),
  mcpTool("pinar.delete_collection", "Delete a local collection. Its captures are moved to the default Inbox and its children are promoted to the deleted collection's parent; the protected Inbox cannot be deleted.", {
    collectionId: { type: "string" },
  }, ["collectionId"]),
  mcpTool("pinar.delete_batch", "Delete a local capture batch. Sessions keep their captures; only the batch tag is detached.", {
    batchId: { type: "string" },
  }, ["batchId"]),
  mcpTool("pinar.finish_batch", "Mark a local capture batch as finished, stamping its finishedAt timestamp.", {
    batchId: { type: "string" },
  }, ["batchId"]),
  mcpTool("pinar.delete_session", "Delete a local session, cleaning up its stored comments, reviews, and screenshot.", {
    sessionId: { type: "string" },
  }, ["sessionId"]),
  mcpTool("pinar.delete_pin_comment", "Delete one stored comment from a pin conversation. Only the target comment is removed; the pin and the other comments stay.", {
    commentId: { type: "string" },
    pinId: { type: "string" },
    sessionId: { type: "string" },
  }, ["sessionId", "pinId", "commentId"]),
  mcpTool("pinar.create_batch", "Create a local capture batch. The id and startedAt timestamp are generated by the server; label is required.", {
    label: { maxLength: 256, type: "string" },
  }, ["label"]),
  mcpTool("pinar.rename_batch", "Rename a local capture batch. The batch id, startedAt, finishedAt, and session membership are preserved.", {
    batchId: { type: "string" },
    label: { maxLength: 256, type: "string" },
  }, ["batchId", "label"]),
  mcpTool("pinar.create_session", "Create a local session from metadata only (no screenshot, no pins, zero image bytes). The id and createdAt are generated by the server; title and url are required and description is optional. An explicit collectionId or batchId must already exist; omitted destinations use the protected default.", {
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
  mcpTool("pinar.update_session", "Update a stored session's page title, url or description and/or its reproduction. Id, createdAt, position, collection, batch, screenshot identity, and every existing pin are preserved; an explicit empty description clears it.", {
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
];
