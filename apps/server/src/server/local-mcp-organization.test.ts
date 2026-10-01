import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleApiRequest, resetLocalApiForTests } from "./api.local";

const VALID_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const ORIGIN = "http://127.0.0.1:17373";

interface ToolResult {
  isError: boolean;
  json: Record<string, unknown> | null;
  response: Response;
  rpcError: unknown;
  text: string;
}

let root = "";
let previousHome: string | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecords(value: unknown): Array<Record<string, unknown>> {
  return (Array.isArray(value) ? value : []).filter(isRecord);
}

function request(path: string, init: RequestInit = {}) {
  return handleApiRequest(new Request(`${ORIGIN}${path}`, init));
}

function urlPattern(value: string): RegExp {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

function headersOf(init: RequestInit): Record<string, string> {
  const value = init.headers;
  if (!value) return {};
  if (Array.isArray(value)) return Object.fromEntries(value.map(([name, item]) => [name, item]));
  if (value instanceof Headers) return Object.fromEntries(value.entries());
  return { ...value };
}

const MCP_ACCEPT = "application/json, text/event-stream";
const INITIALIZE_PARAMS = { capabilities: {}, clientInfo: { name: "pinar-org-test", version: "0.0.0" }, protocolVersion: "2025-11-25" };

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

async function callTool(name: string, argumentsValue: Record<string, unknown>, init: RequestInit = {}): Promise<ToolResult> {
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
  let json: Record<string, unknown> | null = null;
  if (result.isError !== true) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (isRecord(parsed)) json = parsed;
    } catch {
      json = null;
    }
  }
  return { isError: result.isError === true, json, response, rpcError: body.error ?? null, text };
}

function describeFailure(label: string, result: ToolResult) {
  return `${label}: expected a tool error, got status=${result.response.status} text=${JSON.stringify(result.text).slice(0, 160)} rpcError=${JSON.stringify(result.rpcError)}`;
}

function failure(result: ToolResult, label: string) {
  assert.equal(result.isError, true, describeFailure(label, result));
}

function page(result: ToolResult, label: string): Record<string, unknown> {
  assert.equal(result.isError, false, describeFailure(label, result));
  assert.equal(result.response.status, 200, `${label}: expected HTTP 200, got ${result.response.status}`);
  assert.ok(result.json, `${label}: expected a JSON object result, got ${JSON.stringify(result.text).slice(0, 160)}`);
  return result.json;
}

function ok(result: ToolResult, label: string): Record<string, unknown> {
  const body = page(result, label);
  assert.equal(body.ok, true, `${label}: expected ok:true, got ${JSON.stringify(body).slice(0, 160)}`);
  return body;
}

function markdown(result: ToolResult, label: string): string {
  assert.equal(result.isError, false, describeFailure(label, result));
  assert.equal(result.response.status, 200, `${label}: expected HTTP 200, got ${result.response.status}`);
  assert.ok(result.text.length > 0, `${label}: expected non-empty markdown, got nothing`);
  return result.text;
}

