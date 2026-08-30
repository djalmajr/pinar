import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  authorizeAppRequest,
  authorizeHistoryRequest,
  handleApiRequest,
  handlePublicRequest,
  resetLocalApiForTests,
} from "./api.local";
import { LOCAL_UNAUTHORIZED_BODY } from "./local-api-policy";
import {
  LOCAL_CORS_ALLOWED_ORIGIN_KINDS,
  LOCAL_HEALTH_DISCOVERY_KEYS,
  LOCAL_HEALTH_FORBIDDEN_KEYS,
  classifyLocalApiRequest,
  localHealthDiscoveryBody,
} from "./local-api-trust";

const VALID_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const HOSTILE_ORIGIN = "https://evil.example";
const EXTENSION_ORIGIN = "chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef";
const WORKSPACE_ORIGIN = "http://127.0.0.1:17373";
const HOSTILE_COMMENT = "secret pin comment that must not leak";
const HOSTILE_URL = "https://evil.example/captured-page";

let root = "";
let previousHome: string | undefined;
let previousGrace: string | undefined;

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

function assertGenericUnauthorized(response: Response, serialized: string) {
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.ok(!serialized.includes(HOSTILE_COMMENT));
  assert.ok(!serialized.includes(HOSTILE_URL));
  assert.ok(!serialized.toLowerCase().includes("x-pinar-capability"));
}

