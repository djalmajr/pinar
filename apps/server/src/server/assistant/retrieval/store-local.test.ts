import assert from "node:assert/strict";
import { openHistoryDb } from "@pinar/cli/history";
import { mkdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { localPinIndexStore, type LocalPinIndexDatabase } from "./store-local";
import { assertPinIndexReplaceAtomic, assertPinIndexStore, pinIndexEntry, pinIndexVector } from "./store.test-helpers";
import { releaseClosedDatabases } from "../../../../tests/helpers/native-handles";

type HistoryDb = LocalPinIndexDatabase & {
  clearHistory(): boolean;
  close(): void;
  deleteSession(id: string): boolean;
  saveSession(input: { id: string; page: { title: string }; pins: Array<{ comment: string; kind: string; pinId: string }> }): unknown;
};

const BACKENDS = [
  { name: "sqlite", open: (dir: string) => openHistoryDb(dir) as unknown as HistoryDb },
  {
    name: "json",
    // A directory where history.db should be makes SQLite fail, so the JSON fallback opens.
    open: (dir: string) => {
      mkdirSync(join(dir, "history.db"), { recursive: true });
      return openHistoryDb(dir) as unknown as HistoryDb;
    },
  },
];

for (const backend of BACKENDS) {
  describe(`localPinIndexStore over ${backend.name}`, () => {
    let tempDir: string;
    let db: HistoryDb;

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), "pinar-pin-index-local-"));
      db = backend.open(tempDir);
    });

    afterEach(async () => {
      db.close();
      await releaseClosedDatabases();
      await rm(tempDir, { force: true, recursive: true });
    });

    test("keeps entries, entriesFor, staleSessions, and the vector bytes", async () => {
      await assertPinIndexStore(localPinIndexStore(db));
    });

    test("a failure in the middle of a replacement leaves the previous entries", async () => {
      await assertPinIndexReplaceAtomic(localPinIndexStore(db));
    });

    test("entries go with the session and with clearHistory", async () => {
      const store = localPinIndexStore(db);
      db.saveSession({ id: "idx_life", page: { title: "Indexed" }, pins: [{ comment: "Fix", kind: "element", pinId: "idx_life_p1" }] });
      db.saveSession({ id: "idx_keep", page: { title: "Kept" }, pins: [{ comment: "Keep", kind: "element", pinId: "idx_keep_p1" }] });
      await store.replaceSession("idx_life", [pinIndexEntry("idx_life", "idx_life_p1", { vector: pinIndexVector(7) })]);
      await store.replaceSession("idx_keep", [pinIndexEntry("idx_keep", "idx_keep_p1")]);

      assert.equal(db.deleteSession("idx_life"), true);
      assert.deepEqual(await store.entries("idx_life"), []);
      assert.deepEqual((await store.entries("idx_keep")).map((entry) => entry.pinId), ["idx_keep_p1"]);

      db.clearHistory();
      assert.deepEqual(await store.entriesFor(["idx_keep"]), []);
    });

    test("entries survive a reopen", async () => {
      const entry = pinIndexEntry("idx_reopen", "idx_reopen_p1", { model: "embeddinggemma-300m", truncated: true, vector: pinIndexVector(9) });
      await localPinIndexStore(db).replaceSession("idx_reopen", [entry]);
      db.close();
      db = backend.open(tempDir);
      assert.deepEqual(await localPinIndexStore(db).entries("idx_reopen"), [entry]);
    });
  });
}
