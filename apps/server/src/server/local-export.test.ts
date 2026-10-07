import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { parseLocalExportManifest, readZipDirectory, readZipEntry } from "@pinar/shared";
import { localExportFileName, streamLocalExport, type LocalExportSource } from "./local-export";

// Distinctive bytes: a stored shotPath that the export must never read.
const SECRET = new Uint8Array([0x53, 0x45, 0x43, 0x52, 0x45, 0x54, 0x01, 0x02]);

const tempRoots: string[] = [];

function makeRoot(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

// Windows (Defender + delayed handle release) can keep the temp root briefly
// busy right after close, so retry the cleanup with a bounded delay.
async function removeWithRetry(path: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await rm(path, { force: true, recursive: true });
      return;
    } catch (error) {
      if (String(error).includes("EBUSY") && attempt < 19) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      throw error;
    }
  }
}

afterEach(async () => {
  for (const dir of tempRoots.splice(0)) await removeWithRetry(dir);
});

function fixture() {
  const root = makeRoot("pinar-export-");
  const shotsRoot = join(root, "shots");
  mkdirSync(shotsRoot);
  writeFileSync(join(shotsRoot, "shot0001.png"), new Uint8Array([137, 80, 78, 71, 1, 2, 3]));
  // Outside the Pinar root entirely: a shotPath that must never be read.
  const outside = makeRoot("pinar-export-outside-");
  const outsideShot = join(outside, "secret.png");
  writeFileSync(outsideShot, SECRET);
  const sessions = {
    session0001: { batchId: "batch1", captureId: "session0001", collectionId: "child", createdAt: "2026-10-01T00:00:00.000Z", id: "session0001", includeScreenshot: true, page: { title: "A", url: "https://a" }, pins: [{ id: "p1" }], position: 0, privacy: { redacted: false }, schemaVersion: 1, shotId: "shot0001", shotPath: null },
    session0002: { batchId: null, captureId: "session0002", collectionId: "inbox", createdAt: "2026-10-02T00:00:00.000Z", id: "session0002", includeScreenshot: true, page: { title: "B", url: "https://b" }, pins: [], position: 1, shotId: "missing0", shotPath: null },
    session0003: { batchId: null, captureId: "session0003", collectionId: "inbox", createdAt: "2026-10-03T00:00:00.000Z", id: "session0003", includeScreenshot: false, page: { title: "C", url: "https://c" }, pins: [], position: 2, shotId: "shot0001", shotPath: null },
    // A stored shotPath outside the root: the export must ignore it.
    session0004: { batchId: null, captureId: "session0004", collectionId: "inbox", createdAt: "2026-10-04T00:00:00.000Z", id: "session0004", includeScreenshot: true, page: { title: "D", url: "https://d" }, pins: [], position: 3, shotId: "shot0004", shotPath: outsideShot },
    // A stored shotPath inside the shots root but belonging to another
    // session's canonical file: the export must ignore it.
    session0005: { batchId: null, captureId: "session0005", collectionId: "inbox", createdAt: "2026-10-05T00:00:00.000Z", id: "session0005", includeScreenshot: true, page: { title: "E", url: "https://e" }, pins: [], position: 4, shotId: "shot0005", shotPath: join(shotsRoot, "shot0001.png") },
    // No canonical file yet; the symlink test points at one that escapes.
    session0006: { batchId: null, captureId: "session0006", collectionId: "inbox", createdAt: "2026-10-06T00:00:00.000Z", id: "session0006", includeScreenshot: true, page: { title: "F", url: "https://f" }, pins: [], position: 5, shotId: "shot0006", shotPath: null },
  };
  const source: LocalExportSource = {
    getProjectTree: () => ({
      projects: [{
        collections: [
          { createdAt: "t", id: "inbox", isProtected: true, name: "Inbox", parentId: null, position: 0, projectId: "personal", sessions: [{ id: "session0002" }, { id: "session0003" }, { id: "session0004" }, { id: "session0005" }, { id: "session0006" }], updatedAt: "t" },
          { createdAt: "t", id: "child", isProtected: false, name: "Child", parentId: "inbox", position: 1, projectId: "personal", sessions: [{ id: "session0001" }, { id: "gone" }], updatedAt: "t" },
        ],
        createdAt: "t",
        icon: "user-round",
        id: "personal",
        isProtected: true,
        name: "Personal",
        position: 0,
        updatedAt: "t",
      }],
    }),
    getSession: (id) => sessions[id as keyof typeof sessions] ?? null,
    listBatches: () => [{ finishedAt: null, id: "batch1", label: "Lote", startedAt: "2026-10-01T00:00:00.000Z" }],
  };
  return { outsideShot, root, shotsRoot, source };
}

