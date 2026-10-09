import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, test } from "node:test";
import { Database } from "bun:sqlite";
import { setSystemTime } from "bun:test";
import { openHistoryDb } from "@pinar/cli/history";
import { parseHandoffJson } from "@pinar/shared";
import { handleApiRequest, handlePublicRequest, resetLocalApiForTests } from "./api.local";
import { isUsableSessionShotPath } from "./local-session-files";

const VALID_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

let root = "";
let victimDir = "";
let previousHome: string | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function request(path: string, init: RequestInit = {}) {
  return handleApiRequest(new Request(`http://127.0.0.1:17373${path}`, init));
}

async function requestJson(path: string, init: RequestInit = {}) {
  const response = await request(path, init);
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { body, response };
}

const MCP_ACCEPT = "application/json, text/event-stream";
const INITIALIZE_PARAMS = { capabilities: {}, clientInfo: { name: "pinar-crud-test", version: "0.0.0" }, protocolVersion: "2025-11-25" };
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

function headersOf(init: RequestInit): Record<string, string> {
  const value = init.headers;
  if (!value) return {};
  if (Array.isArray(value)) return Object.fromEntries(value.map(([name, item]) => [name, item]));
  if (value instanceof Headers) return Object.fromEntries(value.entries());
  return { ...value };
}

// A clock-mocked test stamps the transport session's last activity under the
// mocked time; once the real clock returns, the cached session reads as idle
// for months and its 30-minute expiry kills every later call. Drop the cached
// session id so the next callTool reinitializes a fresh handshake at the
// real clock.
function resetMcpSession() {
  mcpSessionId = null;
}

async function callTool(name: string, argumentsValue: Record<string, unknown>, init: RequestInit = {}) {
  await ensureMcpSession();
  const response = await request("/api/mcp", {
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "tools/call", params: { arguments: argumentsValue, name } }),
    headers: { "content-type": "application/json", accept: MCP_ACCEPT, ...(mcpSessionId ? { "mcp-session-id": mcpSessionId } : {}), ...headersOf(init) },
    method: "POST",
  });
  const body = (await response.json()) as Record<string, unknown>;
  const result = isRecord(body.result) ? body.result : {};
  const content = Array.isArray(result.content) ? result.content : [];
  const first = content[0];
  const text = isRecord(first) && typeof first.text === "string" ? first.text : "";
  return { isError: result.isError === true, response, text };
}

function parse(text: string): Record<string, unknown> {
  return JSON.parse(text) as Record<string, unknown>;
}

function sessionIds(page: Record<string, unknown>): string[] {
  const sessions = Array.isArray(page.sessions) ? page.sessions : [];
  return sessions.map((session) => (isRecord(session) ? String(session.id) : "")).sort();
}

