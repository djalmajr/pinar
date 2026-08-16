import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import {
  authorizeCloudHistoryRequest,
  cleanupOldRecords,
  handleCloudApiRequest,
  handleCloudPublicRequest,
  resetCloudMemoryStateForTests,
} from "./cloud-api";
import { exerciseProjectApiContract } from "./project-api.contract";

const identityA = { id: `ins_${"A".repeat(24)}`, token: `pit_${"a".repeat(43)}` };
const identityB = { id: `ins_${"B".repeat(24)}`, token: `pit_${"b".repeat(43)}` };
const identityC = { id: `ins_${"C".repeat(24)}`, token: `pit_${"c".repeat(43)}` };
const VALID_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function identityHeaders(identity: typeof identityA, extra: HeadersInit = {}) {
  return new Headers({
    authorization: `Bearer ${identity.token}`,
    "x-pinar-installation-id": identity.id,
    ...Object.fromEntries(new Headers(extra)),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function jsonBody(response: Response) {
  const body: unknown = await response.json();
  assert.ok(isRecord(body));
  return body;
}

function sessionIds(body: Record<string, unknown>) {
  assert.ok(Array.isArray(body.sessions));
  return body.sessions.map((session) => {
    assert.ok(isRecord(session));
    assert.equal(typeof session.id, "string");
    return session.id;
  });
}

function api(path: string, init: RequestInit = {}) {
  return handleCloudApiRequest(new Request(`https://pinar.test${path}`, init), {});
}

function register(identity: typeof identityA) {
  return api("/api/installations", {
    body: JSON.stringify({ installationId: identity.id, installationToken: identity.token }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function upload(identity: typeof identityA, id: string, title: string) {
  return api("/api/shots", {
    body: JSON.stringify({
      id,
      image: VALID_PNG,
      page: { title, url: `https://example.test/${id}` },
      pins: [{ comment: `Pin for ${title}`, number: 1 }],
    }),
    headers: identityHeaders(identity, { "content-type": "application/json" }),
    method: "POST",
  });
}

describe("remote installation isolation", () => {
  beforeEach(() => resetCloudMemoryStateForTests());

  test("history, browser sessions, rotation, and deletion remain installation-scoped", async () => {
    assert.equal((await register(identityA)).status, 201);
    assert.equal((await register(identityB)).status, 201);
    assert.equal((await register(identityA)).status, 200);

    assert.equal((await upload(identityA, "session_A_001", "Owner A")).status, 201);
    assert.equal((await upload(identityB, "session_B_001", "Owner B")).status, 201);
    assert.equal((await api("/api/shots", {
      body: JSON.stringify({ id: "broken_session", image: "data:image/png;base64,iVBORw==" }),
      headers: identityHeaders(identityA, { "content-type": "application/json" }),
      method: "POST",
    })).status, 400);

    assert.equal((await api("/api/history")).status, 401);
    assert.equal(await authorizeCloudHistoryRequest(new Request("https://pinar.test/history"), {}), false);

    const historyA = await api("/api/history", { headers: identityHeaders(identityA) });
    assert.deepEqual(sessionIds(await jsonBody(historyA)), ["session_A_001"]);
    const historyB = await api("/api/history", { headers: identityHeaders(identityB) });
    assert.deepEqual(sessionIds(await jsonBody(historyB)), ["session_B_001"]);
    assert.equal((await upload(identityB, "session_A_001", "Overwrite A")).status, 409);

    const ticketResponse = await api("/api/auth/browser-ticket", {
      headers: identityHeaders(identityA),
      method: "POST",
    });
    const ticketBody = await jsonBody(ticketResponse);
    if (typeof ticketBody.url !== "string") assert.fail("browser ticket URL is missing");
    const ticketUrl = new URL(ticketBody.url);
    const ticketPath = `${ticketUrl.pathname}${ticketUrl.search}`;
    const exchange = await api(ticketPath);
    assert.equal(exchange.status, 302);
    assert.equal(exchange.headers.get("location"), "/history");
    const sessionCookie = exchange.headers.get("set-cookie")?.split(";", 1)[0] || "";
    assert.match(sessionCookie, /^pinar_session=pbs_/);
    assert.equal((await api(ticketPath)).status, 401);

    const browserRequest = new Request("https://pinar.test/history", { headers: { cookie: sessionCookie } });
    assert.equal(await authorizeCloudHistoryRequest(browserRequest, {}), true);
    const browserHistory = await api("/api/history", { headers: { cookie: sessionCookie } });
    assert.deepEqual(sessionIds(await jsonBody(browserHistory)), ["session_A_001"]);

    const publicSession = await api("/api/sessions/session_A_001");
    assert.equal(publicSession.status, 200);
    const markdown = await handleCloudPublicRequest(new Request("https://pinar.test/v/session_A_001.md"), {});
    assert.equal(markdown.status, 200);
    assert.match(await markdown.text(), /Owner A/);

    const rotate = await api("/api/installations/rotate", {
      body: JSON.stringify({ installationId: identityC.id, installationToken: identityC.token }),
      headers: identityHeaders(identityA, { "content-type": "application/json" }),
      method: "POST",
    });
    assert.equal(rotate.status, 200);
    assert.equal((await api("/api/history", { headers: identityHeaders(identityA) })).status, 401);
    assert.equal((await api("/api/history", { headers: { cookie: sessionCookie } })).status, 401);
    assert.deepEqual(
      sessionIds(await jsonBody(await api("/api/history", { headers: identityHeaders(identityC) }))),
      ["session_A_001"],
    );
    assert.equal(
      (await api("/api/history/session_A_001", { headers: identityHeaders(identityB), method: "DELETE" })).status,
      404,
    );
    assert.equal(
      (await api("/api/history/session_A_001", { headers: identityHeaders(identityC), method: "DELETE" })).status,
      200,
    );
    assert.deepEqual(
      sessionIds(await jsonBody(await api("/api/history", { headers: identityHeaders(identityC) }))),
      [],
    );
    assert.equal((await api("/v1/history", { headers: identityHeaders(identityB) })).status, 404);
  });

  test("creates subscription checkout with dynamic payment methods", async () => {
    const originalFetch = globalThis.fetch;
    let stripeInit: RequestInit | undefined;
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      stripeInit = init;
      return Response.json({ url: "https://checkout.stripe.test/session" });
    };
    try {
      const response = await handleCloudApiRequest(
        new Request("https://pinar.test/api/stripe/checkout", {
          body: JSON.stringify({ interval: "year" }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
        {
          STRIPE_PRICE_YEARLY: "price_yearly_test",
          STRIPE_SECRET_KEY: "sk_test_example",
        },
      );
      assert.equal(response.status, 200);
      assert.equal((await jsonBody(response)).url, "https://checkout.stripe.test/session");
    } finally {
      globalThis.fetch = originalFetch;
    }

    const params = new URLSearchParams(String(stripeInit?.body));
    assert.equal(params.get("mode"), "subscription");
    assert.equal(params.get("line_items[0][price]"), "price_yearly_test");
    assert.equal(params.has("payment_method_types[0]"), false);
    assert.match(params.get("integration_identifier") || "", /^pinar_web_[a-z]{8}$/);
    assert.equal(new Headers(stripeInit?.headers).get("stripe-version"), "2026-07-29.dahlia");
  });

  test("isolates project trees and safely resolves foreign capture destinations", async () => {
    // Mutation captured: resolving a collection by id without owner scope lets installation B write into A's tree.
    await register(identityA);
    await register(identityB);

    const treeA = await jsonBody(await api("/api/project-tree", { headers: identityHeaders(identityA) }));
    assert.ok(isRecord(treeA.tree));
    assert.ok(Array.isArray(treeA.tree.projects));
    const personalA = treeA.tree.projects[0];
    assert.ok(isRecord(personalA));
    assert.ok(Array.isArray(personalA.collections));
    const inboxA = personalA.collections[0];
    assert.ok(isRecord(inboxA));

    const projectResponse = await api("/api/projects", {
      body: JSON.stringify({ name: "Website" }),
      headers: identityHeaders(identityA, { "content-type": "application/json" }),
      method: "POST",
    });
    assert.equal(projectResponse.status, 201);
    const projectBody = await jsonBody(projectResponse);
    assert.ok(isRecord(projectBody.project));
    const projectId = String(projectBody.project.id);

    const collectionResponse = await api(`/api/projects/${projectId}/collections`, {
      body: JSON.stringify({ name: "Review" }),
      headers: identityHeaders(identityA, { "content-type": "application/json" }),
      method: "POST",
    });
    assert.equal(collectionResponse.status, 201);
    const collectionBody = await jsonBody(collectionResponse);
    assert.ok(isRecord(collectionBody.collection));
    const collectionId = String(collectionBody.collection.id);

    assert.equal((await api(`/api/projects/${projectId}/collections`, {
      body: JSON.stringify({ name: "Foreign" }),
      headers: identityHeaders(identityB, { "content-type": "application/json" }),
      method: "POST",
    })).status, 404);

    const uploadA = await api("/api/shots", {
      body: JSON.stringify({ collectionId, id: "session_A_tree", image: VALID_PNG, page: {}, pins: [] }),
      headers: identityHeaders(identityA, { "content-type": "application/json" }),
      method: "POST",
    });
    const uploadABody = await jsonBody(uploadA);
    assert.ok(isRecord(uploadABody.destination));
    assert.equal(uploadABody.destination.collectionId, collectionId);
    const projectMarkdown = await handleCloudPublicRequest(
      new Request(`https://pinar.test/p/${projectId}.md`),
      {},
    );
    assert.equal(projectMarkdown.status, 200);
    assert.match(await projectMarkdown.text(), /session_A_tree/);

    const uploadB = await api("/api/shots", {
      body: JSON.stringify({ collectionId, id: "session_B_tree", image: VALID_PNG, page: {}, pins: [] }),
      headers: identityHeaders(identityB, { "content-type": "application/json" }),
      method: "POST",
    });
    const uploadBBody = await jsonBody(uploadB);
    assert.ok(isRecord(uploadBBody.destination));
    assert.notEqual(uploadBBody.destination.collectionId, collectionId);

    assert.equal((await api("/api/sessions/session_B_tree/move", {
      body: JSON.stringify({ collectionId }),
      headers: identityHeaders(identityB, { "content-type": "application/json" }),
      method: "POST",
    })).status, 404);

    const privateTreeB = await jsonBody(await api("/api/project-tree", { headers: identityHeaders(identityB) }));
    assert.ok(isRecord(privateTreeB.tree));
    assert.ok(Array.isArray(privateTreeB.tree.projects));
    assert.equal(privateTreeB.tree.projects.some((project) => isRecord(project) && project.id === projectId), false);

    assert.equal((await api(`/api/projects/${projectId}`, {
      headers: identityHeaders(identityA),
      method: "DELETE",
    })).status, 200);
    const preserved = await jsonBody(await api("/api/sessions/session_A_tree"));
    assert.ok(isRecord(preserved.session));
    assert.equal(preserved.session.collectionId, inboxA.id);
  });

  test("expiration removes sessions from live aggregates but keeps empty containers", async () => {
    await register(identityA);
    const projectBody = await jsonBody(await api("/api/projects", {
      body: JSON.stringify({ name: "Archive" }),
      headers: identityHeaders(identityA, { "content-type": "application/json" }),
      method: "POST",
    }));
    assert.ok(isRecord(projectBody.project));
    const projectId = String(projectBody.project.id);
    const collectionBody = await jsonBody(await api(`/api/projects/${projectId}/collections`, {
      body: JSON.stringify({ name: "Expired" }),
      headers: identityHeaders(identityA, { "content-type": "application/json" }),
      method: "POST",
    }));
    assert.ok(isRecord(collectionBody.collection));
    const collectionId = String(collectionBody.collection.id);

    const response = await api("/api/shots", {
      body: JSON.stringify({
        collectionId,
        createdAt: "2020-01-01T00:00:00.000Z",
        id: "expired_session",
        image: VALID_PNG,
        page: { title: "Expired session" },
        pins: [],
      }),
      headers: identityHeaders(identityA, { "content-type": "application/json" }),
      method: "POST",
    });
    assert.equal(response.status, 201);
    assert.equal((await cleanupOldRecords({}, 7)).deletedCount, 1);

    const treeBody = await jsonBody(await api("/api/project-tree", { headers: identityHeaders(identityA) }));
    assert.ok(isRecord(treeBody.tree));
    assert.ok(Array.isArray(treeBody.tree.projects));
    const project = treeBody.tree.projects.find((item) => isRecord(item) && item.id === projectId);
    assert.ok(isRecord(project));
    assert.ok(Array.isArray(project.collections));
    const collection = project.collections.find((item) => isRecord(item) && item.id === collectionId);
    assert.ok(isRecord(collection));
    assert.deepEqual(collection.sessions, []);

    const markdown = await handleCloudPublicRequest(
      new Request(`https://pinar.test/c/${collectionId}.md`),
      {},
    );
    assert.equal(markdown.status, 200);
    assert.doesNotMatch(await markdown.text(), /expired_session/);
  });

  test("matches the shared projects and collections API contract", async () => {
    await register(identityA);
    await exerciseProjectApiContract((path, init = {}) => api(path, {
      ...init,
      headers: identityHeaders(identityA, init.headers),
    }));
  });
});