async function exportBlob(options: Parameters<typeof streamLocalExport>[0]) {
  const chunks: Uint8Array[] = [];
  for await (const chunk of streamLocalExport(options)) chunks.push(chunk);
  return new Blob(chunks);
}

function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  const source = Buffer.from(haystack);
  const target = Buffer.from(needle);
  return source.includes(target);
}

describe("local export", () => {
  test("writes a valid manifest and only the screenshots that exist and are included", async () => {
    const { root, shotsRoot, source } = fixture();
    const archive = await exportBlob({ now: () => new Date("2026-10-07T12:00:00.000Z"), root, shotsRoot, source, version: "0.7.0" });
    const entries = await readZipDirectory(archive);
    assert.deepEqual(entries.map((entry) => entry.name), ["manifest.json", "shots/shot0001.png"]);
    const manifest = parseLocalExportManifest(JSON.parse(new TextDecoder().decode(await readZipEntry(archive, entries[0]))));
    assert.equal(manifest.exportedAt, "2026-10-07T12:00:00.000Z");
    assert.equal(manifest.source.version, "0.7.0");
    assert.deepEqual(manifest.sessions.map((session) => [session.id, session.shot]), [
      ["session0002", null],
      ["session0003", null],
      ["session0004", null],
      ["session0005", null],
      ["session0006", null],
      ["session0001", "shots/shot0001.png"],
    ]);
    const first = manifest.sessions.find((session) => session.id === "session0001");
    assert.ok(first);
    assert.deepEqual(first.capture, { captureId: "session0001", page: { title: "A", url: "https://a" }, pins: [{ id: "p1" }], privacy: { redacted: false }, schemaVersion: 1 });
    assert.deepEqual(await readZipEntry(archive, entries[1]), new Uint8Array([137, 80, 78, 71, 1, 2, 3]));
  });

  test("never reads a stored shotPath, even inside the shots root, and leaks none of its bytes", async () => {
    const { outsideShot, root, shotsRoot, source } = fixture();
    const archive = await exportBlob({ root, shotsRoot, source, version: "0.7.0" });
    const entries = await readZipDirectory(archive);
    const manifest = parseLocalExportManifest(JSON.parse(new TextDecoder().decode(await readZipEntry(archive, entries[0]))));
    // shotPath outside the root and shotPath pointing at another session's
    // canonical file both export without a screenshot.
    for (const id of ["session0004", "session0005"]) {
      const session = manifest.sessions.find((item) => item.id === id);
      assert.ok(session, id);
      assert.equal(session.shot, null, id);
    }
    for (const entry of entries) {
      assert.ok(
        !containsBytes(await readZipEntry(archive, entry), SECRET),
        `no archive entry may carry the bytes of ${outsideShot}`,
      );
    }
  });

  test("ignores a canonical shot that is a symlink out of the shots root", async (t) => {
    const { outsideShot, root, shotsRoot, source } = fixture();
    const link = join(shotsRoot, "shot0006.png");
    try {
      symlinkSync(outsideShot, link);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES" || code === "EINVAL") {
        t.skip(`symlink creation is not allowed on this system (${code})`);
        return;
      }
      throw error;
    }
    try {
      const archive = await exportBlob({ root, shotsRoot, source, version: "0.7.0" });
      const entries = await readZipDirectory(archive);
      const manifest = parseLocalExportManifest(JSON.parse(new TextDecoder().decode(await readZipEntry(archive, entries[0]))));
      const escaped = manifest.sessions.find((session) => session.id === "session0006");
      assert.ok(escaped);
      assert.equal(escaped.shot, null);
      for (const entry of entries) {
        assert.ok(!containsBytes(await readZipEntry(archive, entry), SECRET), "a symlinked shot must not be exported");
      }
    } finally {
      rmSync(link, { force: true });
    }
  });

  test("names the file after the export date", () => {
    assert.equal(localExportFileName(new Date("2026-10-07T23:59:00.000Z")), "pinar-export-2026-10-07.zip");
  });
});