async function getJson(path: string): Promise<Record<string, unknown>> {
  const response = await request(path);
  assert.equal(response.status, 200, `${path}: expected 200, got ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

async function postJson(path: string, body: Record<string, unknown>) {
  const response = await request(path, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  return { body: (await response.json()) as Record<string, unknown>, response };
}

async function createProject(name: string): Promise<Record<string, unknown>> {
  const { body, response } = await postJson("/api/projects", { name });
  assert.equal(response.status, 201, `seed project ${name}: ${JSON.stringify(body).slice(0, 160)}`);
  assert.ok(isRecord(body.project), "seed project: expected a project payload");
  return body.project;
}

async function createCollection(projectId: string, name: string, parentId?: string | null): Promise<Record<string, unknown>> {
  const payload: Record<string, unknown> = { name };
  if (parentId !== undefined) payload.parentId = parentId;
  const { body, response } = await postJson(`/api/projects/${encodeURIComponent(projectId)}/collections`, payload);
  assert.equal(response.status, 201, `seed collection ${name}: ${JSON.stringify(body).slice(0, 160)}`);
  assert.ok(isRecord(body.collection), "seed collection: expected a collection payload");
  return body.collection;
}

async function seedSession(id: string, options: { batch?: { id: string; label: string; startedAt: string }; collectionId?: string; note?: string } = {}) {
  const payload: Record<string, unknown> = {
    id,
    image: VALID_PNG,
    page: { title: `Session ${id}`, url: `https://example.test/${id}` },
    pins: [{ comment: options.note ?? `Original note ${id}`, kind: "element", pinId: "pin_one" }],
  };
  if (options.collectionId) payload.collectionId = options.collectionId;
  if (options.batch) payload.batch = options.batch;
  const response = await request("/api/shots", {
    body: JSON.stringify(payload),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(response.status, 201, `seed session ${id}: ${JSON.stringify(body).slice(0, 160)}`);
}

async function storedProjects(): Promise<Array<Record<string, unknown>>> {
  return asRecords((await getJson("/api/projects")).projects);
}

async function storedCollections(projectId: string): Promise<Array<Record<string, unknown>>> {
  return asRecords((await getJson(`/api/projects/${encodeURIComponent(projectId)}/collections`)).collections);
}

async function storedBatches(): Promise<Array<Record<string, unknown>>> {
  return asRecords((await getJson("/api/batches")).batches);
}

async function storedSessionsInCollection(collectionId: string): Promise<Array<Record<string, unknown>>> {
  return asRecords((await getJson(`/api/history?collectionId=${encodeURIComponent(collectionId)}`)).sessions);
}

async function storedSessionPayload(id: string): Promise<Record<string, unknown>> {
  return getJson(`/api/sessions/${encodeURIComponent(id)}`);
}

async function protectedProject(): Promise<Record<string, unknown>> {
  const found = (await storedProjects()).find((project) => project.isProtected === true);
  assert.ok(found, "expected the protected default project");
  return found;
}

describe("local MCP organization tools (contract)", () => {
  beforeEach(async () => {
    previousHome = process.env.PINAR_HOME;
    root = await mkdtemp(join(tmpdir(), "pinar-local-mcp-org-"));
    process.env.PINAR_HOME = root;
    resetLocalApiForTests();
  });

  afterEach(async () => {
    resetLocalApiForTests();
    if (previousHome === undefined) delete process.env.PINAR_HOME;
    else process.env.PINAR_HOME = previousHome;
    await rm(root, { force: true, recursive: true });
  });

  test("lists projects as bounded metadata and paginates", async () => {
    const personal = await protectedProject();
    const alpha = await createProject("Alpha");
    const beta = await createProject("Beta");

    const listed = page(await callTool("pinar.list_projects", {}), "list_projects");
    assert.equal(listed.limit, 50);
    assert.equal(listed.offset, 0);
    const projects = asRecords(listed.projects);
    assert.equal(projects.length, 3);
    assert.deepEqual(projects.map((project) => project.id).sort(), [personal.id, alpha.id, beta.id].map(String).sort());
    for (const project of projects) {
      assert.equal(typeof project.name, "string");
      assert.ok(String(project.name).length > 0);
      assert.ok(!("sessions" in project), "project metadata must not embed sessions");
    }

    const limited = page(await callTool("pinar.list_projects", { limit: 1 }), "list_projects limit=1");
    assert.equal(limited.limit, 1);
    assert.equal(asRecords(limited.projects).length, 1);

    const skipped = page(await callTool("pinar.list_projects", { limit: 1, offset: 1 }), "list_projects offset=1");
    assert.equal(skipped.offset, 1);
    assert.notDeepEqual(asRecords(skipped.projects)[0]?.id, asRecords(limited.projects)[0]?.id);

    const invalid: Array<[string, Record<string, unknown>]> = [
      ["limit=0", { limit: 0 }],
      ["limit=51", { limit: 51 }],
      ["limit non-integer", { limit: 2.5 }],
      ["limit string", { limit: "1" }],
      ["offset=-1", { offset: -1 }],
      ["offset=10001", { offset: 10001 }],
      ["offset string", { offset: "1" }],
    ];
    for (const [label, args] of invalid) {
      failure(await callTool("pinar.list_projects", args), `list_projects ${label}`);
    }
  });

  test("returns project markdown aggregated from the stored tree", async () => {
    const project = await createProject("Markdown Project");
    const collection = await createCollection(String(project.id), "Markdown Collection");
    await seedSession("markdown_session", { collectionId: String(collection.id), note: "Markdown pin note" });

    const text = markdown(await callTool("pinar.get_project_markdown", { projectId: String(project.id) }), "get_project_markdown");
    assert.match(text, /^# Markdown Project$/m);
    assert.match(text, urlPattern(`Project viewer: ${ORIGIN}/p/${project.id}`));
    assert.match(text, urlPattern(`## [Markdown Collection](${ORIGIN}/c/${collection.id})`));
    assert.match(text, urlPattern(`### [Session markdown_session](${ORIGIN}/v/markdown_session)`));
    assert.match(text, urlPattern(`Markdown: ${ORIGIN}/v/markdown_session.md`));
    assert.match(text, /Markdown pin note/);

    failure(await callTool("pinar.get_project_markdown", { projectId: "missing_project" }), "get_project_markdown unknown id");
    failure(await callTool("pinar.get_project_markdown", { projectId: "   " }), "get_project_markdown blank id");
    failure(await callTool("pinar.get_project_markdown", { projectId: 42 }), "get_project_markdown non-string id");
  });

  test("creates and renames projects with persisted metadata", async () => {
    const created = ok(await callTool("pinar.create_project", { name: "  Fresh Project  " }), "create_project");
    const project = asSingle(created, "create_project.project");
    assert.equal(project.name, "Fresh Project");
    assert.equal(project.isProtected, false);
    const id = String(project.id);

    const listed = await storedProjects();
    assert.ok(listed.some((item) => item.id === id && item.name === "Fresh Project"), "created project must persist");

    const renamed = ok(await callTool("pinar.rename_project", { name: "Renamed Project", projectId: id }), "rename_project");
    assert.equal(asSingle(renamed, "rename_project.project").name, "Renamed Project");
    assert.ok((await storedProjects()).some((item) => item.id === id && item.name === "Renamed Project"), "renamed project must persist");
  });

  test("rejects invalid project names and unknown projects before writing", async () => {
    const snapshot = (await storedProjects()).map((item) => item.name);

    const invalid: Array<[string, Record<string, unknown>]> = [
      ["blank name", { name: "   " }],
      ["null control name", { name: "Bad\u0000Name" }],
      ["unit separator name", { name: "Bad\u001fName" }],
      ["overlong name", { name: "x".repeat(257) }],
      ["non-string name", { name: 42 }],
    ];
    for (const [label, args] of invalid) {
      failure(await callTool("pinar.create_project", args), `create_project ${label}`);
    }
    assert.deepEqual((await storedProjects()).map((item) => item.name), snapshot, "rejected names must not create projects");

    const boundary = ok(await callTool("pinar.create_project", { name: "y".repeat(256) }), "create_project 256 chars");
    assert.equal(String(asSingle(boundary, "create_project.project").name).length, 256);

    const anyProject = (await storedProjects())[0];
    failure(await callTool("pinar.rename_project", { name: "New Name", projectId: "missing_project" }), "rename_project unknown id");
    failure(await callTool("pinar.rename_project", { name: "   ", projectId: String(anyProject.id) }), "rename_project blank name");
  });

  test("reorders projects with a complete id list and persists the new order", async () => {
    const personal = await protectedProject();
    const alpha = await createProject("Alpha");
    const beta = await createProject("Beta");
    assert.deepEqual((await storedProjects()).map((item) => String(item.id)), [String(personal.id), String(alpha.id), String(beta.id)]);

    const reversed = [String(beta.id), String(personal.id), String(alpha.id)];
    const result = ok(await callTool("pinar.reorder_projects", { ids: reversed }), "reorder_projects");
    assert.deepEqual(asRecords(result.projects).map((item) => item.id), reversed);
    assert.deepEqual((await storedProjects()).map((item) => String(item.id)), reversed, "reordered project positions must persist");
  });

  test("rejects invalid project orders without mutation", async () => {
    const personal = await protectedProject();
    const alpha = await createProject("Alpha");
    const beta = await createProject("Beta");
    const ids = [String(personal.id), String(alpha.id), String(beta.id)];
    const snapshot = (await storedProjects()).map((item) => item.position);

    const invalid: Array<[string, Record<string, unknown>]> = [
      ["empty ids", { ids: [] }],
      ["partial order", { ids: ids.slice(0, 2) }],
      ["duplicate id", { ids: [ids[0], ids[1], ids[1]] }],
      ["unknown id", { ids: [ids[0], ids[1], "missing_id"] }],
      ["non-array ids", { ids: "alpha" }],
      ["non-string id", { ids: [ids[0], 42, ids[2]] }],
      ["overlong ids", { ids: [...ids, ...Array.from({ length: 1000 }, (_, index) => `extra_${index}`)] }],
    ];
    for (const [label, args] of invalid) {
      failure(await callTool("pinar.reorder_projects", args), `reorder_projects ${label}`);
    }
    assert.deepEqual((await storedProjects()).map((item) => item.position), snapshot, "rejected reorders must not mutate project positions");
  });

  test("lists collections per project as bounded metadata", async () => {
    const project = await createProject("Collections Project");
    const alpha = await createCollection(String(project.id), "Col A");
    await createCollection(String(project.id), "Col Nested", String(alpha.id));
    await seedSession("collection_session", { collectionId: String(alpha.id) });

    const listed = page(await callTool("pinar.list_collections", { projectId: String(project.id) }), "list_collections");
    assert.equal(listed.limit, 50);
    assert.equal(listed.offset, 0);
    const collections = asRecords(listed.collections);
    assert.equal(collections.length, 2);
    assert.deepEqual(collections.map((item) => item.name).sort(), ["Col A", "Col Nested"]);
    for (const collection of collections) {
      assert.ok(!("sessions" in collection), "collection metadata must not embed sessions");
    }

    const limited = page(await callTool("pinar.list_collections", { limit: 1, projectId: String(project.id) }), "list_collections limit=1");
    assert.equal(asRecords(limited.collections).length, 1);

    failure(await callTool("pinar.list_collections", { projectId: "missing_project" }), "list_collections unknown project");
    failure(await callTool("pinar.list_collections", { limit: 0, projectId: String(project.id) }), "list_collections limit=0");
    failure(await callTool("pinar.list_collections", { offset: 10001, projectId: String(project.id) }), "list_collections offset=10001");
  });

  test("returns collection markdown for the stored collection", async () => {
    const project = await createProject("Collection Markdown Project");
    const collection = await createCollection(String(project.id), "Collection Markdown");
    await seedSession("collection_markdown_session", { collectionId: String(collection.id), note: "Collection pin note" });

    const text = markdown(await callTool("pinar.get_collection_markdown", { collectionId: String(collection.id) }), "get_collection_markdown");
    assert.match(text, /^# Collection Markdown$/m);
    assert.match(text, urlPattern(`Collection viewer: ${ORIGIN}/c/${collection.id}`));
    assert.match(text, urlPattern(`Markdown: ${ORIGIN}/v/collection_markdown_session.md`));
    assert.match(text, /Collection pin note/);

    failure(await callTool("pinar.get_collection_markdown", { collectionId: "missing_collection" }), "get_collection_markdown unknown id");
    failure(await callTool("pinar.get_collection_markdown", { collectionId: "   " }), "get_collection_markdown blank id");
  });

  test("creates root and nested collections and renames them", async () => {
    const project = await createProject("Hierarchy Project");
    const projectId = String(project.id);

    const rootCollection = asSingle(
      ok(await callTool("pinar.create_collection", { name: "Root Collection", projectId }), "create_collection root"),
      "create_collection.collection",
    );
    assert.equal(rootCollection.projectId, projectId);
    assert.equal(rootCollection.parentId, null);

    const nestedCollection = asSingle(
      ok(await callTool("pinar.create_collection", { name: "Nested Collection", parentId: String(rootCollection.id), projectId }), "create_collection nested"),
      "create_collection.collection",
    );
    assert.equal(nestedCollection.parentId, rootCollection.id);

    const explicitRoot = asSingle(
      ok(await callTool("pinar.create_collection", { name: "Explicit Root", parentId: null, projectId }), "create_collection explicit null parent"),
      "create_collection.collection",
    );
    assert.equal(explicitRoot.parentId, null);

    const stored = await storedCollections(projectId);
    assert.deepEqual(stored.map((item) => item.name).sort(), ["Explicit Root", "Nested Collection", "Root Collection"]);

    const renamed = asSingle(ok(await callTool("pinar.rename_collection", { collectionId: String(nestedCollection.id), name: "Renamed Nested" }), "rename_collection"), "rename_collection.collection");
    assert.equal(renamed.name, "Renamed Nested");
    assert.ok((await storedCollections(projectId)).some((item) => item.id === nestedCollection.id && item.name === "Renamed Nested"), "renamed collection must persist");

    const other = await createProject("Other Project");
    const foreign = await createCollection(String(other.id), "Foreign Collection");
    failure(await callTool("pinar.create_collection", { name: "Orphan", projectId: "missing_project" }), "create_collection unknown project");
    failure(await callTool("pinar.create_collection", { name: "Orphan", parentId: "missing_parent", projectId }), "create_collection unknown parent");
    failure(await callTool("pinar.create_collection", { name: "Orphan", parentId: String(foreign.id), projectId }), "create_collection foreign parent");
    failure(await callTool("pinar.create_collection", { name: "   ", projectId }), "create_collection blank name");
    failure(await callTool("pinar.rename_collection", { collectionId: "missing_collection", name: "New Name" }), "rename_collection unknown id");
  });

  test("reorders and reparents collections with a complete item list", async () => {
    const project = await createProject("Reorder Project");
    const projectId = String(project.id);
    const a = await createCollection(projectId, "Col A");
    const b = await createCollection(projectId, "Col B");
    const c = await createCollection(projectId, "Col C");

    const result = ok(await callTool("pinar.reorder_collections", {
      items: [
        { id: String(c.id), parentId: null },
        { id: String(a.id), parentId: null },
        { id: String(b.id), parentId: String(a.id) },
      ],
      projectId,
    }), "reorder_collections");
    const collections = asRecords(result.collections);
    assert.equal(collections.length, 3);
    assert.deepEqual(collections.map((item) => item.id), [String(c.id), String(a.id), String(b.id)]);
    const byId = new Map(collections.map((item) => [String(item.id), item]));
    assert.equal(byId.get(String(c.id))?.parentId, null);
    assert.equal(byId.get(String(a.id))?.parentId, null);
    assert.equal(byId.get(String(b.id))?.parentId, String(a.id));

    const stored = await storedCollections(projectId);
    assert.equal(stored.find((item) => item.id === b.id)?.parentId, a.id, "reparented collection must persist");
  });

  test("rejects invalid collection hierarchies without mutation", async () => {
    const project = await createProject("Invalid Hierarchy");
    const projectId = String(project.id);
    const a = await createCollection(projectId, "Col A");
    const b = await createCollection(projectId, "Col B");
    const other = await createProject("Other Project");
    const foreign = await createCollection(String(other.id), "Foreign Collection");
    const snapshot = await storedCollections(projectId);

    const invalid: Array<[string, Record<string, unknown>]> = [
      ["empty items", { items: [], projectId }],
      ["partial items", { items: [{ id: String(a.id), parentId: null }], projectId }],
      ["duplicate item", { items: [{ id: String(a.id), parentId: null }, { id: String(a.id), parentId: null }], projectId }],
      ["unknown id", { items: [{ id: String(a.id), parentId: null }, { id: "missing", parentId: null }], projectId }],
      ["cycle", { items: [{ id: String(a.id), parentId: String(b.id) }, { id: String(b.id), parentId: String(a.id) }], projectId }],
      ["self parent", { items: [{ id: String(a.id), parentId: String(a.id) }, { id: String(b.id), parentId: null }], projectId }],
      ["unknown parent", { items: [{ id: String(a.id), parentId: "missing" }, { id: String(b.id), parentId: null }], projectId }],
      ["foreign parent", { items: [{ id: String(a.id), parentId: String(foreign.id) }, { id: String(b.id), parentId: null }], projectId }],
      ["non-array items", { items: "col-a", projectId }],
      ["malformed item", { items: [{ id: String(a.id) }, String(b.id)], projectId }],
      ["non-string id", { items: [{ id: 42, parentId: null }, { id: String(b.id), parentId: null }], projectId }],
      ["unknown project", { items: [{ id: String(a.id), parentId: null }, { id: String(b.id), parentId: null }], projectId: "missing_project" }],
    ];
    for (const [label, args] of invalid) {
      failure(await callTool("pinar.reorder_collections", args), `reorder_collections ${label}`);
    }
    assert.deepEqual(await storedCollections(projectId), snapshot, "rejected reorders must not mutate the collection hierarchy");
  });

  test("keeps the protected Inbox at the root during collection reorders", async () => {
    const personal = await protectedProject();
    const projectId = String(personal.id);
    const inbox = (await storedCollections(projectId)).find((item) => item.isProtected === true);
    assert.ok(inbox, "expected the protected Inbox collection");
    const extra = await createCollection(projectId, "Personal Collection");

    const result = ok(await callTool("pinar.reorder_collections", {
      items: [
        { id: String(extra.id), parentId: null },
        { id: String(inbox.id), parentId: null },
      ],
      projectId,
    }), "reorder_collections with the protected inbox");
    assert.deepEqual(asRecords(result.collections).map((item) => item.id), [String(extra.id), String(inbox.id)]);

    const before = await storedCollections(projectId);
    failure(
      await callTool("pinar.reorder_collections", {
        items: [
          { id: String(inbox.id), parentId: String(extra.id) },
          { id: String(extra.id), parentId: null },
        ],
        projectId,
      }),
      "moving the protected inbox under another collection",
    );
    assert.deepEqual(await storedCollections(projectId), before, "rejected reorder must not move the protected inbox or its siblings");
  });

  test("lists batches as bounded metadata", async () => {
    await seedSession("batch_session_one", { batch: { id: "batch_one", label: "First batch", startedAt: "2026-09-01T00:00:00.000Z" } });
    await seedSession("batch_session_two", { batch: { id: "batch_two", label: "Second batch", startedAt: "2026-09-02T00:00:00.000Z" } });

    const listed = page(await callTool("pinar.list_batches", {}), "list_batches");
    assert.equal(listed.limit, 50);
    assert.equal(listed.offset, 0);
    const batches = asRecords(listed.batches);
    assert.equal(batches.length, 2);
    assert.deepEqual(batches.map((item) => item.id), ["batch_two", "batch_one"]);
    assert.deepEqual(batches.map((item) => item.label), ["Second batch", "First batch"]);
    for (const batch of batches) {
      assert.equal(batch.sessionCount, 1);
      assert.ok(!("sessions" in batch), "batch metadata must not embed sessions");
    }

    const limited = page(await callTool("pinar.list_batches", { limit: 1 }), "list_batches limit=1");
    assert.equal(asRecords(limited.batches).length, 1);

    const stored = await storedBatches();
    assert.deepEqual(stored.map((item) => [item.id, item.sessionCount]), [
      ["batch_two", 1],
      ["batch_one", 1],
    ], "batch metadata must match the persisted storage");

    failure(await callTool("pinar.list_batches", { limit: 51 }), "list_batches limit=51");
    failure(await callTool("pinar.list_batches", { offset: 10001 }), "list_batches offset=10001");
  });

  test("returns batch markdown for the stored batch pages", async () => {
    await seedSession("batch_markdown_session", {
      batch: { id: "batch_markdown", label: "Markdown batch", startedAt: "2026-09-03T00:00:00.000Z" },
      note: "Batch pin note",
    });

    const text = markdown(await callTool("pinar.get_batch_markdown", { batchId: "batch_markdown" }), "get_batch_markdown");
    assert.match(text, /^# Markdown batch$/m);
    assert.match(text, /## Session batch_markdown_session/);
    assert.match(text, /Batch pin note/);
    assert.match(text, /pinar-visual-context/);
    assert.match(text, urlPattern(`${ORIGIN}/v/batch_markdown_session.md`));

    failure(await callTool("pinar.get_batch_markdown", { batchId: "missing_batch" }), "get_batch_markdown unknown id");
    failure(await callTool("pinar.get_batch_markdown", { batchId: "   " }), "get_batch_markdown blank id");
  });

  test("moves a session between collections and persists the move", async () => {
    const project = await createProject("Move Project");
    const source = await createCollection(String(project.id), "Source Collection");
    const target = await createCollection(String(project.id), "Target Collection");
    await seedSession("move_session", { collectionId: String(source.id) });
    assert.deepEqual((await storedSessionsInCollection(String(source.id))).map((item) => item.id), ["move_session"]);

    const result = ok(await callTool("pinar.move_session", { collectionId: String(target.id), sessionId: "move_session" }), "move_session");
    assert.equal(asSingle(result, "move_session.session").collectionId, target.id);

    assert.deepEqual((await storedSessionsInCollection(String(target.id))).map((item) => item.id), ["move_session"], "session must persist in the target collection");
    assert.deepEqual(await storedSessionsInCollection(String(source.id)), [], "session must leave the source collection");
    const movedPayload = await storedSessionPayload("move_session");
    assert.equal(asSingle(movedPayload, "stored payload.session").collectionId, target.id);

    failure(await callTool("pinar.move_session", { collectionId: String(target.id), sessionId: "missing_session" }), "move_session unknown session");
    failure(await callTool("pinar.move_session", { collectionId: "missing_collection", sessionId: "move_session" }), "move_session unknown collection");
  });

  test("reorders sessions within a collection with a complete id list", async () => {
    const project = await createProject("Sessions Project");
    const collection = await createCollection(String(project.id), "Sessions Collection");
    await seedSession("session_first", { collectionId: String(collection.id) });
    await seedSession("session_second", { collectionId: String(collection.id) });
    assert.deepEqual((await storedSessionsInCollection(String(collection.id))).map((item) => item.id), ["session_first", "session_second"]);

    const result = ok(await callTool("pinar.reorder_sessions", { collectionId: String(collection.id), ids: ["session_second", "session_first"] }), "reorder_sessions");
    assert.deepEqual(asRecords(result.sessions).map((item) => item.id), ["session_second", "session_first"]);
    assert.deepEqual(
      (await storedSessionsInCollection(String(collection.id))).map((item) => item.id),
      ["session_second", "session_first"],
      "reordered session positions must persist",
    );
  });

  test("rejects invalid session orders without mutation", async () => {
    const project = await createProject("Invalid Sessions");
    const collection = await createCollection(String(project.id), "Invalid Collection");
    await seedSession("session_one", { collectionId: String(collection.id) });
    await seedSession("session_two", { collectionId: String(collection.id) });
    const snapshot = (await storedSessionsInCollection(String(collection.id))).map((item) => [item.id, item.position]);

    const invalid: Array<[string, Record<string, unknown>]> = [
      ["empty ids", { collectionId: String(collection.id), ids: [] }],
      ["partial order", { collectionId: String(collection.id), ids: ["session_one"] }],
      ["duplicate id", { collectionId: String(collection.id), ids: ["session_one", "session_one"] }],
      ["unknown id", { collectionId: String(collection.id), ids: ["session_one", "session_two", "missing_session"] }],
      ["unknown collection", { collectionId: "missing_collection", ids: ["session_one", "session_two"] }],
      ["non-array ids", { collectionId: String(collection.id), ids: "session_one" }],
      ["non-string id", { collectionId: String(collection.id), ids: ["session_one", 42] }],
    ];
    for (const [label, args] of invalid) {
      failure(await callTool("pinar.reorder_sessions", args), `reorder_sessions ${label}`);
    }
    const after = (await storedSessionsInCollection(String(collection.id))).map((item) => [item.id, item.position]);
    assert.deepEqual(after, snapshot, "rejected reorders must not mutate session positions");
  });

  test("concludes a pin as a human accept and persists the transition", async () => {
    await seedSession("conclude_session");

    const result = ok(await callTool("pinar.conclude_pin", { pinId: "pin_one", sessionId: "conclude_session" }), "conclude_pin");
    assert.equal(result.changed, true);
    const review = asSingle(result, "conclude_pin.review");
    assert.equal(review.status, "accepted");
    assert.equal(review.pinId, "pin_one");

    const payload = await storedSessionPayload("conclude_session");
    const reviews = asRecords(payload.reviews);
    assert.equal(reviews.length, 1);
    assert.equal(reviews[0]?.status, "accepted", "concluded state must persist");
    const lastEvent = asRecords(reviews[0]?.timeline).at(-1);
    assert.deepEqual(
      {
        actorId: lastEvent?.actorId,
        actorType: lastEvent?.actorType,
        fromStatus: lastEvent?.fromStatus,
        origin: lastEvent?.origin,
        toStatus: lastEvent?.toStatus,
      },
      { actorId: "local", actorType: "human", fromStatus: "open", origin: "human", toStatus: "accepted" },
      "conclude must record a human event from the local actor",
    );
    assert.deepEqual(payload.executions, [], "Local conclude must not create agent executions");

    const markdownResult = markdown(await callTool("pinar.get_session_markdown", { sessionId: "conclude_session" }), "get_session_markdown after conclude");
    assert.match(markdownResult, /## Pin review/);
    assert.match(markdownResult, /accepted/);

    failure(await callTool("pinar.conclude_pin", { pinId: "pin_one", sessionId: "conclude_session" }), "repeated conclude_pin");
    const afterRepeat = await storedSessionPayload("conclude_session");
    assert.equal(asRecords(afterRepeat.reviews)[0]?.status, "accepted", "a rejected transition must not change state");

    failure(await callTool("pinar.conclude_pin", { pinId: "missing_pin", sessionId: "conclude_session" }), "conclude_pin unknown pin");
    failure(await callTool("pinar.conclude_pin", { pinId: "pin_one", sessionId: "missing_session" }), "conclude_pin unknown session");
  });

  test("reopens an accepted pin and follows the store transition contract", async () => {
    await seedSession("reopen_session");

    failure(await callTool("pinar.reopen_pin", { pinId: "pin_one", sessionId: "reopen_session" }), "reopen_pin on an open pin");

    ok(await callTool("pinar.conclude_pin", { pinId: "pin_one", sessionId: "reopen_session" }), "setup conclude_pin");

    const result = ok(await callTool("pinar.reopen_pin", { pinId: "pin_one", sessionId: "reopen_session" }), "reopen_pin");
    assert.equal(result.changed, true);
    assert.equal(asSingle(result, "reopen_pin.review").status, "reopened");

    const payload = await storedSessionPayload("reopen_session");
    const reviews = asRecords(payload.reviews);
    assert.equal(reviews[0]?.status, "reopened", "reopened state must persist");
    const lastEvent = asRecords(reviews[0]?.timeline).at(-1);
    assert.deepEqual(
      {
        actorId: lastEvent?.actorId,
        actorType: lastEvent?.actorType,
        fromStatus: lastEvent?.fromStatus,
        origin: lastEvent?.origin,
        toStatus: lastEvent?.toStatus,
      },
      { actorId: "local", actorType: "human", fromStatus: "accepted", origin: "human", toStatus: "reopened" },
      "reopen must record a human event from the local actor",
    );

    failure(await callTool("pinar.reopen_pin", { pinId: "pin_one", sessionId: "reopen_session" }), "repeated reopen_pin");

    const reconclude = ok(await callTool("pinar.conclude_pin", { pinId: "pin_one", sessionId: "reopen_session" }), "conclude_pin after reopen");
    assert.equal(asSingle(reconclude, "conclude_pin.review").status, "accepted");
    const afterReconclude = await storedSessionPayload("reopen_session");
    assert.equal(asRecords(afterReconclude.reviews)[0]?.status, "accepted", "re-concluded state must persist");

    failure(await callTool("pinar.reopen_pin", { pinId: "missing_pin", sessionId: "reopen_session" }), "reopen_pin unknown pin");
  });

  test("denies hostile origins for the organization tools", async () => {
    const project = await createProject("Hostile Project");
    await seedSession("hostile_org_session", { collectionId: String(project.id) });

    const calls: Array<[string, Record<string, unknown>]> = [
      ["pinar.list_projects", {}],
      ["pinar.get_project_markdown", { projectId: String(project.id) }],
      ["pinar.list_collections", { projectId: String(project.id) }],
      ["pinar.get_collection_markdown", { collectionId: "missing" }],
      ["pinar.list_batches", {}],
      ["pinar.get_batch_markdown", { batchId: "missing" }],
      ["pinar.create_project", { name: "Hostile Project" }],
      ["pinar.rename_project", { name: "Hostile Project", projectId: String(project.id) }],
      ["pinar.reorder_projects", { ids: [] }],
      ["pinar.create_collection", { name: "Hostile Collection", projectId: String(project.id) }],
      ["pinar.rename_collection", { collectionId: "missing", name: "Hostile Collection" }],
      ["pinar.reorder_collections", { items: [], projectId: String(project.id) }],
      ["pinar.move_session", { collectionId: "missing", sessionId: "hostile_org_session" }],
      ["pinar.reorder_sessions", { collectionId: "missing", ids: [] }],
      ["pinar.conclude_pin", { pinId: "pin_one", sessionId: "hostile_org_session" }],
      ["pinar.reopen_pin", { pinId: "pin_one", sessionId: "hostile_org_session" }],
    ];
    for (const [name, args] of calls) {
      const result = await callTool(name, args, { headers: { origin: "https://evil.example" } });
      assert.equal(result.response.status, 401, `${name} must deny hostile origins with 401, got ${result.response.status}`);
    }
    assert.equal((await storedProjects()).filter((item) => item.name === "Hostile Project" && item.id !== project.id).length, 0, "denied calls must not create projects");
  });
});

function asSingle(body: Record<string, unknown>, label: string): Record<string, unknown> {
  const key = label.split(".")[1];
  assert.ok(key, `${label}: expected a dotted field label`);
  const value = body[key];
  assert.ok(isRecord(value), `${label}: expected an object payload, got ${JSON.stringify(value).slice(0, 160)}`);
  return value;
}
