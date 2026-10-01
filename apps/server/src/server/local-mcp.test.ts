import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleApiRequest, resetLocalApiForTests } from "./api.local";
import { LOCAL_MCP_INSTRUCTIONS } from "./local-mcp";
import { handleMcpProtocolRequest } from "./mcp-protocol";

const VALID_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const EXPECTED_TOOLS = [
  "pinar.add_pin_comment",
  "pinar.conclude_pin",
  "pinar.create_batch",
  "pinar.create_collection",
  "pinar.create_pin",
  "pinar.create_project",
  "pinar.create_session",
  "pinar.delete_batch",
  "pinar.delete_collection",
  "pinar.delete_pin",
  "pinar.delete_pin_comment",
  "pinar.delete_project",
  "pinar.delete_session",
  "pinar.edit_pin_comment",
  "pinar.edit_pin_note",
  "pinar.finish_batch",
  "pinar.get_batch_markdown",
  "pinar.get_collection_markdown",
  "pinar.get_pin",
  "pinar.get_project_markdown",
  "pinar.get_session_markdown",
  "pinar.list_batches",
  "pinar.list_collections",
  "pinar.list_pin_comments",
  "pinar.list_pins",
  "pinar.list_projects",
  "pinar.list_sessions",
  "pinar.move_session",
  "pinar.rename_batch",
  "pinar.rename_collection",
  "pinar.rename_project",
  "pinar.reopen_pin",
  "pinar.reorder_collections",
  "pinar.reorder_projects",
  "pinar.reorder_sessions",
  "pinar.update_session",
];

let root = "";
let previousHome: string | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function request(path: string, init: RequestInit = {}) {
  return handleApiRequest(new Request(`http://127.0.0.1:17373${path}`, init));
}

const MCP_ACCEPT = "application/json, text/event-stream";
const INITIALIZE_PARAMS = { capabilities: {}, clientInfo: { name: "pinar-local-test", version: "0.0.0" }, protocolVersion: "2025-11-25" };

let mcpSessionId: string | null = null;

