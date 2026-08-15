import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { app, resetMemoryStateForTests } from "./index.js";

const identityA = { id: `ins_${"A".repeat(24)}`, token: `pit_${"a".repeat(43)}` };
const identityB = { id: `ins_${"B".repeat(24)}`, token: `pit_${"b".repeat(43)}` };
const identityC = { id: `ins_${"C".repeat(24)}`, token: `pit_${"c".repeat(43)}` };

function identityHeaders(identity, extra = {}) {
  return {
    authorization: `Bearer ${identity.token}`,
    "x-pinar-installation-id": identity.id,
    ...extra,
  };
}

async function request(path, init = {}) {
  return app.request(`https://pinar.test${path}`, init, {});
}

async function register(identity) {
  return request("/api/installations", {
    body: JSON.stringify({ installationId: identity.id, installationToken: identity.token }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function upload(identity, id, title) {
  return request("/api/shots", {
    body: JSON.stringify({
      id,
      image: "data:image/png;base64,iVBORw==",
      page: { title, url: `https://example.test/${id}` },
      pins: [{ comment: `Pin for ${title}`, number: 1 }],
    }),
    headers: identityHeaders(identity, { "content-type": "application/json" }),
    method: "POST",
  });
}

describe("remote installation isolation", () => {
  beforeEach(() => resetMemoryStateForTests());

  test("history, browser sessions, rotation, and deletion stay scoped to one installation", async () => {
    assert.equal((await register(identityA)).status, 201);
    assert.equal((await register(identityB)).status, 201);
    assert.equal((await register(identityA)).status, 200, "registration is idempotent");

    assert.equal((await upload(identityA, "session_A_001", "Owner A </script><script>alert(1)</script>")).status, 201);
    assert.equal((await upload(identityB, "session_B_001", "Owner B")).status, 201);

    const anonymousHistory = await request("/api/history");
    assert.equal(anonymousHistory.status, 401);
    const anonymousPage = await request("/history");
    assert.equal(anonymousPage.status, 401);
    assert.doesNotMatch(await anonymousPage.text(), /Owner A|Owner B/);

    const historyA = await request("/api/history", { headers: identityHeaders(identityA) });
    assert.equal(historyA.status, 200);
    assert.deepEqual((await historyA.json()).sessions.map((session) => session.id), ["session_A_001"]);

    const historyB = await request("/api/history", { headers: identityHeaders(identityB) });
    assert.deepEqual((await historyB.json()).sessions.map((session) => session.id), ["session_B_001"]);

    const collision = await upload(identityB, "session_A_001", "Overwrite A");
    assert.equal(collision.status, 409);

    const ticketResponse = await request("/api/auth/browser-ticket", {
      headers: identityHeaders(identityA),
      method: "POST",
    });
    assert.equal(ticketResponse.status, 200);
    const { url } = await ticketResponse.json();
    assert.match(url, /^https:\/\/pinar\.test\/api\/auth\/device\?ticket=pbt_/);

    const ticketPath = new URL(url).pathname + new URL(url).search;
    const exchange = await request(ticketPath);
    assert.equal(exchange.status, 302);
    assert.equal(exchange.headers.get("location"), "/history");
    const sessionCookie = exchange.headers.get("set-cookie")?.split(";", 1)[0];
    assert.match(sessionCookie || "", /^pinar_session=pbs_/);

    assert.equal((await request(ticketPath)).status, 401, "browser tickets are one-time");
    const browserHistory = await request("/api/history", { headers: { cookie: sessionCookie } });
    assert.deepEqual((await browserHistory.json()).sessions.map((session) => session.id), ["session_A_001"]);

    const dashboard = await request("/history", { headers: { cookie: sessionCookie } });
    const dashboardHtml = await dashboard.text();
    assert.equal(dashboard.status, 200);
    assert.match(dashboardHtml, /Owner A/);
    assert.doesNotMatch(dashboardHtml, /<\/script><script>alert\(1\)<\/script>/);
    const themeIndex = dashboardHtml.indexOf('id="btnThemeToggle"');
    const githubIndex = dashboardHtml.indexOf('href="https://github.com/djalmajr/pinar"');
    const coffeeIndex = dashboardHtml.indexOf('href="https://buymeacoffee.com/djalmajr"');
    assert.ok(themeIndex < githubIndex && githubIndex < coffeeIndex, "GitHub follows the theme toggle");

    const viewer = await request("/v/session_A_001");
    const viewerHtml = await viewer.text();
    assert.equal(viewer.status, 200);
    assert.match(viewerHtml, /aria-label="Back to history"/);
    assert.doesNotMatch(viewerHtml, /← Back|☀|🌙/);

    const publicSession = await request("/api/sessions/session_A_001");
    assert.equal(publicSession.status, 200);
    assert.equal((await publicSession.json()).session.id, "session_A_001");

    const rotate = await request("/api/installations/rotate", {
      body: JSON.stringify({ installationId: identityC.id, installationToken: identityC.token }),
      headers: identityHeaders(identityA, { "content-type": "application/json" }),
      method: "POST",
    });
    assert.equal(rotate.status, 200);
    assert.equal((await request("/api/history", { headers: identityHeaders(identityA) })).status, 401);
    assert.equal((await request("/api/history", { headers: { cookie: sessionCookie } })).status, 401);

    const historyC = await request("/api/history", { headers: identityHeaders(identityC) });
    assert.deepEqual((await historyC.json()).sessions.map((session) => session.id), ["session_A_001"]);
    assert.equal(
      (await request("/api/history/session_A_001", { headers: identityHeaders(identityB), method: "DELETE" })).status,
      404,
    );
    assert.equal(
      (await request("/api/history/session_A_001", { headers: identityHeaders(identityC), method: "DELETE" })).status,
      200,
    );
    assert.deepEqual(
      (await (await request("/api/history", { headers: identityHeaders(identityC) })).json()).sessions,
      [],
    );

    assert.equal((await request("/v1/history", { headers: identityHeaders(identityB) })).status, 404);
  });
});
