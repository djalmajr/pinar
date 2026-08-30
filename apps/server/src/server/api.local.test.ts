import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  authorizeAppRequest,
  handleApiRequest,
  handlePublicRequest,
  resetLocalApiForTests,
} from "./api.local";
import { exerciseProjectApiContract } from "./project-api.contract";
import { exerciseVisualContextContract } from "./visual-context.contract";
import { exerciseAgentResultsContract } from "./agent-results.contract";
import { exercisePinReviewContract } from "./pin-review.contract";
import { exerciseClosedLoopContract } from "./closed-loop.contract";

const VALID_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

let root = "";
let previousHome: string | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function jsonBody(response: Response) {
  const body: unknown = await response.json();
  assert.ok(isRecord(body));
  return body;
}

function request(path: string, init: RequestInit = {}) {
  return handleApiRequest(new Request(`http://127.0.0.1:17373${path}`, init));
}

describe("local TanStack API", () => {
  beforeEach(async () => {
    previousHome = process.env.PINAR_HOME;
    root = await mkdtemp(join(tmpdir(), "pinar-local-api-"));
    process.env.PINAR_HOME = root;
    resetLocalApiForTests();
  });

  afterEach(async () => {
    resetLocalApiForTests();
    if (previousHome === undefined) delete process.env.PINAR_HOME;
    else process.env.PINAR_HOME = previousHome;
    await rm(root, { force: true, recursive: true });
  });

  test("recreates storage, stores one shots directory, and exposes history and markdown", async () => {
    const health = await request("/api/health");
    assert.equal(health.status, 200);
    assert.equal((await jsonBody(health)).runtime, "local");
    assert.equal(await authorizeAppRequest(), true);
    assert.deepEqual(await jsonBody(await request("/api/auth/session")), {
      session: { kind: "local", plan: "free" },
    });

    const upload = await request("/api/shots", {
      body: JSON.stringify({
        id: "local_session_001",
        image: VALID_PNG,
        page: { title: "Local session", url: "https://example.test/local" },
        pins: [{ anchor: { x: 12, y: 34 }, comment: "Local pin", kind: "element" }],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(upload.status, 201);
    assert.equal(existsSync(join(root, "shots", "local_session_001.png")), true);
    assert.equal(existsSync(join(root, "shots", "shots")), false);
    assert.equal(existsSync(join(root, "history.db")), true);

    const invalidUpload = await request("/api/shots", {
      body: JSON.stringify({ id: "broken_session", image: "data:image/png;base64,iVBORw==" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(invalidUpload.status, 400);
    assert.equal(existsSync(join(root, "shots", "broken_session.png")), false);

    const history = await request("/api/history");
    const historyBody = await jsonBody(history);
    assert.ok(Array.isArray(historyBody.sessions));
    assert.equal(historyBody.sessions.length, 1);

    const session = await request("/api/sessions/local_session_001");
    assert.equal(session.status, 200);
    const sessionBody = await jsonBody(session);
    assert.ok(isRecord(sessionBody.session));
    assert.ok(Array.isArray(sessionBody.session.pins));
    assert.equal(sessionBody.session.schemaVersion, 1);
    assert.equal(sessionBody.session.captureId, "local_session_001");
    assert.equal(sessionBody.session.pins[0].comment, "Local pin");
    assert.equal(sessionBody.session.pins[0].kind, "element");
    assert.equal(sessionBody.session.pins[0].number, 1);
    assert.equal(sessionBody.session.pins[0].pinId, "local_session_001:p1");
    assert.deepEqual(sessionBody.session.pins[0].coords, { x: 12, y: 34 });
    const markdown = await handlePublicRequest(
      new Request("http://127.0.0.1:17373/v/local_session_001.md"),
    );
    assert.equal(markdown.status, 200);
    assert.match(await markdown.text(), /Local pin/);
    const shot = await handlePublicRequest(
      new Request("http://127.0.0.1:17373/shots/local_session_001.png"),
    );
    assert.equal(shot.status, 200);
    assert.equal(shot.headers.get("cache-control"), "no-store");

    assert.equal((await request("/api/history/local_session_001", { method: "DELETE" })).status, 200);
    assert.equal(existsSync(join(root, "shots", "local_session_001.png")), false);
  });

  test("does not proxy cloud pricing or checkout", async () => {
    let fetched = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetched += 1;
      return Response.json({ leaked: true });
    }) as typeof fetch;
    try {
      const pricing = await request("/api/pricing");
      const checkout = await request("/api/stripe/checkout", {
        body: JSON.stringify({ interval: "year" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      assert.equal(pricing.status, 404);
      assert.equal(checkout.status, 404);
      assert.deepEqual(await jsonBody(pricing), { error: "not found" });
      assert.deepEqual(await jsonBody(checkout), { error: "not found" });
      assert.equal(fetched, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("provides project and collection CRUD with safe capture fallback", async () => {
    // Mutation captured: accepting the requested collection without resolving it leaks orphan sessions into the API.
    const initialTree = await jsonBody(await request("/api/project-tree"));
    assert.ok(isRecord(initialTree.tree));
    assert.ok(Array.isArray(initialTree.tree.projects));
    const personal = initialTree.tree.projects[0];
    assert.ok(isRecord(personal));
    assert.equal(personal.name, "Personal");
    assert.equal(personal.isProtected, true);
    assert.ok(Array.isArray(personal.collections));
    const inbox = personal.collections[0];
    assert.ok(isRecord(inbox));
    assert.equal(inbox.name, "Inbox");

    const projectResponse = await request("/api/projects", {
      body: JSON.stringify({ name: "Website" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(projectResponse.status, 201);
    const projectBody = await jsonBody(projectResponse);
    assert.ok(isRecord(projectBody.project));
    const projectId = String(projectBody.project.id);

    const collectionResponse = await request(`/api/projects/${projectId}/collections`, {
      body: JSON.stringify({ name: "Review" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(collectionResponse.status, 201);
    const collectionBody = await jsonBody(collectionResponse);
    assert.ok(isRecord(collectionBody.collection));
    const collectionId = String(collectionBody.collection.id);

    const upload = await request("/api/shots", {
      body: JSON.stringify({
        collectionId,
        id: "organized-session",
        image: VALID_PNG,
        page: { title: "Organized", url: "https://example.test/organized" },
        pins: [],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const uploadBody = await jsonBody(upload);
    assert.ok(isRecord(uploadBody.destination));
    assert.equal(uploadBody.destination.collectionId, collectionId);
    assert.equal(uploadBody.destination.projectId, projectId);
    const projectMarkdown = await handlePublicRequest(
      new Request(`http://127.0.0.1:17373/p/${projectId}.md`),
    );
    assert.equal(projectMarkdown.status, 200);
    assert.match(await projectMarkdown.text(), /Organized/);
    const collectionMarkdown = await handlePublicRequest(
      new Request(`http://127.0.0.1:17373/c/${collectionId}.md`),
    );
    assert.equal(collectionMarkdown.status, 200);
    assert.match(await collectionMarkdown.text(), /\/v\/organized-session/);

    const fallbackUpload = await request("/api/shots", {
      body: JSON.stringify({
        collectionId: "deleted-or-foreign",
        id: "fallback-session",
        image: VALID_PNG,
        page: { title: "Fallback", url: "https://example.test/fallback" },
        pins: [],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const fallbackBody = await jsonBody(fallbackUpload);
    assert.ok(isRecord(fallbackBody.destination));
    assert.equal(fallbackBody.destination.collectionId, inbox.id);

    const deleted = await request(`/api/projects/${projectId}`, { method: "DELETE" });
    assert.equal(deleted.status, 200);
    assert.equal(existsSync(join(root, "shots", "organized-session.png")), true);
    const movedBody = await jsonBody(await request("/api/sessions/organized-session"));
    assert.ok(isRecord(movedBody.session));
    assert.equal(movedBody.session.collectionId, inbox.id);
    assert.equal((await request(`/api/projects/${personal.id}`, { method: "DELETE" })).status, 409);
  });

  test("matches the shared projects and collections API contract", async () => {
    await exerciseProjectApiContract(request);
  });

  test("matches the shared visual context contract", async () => {
    await exerciseVisualContextContract(request, (path, init) => (
      handlePublicRequest(new Request(`http://127.0.0.1:17373${path}`, init))
    ));
  });

  test("matches the shared agent results contract", async () => {
    await exerciseAgentResultsContract(request, (path, init) => (
      handlePublicRequest(new Request(`http://127.0.0.1:17373${path}`, init))
    ));
  });

  test("matches the shared pin review contract", async () => {
    await exercisePinReviewContract(request, (path, init) => (
      handlePublicRequest(new Request(`http://127.0.0.1:17373${path}`, init))
    ));
  });

  test("matches the closed-loop pin, handoff, review and opt-in metrics contract", async () => {
    await exerciseClosedLoopContract(request);
  });
});
