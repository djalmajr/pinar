import assert from "node:assert/strict";
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
import { exerciseAgentResultsContract } from "./agent-results.contract";
import { exercisePinReviewContract } from "./pin-review.contract";
import { exerciseClosedLoopContract } from "./closed-loop.contract";
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

  test("configures OpenAI-compatible local AI and summarizes without Pinar credits", async () => {
    const secrets = new Map<string, string>();
    setLocalAiDependenciesForTests({
      vault: {
        clear: async () => { secrets.clear(); },
        get: async () => secrets.get("key") ?? null,
        set: async (value) => { secrets.set("key", value); },
      },
      fetch: async (input, init) => {
        if (String(input).endsWith("/models")) {
          return Response.json({ data: [{ id: "llama3.2" }] });
        }
        assert.equal(String(input), "http://127.0.0.1:11434/v1/chat/completions");
        assert.equal(new Headers(init?.headers).has("Authorization"), false);
        return Response.json({
          choices: [{ message: { content: '{"summary":"Local summary","highlights":["First pin"]}' } }],
          model: "llama3.2-q4",
          usage: { completion_tokens: 8, prompt_tokens: 12 },
        });
      },
    });

    const configured = await jsonBody(await request("/api/ai/settings", {
      body: JSON.stringify({
        endpoint: "http://127.0.0.1:11434/v1",
        mode: "local",
        model: "llama3.2",
      }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    }));
    assert.equal(configured.ok, true);
    assert.equal(configured.mode, "local");
    assert.equal(configured.hasApiKey, false);
    assert.doesNotMatch(readFileSync(join(root, "ai.json"), "utf8"), /apiKey/);

    await request("/api/history", {
      body: JSON.stringify({
        id: "local_ai_session",
        page: { title: "Local AI", url: "https://example.test/ai" },
        pins: [{ comment: "First pin", kind: "element" }],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const response = await request("/api/ai/session-summary", {
      body: JSON.stringify({ language: "en", requestId: "local_request_001", sessionId: "local_ai_session" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(response.status, 200);
    const generated = await jsonBody(response);
    assert.equal(generated.creditsCharged, 0);
    assert.deepEqual(generated.result, {
      highlights: ["First pin"],
      model: "llama3.2-q4",
      provider: "local",
      summary: "Local summary",
    });
    assert.deepEqual(generated.usage, {
      inputTokens: 12,
      model: "llama3.2-q4",
      outputTokens: 8,
      provider: "local",
    });
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
});