describe("local API trust enforcement", () => {
  beforeEach(async () => {
    previousHome = process.env.PINAR_HOME;
    previousGrace = process.env.PINAR_CAPABILITY_GRACE_MS;
    root = await mkdtemp(join(tmpdir(), "pinar-trust-baseline-"));
    process.env.PINAR_HOME = root;
    delete process.env.PINAR_CAPABILITY_GRACE_MS;
    resetLocalApiForTests();
  });

  afterEach(async () => {
    resetLocalApiForTests();
    if (previousHome === undefined) delete process.env.PINAR_HOME;
    else process.env.PINAR_HOME = previousHome;
    if (previousGrace === undefined) delete process.env.PINAR_CAPABILITY_GRACE_MS;
    else process.env.PINAR_CAPABILITY_GRACE_MS = previousGrace;
    await rm(root, { force: true, recursive: true });
  });

  test("health discovery stays public-min and is not CORS-readable from a hostile origin", async () => {
    const response = await request("/api/health", { headers: { origin: HOSTILE_ORIGIN } });
    assert.equal(response.status, 200);
    const body = await jsonBody(response);
    assert.deepEqual(body, localHealthDiscoveryBody());
    assert.deepEqual(Object.keys(body).sort(), [...LOCAL_HEALTH_DISCOVERY_KEYS].sort());
    for (const key of LOCAL_HEALTH_FORBIDDEN_KEYS) assert.equal(key in body, false);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.equal(classifyLocalApiRequest("GET", "/api/health")?.class, "public-min");
    assert.deepEqual([...LOCAL_CORS_ALLOWED_ORIGIN_KINDS].sort(), ["chrome-extension", "loopback"]);
  });

  test("denies hostile CORS, preflight reflection, and capability-less mutation", async () => {
    const preflight = await request("/api/history", {
      headers: {
        "access-control-request-headers": "content-type, x-pinar-capability",
        "access-control-request-method": "GET",
        origin: HOSTILE_ORIGIN,
      },
      method: "OPTIONS",
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), null);

    const history = await request("/api/history", { headers: { origin: HOSTILE_ORIGIN } });
    const historyText = await history.clone().text();
    assertGenericUnauthorized(history, historyText);
    assert.deepEqual(await jsonBody(history), LOCAL_UNAUTHORIZED_BODY);

    const tree = await request("/api/project-tree", { headers: { origin: HOSTILE_ORIGIN } });
    assert.equal(tree.status, 401);

    const upload = await request("/api/shots", {
      body: JSON.stringify({
        id: "hostile_session",
        image: VALID_PNG,
        page: { title: "Hostile", url: HOSTILE_URL },
        pins: [{ comment: HOSTILE_COMMENT, kind: "element" }],
      }),
      headers: { "content-type": "application/json", origin: HOSTILE_ORIGIN },
      method: "POST",
    });
    const uploadText = await upload.clone().text();
    assertGenericUnauthorized(upload, uploadText);

    const listed = await jsonBody(await request("/api/history"));
    assert.equal(Array.isArray(listed.sessions) && listed.sessions.length, 0);

    assert.equal(await authorizeAppRequest(), true);
    assert.equal(await authorizeHistoryRequest(new Request("http://127.0.0.1:17373/api/history", {
      headers: { origin: HOSTILE_ORIGIN },
    })), false);
    assert.equal(await authorizeHistoryRequest(new Request("http://127.0.0.1:17373/api/history")), true);
    assert.equal(classifyLocalApiRequest("GET", "/api/history")?.class, "sensitive-read");
    assert.equal(classifyLocalApiRequest("POST", "/api/shots")?.class, "mutable");
    assert.equal(classifyLocalApiRequest("POST", "/api/agent-executions")?.class, "mutable");
    assert.equal(classifyLocalApiRequest("POST", "/api/loop-metrics")?.class, "mutable");
    assert.equal(classifyLocalApiRequest("GET", "/api/loop-metrics")?.class, "sensitive-read");
    assert.equal(classifyLocalApiRequest("POST", "/api/sessions/hostile_session/pins/pin_cta/review")?.class, "mutable");
    assert.equal(classifyLocalApiRequest("GET", "/v/hostile_session.md")?.class, "local-public-projection");
  });

  test("loopback workspace and CLI clients keep access without a capability header", async () => {
    const workspace = await request("/api/project-tree", { headers: { origin: WORKSPACE_ORIGIN } });
    assert.equal(workspace.status, 200);
    assert.equal(workspace.headers.get("access-control-allow-origin"), WORKSPACE_ORIGIN);
    assert.ok(isRecord((await jsonBody(workspace)).tree));

    const upload = await request("/api/shots", {
      body: JSON.stringify({
        id: "viewer_session",
        image: VALID_PNG,
        page: { title: "Viewer", url: "https://example.test/viewer" },
        pins: [{ comment: "Visible in markdown", kind: "element" }],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(upload.status, 201);
    const markdown = await handlePublicRequest(new Request("http://127.0.0.1:17373/v/viewer_session.md"));
    assert.equal(markdown.status, 200);
    assert.match(await markdown.text(), /Visible in markdown/);
    assert.equal(markdown.headers.get("access-control-allow-origin"), null);
  });

  test("extension pairing, authorized capture, missing and expired capability", async () => {
    const hostilePairing = await request("/api/local/capability", { headers: { origin: HOSTILE_ORIGIN } });
    assert.equal(hostilePairing.status, 401);
    assert.equal((await jsonBody(hostilePairing)).token, undefined);

    const allowedPreflight = await request("/api/shots", {
      headers: {
        "access-control-request-headers": "content-type, x-pinar-capability",
        "access-control-request-method": "POST",
        origin: EXTENSION_ORIGIN,
      },
      method: "OPTIONS",
    });
    assert.equal(allowedPreflight.status, 204);
    assert.equal(allowedPreflight.headers.get("access-control-allow-origin"), EXTENSION_ORIGIN);
    assert.match(allowedPreflight.headers.get("access-control-allow-headers") || "", /x-pinar-capability/);

    const missing = await request("/api/shots", {
      body: JSON.stringify({
        id: "missing_capability",
        image: VALID_PNG,
        page: { title: "Missing", url: "https://example.test/missing" },
        pins: [],
      }),
      headers: { "content-type": "application/json", origin: EXTENSION_ORIGIN },
      method: "POST",
    });
    assert.equal(missing.status, 401);
    assert.deepEqual(await jsonBody(missing), LOCAL_UNAUTHORIZED_BODY);
    assert.equal(missing.headers.get("access-control-allow-origin"), EXTENSION_ORIGIN);

    const missingResult = await request("/api/agent-executions", {
      body: JSON.stringify({
        agent: "cursor",
        captureId: "missing_capability",
        idempotencyKey: "exec_missing_capability",
        results: [{ pinId: "pin_cta", status: "changed", summary: "Nope" }],
      }),
      headers: { "content-type": "application/json", origin: EXTENSION_ORIGIN },
      method: "POST",
    });
    assert.equal(missingResult.status, 401);
    assert.deepEqual(await jsonBody(missingResult), LOCAL_UNAUTHORIZED_BODY);

    const missingMetrics = await request("/api/loop-metrics", {
      body: JSON.stringify({ events: [{ event: "handoff" }], optIn: true }),
      headers: { "content-type": "application/json", origin: EXTENSION_ORIGIN },
      method: "POST",
    });
    assert.equal(missingMetrics.status, 401);
    assert.deepEqual(await jsonBody(missingMetrics), LOCAL_UNAUTHORIZED_BODY);

    const pairing = await request("/api/local/capability", { headers: { origin: EXTENSION_ORIGIN } });
    assert.equal(pairing.status, 200);
    const pairingBody = await jsonBody(pairing);
    assert.equal(typeof pairingBody.token, "string");
    const token = String(pairingBody.token);
    assert.equal(pairing.headers.get("access-control-allow-origin"), EXTENSION_ORIGIN);

    const invalid = await request("/api/shots", {
      body: JSON.stringify({ id: "invalid_capability", image: VALID_PNG, pins: [] }),
      headers: {
        "content-type": "application/json",
        origin: EXTENSION_ORIGIN,
        "x-pinar-capability": "definitely-not-it",
      },
      method: "POST",
    });
    const invalidText = await invalid.clone().text();
    assert.equal(invalid.status, 401);
    assert.ok(!invalidText.includes(token));
    assert.ok(!invalidText.includes(HOSTILE_COMMENT));

    const authorized = await request("/api/shots", {
      body: JSON.stringify({
        id: "extension_session",
        image: VALID_PNG,
        page: { title: "Extension", url: "https://example.test/extension" },
        pins: [{ comment: "Authorized pin", kind: "element" }],
      }),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        origin: EXTENSION_ORIGIN,
      },
      method: "POST",
    });
    assert.equal(authorized.status, 201);

    process.env.PINAR_CAPABILITY_GRACE_MS = "0";
    const rotated = await request("/api/local/capability/rotate", {
      headers: { origin: EXTENSION_ORIGIN, "x-pinar-capability": token },
      method: "POST",
    });
    assert.equal(rotated.status, 200);
    const rotatedBody = await jsonBody(rotated);
    assert.equal(typeof rotatedBody.token, "string");
    assert.notEqual(rotatedBody.token, token);

    const expired = await request("/api/project-tree", {
      headers: { origin: EXTENSION_ORIGIN, "x-pinar-capability": token },
    });
    assert.equal(expired.status, 401);

    const refreshed = await request("/api/project-tree", {
      headers: { origin: EXTENSION_ORIGIN, "x-pinar-capability": String(rotatedBody.token) },
    });
    assert.equal(refreshed.status, 200);

    const revoked = await request("/api/local/capability/revoke", {
      headers: { origin: EXTENSION_ORIGIN, "x-pinar-capability": String(rotatedBody.token) },
      method: "POST",
    });
    assert.equal(revoked.status, 200);
    const afterRevoke = await request("/api/project-tree", {
      headers: { origin: EXTENSION_ORIGIN, "x-pinar-capability": String(rotatedBody.token) },
    });
    assert.equal(afterRevoke.status, 401);
    const reminted = await jsonBody(await request("/api/local/capability", { headers: { origin: EXTENSION_ORIGIN } }));
    assert.notEqual(reminted.token, rotatedBody.token);
  });
});
