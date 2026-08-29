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
import {
  CURRENT_LOCAL_CORS_ALLOW_ORIGIN,
  LOCAL_HEALTH_DISCOVERY_KEYS,
  LOCAL_HEALTH_FORBIDDEN_KEYS,
  classifyLocalApiRequest,
  localHealthDiscoveryBody,
} from "./local-api-trust";

const VALID_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const HOSTILE_ORIGIN = "https://evil.example";

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

describe("local API trust baseline", () => {
  beforeEach(async () => {
    previousHome = process.env.PINAR_HOME;
    root = await mkdtemp(join(tmpdir(), "pinar-trust-baseline-"));
    process.env.PINAR_HOME = root;
    resetLocalApiForTests();
  });

  afterEach(async () => {
    resetLocalApiForTests();
    if (previousHome === undefined) delete process.env.PINAR_HOME;
    else process.env.PINAR_HOME = previousHome;
    await rm(root, { force: true, recursive: true });
  });

  test("health discovery is limited to ok, runtime, and service", async () => {
    const response = await request("/api/health", { headers: { origin: HOSTILE_ORIGIN } });
    assert.equal(response.status, 200);
    const body = await jsonBody(response);
    assert.deepEqual(body, localHealthDiscoveryBody());
    assert.deepEqual(Object.keys(body).sort(), [...LOCAL_HEALTH_DISCOVERY_KEYS].sort());
    for (const key of LOCAL_HEALTH_FORBIDDEN_KEYS) assert.equal(key in body, false);
    assert.equal(classifyLocalApiRequest("GET", "/api/health")?.class, "public-min");
  });

  test("characterizes CORS wildcard, arbitrary preflight, and missing capability", async () => {
    // DJA-155 characterization of today's open surface. DJA-156+ invert these assertions.
    const preflight = await request("/api/history", {
      headers: {
        "access-control-request-headers": "content-type, x-pinar-capability",
        "access-control-request-method": "GET",
        origin: HOSTILE_ORIGIN,
      },
      method: "OPTIONS",
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), CURRENT_LOCAL_CORS_ALLOW_ORIGIN);

    const history = await request("/api/history", { headers: { origin: HOSTILE_ORIGIN } });
    assert.equal(history.status, 200);
    assert.equal(history.headers.get("access-control-allow-origin"), "*");
    const historyBody = await jsonBody(history);
    assert.ok(Array.isArray(historyBody.sessions));

    const tree = await request("/api/project-tree", { headers: { origin: HOSTILE_ORIGIN } });
    assert.equal(tree.status, 200);
    assert.ok(isRecord((await jsonBody(tree)).tree));

    const upload = await request("/api/shots", {
      body: JSON.stringify({
        id: "hostile_session",
        image: VALID_PNG,
        page: { title: "Hostile", url: "https://evil.example/page" },
        pins: [{ comment: "should not require a capability yet", kind: "element" }],
      }),
      headers: { "content-type": "application/json", origin: HOSTILE_ORIGIN },
      method: "POST",
    });
    assert.equal(upload.status, 201);

    const listed = await jsonBody(await request("/api/history", { headers: { origin: HOSTILE_ORIGIN } }));
    assert.equal(Array.isArray(listed.sessions) && listed.sessions.length, 1);

    assert.equal(await authorizeAppRequest(), true);
    assert.equal(await authorizeHistoryRequest(), true);
    assert.equal(classifyLocalApiRequest("GET", "/api/history")?.class, "sensitive-read");
    assert.equal(classifyLocalApiRequest("POST", "/api/shots")?.class, "mutable");
    assert.equal(classifyLocalApiRequest("GET", "/v/hostile_session.md")?.class, "local-public-projection");
  });

  test("loopback viewer remains a public projection of saved sessions", async () => {
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
  });
});
