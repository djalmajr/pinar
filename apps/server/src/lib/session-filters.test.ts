import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Session } from "@pinar/shared";
import { filterSessions, pinCountFilterValue } from "./session-filters";

function fixture(id: string, title: string, url: string, comments: string[], pinCount?: number): Session {
  return {
    createdAt: "2026-08-18T00:00:00.000Z",
    id,
    page: { title, url },
    pinCount,
    pins: comments.map((comment, index) => ({
      comment,
      coords: { x: index, y: index },
      number: index + 1,
      selector: index === 0 ? `[data-session="${id}"]` : undefined,
      type: "point",
    })),
  };
}

const sessions = [
  fixture("alpha", "Alpha dashboard", "https://example.test/home", ["navigation"]),
  fixture("beta", "Beta checkout", "https://example.test/billing", ["copy", "spacing", "button"]),
  fixture("gamma", "Gamma reports", "https://example.test/reports", ["secret metric"], 6),
];

describe("session filters", () => {
  test("classifies pin-count boundaries", () => {
    assert.equal(pinCountFilterValue(1), "one");
    assert.equal(pinCountFilterValue(2), "twoToFive");
    assert.equal(pinCountFilterValue(5), "twoToFive");
    assert.equal(pinCountFilterValue(6), "sixOrMore");
  });

  test("searches title, URL, comment and selector case-insensitively", () => {
    assert.deepEqual(filterSessions(sessions, "ALPHA", []).map(({ id }) => id), ["alpha"]);
    assert.deepEqual(filterSessions(sessions, "billing", []).map(({ id }) => id), ["beta"]);
    assert.deepEqual(filterSessions(sessions, "secret metric", []).map(({ id }) => id), ["gamma"]);
    assert.deepEqual(filterSessions(sessions, 'data-session="beta"', []).map(({ id }) => id), ["beta"]);
  });

  test("intersects search and multiple pin filters without mutating input", () => {
    const before = structuredClone(sessions);
    assert.deepEqual(filterSessions(sessions, "checkout", ["twoToFive"]).map(({ id }) => id), ["beta"]);
    assert.deepEqual(filterSessions(sessions, "", ["one", "sixOrMore"]).map(({ id }) => id), ["alpha", "gamma"]);
    assert.deepEqual(sessions, before);
  });
});