async function seedSession(id: string, options: { batch?: { id: string; label: string }; collectionId?: string; pins?: unknown[] } = {}) {
  const upload = await request("/api/shots", {
    body: JSON.stringify({
      batch: options.batch,
      collectionId: options.collectionId,
      id,
      image: VALID_PNG,
      page: { title: `CRUD ${id}`, url: `https://example.test/${id}` },
      pins: options.pins ?? [{ comment: "Original note", kind: "element", pinId: "pin_one" }],
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(upload.status, 201, `seed ${id}: ${await upload.text().catch(() => "")}`);
}

async function addComment(sessionId: string, pinId: string, body: string) {
  const added = await callTool("pinar.add_pin_comment", { body, pinId, sessionId });
  assert.equal(added.isError, false, added.text);
  return parse(added.text).comment as Record<string, unknown>;
}

async function commentBodies(sessionId: string, pinId: string): Promise<string[]> {
  const listed = await callTool("pinar.list_pin_comments", { pinId, sessionId });
  assert.equal(listed.isError, false, listed.text);
  const page = parse(listed.text);
  const comments = Array.isArray(page.comments) ? page.comments : [];
  return comments.map((comment) => (isRecord(comment) ? String(comment.body) : ""));
}

async function defaultContainers() {
  const projects = (await requestJson("/api/projects")).body.projects as Array<Record<string, unknown>>;
  const personal = projects.find((project) => project.name === "Personal")!;
  assert.ok(personal, "Personal project missing");
  const collections = ((await requestJson(`/api/projects/${personal.id}/collections`)).body.collections as Array<Record<string, unknown>>);
  const inbox = collections.find((collection) => collection.isProtected === true);
  assert.ok(inbox, "Inbox collection missing");
  return { inboxId: String(inbox.id), personalId: String(personal.id) };
}

async function listSessions(options: Record<string, unknown> = {}) {
  const listed = await callTool("pinar.list_sessions", { limit: 50, ...options });
  assert.equal(listed.isError, false, listed.text);
  return parse(listed.text).sessions as Array<Record<string, unknown>>;
}

const VICTIM_CONTENT = "do not delete";

function makeVictim(name: string): string {
  const victim = join(victimDir, name);
  writeFileSync(victim, VICTIM_CONTENT);
  return victim;
}

// Simulates a corrupted/legacy stored record: writes the shotPath (and
// optionally a forged shotId) straight into the history store, bypassing the
// (now validated) HTTP ingest route.
function corruptShotPath(sessionId: string, shotPath: string, shotId?: string) {
  resetLocalApiForTests();
  const store = openHistoryDb(root) as unknown as { close(): void; saveSession(input: Record<string, unknown>): unknown };
  try {
    store.saveSession({
      id: sessionId,
      page: { title: sessionId, url: `https://example.test/${sessionId}` },
      pins: [{ comment: "note", kind: "element", pinId: "pin_one" }],
      shotId: shotId ?? null,
      shotPath,
    });
  } finally {
    store.close();
  }
}

function poisonHistory(id: string, shotPath: string) {
  return request("/api/history", {
    body: JSON.stringify({
      id,
      page: { title: id, url: `https://example.test/${id}` },
      pins: [{ comment: "n", kind: "element", pinId: "pin_one" }],
      shotPath,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function assertBackendShape(jsonFallback: boolean) {
  if (jsonFallback) assert.ok(existsSync(join(root, "history.json")), "history.json must exist");
  else assert.ok(existsSync(join(root, "history.db")) && !existsSync(join(root, "history.json")), "SQLite backend without history.json");
}

function shotSafetyTests(jsonFallback: boolean) {
  test("POST /api/history rejects a shotPath outside the shots root without mutation", async () => {
    await seedSession("safety_keep");
    assertBackendShape(jsonFallback);
    const victim = makeVictim("poison.txt");
    const poison = await poisonHistory("safety_keep", victim);
    assert.equal(poison.status, 400, `poison must be rejected: ${await poison.text()}`);
    const session = (await requestJson("/api/sessions/safety_keep")).body.session as Record<string, unknown>;
    assert.equal(session.shotPath, join(root, "shots", "safety_keep.png"), "the original shotPath must survive the rejected write");
    const ghost = await poisonHistory("safety_ghost", victim);
    assert.equal(ghost.status, 400, `a new-session poison must be rejected: ${await ghost.text()}`);
    assert.equal((await request("/api/sessions/safety_ghost")).status, 404, "no session must be created");
    const kept = await callTool("pinar.delete_session", { sessionId: "safety_keep" });
    assert.equal(kept.isError, false, kept.text);
    assert.deepEqual(parse(kept.text), { deleted: true, ok: true });
    assert.ok(!existsSync(join(root, "shots", "safety_keep.png")), "the legitimate shot must be cleaned up");
    assert.ok(existsSync(victim), "the external victim must survive");
    assert.equal(readFileSync(victim, "utf8"), VICTIM_CONTENT, "the external victim must be byte-identical");
  });

  test("a corrupted external shotPath is skipped on delete while the session row is removed", async () => {
    const mcpVictim = makeVictim("mcp-precious.txt");
    const restVictim = makeVictim("rest-precious.txt");
    await seedSession("safety_mcp");
    assertBackendShape(jsonFallback);
    await seedSession("safety_rest");
    corruptShotPath("safety_mcp", mcpVictim);
    corruptShotPath("safety_rest", restVictim);

    const mcp = await callTool("pinar.delete_session", { sessionId: "safety_mcp" });
    assert.equal(mcp.isError, false, mcp.text);
    assert.deepEqual(parse(mcp.text), { deleted: true, ok: true });
    assert.equal(readFileSync(mcpVictim, "utf8"), VICTIM_CONTENT, "MCP delete must not touch the external file");
    assert.equal((await request("/api/sessions/safety_mcp")).status, 404, "the session row must be deleted");

    const rest = await request("/api/history/safety_rest", { method: "DELETE" });
    const restText = await rest.text();
    assert.equal(rest.status, 200, `REST delete must succeed: ${restText}`);
    assert.deepEqual(JSON.parse(restText), { deleted: true, ok: true });
    assert.equal(readFileSync(restVictim, "utf8"), VICTIM_CONTENT, "REST delete must not touch the external file");
    assert.equal((await request("/api/sessions/safety_rest")).status, 404, "the session row must be deleted");
    assert.deepEqual(sessionIds(parse((await callTool("pinar.list_sessions", {})).text)), [], "both corrupted sessions must be gone");
  });

  // Windows without SeCreateSymbolicLinkPrivilege (no developer mode) fails
  // with EPERM when creating symlinks. For directory links a junction is a
  // genuine directory link that realpathSync follows, so the directory cases
  // keep running on the junction; for FILE links there is no equivalent shape
  // (a junction is a directory, a direct path is not a symlink), so the
  // file-symlink tests skip via the node:test context instead of degrading
  // the fixture. Every other error, or any error on non-win32, is rethrown.
  const isWin32Eperm = (error: unknown): boolean =>
    process.platform === "win32" && error instanceof Error && "code" in error && error.code === "EPERM";

  test("linked parent directories and directory shotPaths are skipped, never removed", async () => {
    // Real dir symlinks are tried first, so hosts that may create them keep
    // the full coverage. On win32 EPERM a directory junction is used instead
    // (a genuine directory link that realpathSync follows, so containment is
    // still exercised on the same path shape).
    const linked = makeVictim("linked.txt");
    mkdirSync(join(root, "shots"), { recursive: true });
    const parentLink = join(root, "shots", "escape-parent");
    try {
      symlinkSync(victimDir, parentLink, "dir");
    } catch (error) {
      if (isWin32Eperm(error)) symlinkSync(victimDir, parentLink, "junction");
      else throw error;
    }
    const subDir = join(root, "shots", "subdir");
    mkdirSync(subDir);
    writeFileSync(join(subDir, "keep.txt"), "keep");

    await seedSession("safety_links");
    assertBackendShape(jsonFallback);
    corruptShotPath("safety_links", join(parentLink, "linked.txt"));
    const first = await callTool("pinar.delete_session", { sessionId: "safety_links" });
    assert.equal(first.isError, false, first.text);
    assert.equal(readFileSync(linked, "utf8"), VICTIM_CONTENT, "a symlinked parent escaping the root must not be removed");

    await seedSession("safety_rootdir");
    corruptShotPath("safety_rootdir", join(root, "shots"));
    const third = await callTool("pinar.delete_session", { sessionId: "safety_rootdir" });
    assert.equal(third.isError, false, third.text);
    assert.ok(existsSync(join(root, "shots")), "the shots root itself must survive");

    await seedSession("safety_subdir");
    corruptShotPath("safety_subdir", subDir);
    const fourth = await callTool("pinar.delete_session", { sessionId: "safety_subdir" });
    assert.equal(fourth.isError, false, fourth.text);
    assert.ok(existsSync(join(subDir, "keep.txt")), "a directory shotPath must never be removed recursively");

    assert.deepEqual(sessionIds(parse((await callTool("pinar.list_sessions", {})).text)), [], "every corrupted session must be deleted");
  });

  test("a file symlink escaping the shots root is skipped, never removed", async (t) => {
    const fileLink = makeVictim("file-link-target.txt");
    const fileLinkCandidate = join(root, "shots", "escape-file.png");
    mkdirSync(join(root, "shots"), { recursive: true });
    try {
      symlinkSync(fileLink, fileLinkCandidate, "file");
    } catch (error) {
      if (isWin32Eperm(error)) {
        t.skip("file symlinks are not permitted on this Windows host (EPERM); file-symlink containment coverage not exercised");
        return;
      }
      throw error;
    }
    await seedSession("safety_filelink");
    corruptShotPath("safety_filelink", fileLinkCandidate);
    const second = await callTool("pinar.delete_session", { sessionId: "safety_filelink" });
    assert.equal(second.isError, false, second.text);
    assert.equal(readFileSync(fileLink, "utf8"), VICTIM_CONTENT, "a symlink pointing outside the root must not be removed");
    assert.deepEqual(sessionIds(parse((await callTool("pinar.list_sessions", {})).text)), [], "the corrupted session must be deleted");
  });

  test("an own-canonical file symlink to an external file is skipped (MCP and REST)", async (t) => {
    // The session's own canonical file name pointing outside the root: with a
    // real file symlink the ownership check passes because the canonical path
    // resolves to the same external target, so only the containment guard
    // protects the file (review 173240 P3-1). The shot upload writes through
    // a link at the canonical path, so the fixture link can only be created
    // after the upload; the probe below therefore runs before any session is
    // seeded, and on win32 EPERM the test skips instead of substituting a
    // junction or a direct path.
    const ownMcpVictim = makeVictim("own-canonical-mcp.txt");
    const ownMcpLink = join(root, "shots", "safety_ownlink_mcp.png");
    mkdirSync(join(root, "shots"), { recursive: true });
    try {
      symlinkSync(ownMcpVictim, ownMcpLink, "file");
    } catch (error) {
      if (isWin32Eperm(error)) {
        t.skip("file symlinks are not permitted on this Windows host (EPERM); file-symlink containment coverage not exercised");
        return;
      }
      throw error;
    }
    rmSync(ownMcpLink);

    await seedSession("safety_ownlink_mcp");
    rmSync(ownMcpLink);
    symlinkSync(ownMcpVictim, ownMcpLink, "file");
    const ownMcp = await callTool("pinar.delete_session", { sessionId: "safety_ownlink_mcp" });
    assert.equal(ownMcp.isError, false, ownMcp.text);
    assert.equal((await request("/api/sessions/safety_ownlink_mcp")).status, 404, "the session row must still be deleted (MCP)");
    assert.equal(readFileSync(ownMcpVictim, "utf8"), VICTIM_CONTENT, "an own-canonical symlink to an external file must not be removed (MCP)");

    await seedSession("safety_ownlink_rest");
    const ownRestLink = join(root, "shots", "safety_ownlink_rest.png");
    const ownRestVictim = makeVictim("own-canonical-rest.txt");
    rmSync(ownRestLink);
    symlinkSync(ownRestVictim, ownRestLink, "file");
    const ownRest = await request("/api/history/safety_ownlink_rest", { method: "DELETE" });
    const ownRestText = await ownRest.text();
    assert.equal(ownRest.status, 200, `the REST delete must succeed: ${ownRestText}`);
    assert.equal((await request("/api/sessions/safety_ownlink_rest")).status, 404, "the session row must still be deleted (REST)");
    assert.equal(readFileSync(ownRestVictim, "utf8"), VICTIM_CONTENT, "an own-canonical symlink to an external file must not be removed (REST)");

    assert.deepEqual(sessionIds(parse((await callTool("pinar.list_sessions", {})).text)), [], "every corrupted session must be deleted");
  });

  test("corrupted pointers at another session's shot or a non-shot file never remove them", async () => {
    await seedSession("safety_owner_a");
    assertBackendShape(jsonFallback);
    await seedSession("safety_owner_b");
    const shotA = join(root, "shots", "safety_owner_a.png");
    const shotB = join(root, "shots", "safety_owner_b.png");
    assert.ok(existsSync(shotA));
    assert.ok(existsSync(shotB));
    const beforeA = readFileSync(shotA);
    const beforeB = readFileSync(shotB);
    const notes = join(root, "shots", "notes.txt");
    writeFileSync(notes, "scratch");

    // shotPath alone points at another session's screenshot (REST route)
    await seedSession("safety_borrow");
    corruptShotPath("safety_borrow", shotA);
    const rest = await request("/api/history/safety_borrow", { method: "DELETE" });
    const restText = await rest.text();
    assert.equal(rest.status, 200, `REST delete must succeed: ${restText}`);
    assert.deepEqual(JSON.parse(restText), { deleted: true, ok: true });
    assert.equal((await request("/api/sessions/safety_borrow")).status, 404, "the borrowed session row must be deleted");
    assert.deepEqual(readFileSync(shotA), beforeA, "the other session's screenshot must stay byte-identical (REST)");

    // forged shotId + shotPath: the strongest corruption still must not win,
    // because the real owner session references the same file (MCP tool)
    await seedSession("safety_borrow2");
    corruptShotPath("safety_borrow2", shotB, "safety_owner_b");
    const mcp = await callTool("pinar.delete_session", { sessionId: "safety_borrow2" });
    assert.equal(mcp.isError, false, mcp.text);
    assert.deepEqual(parse(mcp.text), { deleted: true, ok: true });
    assert.equal((await request("/api/sessions/safety_borrow2")).status, 404, "the borrowed session row must be deleted");
    assert.deepEqual(readFileSync(shotB), beforeB, "the shared screenshot must stay byte-identical (MCP, forged identity)");

    // a non-shot file inside the same shots root is never a canonical shot
    await seedSession("safety_borrow3");
    corruptShotPath("safety_borrow3", notes);
    const mcpNotes = await callTool("pinar.delete_session", { sessionId: "safety_borrow3" });
    assert.equal(mcpNotes.isError, false, mcpNotes.text);
    assert.equal(readFileSync(notes, "utf8"), "scratch", "the non-shot file must stay byte-identical");

    // the owners' own unshared shots are still cleaned up by their own delete
    const ownerA = await callTool("pinar.delete_session", { sessionId: "safety_owner_a" });
    assert.equal(ownerA.isError, false, ownerA.text);
    assert.ok(!existsSync(shotA), "the owner's own shot must be removed once unshared");
    const ownerB = await callTool("pinar.delete_session", { sessionId: "safety_owner_b" });
    assert.equal(ownerB.isError, false, ownerB.text);
    assert.ok(!existsSync(shotB), "the owner's own shot must be removed once unshared");
    assert.equal(readFileSync(notes, "utf8"), "scratch", "the non-shot file must survive every delete");
    assert.deepEqual(sessionIds(parse((await callTool("pinar.list_sessions", {})).text)), [], "every session must be gone");
  });

  test("a legitimate screenshot is removed and unrelated shots stay untouched", async () => {
    await seedSession("safety_legit_a");
    await seedSession("safety_legit_b");
    const shotA = join(root, "shots", "safety_legit_a.png");
    const shotB = join(root, "shots", "safety_legit_b.png");
    assert.ok(existsSync(shotA));
    assert.ok(existsSync(shotB));

    const deleted = await callTool("pinar.delete_session", { sessionId: "safety_legit_a" });
    assert.equal(deleted.isError, false, deleted.text);
    assert.ok(!existsSync(shotA), "the deleted session's shot must be removed");
    assert.ok(existsSync(shotB), "the other session's shot must stay untouched");
    assert.deepEqual((await listSessions()).map((session) => session.id), ["safety_legit_b"]);
  });

  test("metadata-only, missing-file, and relative shotPaths still delete cleanly", async () => {
    const metadata = await request("/api/history", {
      body: JSON.stringify({
        id: "safety_meta",
        page: { title: "meta", url: "https://example.test/meta" },
        pins: [{ comment: "n", kind: "element", pinId: "pin_one" }],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(metadata.status, 201, `a metadata-only session must save: ${await metadata.text()}`);
    assertBackendShape(jsonFallback);
    const meta = await callTool("pinar.delete_session", { sessionId: "safety_meta" });
    assert.equal(meta.isError, false, "a metadata-only session must stay deletable");
    assert.deepEqual(parse(meta.text), { deleted: true, ok: true });

    await seedSession("safety_missing");
    corruptShotPath("safety_missing", join(root, "shots", "never_written.png"));
    const missing = await callTool("pinar.delete_session", { sessionId: "safety_missing" });
    assert.equal(missing.isError, false, "a missing in-root shot file must not block the delete");

    await seedSession("safety_rel");
    corruptShotPath("safety_rel", "shots/relative-escape.png");
    const rel = await callTool("pinar.delete_session", { sessionId: "safety_rel" });
    assert.equal(rel.isError, false, "a relative shotPath must not break the delete");
    assert.equal((await request("/api/sessions/safety_rel")).status, 404, "the session row must still be deleted");
    assert.deepEqual(sessionIds(parse((await callTool("pinar.list_sessions", {})).text)), [], "every session must be gone");

    assert.equal(isUsableSessionShotPath("shots/relative-escape.png", "safety_rel"), false, "a relative path outside the root must be rejected");
    assert.equal(isUsableSessionShotPath("../escape.png", "safety_rel"), false, "parent traversal must be rejected");
    assert.equal(isUsableSessionShotPath(join(root, "shots"), "safety_rel"), false, "the shots root itself is not a usable shot path");
    assert.equal(isUsableSessionShotPath(join(root, "shots", "fresh.png"), "fresh"), true, "a fresh canonical path must be accepted");
    assert.equal(isUsableSessionShotPath(join(root, "shots", "fresh.png"), "other"), false, "a canonical path of another identity must be rejected");
  });
}

function batchCrudTests(jsonFallback: boolean) {
  test("create_batch and rename_batch keep the batch id, timestamps, and sessions stable", async () => {
    // A controlled clock in small steps (two minutes apart, so the cached
    // MCP transport session never crosses its 30-minute idle expiry) makes
    // startedAt and finishedAt exact values: a rename that rewrites
    // startedAt can no longer slip past the assertions on wall-clock
    // latency between operations (review 174647 P3-1).
    const T0 = "2026-01-10T10:00:00.000Z";
    const T1 = "2026-01-10T10:02:00.000Z";
    const T2 = "2026-01-10T10:04:00.000Z";
    const T3 = "2026-01-10T10:06:00.000Z";
    setSystemTime(new Date(T0));
    try {
      const created = await callTool("pinar.create_batch", { label: "  First label  " });
      assert.equal(created.isError, false, created.text);
      assertBackendShape(jsonFallback);
      const createdBody = parse(created.text);
      assert.equal(createdBody.ok, true);
      const batch = createdBody.batch as Record<string, unknown>;
      const batchId = String(batch.id);
      assert.ok(batchId.length >= 8, "the id must be server-generated");
      assert.equal(batch.label, "First label", "the label must be trimmed");
      assert.equal(batch.finishedAt, null);
      assert.equal(batch.sessionCount, 0);
      assert.equal(batch.startedAt, T0, "startedAt is the controlled clock at creation");

      const listed = (parse((await callTool("pinar.list_batches", {})).text).batches as Array<Record<string, unknown>>);
      assert.deepEqual(listed.map((item) => item.id), [batchId]);
      assert.equal(listed[0].label, "First label");
      const markdown = await callTool("pinar.get_batch_markdown", { batchId });
      assert.equal(markdown.isError, false, markdown.text);
      assert.ok(markdown.text.includes("First label"), "the markdown must show the label");

      await seedSession("crud_batch_member", { batch: { id: batchId, label: "First label" } });
      const afterMember = (parse((await callTool("pinar.list_batches", {})).text).batches as Array<Record<string, unknown>>)[0];
      assert.equal(afterMember.sessionCount, 1);

      setSystemTime(new Date(T1));
      const renamed = await callTool("pinar.rename_batch", { batchId, label: "Second label" });
      assert.equal(renamed.isError, false, renamed.text);
      const renamedBody = parse(renamed.text);
      assert.equal(renamedBody.ok, true);
      assert.deepEqual(renamedBody.batch, { ...batch, label: "Second label", sessionCount: 1 }, "rename preserves id and startedAt");
      assert.equal(renamedBody.batch.startedAt, T0, "rename must not restamp startedAt");
      const renamedMarkdown = await callTool("pinar.get_batch_markdown", { batchId });
      assert.equal(renamedMarkdown.isError, false, renamedMarkdown.text);
      assert.ok(renamedMarkdown.text.includes("Second label"), "the markdown must show the renamed label");

      setSystemTime(new Date(T2));
      const finished = await callTool("pinar.finish_batch", { batchId });
      assert.equal(finished.isError, false, finished.text);
      const finishedAt = String((parse(finished.text).batch as Record<string, unknown>).finishedAt);
      assert.equal(finishedAt, T2, "finishedAt is the controlled clock at finish");

      setSystemTime(new Date(T3));
      const renamedAgain = await callTool("pinar.rename_batch", { batchId, label: "Third label" });
      assert.equal(renamedAgain.isError, false, renamedAgain.text);
      assert.deepEqual(
        parse(renamedAgain.text).batch,
        { ...batch, finishedAt: T2, label: "Third label", sessionCount: 1 },
        "renaming a finished batch preserves id, startedAt, and finishedAt",
      );

      if (jsonFallback) {
        assert.ok(readFileSync(join(root, "history.json"), "utf8").includes(batchId), "the batch must live in the real history.json");
      }

      const deleted = await callTool("pinar.delete_batch", { batchId });
      assert.equal(deleted.isError, false, deleted.text);
      assert.deepEqual(parse(deleted.text), { deleted: true, ok: true });
      const sessions = await listSessions();
      assert.deepEqual(sessions.map((session) => session.id), ["crud_batch_member"]);
      assert.equal(sessions[0].batchId, null, "the member session must keep its capture with the batch detached");
      assert.deepEqual((parse((await callTool("pinar.list_batches", {})).text).batches as unknown[]).length, 0);
    } finally {
      setSystemTime(undefined);
      resetMcpSession();
    }
  });

  test("create_batch and rename_batch reject invalid input and unknown batches without mutation", async () => {
    const seed = await callTool("pinar.create_batch", { label: "Kept label" });
    assert.equal(seed.isError, false, seed.text);
    const keptId = String((parse(seed.text).batch as Record<string, unknown>).id);

    const missing = await callTool("pinar.create_batch", {});
    assert.equal(missing.isError, true);
    assert.match(String(missing.text), /Input validation error/);
    const oversized = await callTool("pinar.create_batch", { label: "x".repeat(300) });
    assert.equal(oversized.isError, true);
    assert.match(String(oversized.text), /Input validation error/);
    const blank = await callTool("pinar.create_batch", { label: "   " });
    assert.equal(blank.isError, true);
    assert.equal(blank.text, "label is invalid");
    const control = await callTool("pinar.create_batch", { label: "bad\u0000label" });
    assert.equal(control.isError, true);
    const hostileRename = await callTool("pinar.rename_batch", { batchId: keptId, label: "x".repeat(300) });
    assert.equal(hostileRename.isError, true);
    assert.match(String(hostileRename.text), /Input validation error/);
    const missingRename = await callTool("pinar.rename_batch", { batchId: "nope", label: "Gone" });
    assert.equal(missingRename.isError, true);
    assert.equal(missingRename.text, "Batch not found");
    const missingLabel = await callTool("pinar.rename_batch", { batchId: keptId });
    assert.equal(missingLabel.isError, true);
    assert.match(String(missingLabel.text), /Input validation error/);

    // Caller-forged identity/timestamp extras are rejected (not silently
    // ignored) before any write: the id and startedAt/finishedAt are
    // server-owned.
    const forgedCreate = await callTool("pinar.create_batch", {
      finishedAt: "2020-01-01T00:00:00.000Z",
      id: "caller_chosen",
      label: "Forged",
      startedAt: "2020-01-01T00:00:00.000Z",
    });
    assert.equal(forgedCreate.isError, true);
    assert.equal(forgedCreate.text, "Unexpected argument");
    const forgedRename = await callTool("pinar.rename_batch", {
      batchId: keptId,
      finishedAt: "2020-01-01T00:00:00.000Z",
      id: "caller_chosen",
      label: "Forged",
      startedAt: "2020-01-01T00:00:00.000Z",
    });
    assert.equal(forgedRename.isError, true);
    assert.equal(forgedRename.text, "Unexpected argument");

    const listed = parse((await callTool("pinar.list_batches", {})).text).batches as Array<Record<string, unknown>>;
    assert.deepEqual(listed.map((item) => item.id), [keptId], "no batch may be created or removed by invalid input");
    assert.equal(listed[0].label, "Kept label", "no rename may happen on invalid input");
  });

  test("hostile Origin is denied for the batch tools without mutation", async () => {
    const created = await callTool("pinar.create_batch", { label: "Origin kept" });
    assert.equal(created.isError, false, created.text);
    const batchId = String((parse(created.text).batch as Record<string, unknown>).id);
    for (const [name, args] of [
      ["pinar.create_batch", { label: "evil" }],
      ["pinar.rename_batch", { batchId, label: "evil" }],
    ] as const) {
      const hostile = await callTool(name, { ...args }, { headers: { Origin: "https://evil.example" } });
      assert.ok(hostile.response.status === 403 || hostile.response.status === 401, `${name} status ${hostile.response.status}`);
    }
    const listed = parse((await callTool("pinar.list_batches", {})).text).batches as Array<Record<string, unknown>>;
    assert.deepEqual(listed.map((item) => item.id), [batchId]);
    assert.equal(listed[0].label, "Origin kept", "a hostile Origin must not create or rename");
  });
}

async function restSession(id: string): Promise<Record<string, unknown>> {
  const { body, response } = await requestJson(`/api/sessions/${id}`);
  assert.equal(response.status, 200, `session ${id} must exist: ${response.status}`);
  return body.session as Record<string, unknown>;
}

function sessionCrudTests(jsonFallback: boolean) {
  test("create_session and update_session complete a metadata-only lifecycle with preserved immutables", async () => {
    const { inboxId } = await defaultContainers();
    const project = await callTool("pinar.create_project", { name: "Session work" });
    assert.equal(project.isError, false, project.text);
    const projectId = String(parse(project.text).project.id);
    const collection = await callTool("pinar.create_collection", { name: "Session specs", projectId });
    assert.equal(collection.isError, false, collection.text);
    const collectionId = String(parse(collection.text).collection.id);
    const batch = await callTool("pinar.create_batch", { label: "Session batch" });
    assert.equal(batch.isError, false, batch.text);
    const batchId = String(parse(batch.text).batch.id);
    assertBackendShape(jsonFallback);

    // An omitted destination lands in the protected default Inbox; the
    // session is metadata only: server-generated id/createdAt, no pins and no
    // screenshot file, and no shot URL is presented for the absent image.
    const defaulted = await callTool("pinar.create_session", {
      page: { title: "Default session", url: "https://example.test/default" },
    });
    assert.equal(defaulted.isError, false, defaulted.text);
    const defaultBody = parse(defaulted.text);
    assert.equal(defaultBody.ok, true);
    const defaultedSession = defaultBody.session as Record<string, unknown>;
    const defaultedId = String(defaultedSession.id);
    assert.ok(defaultedId.length >= 8, "the id must be server-generated");
    assert.equal(defaultedSession.collectionId, inboxId, "an omitted destination lands in the protected default Inbox");
    assert.equal(defaultedSession.batchId, null);
    assert.equal(defaultedSession.pinCount, 0);
    assert.ok(ISO_TIMESTAMP.test(String(defaultedSession.createdAt)), `createdAt ${defaultedSession.createdAt} must be an ISO timestamp`);
    assert.ok(!existsSync(join(root, "shots", `${defaultedId}.png`)), "a metadata-only session creates no screenshot file");
    const defaultedRow = await restSession(defaultedId);
    assert.equal(defaultedRow.includeScreenshot, false, "an agent-created session is metadata only");
    assert.equal(defaultedRow.shotPath, null);
    assert.equal(defaultedRow.shotId, null);
    assert.equal(defaultedRow.shotUrl, null, "no shot URL is presented for an absent image");
    const defaultedMarkdown = await callTool("pinar.get_session_markdown", { sessionId: defaultedId });
    assert.equal(defaultedMarkdown.isError, false, defaultedMarkdown.text);
    assert.match(defaultedMarkdown.text, /Default session/);
    assert.doesNotMatch(defaultedMarkdown.text, /Screenshot:/, "no Screenshot line for an absent image");

    // An explicit existing collection and batch are honored; the URL is
    // sanitized and only the sanitized URL plus redacted categories are
    // stored.
    const created = await callTool("pinar.create_session", {
      batchId,
      collectionId,
      page: { description: "Agent note", title: "Agent session", url: "https://example.test/agent?token=agenttoken123" },
    });
    assert.equal(created.isError, false, created.text);
    const sessionId = String((parse(created.text).session as Record<string, unknown>).id);
    const row = await restSession(sessionId);
    assert.equal(row.collectionId, collectionId);
    assert.equal(row.batchId, batchId);
    assert.equal(decodeURIComponent(String(row.page.url)), "https://example.test/agent?token=[redacted]", "only the sanitized URL is stored");
    assert.deepEqual(row.privacy, { redacted: ["secret-query", "unevaluated"], unevaluated: true });
    assert.equal(row.includeScreenshot, false);
    assert.ok(row.pins.length === 0, "no pins are accepted from the caller");
    assert.ok(!JSON.stringify(row).includes("agenttoken123"), "secret values are never stored");
    assert.ok(!existsSync(join(root, "shots", `${sessionId}.png`)), "a metadata-only session creates no screenshot file");
    const createdMarkdown = await callTool("pinar.get_session_markdown", { sessionId });
    assert.equal(createdMarkdown.isError, false, createdMarkdown.text);
    assert.match(createdMarkdown.text, /Agent note/);
    assert.doesNotMatch(createdMarkdown.text, /Screenshot:/, "no Screenshot line for an absent image");

    // Partial update: title, a clean URL, and a reproduction. The stored
    // privacy categories survive the URL change (merge, not replace) and the
    // new URL contributes no new category.
    const reproduction = { startedAt: "2026-09-26T12:00:00.000Z", steps: [{ at: "2026-09-26T12:00:00.000Z", kind: "navigate", url: "https://example.test/agent" }], version: 1 };
    const updated = await callTool("pinar.update_session", {
      page: { title: "Agent session v2", url: "https://example.test/agent" },
      reproduction,
      sessionId,
    });
    assert.equal(updated.isError, false, updated.text);
    const updatedRow = await restSession(sessionId);
    assert.equal(updatedRow.page.title, "Agent session v2");
    assert.equal(updatedRow.page.url, "https://example.test/agent");
    assert.deepEqual(updatedRow.privacy, { redacted: ["secret-query", "unevaluated"], unevaluated: true }, "the stored privacy report is preserved across the URL change");
    assert.deepEqual(updatedRow.reproduction, reproduction, "the reproduction is persisted through the shared validator");

    // A title-only update keeps the privacy report untouched.
    const titleOnly = await callTool("pinar.update_session", { page: { title: "Agent session v3" }, sessionId });
    assert.equal(titleOnly.isError, false, titleOnly.text);
    const titleOnlyRow = await restSession(sessionId);
    assert.equal(titleOnlyRow.page.title, "Agent session v3");
    assert.deepEqual(titleOnlyRow.privacy, { redacted: ["secret-query", "unevaluated"], unevaluated: true });

    // An explicit "" clears the description; its absence preserves it.
    const cleared = await callTool("pinar.update_session", { page: { description: "" }, sessionId });
    assert.equal(cleared.isError, false, "an explicit empty description is a change, not a no-op");
    const clearedMarkdown = await callTool("pinar.get_session_markdown", { sessionId });
    assert.doesNotMatch(clearedMarkdown.text, /Agent note/);
    assert.equal((await listSessions({ query: "Agent note" })).length, 0, "the cleared description is no longer searchable");
    const restored = await callTool("pinar.update_session", { page: { description: "Keep me" }, sessionId });
    assert.equal(restored.isError, false, restored.text);
    const kept = await callTool("pinar.update_session", { page: { title: "Agent session v4" }, sessionId });
    assert.equal(kept.isError, false, kept.text);
    const keptMarkdown = await callTool("pinar.get_session_markdown", { sessionId });
    assert.match(keptMarkdown.text, /Keep me/);
    assert.equal((await restSession(sessionId)).page.title, "Agent session v4");

    // An explicit null clears the reproduction.
    const reproductionCleared = await callTool("pinar.update_session", { reproduction: null, sessionId });
    assert.equal(reproductionCleared.isError, false, reproductionCleared.text);
    const reproductionRow = await restSession(sessionId);
    assert.equal(reproductionRow.reproduction, undefined, "reproduction: null clears the stored reproduction");

    // A hostile Origin is denied for both tools without mutation.
    const beforeHostile = await restSession(sessionId);
    const hostileCreate = await callTool("pinar.create_session", {
      page: { title: "Hostile create", url: "https://example.test/hostile" },
    }, { headers: { Origin: "https://evil.example" } });
    assert.ok(hostileCreate.response.status === 401 || hostileCreate.response.status === 403, `create status ${hostileCreate.response.status}`);
    const hostileUpdate = await callTool("pinar.update_session", { page: { title: "Hostile" }, sessionId }, { headers: { Origin: "https://evil.example" } });
    assert.ok(hostileUpdate.response.status === 401 || hostileUpdate.response.status === 403, `update status ${hostileUpdate.response.status}`);
    assert.deepEqual(await restSession(sessionId), beforeHostile, "a hostile Origin must not create or update");

    if (jsonFallback) {
      assert.ok(readFileSync(join(root, "history.json"), "utf8").includes(sessionId), "the session must live in the real history.json");
    }

    const deleted = await callTool("pinar.delete_session", { sessionId });
    assert.equal(deleted.isError, false, deleted.text);
    assert.deepEqual(parse(deleted.text), { deleted: true, ok: true });
    assert.equal((await request(`/api/sessions/${sessionId}`)).status, 404);
    const missingMarkdown = await callTool("pinar.get_session_markdown", { sessionId });
    assert.equal(missingMarkdown.text, "Session not found");
    const deletedDefaulted = await callTool("pinar.delete_session", { sessionId: defaultedId });
    assert.equal(deletedDefaulted.isError, false, deletedDefaulted.text);
  });

  test("create_session and update_session reject unknown destinations, invalid inputs, and empty changes without writes", async () => {
    const page = { title: "Reject host", url: "https://example.test/reject" };

    // Unknown explicit destinations reject before any write: there is no
    // silent Inbox fallback for a named-but-missing destination.
    const unknownCollection = await callTool("pinar.create_session", { collectionId: "nope", page });
    assert.equal(unknownCollection.isError, true);
    assert.equal(unknownCollection.text, "Collection not found");
    const unknownBatch = await callTool("pinar.create_session", { batchId: "nope", page });
    assert.equal(unknownBatch.isError, true);
    assert.equal(unknownBatch.text, "Batch not found");
    assert.equal((await listSessions({ query: "Reject host" })).length, 0, "no session may be created by an unknown destination");

    // Hostile and out-of-bounds page variants are rejected without writes.
    const missingPage = await callTool("pinar.create_session", {});
    assert.match(String(missingPage.text), /Input validation error.*required property 'page'/);
    const missingTitle = await callTool("pinar.create_session", { page: { url: page.url } });
    assert.match(String(missingTitle.text), /Input validation error/);
    const missingUrl = await callTool("pinar.create_session", { page: { title: page.title } });
    assert.match(String(missingUrl.text), /Input validation error/);
    const nonStringTitle = await callTool("pinar.create_session", { page: { title: 42, url: page.url } });
    assert.match(String(nonStringTitle.text), /Input validation error/);
    const blankTitle = await callTool("pinar.create_session", { page: { title: "   ", url: page.url } });
    assert.equal(blankTitle.text, "title is invalid");
    const controlTitle = await callTool("pinar.create_session", { page: { title: "bad\u0000title", url: page.url } });
    assert.equal(controlTitle.text, "title is invalid");
    const oversizedTitle = await callTool("pinar.create_session", { page: { title: "x".repeat(2001), url: page.url } });
    assert.match(String(oversizedTitle.text), /Input validation error/);
    const oversizedDescription = await callTool("pinar.create_session", { page: { description: "x".repeat(2001), title: page.title, url: page.url } });
    assert.match(String(oversizedDescription.text), /Input validation error/);
    for (const badUrl of ["not a url", "ftp://example.test/", "http://user:pass@example.test/"]) {
      const bad = await callTool("pinar.create_session", { page: { title: page.title, url: badUrl } });
      assert.equal(bad.text, "page.url is invalid", `url ${badUrl} must be rejected`);
    }
    const forgedId = await callTool("pinar.create_session", { id: "caller_chosen", page });
    assert.equal(forgedId.text, "Unexpected argument", "no caller-selected id is accepted");
    const forgedPageKey = await callTool("pinar.create_session", { page: { shotPath: "x", title: page.title, url: page.url } });
    assert.equal(forgedPageKey.text, "Unexpected argument", "no arbitrary page field (shotPath/image/bytes/pins) is accepted");

    // A real session exists for the no-write assertions on update_session.
    await seedSession("reject_host_session");
    const before = await restSession("reject_host_session");
    const missing = await callTool("pinar.update_session", { page: { title: "x" }, sessionId: "nope" });
    assert.equal(missing.text, "Session not found");
    const emptyPage = await callTool("pinar.update_session", { page: {}, sessionId: "reject_host_session" });
    assert.equal(emptyPage.text, "No changes provided");
    const noChanges = await callTool("pinar.update_session", { sessionId: "reject_host_session" });
    assert.equal(noChanges.text, "No changes provided");
    const unexpectedArg = await callTool("pinar.update_session", { position: 5, sessionId: "reject_host_session" });
    assert.equal(unexpectedArg.text, "Unexpected argument");
    const badPageKey = await callTool("pinar.update_session", { page: { shotPath: "x" }, sessionId: "reject_host_session" });
    assert.equal(badPageKey.text, "page is invalid");
    const nonStringDescription = await callTool("pinar.update_session", { page: { description: 42, title: "x" }, sessionId: "reject_host_session" });
    assert.match(String(nonStringDescription.text), /Input validation error/, "the schema rejects a non-string description before the dispatcher");
    const controlDescription = await callTool("pinar.update_session", { page: { description: "bad\u0000control", title: "x" }, sessionId: "reject_host_session" });
    assert.equal(controlDescription.text, "description is invalid");
    const oversizedDescriptionUpdate = await callTool("pinar.update_session", { page: { description: "x".repeat(2001), title: "x" }, sessionId: "reject_host_session" });
    assert.match(String(oversizedDescriptionUpdate.text), /Input validation error/);
    const badUrl = await callTool("pinar.update_session", { page: { url: "not a url" }, sessionId: "reject_host_session" });
    assert.equal(badUrl.text, "page.url is invalid");
    const badReproductionVersion = await callTool("pinar.update_session", { reproduction: { steps: [{ at: "2026-09-26T12:00:00.000Z", kind: "navigate" }], version: 9 }, sessionId: "reject_host_session" });
    assert.equal(badReproductionVersion.text, "reproduction is invalid", "the shared validator rejects a wrong version");
    const badReproductionSteps = await callTool("pinar.update_session", { reproduction: { steps: [], version: 1 }, sessionId: "reject_host_session" });
    assert.equal(badReproductionSteps.text, "reproduction is invalid", "the shared validator rejects empty steps");
    const badReproductionKind = await callTool("pinar.update_session", { reproduction: { steps: [{ at: "2026-09-26T12:00:00.000Z", kind: "explode" }], version: 1 }, sessionId: "reject_host_session" });
    assert.equal(badReproductionKind.text, "reproduction is invalid", "the shared validator rejects an unknown step kind");

    // An explicit "" title is invalid input, not an omission: the
    // accompanying valid description must not be written either.
    const emptyTitle = await callTool("pinar.update_session", { page: { description: "Should not land", title: "" }, sessionId: "reject_host_session" });
    assert.equal(emptyTitle.isError, true);
    assert.equal(emptyTitle.text, "title is invalid");
    // An explicit empty destination is invalid input, not an omission: only
    // an omitted destination may fall back to the default Inbox.
    const emptyCollection = await callTool("pinar.create_session", { collectionId: "", page });
    assert.equal(emptyCollection.isError, true);
    assert.equal(emptyCollection.text, "collectionId is invalid");
    const emptyBatch = await callTool("pinar.create_session", { batchId: "", page });
    assert.equal(emptyBatch.isError, true);
    assert.equal(emptyBatch.text, "batchId is invalid");

    assert.deepEqual(await restSession("reject_host_session"), before, "no rejected input may write the session");
    assert.equal((await listSessions({ query: "Reject host" })).length, 0, "no create may have written a session");
  });

  test("update_session on a measured session preserves createdAt, position, batch, pins, and the screenshot across a clock advance", async () => {
    // Controlled clock: the ingest happens at T0 and the update at T1, so a
    // mutation that restamps created_at, resets position, or detaches the
    // batch on update is caught deterministically instead of relying on
    // wall-clock latency.
    const T0 = "2026-01-10T11:00:00.000Z";
    const T1 = "2026-01-10T11:10:00.000Z";
    setSystemTime(new Date(T0));
    try {
      const project = await callTool("pinar.create_project", { name: "Measured work" });
      assert.equal(project.isError, false, project.text);
      const projectId = String(parse(project.text).project.id);
      const collection = await callTool("pinar.create_collection", { name: "Measured specs", projectId });
      assert.equal(collection.isError, false, collection.text);
      const collectionId = String(parse(collection.text).collection.id);
      const batch = await callTool("pinar.create_batch", { label: "Measured batch" });
      assert.equal(batch.isError, false, batch.text);
      const batchId = String(parse(batch.text).batch.id);
      assertBackendShape(jsonFallback);

      // A measured session: real screenshot, pins, position != 0 (a second
      // member of the collection), and a non-null batch.
      await seedSession("measured_first", { batch: { id: batchId, label: "Measured batch" }, collectionId });
      await seedSession("measured_session", { batch: { id: batchId, label: "Measured batch" }, collectionId, pins: [{ comment: "Measured note", kind: "element", pinId: "measured_pin" }] });
      const before = await restSession("measured_session");
      assert.equal(before.createdAt, T0);
      assert.equal(before.position, 1, "the measured session is the second member of the collection (0-indexed)");
      assert.equal(before.batchId, batchId);
      assert.ok(JSON.stringify(before.pins).includes("Measured note"));
      const shotPath = String(before.shotPath);
      assert.ok(existsSync(shotPath), "the measured session has a real screenshot file");
      assert.equal(before.shotUrl, `http://127.0.0.1:17373/shots/measured_session.png`, "the real captured PNG still gets a shot URL");
      const served = await handlePublicRequest(new Request("http://127.0.0.1:17373/shots/measured_session.png"));
      assert.equal(served.status, 200, "the old captured PNG is still served");

      setSystemTime(new Date(T1));
      const updated = await callTool("pinar.update_session", { page: { title: "Measured v2" }, sessionId: "measured_session" });
      assert.equal(updated.isError, false, updated.text);
      const after = await restSession("measured_session");
      assert.equal(after.page.title, "Measured v2");
      assert.equal(after.createdAt, T0, "the clock has advanced; created_at is not restamped");
      assert.equal(after.position, 1, "position is not reset");
      assert.equal(after.batchId, batchId, "batch membership survives the update");
      assert.equal(after.shotPath, shotPath, "the screenshot identity is preserved");
      assert.equal(after.includeScreenshot, before.includeScreenshot);
      assert.ok(JSON.stringify(after.pins).includes("Measured note"), "every existing pin is preserved");
      assert.ok(existsSync(shotPath), "the screenshot file is untouched");
    } finally {
      setSystemTime(undefined);
      resetMcpSession();
    }
  });
}

const PIN_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNMEASURED_PIN_FIELDS = ["anchor", "areaBox", "box", "coords", "documentAnchor", "documentBox", "geometry", "historicalAnchor", "historicalBox", "topBox"];

const AUDIT_DUMP_TABLES = ["sessions", "pin_reviews", "pin_review_events", "pin_comments", "agent_executions", "agent_pin_results", "batches", "collections", "projects"];

function auditTables(captureId: string): unknown {
  const db = new Database(join(root, "history.db"), { readonly: true });
  try {
    return JSON.stringify({
      executions: db.query("SELECT * FROM agent_executions WHERE capture_id = ? ORDER BY rowid").all(captureId),
      results: db.query("SELECT * FROM agent_pin_results ORDER BY rowid").all(),
    });
  } finally {
    db.close();
  }
}

function pinCrudTests(jsonFallback: boolean) {
  test("create_pin adds metadata-only note pins with server ids, next numbers, and a bounded projection", async () => {
    const created = await callTool("pinar.create_session", { page: { title: "Pin spec", url: "https://example.test/pins" } });
    assert.equal(created.isError, false, created.text);
    const sessionId = String(parse(created.text).session.id);
    assertBackendShape(jsonFallback);

    const first = await callTool("pinar.create_pin", {
      comment: "First agent note",
      locator: { cssSelector: "button.cta", domPath: "main > button.cta", innerText: "Buy" },
      sessionId,
    });
    assert.equal(first.isError, false, first.text);
    const firstBody = parse(first.text);
    assert.equal(firstBody.ok, true);
    assert.equal(firstBody.sessionId, sessionId);
    const firstPin = firstBody.pin as Record<string, unknown>;
    const firstId = String(firstPin.id);
    assert.match(firstId, PIN_UUID, "the pin id is a server-generated UUID");
    assert.deepEqual(Object.keys(firstPin).sort(), ["comment", "id", "location", "locator", "number", "reviewStatus"], "the projection is exactly the bounded fields");
    assert.equal(firstPin.comment, "First agent note");
    assert.deepEqual(firstPin.location, { confidence: "unresolved", evidence: [], score: 0, strategy: "none" }, "an agent note is explicitly unresolved, never measured geometry");
    assert.deepEqual(firstPin.locator, { cssSelector: "button.cta", domPath: "main > button.cta", innerText: "Buy" });
    assert.equal(firstPin.number, 1);
    assert.equal(firstPin.reviewStatus, "open");

    const second = await callTool("pinar.create_pin", { comment: "Text only", locator: { innerText: "Only text" }, sessionId });
    assert.equal(second.isError, false, second.text);
    const secondPin = parse(second.text).pin as Record<string, unknown>;
    const secondId = String(secondPin.id);
    assert.equal(secondPin.number, 2, "an innerText-only locator is allowed and takes the next number");
    assert.deepEqual(secondPin.locator, { cssSelector: null, domPath: null, innerText: "Only text" });

    const third = await callTool("pinar.create_pin", { comment: "Bare note", sessionId });
    assert.equal(third.isError, false, third.text);
    const thirdPin = parse(third.text).pin as Record<string, unknown>;
    const thirdId = String(thirdPin.id);
    assert.equal(thirdPin.number, 3, "an absent locator is allowed");
    assert.deepEqual(thirdPin.locator, { cssSelector: null, domPath: null, innerText: null });

    const listed = await callTool("pinar.list_pins", { sessionId });
    assert.equal(listed.isError, false, listed.text);
    const page = parse(listed.text);
    assert.equal(page.limit, 50);
    assert.equal(page.offset, 0);
    const listedPins = page.pins as Array<Record<string, unknown>>;
    assert.deepEqual(listedPins.map((pin) => pin.number), [1, 2, 3]);
    assert.deepEqual(listedPins.map((pin) => pin.id), [firstId, secondId, thirdId]);

    const got = await callTool("pinar.get_pin", { pinId: firstId, sessionId });
    assert.equal(got.isError, false, got.text);
    const gotBody = parse(got.text);
    assert.equal(gotBody.ok, true);
    assert.deepEqual(gotBody.pin, listedPins[0], "get_pin and list_pins project the same bounded fields");

    const row = await restSession(sessionId);
    assert.equal(row.pinCount, 3);

    // The real get_session_markdown carries the full context: the Markdown
    // has no Coordinates/Area lines for none-location pins and the full fence
    // JSON omits every unmeasured geometry field while keeping pin identity.
    const markdown = await callTool("pinar.get_session_markdown", { sessionId });
    assert.equal(markdown.isError, false, markdown.text);
    assert.equal(markdown.text.includes("Coordinates:"), false, "none-location pins have no Coordinates line");
    assert.equal(markdown.text.includes("Area:"), false, "none-location pins have no Area line");
    assert.equal((markdown.text.match(/Location: unresolved \(none\)/g) || []).length, 3);
    const fence = parseHandoffJson(markdown.text) as { pins: Array<Record<string, unknown>> } | null;
    assert.ok(fence, "the session markdown carries the full pinar-visual-context fence");
    assert.deepEqual((fence.pins).map((pin) => String(pin.pinId)), [firstId, secondId, thirdId], "pin ids stay stable in the full fence");
    for (const pin of fence.pins) {
      assert.equal(pin.location?.strategy, "none");
      for (const field of UNMEASURED_PIN_FIELDS) {
        assert.equal(field in pin, false, `the full fence must omit the unmeasured field ${field}`);
      }
    }
    assert.ok(!existsSync(join(root, "shots", `${sessionId}.png`)), "note pins create no screenshot file");
    if (jsonFallback) {
      const data = JSON.parse(readFileSync(join(root, "history.json"), "utf8")) as { sessions: Array<Record<string, unknown>> };
      const sessionRow = data.sessions.find((item) => item.id === sessionId);
      assert.ok(sessionRow, "history.json stores the session");
      assert.ok(String(sessionRow.pins_json).includes(firstId), "history.json stores the created pin");
    }
  });

  test("the pin lifecycle keeps a measured pin immutable through note, comment, review, and atomic delete", async () => {
    const batch = await callTool("pinar.create_batch", { label: "Pin lifecycle batch" });
    assert.equal(batch.isError, false, batch.text);
    const batchId = String(parse(batch.text).batch.id);
    await seedSession("pin_lifecycle", {
      batch: { id: batchId, label: "Pin lifecycle batch" },
      pins: [{ comment: "Measured note", kind: "element", pinId: "measured_pin", selector: "button.measured", coords: { x: 40, y: 80 }, box: { x: 24, y: 80, width: 160, height: 40 } }],
    });
    const before = await restSession("pin_lifecycle");
    assert.ok(existsSync(join(root, "shots", "pin_lifecycle.png")), "the seeded session is a real measured capture");
    assertBackendShape(jsonFallback);

    const created = await callTool("pinar.create_pin", { comment: "Agent note", sessionId: "pin_lifecycle" });
    assert.equal(created.isError, false, created.text);
    const agentPin = parse(created.text).pin as Record<string, unknown>;
    const agentId = String(agentPin.id);
    assert.equal(agentPin.number, 2, "the next number follows the stored pins");

    const comment = await addComment("pin_lifecycle", agentId, "agent comment");
    assert.ok(String(comment.id).length > 0);
    const concluded = await callTool("pinar.conclude_pin", { pinId: agentId, sessionId: "pin_lifecycle" });
    assert.equal(concluded.isError, false, concluded.text);
    const reviewed = await callTool("pinar.get_pin", { pinId: agentId, sessionId: "pin_lifecycle" });
    assert.equal((parse(reviewed.text).pin as Record<string, unknown>).reviewStatus, "accepted");

    const listed = await callTool("pinar.list_pins", { sessionId: "pin_lifecycle" });
    const pins = parse(listed.text).pins as Array<Record<string, unknown>>;
    assert.deepEqual(pins.map((pin) => pin.number), [1, 2]);
    assert.equal(pins[0].id, "measured_pin", "the measured pin keeps its id and number");
    assert.equal(pins[0].comment, "Measured note");

    const deleted = await callTool("pinar.delete_pin", { pinId: agentId, sessionId: "pin_lifecycle" });
    assert.equal(deleted.isError, false, deleted.text);

    const remaining = parse((await callTool("pinar.list_pins", { sessionId: "pin_lifecycle" })).text).pins as Array<Record<string, unknown>>;
    assert.equal(remaining.length, 1, "only the measured pin remains");
    assert.equal(remaining[0].id, "measured_pin");
    assert.equal(remaining[0].number, 1);

    const missing = await callTool("pinar.get_pin", { pinId: agentId, sessionId: "pin_lifecycle" });
    assert.equal(missing.isError, true);
    assert.equal(missing.text, "Pin not found");
    const commentsGone = await callTool("pinar.list_pin_comments", { pinId: agentId, sessionId: "pin_lifecycle" });
    assert.equal(commentsGone.isError, true);
    assert.equal(commentsGone.text, "Pin not found", "the removed pin's comment conversation is gone with the pin");
    const restAfterDelete = await requestJson("/api/sessions/pin_lifecycle");
    assert.deepEqual(restAfterDelete.body.comments, [], "the removed pin's comments do not survive as orphan rows");

    const after = await restSession("pin_lifecycle");
    assert.equal(after.pinCount, 1);
    assert.equal(after.createdAt, before.createdAt, "the session is not restamped");
    assert.equal(after.batchId, batchId, "batch membership survives the pin delete");
    assert.equal(after.position, before.position);
    assert.equal(after.shotPath, before.shotPath);
    assert.ok(existsSync(join(root, "shots", "pin_lifecycle.png")), "the measured image survives the pin delete");

    const markdown = await callTool("pinar.get_session_markdown", { sessionId: "pin_lifecycle" });
    assert.equal(markdown.isError, false, markdown.text);
    assert.ok(markdown.text.includes("Measured note"), "the remaining pin's note stays");
    assert.equal(markdown.text.includes("Agent note"), false, "the removed pin does not reappear in the markdown");
    assert.equal(markdown.text.includes("agent comment"), false, "the removed pin's comments do not reappear");
    assert.equal(markdown.text.includes("accepted"), false, "the removed pin's review does not reappear");
    if (jsonFallback) {
      const data = JSON.parse(readFileSync(join(root, "history.json"), "utf8")) as {
        pin_comments: Array<Record<string, unknown>>;
        pin_reviews: Array<Record<string, unknown>>;
        pin_review_events: Array<Record<string, unknown>>;
        sessions: Array<Record<string, unknown>>;
      };
      assert.equal(data.pin_comments.some((item) => item.pin_id === agentId), false, "the removed pin's comments are gone from history.json");
      assert.equal(data.pin_reviews.some((item) => item.pin_id === agentId), false, "the removed pin's review is gone from history.json");
      assert.equal(data.pin_review_events.some((item) => item.pin_id === agentId), false, "the removed pin's review events are gone from history.json");
      const sessionRow = data.sessions.find((session) => session.id === "pin_lifecycle");
      assert.ok(sessionRow && !String(sessionRow.pins_json).includes(agentId), "the removed pin is gone from the stored pins");
    }
  });

  test("a legacy captureId:pN pin keeps its full note, comment, and review lifecycle", async () => {
    await seedSession("legacy_cap", { pins: [{ comment: "Legacy note", kind: "element", pinId: "legacy_cap:p1" }] });
    assertBackendShape(jsonFallback);

    const got = await callTool("pinar.get_pin", { pinId: "legacy_cap:p1", sessionId: "legacy_cap" });
    assert.equal(got.isError, false, got.text);
    const legacyPin = parse(got.text).pin as Record<string, unknown>;
    assert.equal(legacyPin.id, "legacy_cap:p1", "the legacy pin id is preserved, not renamed");
    assert.equal(legacyPin.number, 1);
    assert.equal(legacyPin.comment, "Legacy note");

    const edited = await callTool("pinar.edit_pin_note", { comment: "Edited legacy note", pinId: "legacy_cap:p1", sessionId: "legacy_cap" });
    assert.equal(edited.isError, false, edited.text);
    const reGot = await callTool("pinar.get_pin", { pinId: "legacy_cap:p1", sessionId: "legacy_cap" });
    assert.equal((parse(reGot.text).pin as Record<string, unknown>).comment, "Edited legacy note");

    const added = await addComment("legacy_cap", "legacy_cap:p1", "legacy comment");
    assert.deepEqual(await commentBodies("legacy_cap", "legacy_cap:p1"), ["legacy comment"]);
    assert.ok(String(added.id).length > 0);

    const concluded = await callTool("pinar.conclude_pin", { pinId: "legacy_cap:p1", sessionId: "legacy_cap" });
    assert.equal(concluded.isError, false, concluded.text);
    const accepted = await callTool("pinar.get_pin", { pinId: "legacy_cap:p1", sessionId: "legacy_cap" });
    assert.equal((parse(accepted.text).pin as Record<string, unknown>).reviewStatus, "accepted");
    const reopened = await callTool("pinar.reopen_pin", { pinId: "legacy_cap:p1", sessionId: "legacy_cap" });
    assert.equal(reopened.isError, false, reopened.text);
    const reopenedPin = await callTool("pinar.get_pin", { pinId: "legacy_cap:p1", sessionId: "legacy_cap" });
    assert.equal((parse(reopenedPin.text).pin as Record<string, unknown>).reviewStatus, "reopened");

    const deleted = await callTool("pinar.delete_pin", { pinId: "legacy_cap:p1", sessionId: "legacy_cap" });
    assert.equal(deleted.isError, false, deleted.text);
    const empty = await callTool("pinar.list_pins", { sessionId: "legacy_cap" });
    assert.deepEqual(parse(empty.text).pins, []);
    const gone = await callTool("pinar.get_pin", { pinId: "legacy_cap:p1", sessionId: "legacy_cap" });
    assert.equal(gone.text, "Pin not found");

    // Syntactic validation and membership are separate: a well-formed foreign
    // legacy id is rejected as not a member, not as invalid, and without writes.
    await seedSession("foreign_cap", { pins: [{ comment: "Foreign note", kind: "element", pinId: "foreign_cap:p1" }] });
    const foreign = await callTool("pinar.get_pin", { pinId: "foreign_cap:p1", sessionId: "legacy_cap" });
    assert.equal(foreign.isError, true);
    assert.equal(foreign.text, "Pin not found", "a syntactically valid id that is not a member is a membership miss");
    const foreignDelete = await callTool("pinar.delete_pin", { pinId: "foreign_cap:p1", sessionId: "legacy_cap" });
    assert.equal(foreignDelete.text, "Pin not found");
    const foreignIntact = parse((await callTool("pinar.list_pins", { sessionId: "foreign_cap" })).text).pins as Array<Record<string, unknown>>;
    assert.deepEqual(foreignIntact.map((pin) => pin.id), ["foreign_cap:p1"], "the foreign pin is untouched by the rejected delete");

    for (const invalidId of ["../escape", "a".repeat(129), "legacy_cap:p9999999"]) {
      const rejected = await callTool("pinar.get_pin", { pinId: invalidId, sessionId: "legacy_cap" });
      assert.equal(rejected.isError, true);
      assert.equal(rejected.text, "pinId is invalid", `pinId ${JSON.stringify(invalidId).slice(0, 24)} must fail the syntactic check`);
      const rejectedDelete = await callTool("pinar.delete_pin", { pinId: invalidId, sessionId: "legacy_cap" });
      assert.equal(rejectedDelete.text, "pinId is invalid");
    }
  });

  test("hostile pin input rejects without writes and numbers follow max+1", async () => {
    await seedSession("pin_hostile", { pins: [{ comment: "One", kind: "element", pinId: "hostile_one" }, { comment: "Two", kind: "element", pinId: "hostile_two" }] });
    const before = await restSession("pin_hostile");
    assertBackendShape(jsonFallback);

    const missingSession = await callTool("pinar.list_pins", { sessionId: "no_such_session" });
    assert.equal(missingSession.text, "Session not found");
    const missingPinSession = await callTool("pinar.create_pin", { comment: "x", sessionId: "no_such_session" });
    assert.equal(missingPinSession.text, "Session not found");
    const missingDeleteSession = await callTool("pinar.delete_pin", { pinId: "hostile_one", sessionId: "no_such_session" });
    assert.equal(missingDeleteSession.text, "Session not found");

    const emptyComment = await callTool("pinar.create_pin", { comment: "", sessionId: "pin_hostile" });
    assert.equal(emptyComment.isError, true);
    assert.equal(emptyComment.text, "comment is invalid");
    const blankComment = await callTool("pinar.create_pin", { comment: "   ", sessionId: "pin_hostile" });
    assert.equal(blankComment.text, "comment is invalid");
    const oversizedComment = await callTool("pinar.create_pin", { comment: "x".repeat(2001), sessionId: "pin_hostile" });
    assert.equal(oversizedComment.text, "comment is invalid");
    const nonStringComment = await callTool("pinar.create_pin", { comment: 42, sessionId: "pin_hostile" });
    assert.match(nonStringComment.text, /Input validation error.*data\/comment must be string/);
    const absentComment = await callTool("pinar.create_pin", { sessionId: "pin_hostile" });
    assert.match(absentComment.text, /required property 'comment'/);

    const stringLocator = await callTool("pinar.create_pin", { comment: "x", locator: "button", sessionId: "pin_hostile" });
    assert.match(stringLocator.text, /Input validation error.*data\/locator must be object/);
    const nonStringLocatorField = await callTool("pinar.create_pin", { comment: "x", locator: { cssSelector: 1 }, sessionId: "pin_hostile" });
    assert.match(nonStringLocatorField.text, /Input validation error.*data\/locator\/cssSelector must be string/);
    const extraLocatorField = await callTool("pinar.create_pin", { comment: "x", locator: { cssSelector: "button", evil: 1 }, sessionId: "pin_hostile" });
    assert.equal(extraLocatorField.text, "locator is invalid");
    const oversizedLocator = await callTool("pinar.create_pin", { comment: "x", locator: { cssSelector: "s".repeat(257) }, sessionId: "pin_hostile" });
    assert.equal(oversizedLocator.text, "locator is invalid");
    const controlLocator = await callTool("pinar.create_pin", { comment: "x", locator: { innerText: "a\u0007b" }, sessionId: "pin_hostile" });
    assert.equal(controlLocator.text, "locator is invalid");

    const extraCreate = await callTool("pinar.create_pin", { comment: "x", number: 9, sessionId: "pin_hostile" });
    assert.equal(extraCreate.text, "Unexpected argument");
    const extraList = await callTool("pinar.list_pins", { query: "x", sessionId: "pin_hostile" });
    assert.equal(extraList.text, "Unexpected argument");
    const extraGet = await callTool("pinar.get_pin", { pinId: "hostile_one", query: "x", sessionId: "pin_hostile" });
    assert.equal(extraGet.text, "Unexpected argument");
    const extraDelete = await callTool("pinar.delete_pin", { pinId: "hostile_one", force: true, sessionId: "pin_hostile" });
    assert.equal(extraDelete.text, "Unexpected argument");

    const boundedList = await callTool("pinar.list_pins", { limit: 1, sessionId: "pin_hostile" });
    assert.deepEqual(parse(boundedList.text).pins.map((pin: Record<string, unknown>) => pin.number), [1]);
    const offsetList = await callTool("pinar.list_pins", { limit: 1, offset: 1, sessionId: "pin_hostile" });
    assert.deepEqual(parse(offsetList.text).pins.map((pin: Record<string, unknown>) => pin.number), [2]);
    const badLimit = await callTool("pinar.list_pins", { limit: 0, sessionId: "pin_hostile" });
    assert.equal(badLimit.isError, true);
    assert.match(badLimit.text, /limit/);
    const badOffset = await callTool("pinar.list_pins", { offset: 10_001, sessionId: "pin_hostile" });
    assert.equal(badOffset.isError, true);
    assert.match(badOffset.text, /offset/);

    // Every reject is a no-write: the session is byte-for-byte unchanged.
    assert.deepEqual(await restSession("pin_hostile"), before, "rejected pin input must not write");
    const afterRejects = parse((await callTool("pinar.list_pins", { sessionId: "pin_hostile" })).text).pins as Array<Record<string, unknown>>;
    assert.deepEqual(afterRejects.map((pin) => pin.number), [1, 2]);

    // Numbers: next number is max+1, and deletes never renumber the rest.
    const third = await callTool("pinar.create_pin", { comment: "Third", sessionId: "pin_hostile" });
    assert.equal((parse(third.text).pin as Record<string, unknown>).number, 3);
    const deletedFirst = await callTool("pinar.delete_pin", { pinId: "hostile_one", sessionId: "pin_hostile" });
    assert.equal(deletedFirst.isError, false, deletedFirst.text);
    const survivors = parse((await callTool("pinar.list_pins", { sessionId: "pin_hostile" })).text).pins as Array<Record<string, unknown>>;
    assert.deepEqual(survivors.map((pin) => pin.number), [2, 3], "remaining pins keep their numbers");
    const fourth = await callTool("pinar.create_pin", { comment: "Fourth", sessionId: "pin_hostile" });
    assert.equal((parse(fourth.text).pin as Record<string, unknown>).number, 4, "the next number follows the current max, not the slot");

    for (const [name, args] of [
      ["pinar.list_pins", { sessionId: "pin_hostile" }],
      ["pinar.get_pin", { pinId: "hostile_two", sessionId: "pin_hostile" }],
      ["pinar.create_pin", { comment: "nope", sessionId: "pin_hostile" }],
      ["pinar.delete_pin", { pinId: "hostile_two", sessionId: "pin_hostile" }],
    ] as const) {
      const hostile = await callTool(name, { ...args }, { headers: { Origin: "https://evil.example" } });
      assert.ok(hostile.response.status === 403 || hostile.response.status === 401, `${name} status ${hostile.response.status}`);
    }
    const intact = parse((await callTool("pinar.list_pins", { sessionId: "pin_hostile" })).text).pins as Array<Record<string, unknown>>;
    assert.deepEqual(intact.map((pin) => pin.number), [2, 3, 4], "a hostile Origin must not create or delete pins");
  });

  if (jsonFallback) {
    test("a failed history.json write propagates from the pin tools without a false success or a torn file", async () => {
      await seedSession("pin_fault", { pins: [{ comment: "Kept", kind: "element", pinId: "fault_one" }] });
      assertBackendShape(true);
      const historyPath = join(root, "history.json");
      const created = await callTool("pinar.create_pin", { comment: "Fault note", sessionId: "pin_fault" });
      assert.equal(created.isError, false, created.text);
      const faultPinId = String(parse(created.text).pin.id);
      const goodBytes = readFileSync(historyPath, "utf8");
      assert.ok(goodBytes.includes(faultPinId), "the created pin is persisted");

      // Break the only write target the JSON store has: the file path becomes
      // a directory, so any open-for-write fails with EISDIR.
      const backup = join(root, "fault-backup.json");
      renameSync(historyPath, backup);
      mkdirSync(historyPath);

      const deleted = await callTool("pinar.delete_pin", { pinId: faultPinId, sessionId: "pin_fault" });
      assert.equal(deleted.isError, true, "a failed persistence must not report success");
      assert.equal(deleted.text, "Local storage failed");

      // Memory, file, and tables stay exactly as they were.
      const listed = parse((await callTool("pinar.list_pins", { sessionId: "pin_fault" })).text).pins as Array<Record<string, unknown>>;
      assert.deepEqual(listed.map((pin) => pin.id), ["fault_one", faultPinId], "the failed write leaves the memory state untouched");
      assert.equal(readFileSync(backup, "utf8"), goodBytes, "the persisted bytes are untouched by the failed write");

      // With the fault cleared, the same delete succeeds and the new state lands.
      rmSync(historyPath, { recursive: true });
      renameSync(backup, historyPath);
      const retried = await callTool("pinar.delete_pin", { pinId: faultPinId, sessionId: "pin_fault" });
      assert.equal(retried.isError, false, retried.text);
      const afterRetry = parse((await callTool("pinar.list_pins", { sessionId: "pin_fault" })).text).pins as Array<Record<string, unknown>>;
      assert.deepEqual(afterRetry.map((pin) => pin.id), ["fault_one"]);
      assert.equal(readFileSync(historyPath, "utf8").includes(faultPinId), false, "the retried delete persists");

      // Control: the healthy store keeps the normal write path.
      const healthy = await callTool("pinar.create_pin", { comment: "After fault", sessionId: "pin_fault" });
      assert.equal(healthy.isError, false, healthy.text);
      assert.ok(readFileSync(historyPath, "utf8").includes(String(parse(healthy.text).pin.id)), "the healthy store persists normally");
    });
  }

  test("delete_pin preserves the seeded execution audit and leaves no resurrection", async () => {
    await seedSession("pin_audit", {
      pins: [
        { comment: "Kept", kind: "element", pinId: "audit_kept" },
        { comment: "Target", kind: "element", pinId: "audit_target" },
      ],
    });
    assertBackendShape(jsonFallback);

    // Local stores no agent feedback itself: seed the audit through the real
    // store API, then force the MCP layer to reload from storage.
    const seeded = openHistoryDb(root);
    try {
      seeded.saveAgentExecution({
        agent: "cursor",
        captureId: "pin_audit",
        idempotencyKey: "audit_exec_crud",
        results: [
          { pinId: "audit_target", status: "changed", summary: "Audit on deleted pin" },
          { pinId: "audit_kept", status: "changed", summary: "Audit on kept pin" },
        ],
      });
    } finally {
      seeded.close();
    }
    resetLocalApiForTests();
    resetMcpSession();

    const auditBefore = jsonFallback
      ? (JSON.parse(readFileSync(join(root, "history.json"), "utf8")) as { agent_executions: unknown[] }).agent_executions
      : auditTables("pin_audit");
    const deleted = await callTool("pinar.delete_pin", { pinId: "audit_target", sessionId: "pin_audit" });
    assert.equal(deleted.isError, false, deleted.text);

    const auditAfter = jsonFallback
      ? (JSON.parse(readFileSync(join(root, "history.json"), "utf8")) as { agent_executions: unknown[] }).agent_executions
      : auditTables("pin_audit");
    assert.deepEqual(auditAfter, auditBefore, "the seeded execution audit rows survive the pin delete");
    if (jsonFallback) {
      const data = JSON.parse(readFileSync(join(root, "history.json"), "utf8")) as { agent_executions: Array<{ results?: Array<{ pin_id: string }> }> };
      const results = data.agent_executions.flatMap((execution) => execution.results ?? []);
      assert.ok(results.some((result) => result.pin_id === "audit_target"), "the audit result on the deleted pin stays in history.json");
    } else {
      const db = new Database(join(root, "history.db"), { readonly: true });
      const rows = db.query("SELECT * FROM agent_pin_results WHERE pin_id = ?").all("audit_target") as unknown[];
      db.close();
      assert.equal(rows.length, 1, "the audit row on the deleted pin survives the delete");
    }

    const listed = parse((await callTool("pinar.list_pins", { sessionId: "pin_audit" })).text).pins as Array<Record<string, unknown>>;
    assert.deepEqual(listed.map((pin) => pin.id), ["audit_kept"], "the deleted pin does not resurface in the list");
    const missing = await callTool("pinar.get_pin", { pinId: "audit_target", sessionId: "pin_audit" });
    assert.equal(missing.text, "Pin not found");
    const markdown = await callTool("pinar.get_session_markdown", { sessionId: "pin_audit" });
    assert.equal(markdown.text.includes("Audit on deleted pin"), false, "the audit never renders as a resurrected pin note");
  });

  if (!jsonFallback) {
    test("a failed SQLite delete_pin rolls back the earlier statements of the same transaction", async () => {
      await seedSession("pin_txn", {
        pins: [
          { comment: "Kept", kind: "element", pinId: "txn_kept" },
          { comment: "Target", kind: "element", pinId: "txn_target" },
        ],
      });
      assertBackendShape(false);
      await addComment("pin_txn", "txn_target", "comment on target");
      const concluded = await callTool("pinar.conclude_pin", { pinId: "txn_target", sessionId: "pin_txn" });
      assert.equal(concluded.isError, false, concluded.text);

      const dump = () => {
        const db = new Database(join(root, "history.db"), { readonly: true });
        try {
          return AUDIT_DUMP_TABLES.map((table) => JSON.stringify(db.query(`SELECT * FROM ${table} ORDER BY rowid`).all()));
        } finally {
          db.close();
        }
      };
      const before = dump();
      const arm = new Database(join(root, "history.db"));
      arm.exec("CREATE TRIGGER crud_fail_del_comments BEFORE DELETE ON pin_comments BEGIN SELECT RAISE(ABORT, 'injected delete failure'); END");
      arm.close();

      const failed = await callTool("pinar.delete_pin", { pinId: "txn_target", sessionId: "pin_txn" });
      assert.equal(failed.isError, true, "the aborted delete must surface as a tool error");
      assert.equal(failed.text, "Local storage failed");
      assert.deepEqual(dump(), before, "the event and review deletes that ran before the abort rolled back with it");

      const listed = parse((await callTool("pinar.list_pins", { sessionId: "pin_txn" })).text).pins as Array<Record<string, unknown>>;
      assert.deepEqual(listed.map((pin) => pin.id), ["txn_kept", "txn_target"], "the target pin is still listed after the failed delete");
      const check = new Database(join(root, "history.db"));
      const count = (sql: string) => (check.query(sql).get("pin_txn", "txn_target") as { n: number }).n;
      assert.equal(count("SELECT COUNT(*) n FROM pin_comments WHERE capture_id = ? AND pin_id = ?"), 1);
      assert.equal(count("SELECT COUNT(*) n FROM pin_reviews WHERE capture_id = ? AND pin_id = ?"), 1);
      assert.equal(count("SELECT COUNT(*) n FROM pin_review_events WHERE capture_id = ? AND pin_id = ?"), 1);
      check.exec("DROP TRIGGER crud_fail_del_comments");
      check.close();

      const retried = await callTool("pinar.delete_pin", { pinId: "txn_target", sessionId: "pin_txn" });
      assert.equal(retried.isError, false, retried.text);
      const survivors = parse((await callTool("pinar.list_pins", { sessionId: "pin_txn" })).text).pins as Array<Record<string, unknown>>;
      assert.deepEqual(survivors.map((pin) => pin.id), ["txn_kept"], "the retried delete removes only the target");
      const after = new Database(join(root, "history.db"), { readonly: true });
      assert.equal((after.query("SELECT COUNT(*) n FROM pin_comments WHERE pin_id = ?").get("txn_target") as { n: number }).n, 0);
      assert.equal((after.query("SELECT COUNT(*) n FROM pin_reviews WHERE pin_id = ?").get("txn_target") as { n: number }).n, 0);
      assert.equal((after.query("SELECT COUNT(*) n FROM pin_review_events WHERE pin_id = ?").get("txn_target") as { n: number }).n, 0);
      after.close();
    });
  }

  if (jsonFallback) {
    test("a failed history.json write from create_pin propagates without a false success or a torn file", async () => {
      await seedSession("pin_fault_add", { pins: [{ comment: "Kept", kind: "element", pinId: "add_fault_one" }] });
      assertBackendShape(true);
      const historyPath = join(root, "history.json");
      const goodBytes = readFileSync(historyPath, "utf8");

      // Break the only write target the JSON store has: the file path becomes
      // a directory, so any open-for-write fails with EISDIR.
      const backup = join(root, "add-fault-backup.json");
      renameSync(historyPath, backup);
      mkdirSync(historyPath);

      const failed = await callTool("pinar.create_pin", { comment: "Must not persist", sessionId: "pin_fault_add" });
      assert.equal(failed.isError, true, "a failed persistence must not report success");
      assert.equal(failed.text, "Local storage failed");
      assert.equal(readFileSync(backup, "utf8"), goodBytes, "the persisted bytes are untouched by the failed write");
      const listed = parse((await callTool("pinar.list_pins", { sessionId: "pin_fault_add" })).text).pins as Array<Record<string, unknown>>;
      assert.deepEqual(listed.map((pin) => pin.id), ["add_fault_one"], "the failed write leaves the memory state untouched");
      assert.ok(!existsSync(join(root, "history.json.pin-state")), "no torn temp file may be left behind");

      // With the fault cleared, the same create succeeds, persists, and is
      // durable across a store reopen.
      rmSync(historyPath, { recursive: true });
      renameSync(backup, historyPath);
      const retried = await callTool("pinar.create_pin", { comment: "After fault", sessionId: "pin_fault_add" });
      assert.equal(retried.isError, false, retried.text);
      const retriedPin = parse(retried.text).pin as Record<string, unknown>;
      assert.equal(retriedPin.number, 2, "the retried create takes the next number");
      assert.ok(readFileSync(historyPath, "utf8").includes(String(retriedPin.id)), "the retried create persists");

      resetLocalApiForTests();
      resetMcpSession();
      const reopened = parse((await callTool("pinar.list_pins", { sessionId: "pin_fault_add" })).text).pins as Array<Record<string, unknown>>;
      assert.deepEqual(reopened.map((pin) => pin.number), [1, 2], "the retried create is durable across a store reopen");
    });
  }
}

describe("local MCP CRUD deletes (SQLite)", () => {
  beforeEach(async () => {
    previousHome = process.env.PINAR_HOME;
    root = await mkdtemp(join(tmpdir(), "pinar-local-mcp-crud-"));
    victimDir = mkdtempSync(join(tmpdir(), "pinar-local-mcp-crud-victim-"));
    process.env.PINAR_HOME = root;
    resetLocalApiForTests();
  });

  afterEach(async () => {
    resetLocalApiForTests();
    if (previousHome === undefined) delete process.env.PINAR_HOME;
    else process.env.PINAR_HOME = previousHome;
    await rm(root, { force: true, recursive: true });
    await rm(victimDir, { force: true, recursive: true });
  });

  test("delete_session removes the session, its comments, and the shot file", async () => {
    await seedSession("crud_session");
    const shotPath = join(root, "shots", "crud_session.png");
    assert.ok(existsSync(shotPath));
    await addComment("crud_session", "pin_one", "first");
    await addComment("crud_session", "pin_one", "second");
    const before = await requestJson("/api/sessions/crud_session");
    assert.equal(before.response.status, 200);
    assert.equal((before.body.comments as unknown[]).length, 2);

    const deleted = await callTool("pinar.delete_session", { sessionId: "crud_session" });
    assert.equal(deleted.isError, false, deleted.text);
    assert.deepEqual(parse(deleted.text), { deleted: true, ok: true });

    assert.ok(!existsSync(shotPath), "shot file must be removed");
    assert.deepEqual(sessionIds(parse((await callTool("pinar.list_sessions", {})).text)), []);
    const markdown = await callTool("pinar.get_session_markdown", { sessionId: "crud_session" });
    assert.equal(markdown.isError, true);
    assert.equal(markdown.text, "Session not found");
    const rest = await request("/api/sessions/crud_session");
    assert.equal(rest.status, 404);
    const again = await callTool("pinar.delete_session", { sessionId: "crud_session" });
    assert.equal(again.isError, true);
    assert.equal(again.text, "Session not found");
  });

  test("delete_session rejects missing and invalid ids without mutating anything", async () => {
    await seedSession("crud_kept");
    await seedSession("crud_other");

    const missing = await callTool("pinar.delete_session", { sessionId: "nope" });
    assert.equal(missing.isError, true);
    assert.equal(missing.text, "Session not found");
    const control = await callTool("pinar.delete_session", { sessionId: "bad\u0000id" });
    assert.equal(control.isError, true);
    assert.equal(control.text, "sessionId is invalid");
    const tooLong = await callTool("pinar.delete_session", { sessionId: "x".repeat(300) });
    assert.equal(tooLong.isError, true);
    assert.equal(tooLong.text, "sessionId is invalid");

    assert.ok(existsSync(join(root, "shots", "crud_kept.png")));
    assert.ok(existsSync(join(root, "shots", "crud_other.png")));
    assert.deepEqual((await listSessions()).map((session) => session.id).sort(), ["crud_kept", "crud_other"]);
  });

  test("delete_pin_comment removes only the target comment", async () => {
    await seedSession("crud_comments", {
      pins: [
        { comment: "One", kind: "element", pinId: "pin_one" },
        { comment: "Two", kind: "element", pinId: "pin_two" },
      ],
    });
    const alpha = await addComment("crud_comments", "pin_one", "alpha");
    const beta = await addComment("crud_comments", "pin_one", "beta");
    const gamma = await addComment("crud_comments", "pin_two", "gamma");

    const deleted = await callTool("pinar.delete_pin_comment", {
      commentId: String(alpha.id),
      pinId: "pin_one",
      sessionId: "crud_comments",
    });
    assert.equal(deleted.isError, false, deleted.text);
    assert.deepEqual(parse(deleted.text), { deleted: true, ok: true });
    assert.deepEqual(await commentBodies("crud_comments", "pin_one"), ["beta"]);
    assert.deepEqual(await commentBodies("crud_comments", "pin_two"), ["gamma"]);

    const wrongPin = await callTool("pinar.delete_pin_comment", {
      commentId: String(gamma.id),
      pinId: "pin_one",
      sessionId: "crud_comments",
    });
    assert.equal(wrongPin.isError, true);
    assert.equal(wrongPin.text, "Resource not found");
    assert.deepEqual(await commentBodies("crud_comments", "pin_two"), ["gamma"]);

    const again = await callTool("pinar.delete_pin_comment", {
      commentId: String(alpha.id),
      pinId: "pin_one",
      sessionId: "crud_comments",
    });
    assert.equal(again.isError, true);
    assert.equal(again.text, "Resource not found");
    const unknownComment = await callTool("pinar.delete_pin_comment", {
      commentId: "does_not_exist",
      pinId: "pin_one",
      sessionId: "crud_comments",
    });
    assert.equal(unknownComment.isError, true);
    assert.equal(unknownComment.text, "Resource not found");
    const wrongSession = await callTool("pinar.delete_pin_comment", {
      commentId: String(beta.id),
      pinId: "pin_one",
      sessionId: "nope",
    });
    assert.equal(wrongSession.isError, true);
    assert.equal(wrongSession.text, "Session not found");
    const wrongPinArg = await callTool("pinar.delete_pin_comment", {
      commentId: String(beta.id),
      pinId: "pin_missing",
      sessionId: "crud_comments",
    });
    assert.equal(wrongPinArg.isError, true);
    assert.equal(wrongPinArg.text, "Pin not found");

    const restDeleted = await request(`/api/sessions/crud_comments/pins/pin_one/comments/${beta.id}`, {
      method: "DELETE",
    });
    assert.equal(restDeleted.status, 200);
    assert.deepEqual(await restDeleted.json(), { ok: true });
    assert.deepEqual(await commentBodies("crud_comments", "pin_one"), []);
    const restMissing = await request(`/api/sessions/crud_comments/pins/pin_one/comments/${beta.id}`, {
      method: "DELETE",
    });
    assert.equal(restMissing.status, 404);
  });

  test("delete_project moves captures to the default Inbox and keeps Personal protected", async () => {
    const { personalId } = await defaultContainers();
    const created = await callTool("pinar.create_project", { name: "Work" });
    assert.equal(created.isError, false, created.text);
    const projectId = String(parse(created.text).project.id);
    const collection = await callTool("pinar.create_collection", { name: "Specs", projectId });
    assert.equal(collection.isError, false, collection.text);
    const collectionId = String(parse(collection.text).collection.id);
    await seedSession("crud_proj_session", { collectionId });
    assert.deepEqual((await listSessions({ collectionId })).map((session) => session.id), ["crud_proj_session"]);

    const deleted = await callTool("pinar.delete_project", { projectId });
    assert.equal(deleted.isError, false, deleted.text);
    assert.deepEqual(parse(deleted.text), { deleted: true, ok: true });

    const projects = (await requestJson("/api/projects")).body.projects as Array<Record<string, unknown>>;
    assert.ok(!projects.some((project) => project.id === projectId));
    assert.ok(projects.some((project) => project.id === personalId));
    const markdown = await callTool("pinar.get_collection_markdown", { collectionId });
    assert.equal(markdown.isError, true);
    assert.equal(markdown.text, "Collection not found");

    const { inboxId } = await defaultContainers();
    const moved = await listSessions({ collectionId: inboxId });
    assert.deepEqual(moved.map((session) => session.id), ["crud_proj_session"]);
    assert.equal(moved[0].collectionId, inboxId);
    assert.ok(existsSync(join(root, "shots", "crud_proj_session.png")));

    const protectedProject = await callTool("pinar.delete_project", { projectId: personalId });
    assert.equal(protectedProject.isError, true);
    assert.equal(protectedProject.text, "Project protected");
    const projectsAfter = (await requestJson("/api/projects")).body.projects as Array<Record<string, unknown>>;
    assert.ok(projectsAfter.some((project) => project.id === personalId));

    const missing = await callTool("pinar.delete_project", { projectId: "nope" });
    assert.equal(missing.isError, true);
    assert.equal(missing.text, "Project not found");
    const hostile = await callTool("pinar.delete_project", { projectId: "x".repeat(300) });
    assert.equal(hostile.isError, true);
    assert.equal(hostile.text, "projectId is invalid");
  });

  test("delete_collection moves captures to the Inbox, promotes children, and keeps Inbox protected", async () => {
    const { inboxId } = await defaultContainers();
    const created = await callTool("pinar.create_project", { name: "Work2" });
    const projectId = String(parse(created.text).project.id);
    const parent = await callTool("pinar.create_collection", { name: "Parent", projectId });
    const parentId = String(parse(parent.text).collection.id);
    const child = await callTool("pinar.create_collection", { name: "Child", parentId, projectId });
    const childId = String(parse(child.text).collection.id);
    await seedSession("crud_coll_a", { collectionId: parentId });
    await seedSession("crud_coll_b", { collectionId: childId });

    const deleted = await callTool("pinar.delete_collection", { collectionId: parentId });
    assert.equal(deleted.isError, false, deleted.text);
    assert.deepEqual(parse(deleted.text), { deleted: true, ok: true });

    const markdown = await callTool("pinar.get_collection_markdown", { collectionId: parentId });
    assert.equal(markdown.isError, true);
    assert.equal(markdown.text, "Collection not found");

    const remaining = await callTool("pinar.list_collections", { projectId });
    assert.equal(remaining.isError, false, remaining.text);
    const collections = parse(remaining.text).collections as Array<Record<string, unknown>>;
    assert.deepEqual(collections.map((collection) => collection.id), [childId]);
    assert.equal(collections[0].parentId, null, "children are promoted to the deleted collection's parent");
    assert.deepEqual((await listSessions({ collectionId: childId })).map((session) => session.id), ["crud_coll_b"]);
    assert.deepEqual((await listSessions({ collectionId: inboxId })).map((session) => session.id), ["crud_coll_a"]);

    const protectedCollection = await callTool("pinar.delete_collection", { collectionId: inboxId });
    assert.equal(protectedCollection.isError, true);
    assert.equal(protectedCollection.text, "Collection protected");
    assert.deepEqual((await listSessions({ collectionId: inboxId })).map((session) => session.id), ["crud_coll_a"]);

    const missing = await callTool("pinar.delete_collection", { collectionId: "nope" });
    assert.equal(missing.isError, true);
    assert.equal(missing.text, "Collection not found");
  });

  test("delete_batch detaches sessions instead of destroying them", async () => {
    await seedSession("crud_batch_a", { batch: { id: "crud_batch", label: "Batch A" } });
    await seedSession("crud_batch_b", { batch: { id: "crud_batch", label: "Batch A" } });
    const batches = parse((await callTool("pinar.list_batches", {})).text).batches as Array<Record<string, unknown>>;
    assert.deepEqual(batches.map((batch) => batch.id), ["crud_batch"]);
    assert.equal(batches[0].sessionCount, 2);

    const deleted = await callTool("pinar.delete_batch", { batchId: "crud_batch" });
    assert.equal(deleted.isError, false, deleted.text);
    assert.deepEqual(parse(deleted.text), { deleted: true, ok: true });

    assert.deepEqual((parse((await callTool("pinar.list_batches", {})).text).batches as unknown[]).length, 0);
    const sessions = await listSessions();
    assert.deepEqual(sessions.map((session) => session.id).sort(), ["crud_batch_a", "crud_batch_b"]);
    assert.ok(sessions.every((session) => session.batchId === null));
    const markdown = await callTool("pinar.get_batch_markdown", { batchId: "crud_batch" });
    assert.equal(markdown.isError, true);
    assert.equal(markdown.text, "Batch not found");
    const again = await callTool("pinar.delete_batch", { batchId: "crud_batch" });
    assert.equal(again.isError, true);
    assert.equal(again.text, "Batch not found");
  });

  test("finish_batch stamps finishedAt and rejects missing batches", async () => {
    await seedSession("crud_finish", { batch: { id: "crud_finish_batch", label: "Finish me" } });
    const before = (parse((await callTool("pinar.list_batches", {})).text).batches as Array<Record<string, unknown>>)[0];
    assert.equal(before.finishedAt, null);

    const finished = await callTool("pinar.finish_batch", { batchId: "crud_finish_batch" });
    assert.equal(finished.isError, false, finished.text);
    const body = parse(finished.text);
    assert.equal(body.ok, true);
    const batch = body.batch as Record<string, unknown>;
    assert.equal(batch.id, "crud_finish_batch");
    assert.equal(batch.sessionCount, 1);
    assert.ok(ISO_TIMESTAMP.test(String(batch.finishedAt)), `finishedAt ${batch.finishedAt} is not an ISO timestamp`);

    const after = (parse((await callTool("pinar.list_batches", {})).text).batches as Array<Record<string, unknown>>)[0];
    assert.equal(after.finishedAt, batch.finishedAt);

    const again = await callTool("pinar.finish_batch", { batchId: "crud_finish_batch" });
    assert.equal(again.isError, false, again.text);
    const missing = await callTool("pinar.finish_batch", { batchId: "nope" });
    assert.equal(missing.isError, true);
    assert.equal(missing.text, "Batch not found");
    const hostile = await callTool("pinar.finish_batch", { batchId: "x".repeat(300) });
    assert.equal(hostile.isError, true);
    assert.equal(hostile.text, "batchId is invalid");
  });

  shotSafetyTests(false);

  batchCrudTests(false);

  sessionCrudTests(false);

  pinCrudTests(false);
});

describe("local MCP CRUD deletes (forced JSON fallback)", () => {
  beforeEach(async () => {
    previousHome = process.env.PINAR_HOME;
    root = await mkdtemp(join(tmpdir(), "pinar-local-mcp-crud-json-"));
    victimDir = mkdtempSync(join(tmpdir(), "pinar-local-mcp-crud-json-victim-"));
    process.env.PINAR_HOME = root;
    resetLocalApiForTests();
    // A directory at the SQLite path makes every DatabaseSync open fail, so
    // openHistoryDb falls back to the JSON store at history.json.
    mkdirSync(join(root, "history.db"));
  });

  afterEach(async () => {
    resetLocalApiForTests();
    if (previousHome === undefined) delete process.env.PINAR_HOME;
    else process.env.PINAR_HOME = previousHome;
    await rm(root, { force: true, recursive: true });
    await rm(victimDir, { force: true, recursive: true });
  });

  test("forced JSON fallback keeps the delete semantics on history.json", async () => {
    const { inboxId, personalId } = await defaultContainers();
    const created = await callTool("pinar.create_project", { name: "JSON work" });
    const projectId = String(parse(created.text).project.id);
    const collection = await callTool("pinar.create_collection", { name: "JSON specs", projectId });
    const collectionId = String(parse(collection.text).collection.id);
    await seedSession("json_session", {
      batch: { id: "json_batch", label: "JSON batch" },
      collectionId,
      pins: [
        { comment: "One", kind: "element", pinId: "pin_one" },
        { comment: "Two", kind: "element", pinId: "pin_two" },
      ],
    });
    assert.ok(existsSync(join(root, "history.json")), "the JSON fallback file must exist");

    const alpha = await addComment("json_session", "pin_one", "alpha");
    await addComment("json_session", "pin_one", "beta");
    const gamma = await addComment("json_session", "pin_two", "gamma");
    const deletedComment = await callTool("pinar.delete_pin_comment", {
      commentId: String(alpha.id),
      pinId: "pin_one",
      sessionId: "json_session",
    });
    assert.equal(deletedComment.isError, false, deletedComment.text);
    assert.deepEqual(await commentBodies("json_session", "pin_one"), ["beta"]);
    assert.deepEqual(await commentBodies("json_session", "pin_two"), ["gamma"]);
    const wrongPin = await callTool("pinar.delete_pin_comment", {
      commentId: String(gamma.id),
      pinId: "pin_one",
      sessionId: "json_session",
    });
    assert.equal(wrongPin.isError, true);
    assert.equal(wrongPin.text, "Resource not found");

    const finished = await callTool("pinar.finish_batch", { batchId: "json_batch" });
    assert.equal(finished.isError, false, finished.text);
    assert.ok(ISO_TIMESTAMP.test(String((parse(finished.text).batch as Record<string, unknown>).finishedAt)));
    const deletedBatch = await callTool("pinar.delete_batch", { batchId: "json_batch" });
    assert.equal(deletedBatch.isError, false, deletedBatch.text);
    const sessionsAfterBatch = await listSessions();
    assert.deepEqual(sessionsAfterBatch.map((session) => session.id), ["json_session"]);
    assert.equal(sessionsAfterBatch[0].batchId, null);

    const deletedProject = await callTool("pinar.delete_project", { projectId });
    assert.equal(deletedProject.isError, false, deletedProject.text);
    assert.deepEqual((await listSessions({ collectionId: inboxId })).map((session) => session.id), ["json_session"]);
    const protectedProject = await callTool("pinar.delete_project", { projectId: personalId });
    assert.equal(protectedProject.isError, true);
    assert.equal(protectedProject.text, "Project protected");
    const protectedInbox = await callTool("pinar.delete_collection", { collectionId: inboxId });
    assert.equal(protectedInbox.isError, true);
    assert.equal(protectedInbox.text, "Collection protected");

    const shotPath = join(root, "shots", "json_session.png");
    assert.ok(existsSync(shotPath));
    const deletedSession = await callTool("pinar.delete_session", { sessionId: "json_session" });
    assert.equal(deletedSession.isError, false, deletedSession.text);
    assert.ok(!existsSync(shotPath), "shot file must be removed");
    assert.deepEqual(sessionIds(parse((await callTool("pinar.list_sessions", {})).text)), []);
    const missingSession = await callTool("pinar.delete_session", { sessionId: "json_session" });
    assert.equal(missingSession.isError, true);
    assert.equal(missingSession.text, "Session not found");
  });

  shotSafetyTests(true);

  batchCrudTests(true);

  sessionCrudTests(true);

  pinCrudTests(true);
});