async function ensureMcpSession() {
  if (mcpSessionId) return;
  const response = await request("/api/mcp", {
    body: JSON.stringify({ id: 0, jsonrpc: "2.0", method: "initialize", params: INITIALIZE_PARAMS }),
    headers: { accept: MCP_ACCEPT, "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(response.status, 200, "MCP initialize must succeed");
  mcpSessionId = response.headers.get("mcp-session-id");
  assert.ok(mcpSessionId, "MCP initialize must return a session id");
}

async function callTool(name: string, argumentsValue: Record<string, unknown>, init: RequestInit = {}) {
  await ensureMcpSession();
  const response = await request("/api/mcp", {
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "tools/call", params: { arguments: argumentsValue, name } }),
    headers: { accept: MCP_ACCEPT, "content-type": "application/json", ...(mcpSessionId ? { "mcp-session-id": mcpSessionId } : {}) },
    method: "POST",
    ...init,
  });
  const body = (await response.json()) as Record<string, unknown>;
  const result = isRecord(body.result) ? body.result : {};
  const content = Array.isArray(result.content) ? result.content : [];
  const first = content[0];
  const text = isRecord(first) && typeof first.text === "string" ? first.text : "";
  return { isError: result.isError === true, response, text };
}

async function seedSession(id: string) {
  const upload = await request("/api/shots", {
    body: JSON.stringify({
      id,
      image: VALID_PNG,
      page: { title: "MCP session", url: `https://example.test/${id}` },
      pins: [{ comment: "Original note", kind: "element", pinId: "pin_one" }],
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(upload.status, 201);
}

describe("local MCP endpoint", () => {
  beforeEach(async () => {
    previousHome = process.env.PINAR_HOME;
    root = await mkdtemp(join(tmpdir(), "pinar-local-mcp-"));
    process.env.PINAR_HOME = root;
    resetLocalApiForTests();
  });

  afterEach(async () => {
    resetLocalApiForTests();
    if (previousHome === undefined) delete process.env.PINAR_HOME;
    else process.env.PINAR_HOME = previousHome;
    await rm(root, { force: true, recursive: true });
  });

  test("initialize reports the local instructions and keeps the Cloud default", async () => {
    const local = await request("/api/mcp", {
      body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "initialize", params: INITIALIZE_PARAMS }),
      headers: { accept: MCP_ACCEPT, "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(local.status, 200);
    const localBody = (await local.json()) as Record<string, unknown>;
    const localResult = isRecord(localBody.result) ? localBody.result : {};
    assert.equal(localResult.instructions, LOCAL_MCP_INSTRUCTIONS);
    assert.match(String(localResult.instructions), /without login or API key/);
    assert.match(String(localResult.instructions), /informational/);

    const cloudDefault = await handleMcpProtocolRequest(
      new Request("http://127.0.0.1:17373/api/mcp", {
        body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "initialize", params: INITIALIZE_PARAMS }),
        headers: { accept: MCP_ACCEPT, "content-type": "application/json" },
        method: "POST",
      }),
      { callTool: async () => ({}), tools: [] },
    );
    assert.equal(cloudDefault.status, 200);
    const cloudBody = (await cloudDefault.json()) as Record<string, unknown>;
    const cloudResult = isRecord(cloudBody.result) ? cloudBody.result : {};
    assert.equal(
      cloudResult.instructions,
      "Pinar Cloud tools act only within the authenticated user's current permissions.",
    );
  });

  test("exposes exactly the thirty-six decided tools and requires POST", async () => {
    await ensureMcpSession();
    const list = await request("/api/mcp", {
      body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "tools/list" }),
      headers: { accept: MCP_ACCEPT, "content-type": "application/json", "mcp-session-id": mcpSessionId ?? "" },
      method: "POST",
    });
    assert.equal(list.status, 200);
    const body = (await list.json()) as Record<string, unknown>;
    const result = isRecord(body.result) ? body.result : {};
    const tools = Array.isArray(result.tools) ? result.tools : [];
    assert.deepEqual(tools.map((tool) => (isRecord(tool) && tool.name ? String(tool.name) : "")).sort(), EXPECTED_TOOLS);

    const get = await request("/api/mcp", { method: "GET" });
    assert.equal(get.status, 405);
  });

  test("serves the pin conversation and note with no credentials over loopback", async () => {
    await seedSession("mcp_comment_session");

    const sessions = await callTool("pinar.list_sessions", { query: "mcp_comment_session" });
    assert.equal(sessions.response.status, 200);
    assert.equal(sessions.isError, false);
    const sessionPage = JSON.parse(sessions.text) as { sessions: Array<Record<string, unknown>> };
    assert.deepEqual(sessionPage.sessions.map((session) => session.id), ["mcp_comment_session"]);

    const markdown = await callTool("pinar.get_session_markdown", { sessionId: "mcp_comment_session" });
    assert.equal(markdown.isError, false);
    assert.match(markdown.text, /Original note/);

    const added = await callTool("pinar.add_pin_comment", {
      agentName: "Grok",
      body: "Investigating the CTA",
      pinId: "pin_one",
      sessionId: "mcp_comment_session",
    });
    assert.equal(added.response.status, 200);
    assert.equal(added.isError, false);
    const addedComment = (JSON.parse(added.text) as { comment: Record<string, unknown> }).comment;
    assert.equal(addedComment.actorType, "agent");
    assert.equal(addedComment.actorLabel, "Grok");
    assert.equal(addedComment.body, "Investigating the CTA");
    const commentId = String(addedComment.id);
    const createdAt = String(addedComment.createdAt);

    const human = await callTool("pinar.add_pin_comment", {
      body: "A human reply",
      pinId: "pin_one",
      sessionId: "mcp_comment_session",
    });
    const humanComment = (JSON.parse(human.text) as { comment: Record<string, unknown> }).comment;
    assert.equal(humanComment.actorType, "human");
    assert.equal(humanComment.actorLabel, "Local");

    const listed = await callTool("pinar.list_pin_comments", { pinId: "pin_one", sessionId: "mcp_comment_session" });
    const listedBody = JSON.parse(listed.text) as { comments: Array<Record<string, unknown>> };
    assert.deepEqual(listedBody.comments.map((comment) => comment.actorType), ["agent", "human"]);
    assert.deepEqual(listedBody.comments.map((comment) => comment.body), ["Investigating the CTA", "A human reply"]);

    const edited = await callTool("pinar.edit_pin_comment", {
      body: "Investigating the CTA (v2)",
      commentId,
      pinId: "pin_one",
      sessionId: "mcp_comment_session",
    });
    const editedComment = (JSON.parse(edited.text) as { comment: Record<string, unknown> }).comment;
    assert.equal(editedComment.id, commentId);
    assert.equal(editedComment.createdAt, createdAt);
    assert.equal(editedComment.body, "Investigating the CTA (v2)");
    assert.equal(editedComment.actorLabel, "Grok");

    const note = await callTool("pinar.edit_pin_note", {
      comment: "Edited original note",
      pinId: "pin_one",
      sessionId: "mcp_comment_session",
    });
    const noteBody = JSON.parse(note.text) as { ok: boolean; pin: Record<string, unknown> };
    assert.equal(noteBody.ok, true);
    assert.equal(noteBody.pin.comment, "Edited original note");
    const markdownAfter = await callTool("pinar.get_session_markdown", { sessionId: "mcp_comment_session" });
    assert.match(markdownAfter.text, /Edited original note/);
  });

  test("rejects hostile origins, invalid payloads, and cross references", async () => {
    await seedSession("mcp_hostile_session");

    const hostile = await callTool("pinar.list_sessions", {}, { headers: { origin: "https://evil.example" } });
    assert.equal(hostile.response.status, 401);

    const emptyBody = await callTool("pinar.add_pin_comment", {
      body: "   ",
      pinId: "pin_one",
      sessionId: "mcp_hostile_session",
    });
    assert.equal(emptyBody.isError, true);
    assert.equal(emptyBody.text, "Invalid payload");

    const overlongBody = await callTool("pinar.add_pin_comment", {
      body: "x".repeat(2001),
      pinId: "pin_one",
      sessionId: "mcp_hostile_session",
    });
    assert.equal(overlongBody.isError, true);
    assert.equal(overlongBody.text, "Invalid payload");

    const missingSession = await callTool("pinar.list_pin_comments", { pinId: "pin_one", sessionId: "nope" });
    assert.equal(missingSession.isError, true);
    assert.equal(missingSession.text, "Session not found");

    const missingPin = await callTool("pinar.list_pin_comments", { pinId: "pin_missing", sessionId: "mcp_hostile_session" });
    assert.equal(missingPin.isError, true);
    assert.equal(missingPin.text, "Pin not found");

    const missingComment = await callTool("pinar.edit_pin_comment", {
      body: "New body",
      commentId: "does_not_exist",
      pinId: "pin_one",
      sessionId: "mcp_hostile_session",
    });
    assert.equal(missingComment.isError, true);
    assert.equal(missingComment.text, "Resource not found");

    const missingMarkdown = await callTool("pinar.get_session_markdown", { sessionId: "nope" });
    assert.equal(missingMarkdown.isError, true);
    assert.equal(missingMarkdown.text, "Session not found");

    const longAgentName = await callTool("pinar.add_pin_comment", {
      agentName: "a".repeat(65),
      body: "Body",
      pinId: "pin_one",
      sessionId: "mcp_hostile_session",
    });
    assert.equal(longAgentName.isError, true);
    assert.match(longAgentName.text, /Input validation error/);
  });
});
