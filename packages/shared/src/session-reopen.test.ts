import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  applyLocatorToPin,
  applyManualReposition,
  dropHydrationIfTabLeftOrigin,
  historicalFieldsUntouched,
  isPinarAppUrl,
  planSessionReopen,
  requestReopenSession,
  selectHydrateSession,
  tabUrlAllowedForSession,
  withHistoricalAnchor,
} from "./session-reopen/index.js";

const helperApp = "http://127.0.0.1:17373/v/session_one";
const session = {
  captureId: "cap_one",
  id: "session_one",
  page: { url: "https://app.example.test/settings" },
};

describe("session reopen origin binding", () => {
  test("allows only Pinar app origins to request a reopen", () => {
    assert.equal(isPinarAppUrl(helperApp), true);
    assert.equal(isPinarAppUrl("http://127.0.0.1:17382/app"), true);
    assert.equal(isPinarAppUrl("https://pinar.dev/v/abc"), true);
    assert.equal(isPinarAppUrl("https://stg.pinar.dev/v/abc"), true);
    assert.equal(isPinarAppUrl("http://127.0.0.1:3000/v/abc"), false);
    assert.equal(isPinarAppUrl("https://evil.example/v/abc"), false);
    assert.equal(isPinarAppUrl("https://pinar.dev.attacker.test/v/abc"), false);
  });

  test("binds the destination tab to the captured page origin", () => {
    assert.equal(tabUrlAllowedForSession(session.page.url, "https://app.example.test/later"), true);
    assert.equal(tabUrlAllowedForSession(session.page.url, "https://evil.example/settings"), false);
    assert.equal(tabUrlAllowedForSession(session.page.url, "http://app.example.test/settings"), false);
  });

  test("sends only the explicitly chosen session", () => {
    assert.equal(selectHydrateSession("session_one", session)?.sessionId, "session_one");
    assert.equal(selectHydrateSession("cap_one", session)?.sessionId, "session_one");
    assert.equal(selectHydrateSession("session_two", session), null);
    assert.equal(selectHydrateSession("session_one", { id: "session_two", page: session.page }), null);
  });

  test("rejects untrusted apps and mismatched payloads before opening a tab", () => {
    assert.equal(planSessionReopen({
      appUrl: "https://evil.example",
      requestedSessionId: "session_one",
      session,
    }).error, "untrusted_app");
    assert.equal(planSessionReopen({
      appUrl: helperApp,
      requestedSessionId: "session_two",
      session,
    }).error, "session_mismatch");
    assert.deepEqual(planSessionReopen({
      appUrl: helperApp,
      requestedSessionId: "session_one",
      session,
    }), {
      ok: true,
      origin: "https://app.example.test",
      pageUrl: session.page.url,
      sessionId: "session_one",
    });
  });

  test("drops a hydration if the tab leaves the authorized origin", () => {
    const hydrations = new Map([[7, { pageUrl: session.page.url }]]);
    const tabPins = new Map([[7, [{ comment: "secret from session_one" }]]]);
    assert.deepEqual(
      dropHydrationIfTabLeftOrigin(hydrations, tabPins, 7, "about:blank"),
      { dropped: false },
    );
    assert.equal(tabPins.has(7), true);
    assert.deepEqual(
      dropHydrationIfTabLeftOrigin(hydrations, tabPins, 7, "https://evil.example/phish"),
      { dropped: true, reason: "origin_mismatch" },
    );
    assert.equal(hydrations.has(7), false);
    assert.equal(tabPins.has(7), false);
  });
});

describe("historical anchors", () => {
  const pin = {
    anchor: { x: 10, y: 20 },
    box: { height: 40, width: 80, x: 8, y: 12 },
    fingerprint: { id: "cta" },
    path: "main > button",
    selector: "#cta",
  };

  test("locator updates live geometry without pretending ambiguous matches are exact", () => {
    const frozen = withHistoricalAnchor(pin);
    const pending = applyLocatorToPin(frozen, {
      at: "2026-08-29T00:00:00.000Z",
      box: { height: 40, width: 80, x: 400, y: 12 },
      location: { confidence: "ambiguous", evidence: ["lookalikes"], score: 0.4, strategy: "semantic" },
    });
    assert.equal(pending.location?.confidence, "ambiguous");
    assert.deepEqual(pending.box, pin.box);
    assert.equal(historicalFieldsUntouched(pin, pending), true);

    const moved = applyLocatorToPin(frozen, {
      anchor: { x: 440, y: 32 },
      at: "2026-08-29T00:00:01.000Z",
      box: { height: 40, width: 80, x: 400, y: 12 },
      location: { confidence: "exact", evidence: ["id"], score: 1, strategy: "stable-selector" },
    });
    assert.equal(moved.location?.confidence, "exact");
    assert.deepEqual(moved.box, { height: 40, width: 80, x: 400, y: 12 });
    assert.deepEqual(moved.historicalAnchor, pin.anchor);
    assert.deepEqual(moved.historicalBox, pin.box);
    assert.equal(moved.selector, "#cta");
  });

  test("manual reposition records history and keeps the original anchor", () => {
    const placed = applyManualReposition(pin, {
      at: "2026-08-29T00:00:02.000Z",
      box: { height: 48, width: 96, x: 200, y: 80 },
    });
    assert.equal(placed.location?.confidence, "exact");
    assert.deepEqual(placed.location?.evidence, ["manual-reposition"]);
    assert.deepEqual(placed.historicalAnchor, pin.anchor);
    assert.deepEqual(placed.historicalBox, pin.box);
    assert.equal(placed.selector, "#cta");
    assert.equal(placed.path, "main > button");
    assert.equal(placed.locationHistory?.at(-1)?.source, "manual");
    assert.equal(historicalFieldsUntouched(pin, placed), true);
  });

  test("dispatches only the session id to the extension bridge", () => {
    const events: string[] = [];
    const target = {
      dispatchEvent(event: Event) {
        events.push(`${event.type}:${JSON.stringify((event as CustomEvent).detail)}`);
        return true;
      },
    } as EventTarget;
    requestReopenSession("session_one", target);
    assert.deepEqual(events, ['pinar:reopen-session:{"sessionId":"session_one"}']);
  });
});
