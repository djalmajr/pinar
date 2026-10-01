import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
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
import { openHistoryDb } from "@pinar/cli/history";
import { setLocalAiDependenciesForTests } from "./ai/local-ai";

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
    const markdownText = await markdown.text();
    assert.match(markdownText, /Local pin/);
    assert.match(markdownText, /Screenshot:/);
    assert.equal(sessionBody.session.includeScreenshot, true);
    const shot = await handlePublicRequest(
      new Request("http://127.0.0.1:17373/shots/local_session_001.png"),
    );
    assert.equal(shot.status, 200);
    assert.equal(shot.headers.get("cache-control"), "no-store");

    assert.equal((await request("/api/history/local_session_001", { method: "DELETE" })).status, 200);
    assert.equal(existsSync(join(root, "shots", "local_session_001.png")), false);
  });

  test("serves session markdown from the live helper preference", async () => {
    const defaults = await jsonBody(await request("/api/preferences"));
    assert.equal(defaults.ok, true);
    assert.equal(defaults.handoffMode, "compact");
    assert.equal(defaults.includeScreenshot, true);

    const upload = await request("/api/shots", {
      body: JSON.stringify({
        id: "local_session_live_pref",
        image: VALID_PNG,
        page: { title: "Login", url: "https://example.test/login" },
        pins: [{ comment: "Fix the form", kind: "element" }],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(upload.status, 201);
    const session = await jsonBody(await request("/api/sessions/local_session_live_pref"));
    assert.ok(isRecord(session.session));
    assert.equal(session.session.includeScreenshot, true);
    assert.match(String(session.session.shotUrl), /\/shots\/local_session_live_pref\.png/);
    const withShot = await handlePublicRequest(
      new Request("http://127.0.0.1:17373/v/local_session_live_pref.md"),
    );
    assert.match(await withShot.text(), /Screenshot:/);

    const patched = await jsonBody(await request("/api/preferences", {
      body: JSON.stringify({ includeScreenshot: false }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    }));
    assert.equal(patched.includeScreenshot, false);
    assert.equal(patched.handoffMode, "compact");
    const detailed = await jsonBody(await request("/api/preferences", {
      body: JSON.stringify({ handoffMode: "full" }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    }));
    assert.equal(detailed.handoffMode, "full");
    assert.equal(detailed.includeScreenshot, false);
    const emptyPatch = await jsonBody(await request("/api/preferences", {
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    }));
    assert.equal(emptyPatch.handoffMode, "full");
    assert.equal(emptyPatch.includeScreenshot, false);

    const markdown = await handlePublicRequest(
      new Request("http://127.0.0.1:17373/v/local_session_live_pref.md"),
    );
    assert.equal(markdown.status, 200);
    const text = await markdown.text();
    assert.match(text, /Fix the form/);
    assert.doesNotMatch(text, /Screenshot:/);
    assert.doesNotMatch(text, /screenshot_missing/);
  });

  test("falls back to captureDestination when a shot omits a collection", async () => {
    const defaults = await jsonBody(await request("/api/preferences"));
    assert.deepEqual(defaults, {
      ok: true,
      captureDestination: null,
      componentTarget: null,
      copyOnFinishBatch: "prompt",
      copyViewerContent: false,
      handoffMode: "compact",
      includeScreenshot: true,
      includeViewer: true,
      language: null,
      sensitiveQueryKeys: "",
      voicePostProcessing: false,
    });

    const tree = await jsonBody(await request("/api/project-tree"));
    assert.ok(isRecord(tree.tree));
    assert.ok(Array.isArray(tree.tree.projects));
    const personal = tree.tree.projects[0];
    assert.ok(isRecord(personal));
    assert.ok(Array.isArray(personal.collections));
    const inbox = personal.collections[0];
    assert.ok(isRecord(inbox));

    const projectBody = await jsonBody(await request("/api/projects", {
      body: JSON.stringify({ name: "Preferred" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }));
    assert.ok(isRecord(projectBody.project));
    const projectId = String(projectBody.project.id);
    const collectionBody = await jsonBody(await request(`/api/projects/${projectId}/collections`, {
      body: JSON.stringify({ name: "Review" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }));
    assert.ok(isRecord(collectionBody.collection));
    const collectionId = String(collectionBody.collection.id);

    const patched = await jsonBody(await request("/api/preferences", {
      body: JSON.stringify({
        captureDestination: { collectionId, projectId },
        copyOnFinishBatch: "link",
        voicePostProcessing: true,
      }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    }));
    assert.deepEqual(patched.captureDestination, { collectionId, projectId });
    assert.equal(patched.copyOnFinishBatch, "link");
    assert.equal(patched.includeScreenshot, true);
    assert.equal(patched.voicePostProcessing, true);

    const preferred = await jsonBody(await request("/api/shots", {
      body: JSON.stringify({
        id: "pref_dest_session",
        image: VALID_PNG,
        page: { title: "Preferred dest", url: "https://example.test/pref" },
        pins: [],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }));
    assert.ok(isRecord(preferred.destination));
    assert.deepEqual(preferred.destination, { collectionId, projectId });

    const explicit = await jsonBody(await request("/api/shots", {
      body: JSON.stringify({
        collectionId: String(inbox.id),
        id: "explicit_dest_session",
        image: VALID_PNG,
        page: { title: "Explicit dest", url: "https://example.test/explicit" },
        pins: [],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }));
    assert.ok(isRecord(explicit.destination));
    assert.equal(explicit.destination.collectionId, inbox.id);

    await request("/api/preferences", {
      body: JSON.stringify({
        captureDestination: { collectionId: "missing-collection", projectId },
      }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    const missing = await jsonBody(await request("/api/shots", {
      body: JSON.stringify({
        id: "missing_dest_session",
        image: VALID_PNG,
        page: { title: "Missing dest", url: "https://example.test/missing" },
        pins: [],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }));
    assert.ok(isRecord(missing.destination));
    assert.equal(missing.destination.collectionId, inbox.id);
  });

  test("session includeScreenshot stamp does not control live markdown", async () => {
    const upload = await request("/api/shots", {
      body: JSON.stringify({
        id: "local_session_stamp_only",
        image: VALID_PNG,
        includeScreenshot: false,
        page: { title: "Login", url: "https://example.test/login" },
        pins: [{ comment: "Fix the form", kind: "element" }],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(upload.status, 201);
    const session = await jsonBody(await request("/api/sessions/local_session_stamp_only"));
    assert.ok(isRecord(session.session));
    assert.equal(session.session.includeScreenshot, false);
    const markdown = await handlePublicRequest(
      new Request("http://127.0.0.1:17373/v/local_session_stamp_only.md"),
    );
    assert.match(await markdown.text(), /Screenshot:/);
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

  test("rejects agent feedback locally without persisting", async () => {
    const upload = await request("/api/shots", {
      body: JSON.stringify({
        id: "local_no_agents",
        image: VALID_PNG,
        page: { title: "No agents", url: "https://example.test/no-agents" },
        pins: [{ comment: "Human pin", kind: "element", pinId: "pin_cta" }],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(upload.status, 201);

    const payload = {
      agent: "cursor",
      captureId: "local_no_agents",
      idempotencyKey: "exec_local_blocked_01",
      results: [{ pinId: "pin_cta", status: "changed", summary: "Agent correction" }],
    };
    const blocked = await request("/api/agent-executions", {
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(blocked.status, 410);
    const blockedBody = await jsonBody(blocked);
    assert.equal(blockedBody.ok, false);
    assert.equal(blockedBody.error, "agent_feedback_disabled");

    const replay = await request("/api/agent-executions", {
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(replay.status, 410);

    const session = await jsonBody(await request("/api/sessions/local_no_agents"));
    assert.deepEqual(session.executions, []);
    assert.ok(Array.isArray(session.reviews));

    const markdown = await handlePublicRequest(
      new Request("http://127.0.0.1:17373/v/local_no_agents.md"),
    );
    assert.equal(markdown.status, 200);
    const text = await markdown.text();
    assert.match(text, /Human pin/);
    assert.doesNotMatch(text, /## Agent results/);
    assert.doesNotMatch(text, /Agent correction/);

    const handoff = await request("/api/sessions/local_no_agents/markdown?includeViewerContent=1");
    assert.equal(handoff.status, 200);
    const handoffText = await handoff.text();
    assert.match(handoffText, /Human pin/);
    assert.equal(handoffText.match(/```pinar-visual-context/g)?.length, 1);
    assert.doesNotMatch(handoffText, /Complementary history|pinar-viewer-reference/);
    assert.doesNotMatch(handoffText, /Agent correction/);
  });

  test("keeps human pin review in Local without agent results", async () => {
    const upload = await request("/api/shots", {
      body: JSON.stringify({
        id: "local_human_review",
        image: VALID_PNG,
        page: { title: "Human review", url: "https://example.test/human-review" },
        pins: [{ comment: "Review me", kind: "element", pinId: "pin_cta" }],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(upload.status, 201);

    const review = (action: string) => request("/api/sessions/local_human_review/pins/pin_cta/review", {
      body: JSON.stringify({ action }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal((await review("accept")).status, 200);
    assert.equal((await review("accept")).status, 409);
    assert.equal((await review("reopen")).status, 200);
    const acceptedAgain = await jsonBody(await review("accept"));
    assert.equal(acceptedAgain.ok, true);
    assert.ok(isRecord(acceptedAgain.review));
    assert.equal(acceptedAgain.review.status, "accepted");

    const session = await jsonBody(await request("/api/sessions/local_human_review"));
    assert.deepEqual(session.executions, []);
    assert.ok(Array.isArray(session.reviews));
    const stored = session.reviews.find((item) => isRecord(item) && item.pinId === "pin_cta");
    assert.ok(isRecord(stored));
    assert.equal(stored.status, "accepted");
  });

  test("hides legacy agent feedback in Local while keeping human review", async () => {
    const upload = await request("/api/shots", {
      body: JSON.stringify({
        batch: { id: "local_legacy_batch", label: "Legacy batch", startedAt: new Date().toISOString() },
        id: "local_legacy_agent",
        image: VALID_PNG,
        page: { title: "Legacy agent", url: "https://example.test/legacy-agent" },
        pins: [
          { comment: "Human pin A", kind: "element", pinId: "pin_a" },
          { comment: "Human pin B", kind: "element", pinId: "pin_b" },
        ],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(upload.status, 201);

    const acceptA = await request("/api/sessions/local_legacy_agent/pins/pin_a/review", {
      body: JSON.stringify({ action: "accept" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(acceptA.status, 200);

    // Rows written by a previous agent run can only pre-exist: the Local API
    // rejects new agent feedback with 410, so seed them directly in history.
    const legacyDb = openHistoryDb(root);
    try {
      legacyDb.saveAgentExecution({
        agent: "cursor",
        captureId: "local_legacy_agent",
        idempotencyKey: "legacy_exec_01",
        results: [{ pinId: "pin_b", status: "changed", summary: "Legacy agent summary" }],
      });
    } finally {
      legacyDb.close();
    }

    const session = await jsonBody(await request("/api/sessions/local_legacy_agent"));
    assert.deepEqual(session.executions, []);
    assert.ok(Array.isArray(session.reviews));
    for (const item of session.reviews) {
      assert.ok(isRecord(item));
      assert.notEqual(item.status, "correction_ready");
      const timeline = Array.isArray(item.timeline) ? item.timeline : [];
      for (const event of timeline) {
        assert.ok(isRecord(event));
        assert.notEqual(event.origin, "agent_result");
      }
    }
    const acceptedA = session.reviews.find((item) => isRecord(item) && item.pinId === "pin_a");
    assert.ok(isRecord(acceptedA));
    assert.equal(acceptedA.status, "accepted");

    const markdown = await handlePublicRequest(
      new Request("http://127.0.0.1:17373/v/local_legacy_agent.md"),
    );
    assert.equal(markdown.status, 200);
    const text = await markdown.text();
    assert.match(text, /Human pin A/);
    assert.match(text, /Human pin B/);
    assert.doesNotMatch(text, /Legacy agent summary/);
    assert.doesNotMatch(text, /## Agent results/);
    assert.doesNotMatch(text, /correction_ready/);
    assert.doesNotMatch(text, /agent_result/);

    const handoff = await request("/api/sessions/local_legacy_agent/markdown?includeViewerContent=1");
    assert.equal(handoff.status, 200);
    const handoffText = await handoff.text();
    assert.match(handoffText, /Human pin A/);
    assert.match(handoffText, /Human pin B/);
    // The accepted pin moves out of the actionable block into the complementary history, once.
    assert.equal(handoffText.match(/```pinar-visual-context/g)?.length, 1);
    assert.equal(handoffText.match(/Human pin A/g)?.length, 1);
    assert.equal(handoffText.match(/Human pin B/g)?.length, 1);
    assert.match(handoffText.split("## Complementary history (not actionable)")[1] ?? "", /Human pin A/);
    assert.doesNotMatch(handoffText, /pinar-viewer-reference/);
    assert.doesNotMatch(handoffText, /Legacy agent summary/);
    assert.doesNotMatch(handoffText, /correction_ready/);
    assert.doesNotMatch(handoffText, /agent_result/);

    const history = await jsonBody(await request("/api/history"));
    assert.ok(Array.isArray(history.sessions));
    const listed = history.sessions.find((item) => isRecord(item) && item.id === "local_legacy_agent");
    assert.ok(isRecord(listed) && isRecord(listed.reviewCounts));
    assert.equal(listed.reviewCounts.correction_ready ?? 0, 0);
    assert.equal(listed.reviewCounts.accepted, 1);

    const batch = await request("/api/batches/local_legacy_batch/markdown");
    assert.equal(batch.status, 200);
    const batchText = await batch.text();
    assert.match(batchText, /Human pin B/);
    assert.doesNotMatch(batchText, /Legacy agent summary/);
    assert.doesNotMatch(batchText, /correction_ready/);
    assert.doesNotMatch(batchText, /agent_result/);

    const blocked = await request("/api/agent-executions", {
      body: JSON.stringify({
        agent: "cursor",
        captureId: "local_legacy_agent",
        idempotencyKey: "legacy_exec_02",
        results: [{ pinId: "pin_b", status: "changed", summary: "New agent feedback" }],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(blocked.status, 410);

    const acceptB = await request("/api/sessions/local_legacy_agent/pins/pin_b/review", {
      body: JSON.stringify({ action: "accept" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(acceptB.status, 200);
    const afterAccept = await jsonBody(await request("/api/sessions/local_legacy_agent"));
    const reviewB = afterAccept.reviews.find((item) => isRecord(item) && item.pinId === "pin_b");
    assert.ok(isRecord(reviewB));
    assert.equal(reviewB.status, "accepted");
    const acceptedTimeline = Array.isArray(reviewB.timeline) ? reviewB.timeline : [];
    assert.ok(acceptedTimeline.length > 0);
    for (const event of acceptedTimeline) {
      assert.ok(isRecord(event));
      assert.notEqual(event.origin, "agent_result");
    }

    const markdownAfterAccept = await handlePublicRequest(
      new Request("http://127.0.0.1:17373/v/local_legacy_agent.md"),
    );
    assert.equal(markdownAfterAccept.status, 200);
    const textAfterAccept = await markdownAfterAccept.text();
    assert.match(textAfterAccept, /Human pin B/);
    assert.doesNotMatch(textAfterAccept, /Legacy agent summary/);
    assert.doesNotMatch(textAfterAccept, /correction_ready/);
    assert.doesNotMatch(textAfterAccept, /agent_result/);
  });

  test("reflects the last human state after interleaved legacy agent events", async () => {
    const upload = await request("/api/shots", {
      body: JSON.stringify({
        id: "local_legacy_interleaved",
        image: VALID_PNG,
        page: { title: "Interleaved", url: "https://example.test/interleaved" },
        pins: [{ comment: "Human pin", kind: "element", pinId: "pin_mixed" }],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(upload.status, 201);

    // agent_result → human accept → human reopen → agent_result, seeded
    // directly: the Local API rejects new agent feedback with 410.
    const legacyDb = openHistoryDb(root);
    const human = { actorId: "local", actorType: "human" as const, origin: "human" as const };
    try {
      legacyDb.saveAgentExecution({
        agent: "cursor",
        captureId: "local_legacy_interleaved",
        idempotencyKey: "legacy_exec_mixed_01",
        results: [{ pinId: "pin_mixed", status: "changed", summary: "Legacy agent summary" }],
      });
      legacyDb.applyPinReview("local_legacy_interleaved", "pin_mixed", "accept", human);
      legacyDb.applyPinReview("local_legacy_interleaved", "pin_mixed", "reopen", human);
      legacyDb.saveAgentExecution({
        agent: "cursor",
        captureId: "local_legacy_interleaved",
        idempotencyKey: "legacy_exec_mixed_02",
        results: [{ pinId: "pin_mixed", status: "changed", summary: "Second legacy agent summary" }],
      });
    } finally {
      legacyDb.close();
    }

    const session = await jsonBody(await request("/api/sessions/local_legacy_interleaved"));
    assert.deepEqual(session.executions, []);
    assert.ok(Array.isArray(session.reviews));
    const review = session.reviews.find((item) => isRecord(item) && item.pinId === "pin_mixed");
    assert.ok(isRecord(review));
    assert.equal(review.status, "reopened");
    assert.deepEqual(review.actions, ["accept"]);
    const timeline = Array.isArray(review.timeline) ? review.timeline : [];
    assert.equal(timeline.length, 2);
    assert.deepEqual(timeline.map((event) => isRecord(event) && event.fromStatus), ["open", "accepted"]);
    assert.deepEqual(timeline.map((event) => isRecord(event) && event.toStatus), ["accepted", "reopened"]);
    for (const event of timeline) {
      assert.ok(isRecord(event));
      assert.equal(event.origin, "human");
    }
    assert.ok(isRecord(timeline[1]));
    assert.equal(review.updatedAt, timeline[1].createdAt);
    assert.ok(isRecord(session.session) && isRecord(session.session.reviewCounts));
    assert.equal(session.session.reviewCounts.correction_ready, 0);
    assert.equal(session.session.reviewCounts.reopened, 1);
    assert.doesNotMatch(JSON.stringify(session.reviews), /correction_ready/);
    assert.doesNotMatch(JSON.stringify(session.reviews), /agent_result/);
    assert.doesNotMatch(JSON.stringify(session.reviews), /Legacy agent summary/);

    const history = await jsonBody(await request("/api/history"));
    const listed = (Array.isArray(history.sessions) ? history.sessions : [])
      .find((item) => isRecord(item) && item.id === "local_legacy_interleaved");
    assert.ok(isRecord(listed) && isRecord(listed.reviewCounts));
    assert.equal(listed.reviewCounts.correction_ready ?? 0, 0);
    assert.equal(listed.reviewCounts.reopened, 1);

    const markdown = await handlePublicRequest(
      new Request("http://127.0.0.1:17373/v/local_legacy_interleaved.md"),
    );
    assert.equal(markdown.status, 200);
    const text = await markdown.text();
    assert.match(text, /Human pin/);
    assert.doesNotMatch(text, /Legacy agent summary/);
    assert.doesNotMatch(text, /Second legacy agent summary/);
    assert.doesNotMatch(text, /correction_ready/);
    assert.doesNotMatch(text, /agent_result/);

    // The human review API still operates on the real stored row.
    const accept = await request("/api/sessions/local_legacy_interleaved/pins/pin_mixed/review", {
      body: JSON.stringify({ action: "accept" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(accept.status, 200);
    const afterAccept = await jsonBody(await request("/api/sessions/local_legacy_interleaved"));
    const accepted = afterAccept.reviews.find((item) => isRecord(item) && item.pinId === "pin_mixed");
    assert.ok(isRecord(accepted));
    assert.equal(accepted.status, "accepted");
  });

  test("keeps loop-metrics opt-in behavior without agent feedback", async () => {
    const off = await request("/api/loop-metrics", {
      body: JSON.stringify({
        events: [{ comment: "Make the CTA bolder", event: "handoff", url: "https://example.test/cta" }],
        optIn: false,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(off.status, 200);
    assert.equal((await jsonBody(off)).stored, 0);

    const forbidden = await request("/api/loop-metrics", {
      body: JSON.stringify({
        events: [{
          comment: "secret comment",
          event: "handoff",
          selector: "#cta",
          screenshot: VALID_PNG,
          url: "https://example.test/cta",
        }],
        optIn: true,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(forbidden.status, 400);

    const on = await request("/api/loop-metrics", {
      body: JSON.stringify({
        events: [
          { agent: "cursor", durationMs: 40, event: "handoff" },
          { event: "correction_ready", locationConfidence: "exact" },
          { event: "accepted" },
        ],
        optIn: true,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(on.status, 201);
    assert.equal((await jsonBody(on)).stored, 3);
  });

  test("patches viewer-owned pin fields and renders them in the session markdown", async () => {
    const upload = await request("/api/shots", {
      body: JSON.stringify({
        id: "local_patch_001",
        image: VALID_PNG,
        page: { title: "Patchable", url: "https://example.test/patch" },
        pins: [{ comment: "Misaligned", kind: "element", pinId: "pin_local_1", selector: "button.pay" }],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(upload.status, 201);
    const patch = (body: unknown) => request("/api/sessions/local_patch_001", {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    assert.equal((await patch({ pins: [{ pinId: "nope" }] })).status, 400);
    assert.equal((await request("/api/sessions/missing_session", { body: "{}", method: "PATCH" })).status, 404);
    const patched = await jsonBody(await patch({
      pins: [{
        diagnosis: {
          acceptedAt: "2026-09-08T00:00:00.000Z",
          cause: "Padding differs from siblings",
          confidence: "medium",
          fix: "button.pay { padding: 8px 16px; }",
          properties: ["padding"],
          version: 1,
        },
        pinId: "pin_local_1",
      }],
    }));
    assert.equal(patched.ok, true);
    const markdown = await handlePublicRequest(new Request("http://127.0.0.1:17373/v/local_patch_001.md"));
    assert.equal(markdown.status, 200);
    const text = await markdown.text();
    assert.match(text, /Diagnosis \(medium confidence\): Padding differs from siblings/);
    assert.match(text, /"cause":"Padding differs from siblings"/);
  });

  test("does not expose retired local AI generation endpoints", async () => {
    const requests = [
      ["/api/ai/session-summary", "POST"],
      ["/api/ai/pin-diagnosis", "POST"],
      ["/api/ai/component-export", "POST"],
      ["/api/ai/design-system", "POST"],
      ["/api/collections/retired_collection/design-system", "GET"],
    ] as const;

    for (const [path, method] of requests) {
      const response = await request(path, { method });
      assert.equal(response.status, 404, `${method} ${path}`);
    }
  });

  test("returns only a masked preview for a stored BYOK key", async () => {
    // Mutation captured: omitting apiKeyPreview or returning the stored secret exposes no safe key identity to the UI.
    const secret = "sk-proj-1234567890abcdef";
    const secrets = new Map<string, string>();
    setLocalAiDependenciesForTests({
      vault: {
        clear: async () => { secrets.clear(); },
        get: async () => secrets.get("key") ?? null,
        set: async (value) => { secrets.set("key", value); },
      },
      fetch: async (_input, init) => {
        assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${secret}`);
        return Response.json({ data: [{ id: "qwen3.8-27b" }] });
      },
    });

    const configuredResponse = await request("/api/ai/settings", {
      body: JSON.stringify({
        apiKey: secret,
        endpoint: "https://provider.example/v1",
        mode: "byok",
        model: "qwen3.8-27b",
      }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    const configuredText = await configuredResponse.text();
    assert.doesNotMatch(configuredText, new RegExp(secret));
    const configured: unknown = JSON.parse(configuredText);
    assert.ok(isRecord(configured));
    assert.equal(configured.apiKeyPreview, "sk-p••••cdef");

    const storedResponse = await request("/api/ai/settings");
    const storedText = await storedResponse.text();
    assert.doesNotMatch(storedText, new RegExp(secret));
    const stored: unknown = JSON.parse(storedText);
    assert.ok(isRecord(stored));
    assert.equal(stored.apiKeyPreview, "sk-p••••cdef");
    assert.doesNotMatch(readFileSync(join(root, "ai.json"), "utf8"), new RegExp(secret));

    const clearedResponse = await request("/api/ai/settings/key", { method: "DELETE" });
    assert.equal(clearedResponse.status, 200);
    const cleared = await jsonBody(clearedResponse);
    assert.equal(cleared.ok, true);
    assert.equal(cleared.hasApiKey, false);
    assert.equal(cleared.apiKeyPreview, "");
    assert.equal(cleared.endpoint, "https://provider.example/v1");
    assert.equal(cleared.mode, "byok");
    assert.equal(cleared.model, "qwen3.8-27b");
    assert.equal(secrets.size, 0);
  });

  test("stores local pin comments, reloads them, and drops them with the capture", async () => {
    const upload = await request("/api/shots", {
      body: JSON.stringify({
        id: "local_comment_capture",
        image: VALID_PNG,
        page: { title: "Local comments", url: "https://example.test/local-comments" },
        pins: [
          { comment: "One", kind: "element", pinId: "pin_one" },
          { comment: "Two", kind: "element", pinId: "pin_two" },
        ],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(upload.status, 201);
    const other = await request("/api/shots", {
      body: JSON.stringify({
        id: "local_comment_other",
        image: VALID_PNG,
        page: { title: "Other", url: "https://example.test/local-other" },
        pins: [{ comment: "Other", kind: "element", pinId: "pin_one" }],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(other.status, 201);

    const created = await request("/api/sessions/local_comment_capture/pins/pin_one/comments", {
      body: JSON.stringify({
        actorId: "browser",
        actorLabel: "Spoofed",
        actorType: "agent",
        body: "  local note  ",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(created.status, 200);
    const createdBody = await jsonBody(created);
    assert.equal(createdBody.ok, true);
    assert.ok(isRecord(createdBody.comment));
    assert.equal(createdBody.comment.body, "local note");
    assert.equal(createdBody.comment.actorId, "local");
    assert.equal(createdBody.comment.actorLabel, "Local");
    assert.equal(createdBody.comment.actorType, "human");
    assert.equal(createdBody.comment.pinId, "pin_one");

    const second = await request("/api/sessions/local_comment_capture/pins/pin_two/comments", {
      body: JSON.stringify({ body: "second local note" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(second.status, 200);
    assert.equal((await request("/api/sessions/local_comment_capture/pins/pin_one/comments", {
      body: JSON.stringify({ body: "   " }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })).status, 400);
    assert.equal((await request("/api/sessions/local_comment_capture/pins/pin_missing/comments", {
      body: JSON.stringify({ body: "missing pin" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })).status, 404);

    resetLocalApiForTests();
    const listed = await jsonBody(await request("/api/sessions/local_comment_capture"));
    assert.ok(Array.isArray(listed.comments));
    assert.deepEqual(listed.comments.map((item) => {
      assert.ok(isRecord(item));
      return item.body;
    }), ["local note", "second local note"]);
    assert.deepEqual(listed.comments.map((item) => {
      assert.ok(isRecord(item));
      return item.pinId;
    }), ["pin_one", "pin_two"]);
    const isolated = await jsonBody(await request("/api/sessions/local_comment_other"));
    assert.deepEqual(isolated.comments, []);

    assert.equal((await request("/api/history/local_comment_capture", { method: "DELETE" })).status, 200);
    const recreated = await request("/api/shots", {
      body: JSON.stringify({
        id: "local_comment_capture",
        image: VALID_PNG,
        page: { title: "Local comments", url: "https://example.test/local-comments" },
        pins: [{ comment: "One", kind: "element", pinId: "pin_one" }],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(recreated.status, 201);
    const afterDelete = await jsonBody(await request("/api/sessions/local_comment_capture"));
    assert.deepEqual(afterDelete.comments, []);
  });

  test("adds agent-authored comments and preserves actor_type across reads", async () => {
    const upload = await request("/api/shots", {
      body: JSON.stringify({
        id: "agent_comment_capture",
        image: VALID_PNG,
        page: { title: "Agent comments", url: "https://example.test/agent-comments" },
        pins: [{ comment: "Original note", kind: "element", pinId: "pin_one" }],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(upload.status, 201);

    const human = await request("/api/sessions/agent_comment_capture/pins/pin_one/comments", {
      body: JSON.stringify({ body: "Human says hi" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(human.status, 200);
    const humanBody = await jsonBody(human);
    const humanComment = humanBody.comment as Record<string, unknown>;
    assert.equal(humanComment.actorType, "human");
    assert.equal(humanComment.actorLabel, "Local");

    const agent = await request("/api/sessions/agent_comment_capture/pins/pin_one/comments", {
      body: JSON.stringify({ agentName: "Grok", body: "Agent reply" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(agent.status, 200);
    const agentBody = await jsonBody(agent);
    const agentComment = agentBody.comment as Record<string, unknown>;
    assert.equal(agentComment.actorType, "agent");
    assert.equal(agentComment.actorLabel, "Grok");
    assert.equal(agentComment.pinId, "pin_one");

    const listed = await jsonBody(await request("/api/sessions/agent_comment_capture"));
    const comments = listed.comments as Array<Record<string, unknown>>;
    assert.equal(comments.length, 2);
    assert.deepEqual(comments.map((item) => item.actorType), ["human", "agent"]);
  });

  test("rejects a non-string agentName without persisting a comment", async () => {
    const upload = await request("/api/shots", {
      body: JSON.stringify({
        id: "agent_name_capture",
        image: VALID_PNG,
        page: { title: "Agent name", url: "https://example.test/agent-name" },
        pins: [{ comment: "Original note", kind: "element", pinId: "pin_one" }],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(upload.status, 201);

    const numberAgent = await request("/api/sessions/agent_name_capture/pins/pin_one/comments", {
      body: JSON.stringify({ agentName: 123, body: "Should not persist" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(numberAgent.status, 400);

    const objectAgent = await request("/api/sessions/agent_name_capture/pins/pin_one/comments", {
      body: JSON.stringify({ agentName: { name: "x" }, body: "Should not persist" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(objectAgent.status, 400);

    const payload = await jsonBody(await request("/api/sessions/agent_name_capture"));
    assert.deepEqual(payload.comments, []);
  });

  test("edits any stored comment, rejects empty or overlong bodies, and refuses cross references", async () => {
    const upload = await request("/api/shots", {
      body: JSON.stringify({
        id: "edit_comment_capture",
        image: VALID_PNG,
        page: { title: "Edit comments", url: "https://example.test/edit-comments" },
        pins: [{ comment: "Original note", kind: "element", pinId: "pin_one" }],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(upload.status, 201);

    const created = await request("/api/sessions/edit_comment_capture/pins/pin_one/comments", {
      body: JSON.stringify({ agentName: "Grok", body: "Agent reply" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const createdBody = await jsonBody(created);
    const comment = createdBody.comment as Record<string, unknown>;
    const commentId = String(comment.id);
    const createdAt = String(comment.createdAt);

    const edited = await request(`/api/sessions/edit_comment_capture/pins/pin_one/comments/${commentId}`, {
      body: JSON.stringify({ body: "Agent reply (edited)" }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    assert.equal(edited.status, 200);
    const editedBody = await jsonBody(edited);
    assert.equal(editedBody.ok, true);
    const editedComment = editedBody.comment as Record<string, unknown>;
    assert.equal(editedComment.id, commentId);
    assert.equal(editedComment.createdAt, createdAt);
    assert.equal(editedComment.body, "Agent reply (edited)");
    assert.equal(editedComment.actorType, "agent");

    // The trusted local environment edits any comment, including human ones.
    const humanCreated = await request("/api/sessions/edit_comment_capture/pins/pin_one/comments", {
      body: JSON.stringify({ body: "Human says hi" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const humanComment = (await jsonBody(humanCreated)).comment as Record<string, unknown>;
    const humanEdited = await request(
      `/api/sessions/edit_comment_capture/pins/pin_one/comments/${humanComment.id}`,
      { body: JSON.stringify({ body: "Human says hi v2" }), headers: { "content-type": "application/json" }, method: "PATCH" },
    );
    assert.equal(humanEdited.status, 200);

    const empty = await request(`/api/sessions/edit_comment_capture/pins/pin_one/comments/${commentId}`, {
      body: JSON.stringify({ body: "   " }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    assert.equal(empty.status, 400);

    const overlong = await request(`/api/sessions/edit_comment_capture/pins/pin_one/comments/${commentId}`, {
      body: JSON.stringify({ body: "x".repeat(2001) }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    assert.equal(overlong.status, 400);

    const unknownComment = await request("/api/sessions/edit_comment_capture/pins/pin_one/comments/does_not_exist", {
      body: JSON.stringify({ body: "New body" }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    assert.equal(unknownComment.status, 404);

    const wrongPin = await request(`/api/sessions/edit_comment_capture/pins/pin_other/comments/${commentId}`, {
      body: JSON.stringify({ body: "New body" }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    assert.equal(wrongPin.status, 404);

    const wrongCapture = await request(`/api/sessions/other_capture/pins/pin_one/comments/${commentId}`, {
      body: JSON.stringify({ body: "New body" }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    assert.equal(wrongCapture.status, 404);

    const blankAgentName = await request("/api/sessions/edit_comment_capture/pins/pin_one/comments", {
      body: JSON.stringify({ agentName: "   ", body: "Body" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(blankAgentName.status, 400);

    const longAgentName = await request("/api/sessions/edit_comment_capture/pins/pin_one/comments", {
      body: JSON.stringify({ agentName: "a".repeat(65), body: "Body" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(longAgentName.status, 400);

    const hostileAgentName = await request("/api/sessions/edit_comment_capture/pins/pin_one/comments", {
      body: JSON.stringify({ agentName: "bad\u0000name", body: "Body" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(hostileAgentName.status, 400);
  });

  test("edits the original note while preserving the session and pin", async () => {
    const upload = await request("/api/shots", {
      body: JSON.stringify({
        id: "note_capture",
        image: VALID_PNG,
        page: { title: "Note capture", url: "https://example.test/note" },
        pins: [
          { anchor: { x: 12, y: 34 }, comment: "Original note", kind: "element", pinId: "pin_one" },
          { comment: "Second pin", kind: "element", pinId: "pin_two" },
        ],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(upload.status, 201);

    const edited = await request("/api/sessions/note_capture/pins/pin_one", {
      body: JSON.stringify({ comment: "Edited note" }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    assert.equal(edited.status, 200);
    const editedBody = await jsonBody(edited);
    assert.equal(editedBody.ok, true);
    assert.equal((editedBody.pin as Record<string, unknown>).comment, "Edited note");
    assert.equal((editedBody.pin as Record<string, unknown>).pinId, "pin_one");

    const payload = await jsonBody(await request("/api/sessions/note_capture"));
    const pins = (payload.session as Record<string, unknown>).pins as Array<Record<string, unknown>>;
    assert.equal(pins[0].comment, "Edited note");
    assert.equal(pins[0].kind, "element");
    assert.equal(pins[1].comment, "Second pin");
    assert.equal(payload.session.id, "note_capture");

    const empty = await request("/api/sessions/note_capture/pins/pin_one", {
      body: JSON.stringify({ comment: "" }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    assert.equal(empty.status, 400);

    const overlong = await request("/api/sessions/note_capture/pins/pin_one", {
      body: JSON.stringify({ comment: "x".repeat(2001) }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    assert.equal(overlong.status, 400);

    const unknownPin = await request("/api/sessions/note_capture/pins/pin_missing", {
      body: JSON.stringify({ comment: "New note" }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    assert.equal(unknownPin.status, 404);

    const unknownCapture = await request("/api/sessions/other_capture/pins/pin_one", {
      body: JSON.stringify({ comment: "New note" }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    assert.equal(unknownCapture.status, 404);
  });

  test("migrates a pre-agent comment store keeping data, index, and the new CHECK", async () => {
    // Seed a store in the pre-agent shape: the single-value CHECK on
    // actor_type and one human comment written before this change.
    const seed = new Database(join(root, "history.db"));
    seed.exec(`
      CREATE TABLE pin_comments (
        id TEXT PRIMARY KEY,
        capture_id TEXT NOT NULL,
        pin_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        actor_label TEXT NOT NULL,
        actor_type TEXT NOT NULL CHECK (actor_type = 'human'),
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_pin_comments_capture ON pin_comments(capture_id, created_at);
      INSERT INTO pin_comments (id, capture_id, pin_id, actor_id, actor_label, actor_type, body, created_at)
        VALUES ('legacy_human_comment', 'migrated_capture', 'pin_one', 'local', 'Local', 'human', 'Legacy human comment', '2026-01-01T00:00:00.000Z');
    `);
    seed.close();

    const upload = await request("/api/shots", {
      body: JSON.stringify({
        id: "migrated_capture",
        image: VALID_PNG,
        page: { title: "Migrated", url: "https://example.test/migrated" },
        pins: [{ comment: "Original note", kind: "element", pinId: "pin_one" }],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(upload.status, 201);

    const payload = await jsonBody(await request("/api/sessions/migrated_capture"));
    const listed = (payload.comments as Array<Record<string, unknown>>).find((item) => item.id === "legacy_human_comment");
    assert.ok(listed);
    assert.equal(listed.body, "Legacy human comment");
    assert.equal(listed.actorType, "human");

    const agent = await request("/api/sessions/migrated_capture/pins/pin_one/comments", {
      body: JSON.stringify({ agentName: "Grok", body: "After migration" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(agent.status, 200);
    const agentComment = (await jsonBody(agent)).comment as Record<string, unknown>;
    assert.equal(agentComment.actorType, "agent");

    const edited = await request(
      `/api/sessions/migrated_capture/pins/pin_one/comments/${agentComment.id}`,
      { body: JSON.stringify({ body: "After migration (edited)" }), headers: { "content-type": "application/json" }, method: "PATCH" },
    );
    assert.equal(edited.status, 200);

    // Close the store and verify persistence at the raw database level.
    resetLocalApiForTests();
    const reopened = new Database(join(root, "history.db"));
    const schema = reopened.query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'pin_comments'").get() as { sql: string };
    assert.ok(schema.sql.includes("CHECK (actor_type IN ('agent', 'human'))"));
    const index = reopened.query(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_pin_comments_capture'",
    ).get() as { name: string } | null;
    assert.equal(index?.name, "idx_pin_comments_capture");
    const legacy = reopened.query("SELECT * FROM pin_comments WHERE id = 'legacy_human_comment'").get() as { actor_type: string; body: string };
    assert.equal(legacy.body, "Legacy human comment");
    assert.equal(legacy.actor_type, "human");
    const migrated = reopened.query("SELECT * FROM pin_comments WHERE id = ?").get(String(agentComment.id)) as { actor_type: string; body: string };
    assert.equal(migrated.actor_type, "agent");
    assert.equal(migrated.body, "After migration (edited)");
    reopened.close();
  });

  test("denies hostile origins on the comment, note, and MCP routes", async () => {
    const upload = await request("/api/shots", {
      body: JSON.stringify({
        id: "hostile_comment_capture",
        image: VALID_PNG,
        page: { title: "Hostile", url: "https://example.test/hostile" },
        pins: [{ comment: "Original note", kind: "element", pinId: "pin_one" }],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(upload.status, 201);

    const commentEdit = await request("/api/sessions/hostile_comment_capture/pins/pin_one/comments/whatever", {
      body: JSON.stringify({ body: "New body" }),
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      method: "PATCH",
    });
    assert.equal(commentEdit.status, 401);

    const noteEdit = await request("/api/sessions/hostile_comment_capture/pins/pin_one", {
      body: JSON.stringify({ comment: "New note" }),
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      method: "PATCH",
    });
    assert.equal(noteEdit.status, 401);

    const mcp = await request("/api/mcp", {
      body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "tools/list" }),
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      method: "POST",
    });
    assert.equal(mcp.status, 401);
  });
});
