// Shared PinIndexStore cases for the local (SQLite and JSON) and Cloud (D1
// and memory) stores, the same ones apps/cli/src/history.test.js runs on
// the synchronous history methods.

import assert from "node:assert/strict";
import type { PinIndexEntry, PinIndexStore } from "./types";

export const INDEXED_AT = "2026-10-01T00:00:00.000Z";

/** A Float32 LE vector of 256 dimensions: 1024 bytes. */
export function pinIndexVector(seed: number): Uint8Array {
  return new Uint8Array(new Float32Array(256).map((_, index) => Math.sin(index + seed) * 1000).buffer);
}

export function pinIndexEntry(sessionId: string, pinId: string, overrides: Partial<PinIndexEntry> = {}): PinIndexEntry {
  return {
    caption: null,
    docHash: `hash-${pinId}`,
    docText: `Page: ${sessionId}\nPin #1: ${pinId}`,
    model: "",
    number: 1,
    ocr: null,
    pinId,
    sessionId,
    truncated: false,
    updatedAt: INDEXED_AT,
    vector: null,
    ...overrides,
  };
}

export async function assertPinIndexStore(store: PinIndexStore) {
  assert.deepEqual(await store.entries("idx_missing"), []);

  // A full entry and a text-only one round-trip every field, ordered by pin number.
  const embedded = pinIndexEntry("idx_s1", "idx_p2", {
    caption: "A red button",
    model: "embeddinggemma-300m",
    number: 2,
    ocr: "Buy now",
    truncated: true,
    vector: pinIndexVector(1),
  });
  const textOnly = pinIndexEntry("idx_s1", "idx_p1");
  await store.replaceSession("idx_s1", [embedded, textOnly]);
  const stored = await store.entries("idx_s1");
  assert.deepEqual(stored, [textOnly, embedded]);
  const vector = stored[1].vector;
  assert.ok(vector instanceof Uint8Array);
  assert.equal(vector.byteLength, 1024);
  assert.deepEqual(vector, pinIndexVector(1));
  assert.deepEqual(new Float32Array(vector.buffer, vector.byteOffset, 256), new Float32Array(pinIndexVector(1).buffer));
  assert.equal(stored[0].vector, null);

  // A caller mutating what it wrote or read does not reach the store.
  embedded.vector?.fill(0);
  vector.fill(0);
  assert.deepEqual((await store.entries("idx_s1"))[1].vector, pinIndexVector(1));

  await store.replaceSession("idx_s2", [pinIndexEntry("idx_s2", "idx_q1", { updatedAt: "2026-10-02T00:00:00.000Z" })]);

  // Replacing drops the pins that left the session and leaves the other sessions alone.
  const replacement = pinIndexEntry("idx_s1", "idx_p3", { number: 3, vector: pinIndexVector(3) });
  await store.replaceSession("idx_s1", [replacement]);
  assert.deepEqual(await store.entries("idx_s1"), [replacement]);
  assert.deepEqual((await store.entries("idx_s2")).map((entry) => entry.pinId), ["idx_q1"]);

  // entriesFor: the requested sessions only, each once, in the requested order.
  assert.deepEqual(
    (await store.entriesFor(["idx_s2", "idx_s1", "idx_s2", "idx_missing"])).map((entry) => entry.pinId),
    ["idx_q1", "idx_p3"],
  );
  assert.deepEqual((await store.entriesFor(["idx_s1"])).map((entry) => entry.pinId), ["idx_p3"]);
  assert.deepEqual(await store.entriesFor([]), []);

  // staleSessions: no entry yet, or updatedAt newer than the oldest entry.
  await store.replaceSession("idx_s4", [
    pinIndexEntry("idx_s4", "idx_r1", { updatedAt: "2026-10-01T00:00:00.000Z" }),
    pinIndexEntry("idx_s4", "idx_r2", { number: 2, updatedAt: "2026-10-03T00:00:00.000Z" }),
  ]);
  const sessions = [
    { id: "idx_s1", updatedAt: INDEXED_AT }, // same instant: fresh
    { id: "idx_s2", updatedAt: "2026-10-01T12:00:00.000Z" }, // older than its entries: fresh
    { id: "idx_s3", updatedAt: INDEXED_AT }, // no entry: stale
    { id: "idx_s1", updatedAt: "2026-10-05T00:00:00.000Z" }, // repeated id: counted once
    { id: "idx_s4", updatedAt: "2026-10-02T00:00:00.000Z" }, // newer than its oldest entry: stale
    { id: "idx_s5", updatedAt: INDEXED_AT }, // no entry: stale
  ];
  assert.deepEqual(await store.staleSessions({ limit: 10, sessions }), ["idx_s3", "idx_s4", "idx_s5"]);
  assert.deepEqual(await store.staleSessions({ limit: 2, sessions }), ["idx_s3", "idx_s4"]);
  assert.deepEqual(await store.staleSessions({ limit: 0, sessions }), []);
  assert.deepEqual(await store.staleSessions({ limit: 10, sessions: [] }), []);
  assert.deepEqual(
    await store.staleSessions({ limit: 10, sessions: [{ id: "idx_s2", updatedAt: "2026-10-02T00:00:00.001Z" }] }),
    ["idx_s2"],
  );

  // A replacement with an entry of another session, or a vector that is not bytes, writes nothing.
  await assert.rejects(
    store.replaceSession("idx_s1", [pinIndexEntry("idx_s1", "idx_ok"), pinIndexEntry("idx_s2", "idx_wrong")]),
    (error: unknown) => error instanceof Error && error.message === "pin index entry belongs to another session",
  );
  await assert.rejects(
    store.replaceSession("idx_s1", [
      pinIndexEntry("idx_s1", "idx_float", { vector: new Float32Array(256) as unknown as Uint8Array }),
    ]),
    (error: unknown) => error instanceof Error && error.message === "pin index vector must be a Uint8Array or null",
  );
  assert.deepEqual(await store.entries("idx_s1"), [replacement]);

  await store.deleteSession("idx_s2");
  assert.deepEqual(await store.entries("idx_s2"), []);
  await store.replaceSession("idx_s1", []);
  assert.deepEqual(await store.entries("idx_s1"), []);
  assert.deepEqual((await store.entries("idx_s4")).map((entry) => entry.pinId), ["idx_r1", "idx_r2"]);
}

/** A failure in the middle of a replacement (the second INSERT repeats a pin id) leaves the previous entries. */
export async function assertPinIndexReplaceAtomic(store: PinIndexStore) {
  const previous = [
    pinIndexEntry("idx_atomic", "idx_a", { vector: pinIndexVector(5) }),
    pinIndexEntry("idx_atomic", "idx_b", { number: 2 }),
  ];
  await store.replaceSession("idx_atomic", previous);
  await assert.rejects(
    store.replaceSession("idx_atomic", [
      pinIndexEntry("idx_atomic", "idx_c", { number: 1 }),
      pinIndexEntry("idx_atomic", "idx_c", { number: 2 }),
    ]),
  );
  assert.deepEqual(await store.entries("idx_atomic"), previous);
}
