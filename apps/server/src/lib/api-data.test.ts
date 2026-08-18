import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  isPin,
  isProjectTreeCollection,
  isProjectTreeProject,
  isRecord,
  isSession,
  readResponseRecord,
} from "./api-data";

const VALID_PIN = {
  comment: "Move the button",
  coords: { x: 20, y: 40 },
  number: 1,
  type: "point",
};

const VALID_SESSION = {
  createdAt: "2026-08-18T12:00:00.000Z",
  id: "session-one",
  page: { title: "Checkout", url: "https://example.test/checkout" },
  pins: [VALID_PIN],
};

const VALID_COLLECTION = {
  createdAt: "2026-08-18T12:00:00.000Z",
  id: "collection-one",
  isProtected: false,
  name: "Checkout",
  ownerId: "owner-one",
  parentId: null,
  position: 0,
  projectId: "project-one",
  sessions: [VALID_SESSION],
  updatedAt: "2026-08-18T12:00:00.000Z",
};

const VALID_PROJECT = {
  collections: [VALID_COLLECTION],
  createdAt: "2026-08-18T12:00:00.000Z",
  icon: "folder-kanban",
  id: "project-one",
  isProtected: false,
  name: "Pinar",
  ownerId: "owner-one",
  position: 0,
  updatedAt: "2026-08-18T12:00:00.000Z",
};

describe("readResponseRecord", () => {
  test("reads JSON objects", async () => {
    assert.deepEqual(await readResponseRecord(Response.json({ ok: true })), { ok: true });
  });

  test("returns null for non-JSON responses", async () => {
    assert.equal(await readResponseRecord(new Response("404 Not Found", { status: 404 })), null);
  });

  // Mutation captured: accepting arrays as records returns the parsed array instead of null.
  test("returns null for empty and non-object JSON bodies", async () => {
    assert.equal(await readResponseRecord(new Response()), null);
    assert.equal(await readResponseRecord(Response.json(["not", "a", "record"])), null);
    assert.equal(await readResponseRecord(Response.json(null)), null);
  });
});

describe("API response guards", () => {
  // Mutation captured: accepting arrays as records makes the first negative assertion fail.
  test("distinguishes JSON records from null, arrays and primitives", () => {
    assert.equal(isRecord({ ok: true }), true);
    assert.equal(isRecord([]), false);
    assert.equal(isRecord(null), false);
    assert.equal(isRecord("object"), false);
  });

  // Mutation captured: removing the coordinate-number guard accepts the malformed pin.
  test("accepts complete pins and rejects malformed coordinates or types", () => {
    assert.equal(isPin(VALID_PIN), true);
    assert.equal(isPin({ ...VALID_PIN, coords: { x: "20", y: 40 } }), false);
    assert.equal(isPin({ ...VALID_PIN, type: "note" }), false);
    assert.equal(isPin({ ...VALID_PIN, number: "1" }), false);
  });

  // Mutation captured: replacing every(isPin) with a plain array check accepts an invalid nested pin.
  test("validates the nested page and every pin in a session", () => {
    assert.equal(isSession(VALID_SESSION), true);
    assert.equal(isSession({ ...VALID_SESSION, page: { title: "Missing URL" } }), false);
    assert.equal(isSession({ ...VALID_SESSION, pins: [{ ...VALID_PIN, comment: 42 }] }), false);
    assert.equal(isSession({ ...VALID_SESSION, pins: null }), false);
  });

  // Mutation captured: dropping the parentId or nested-session guard accepts malformed collections.
  test("validates collection ownership, hierarchy and nested sessions", () => {
    assert.equal(isProjectTreeCollection(VALID_COLLECTION), true);
    assert.equal(isProjectTreeCollection({ ...VALID_COLLECTION, parentId: 10 }), false);
    assert.equal(isProjectTreeCollection({ ...VALID_COLLECTION, projectId: null }), false);
    assert.equal(isProjectTreeCollection({ ...VALID_COLLECTION, sessions: [{}] }), false);
  });

  // Mutation captured: removing the icon or nested-collection guard accepts an invalid project tree.
  test("validates project icons, container fields and every collection", () => {
    assert.equal(isProjectTreeProject(VALID_PROJECT), true);
    assert.equal(isProjectTreeProject({ ...VALID_PROJECT, icon: "not-a-lucide-icon" }), false);
    assert.equal(isProjectTreeProject({ ...VALID_PROJECT, position: "0" }), false);
    assert.equal(isProjectTreeProject({ ...VALID_PROJECT, collections: [{}] }), false);
  });
});
