import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openHistoryDb } from "@pinar/cli/history";
import { shotsDir } from "@pinar/cli/paths";
import { localPinSource, shotMimeType, type LocalPinSourceDatabase } from "./source-local";
import { releaseClosedDatabases } from "../../../../tests/helpers/native-handles";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50]);
const GIF = new TextEncoder().encode("GIF89a....");

let root = "";
let db: (LocalPinSourceDatabase & { close(): void; saveSession(input: Record<string, unknown>): { id: string }; addPinComment(...args: unknown[]): unknown }) | null = null;

function history() {
  assert.ok(db);
  return db;
}

function save(input: Record<string, unknown>) {
  return history().saveSession(input);
}

describe("localPinSource", () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "pinar-pin-source-"));
    db = openHistoryDb(root) as unknown as typeof db;
  });

  afterEach(async () => {
    db?.close();
    db = null;
    await releaseClosedDatabases();
    await rm(root, { force: true, recursive: true });
  });

  test("listSessions lists only sessions with pins, newest first, with createdAt as updatedAt", async () => {
    save({ createdAt: "2026-10-01T00:00:00.000Z", id: "old", page: { title: "Old", url: "https://a.example/old" }, pins: [{ comment: "A" }] });
    save({ createdAt: "2026-10-02T00:00:00.000Z", id: "empty", page: { title: "Empty", url: "https://a.example/e" }, pins: [] });
    save({ createdAt: "2026-10-03T00:00:00.000Z", id: "new", page: { title: "New", url: "https://a.example/new" }, pins: [{ comment: "B" }, { comment: "C" }] });
    const source = localPinSource(history(), shotsDir(root));
    assert.deepEqual(await source.listSessions({ limit: 10, offset: 0 }), [
      { id: "new", updatedAt: "2026-10-03T00:00:00.000Z" },
      { id: "old", updatedAt: "2026-10-01T00:00:00.000Z" },
    ]);
    assert.deepEqual(await source.listSessions({ limit: 1, offset: 1 }), [{ id: "old", updatedAt: "2026-10-01T00:00:00.000Z" }]);
    assert.deepEqual(await source.listSessions({ limit: 5, offset: 2 }), []);
  });

  test("listSessions pages past history pages full of empty sessions", async () => {
    for (let index = 0; index < 3; index += 1) {
      save({ createdAt: `2026-09-0${index + 1}T00:00:00.000Z`, id: `pinned-${index}`, page: { title: "P", url: "https://a.example/p" }, pins: [{ comment: `pin ${index}` }] });
    }
    for (let index = 0; index < 230; index += 1) {
      save({ createdAt: `2026-10-01T00:00:${String(index % 60).padStart(2, "0")}.${String(index).padStart(3, "0")}Z`, id: `empty-${index}`, page: { title: "E", url: "https://a.example/e" }, pins: [] });
    }
    const source = localPinSource(history(), shotsDir(root));
    assert.deepEqual((await source.listSessions({ limit: 100, offset: 0 })).map((session) => session.id), ["pinned-2", "pinned-1", "pinned-0"]);
    assert.deepEqual((await source.listSessions({ limit: 1, offset: 2 })).map((session) => session.id), ["pinned-0"]);
  });

  test("session maps the page and the document fields of each pin, with matching pinIds", async () => {
    save({
      id: "cap",
      page: { title: "Checkout", url: "https://site.example/checkout" },
      pins: [
        { comment: "Contraste baixo", kind: "element", label: "Comprar", pinId: "p1", selector: "button.buy", tag: "button", text: "Comprar" },
        { comment: "Sem detalhes", pinId: "p2" },
      ],
    });
    save({ id: "bare", page: { title: "Bare", url: "https://site.example/bare" }, pins: [] });
    const source = localPinSource(history(), shotsDir(root));
    assert.deepEqual(await source.session("cap"), {
      id: "cap",
      page: { title: "Checkout", url: "https://site.example/checkout" },
      pinIds: ["p1", "p2"],
      pins: [
        { comment: "Contraste baixo", innerText: "Comprar", label: "Comprar", number: 1, selector: "button.buy", tag: "button", text: "Comprar" },
        { comment: "Sem detalhes", number: 2 },
      ],
    });
    // A session without pins is still returned, so indexing it clears its entries.
    assert.deepEqual(await source.session("bare"), { id: "bare", page: { title: "Bare", url: "https://site.example/bare" }, pinIds: [], pins: [] });
    assert.equal(await source.session("missing"), null);
  });

  test("a pin without id is left out and a repeated pin id keeps its first pin", async () => {
    const fake: LocalPinSourceDatabase = {
      getSession: (id) => ({
        createdAt: "2026-10-01T00:00:00.000Z",
        id,
        page: { title: "T", url: "https://u.example" },
        pins: [
          { comment: "first", coords: { x: 0, y: 0 }, number: 1, pinId: "dup", type: "point" },
          { comment: "no id", coords: { x: 0, y: 0 }, number: 2, type: "point" },
          { comment: "second", coords: { x: 0, y: 0 }, id: "dup", number: 3, type: "point" },
          { comment: "by id", coords: { x: 0, y: 0 }, id: "p4", number: 4, type: "point" },
        ],
      }),
      listPinComments: () => [],
      listSessions: () => [],
    };
    const session = await localPinSource(fake, "/nonexistent").session("s");
    assert.deepEqual(session?.pinIds, ["dup", "p4"]);
    assert.deepEqual(session?.pins.map((pin) => pin.comment), ["first", "by id"]);
  });

  test("comments are grouped by pin, oldest first, with the actor label as author", async () => {
    save({ id: "cap", page: { title: "T", url: "https://u.example" }, pins: [{ comment: "A", pinId: "p1" }, { comment: "B", pinId: "p2" }] });
    history().addPinComment("cap", "p1", "primeiro", null);
    history().addPinComment("cap", "p2", "outro pin", "Claude");
    history().addPinComment("cap", "p1", "segundo", null);
    const comments = await localPinSource(history(), shotsDir(root)).comments("cap");
    assert.deepEqual([...comments.entries()], [
      ["p1", [{ author: "Local", body: "primeiro" }, { author: "Local", body: "segundo" }]],
      ["p2", [{ author: "Claude", body: "outro pin" }]],
    ]);
    assert.deepEqual([...(await localPinSource(history(), shotsDir(root)).comments("missing")).entries()], []);
  });

  test("shot reads the canonical shot file and takes the mime type from its signature", async () => {
    const shots = shotsDir(root);
    mkdirSync(shots, { recursive: true });
    const source = localPinSource(history(), shots);
    const cases: Array<{ bytes: Uint8Array; expected: string | null; id: string }> = [
      { bytes: PNG, expected: "image/png", id: "png" },
      { bytes: JPEG, expected: "image/jpeg", id: "jpeg" },
      { bytes: WEBP, expected: "image/webp", id: "webp" },
      { bytes: GIF, expected: null, id: "gif" },
      { bytes: new Uint8Array(), expected: null, id: "zero" },
    ];
    for (const item of cases) {
      save({ id: `cap-${item.id}`, page: { title: "T", url: "https://u.example" }, pins: [{ comment: "A" }], shotId: `shot-${item.id}` });
      writeFileSync(join(shots, `shot-${item.id}.png`), item.bytes);
      const shot = await source.shot(`cap-${item.id}`);
      assert.equal(shot?.mimeType ?? null, item.expected, item.id);
      if (shot) assert.deepEqual([...shot.bytes], [...item.bytes]);
    }
  });

  test("shot falls back to the session id, ignores the stored shotPath and is null without a regular file", async () => {
    const shots = shotsDir(root);
    mkdirSync(shots, { recursive: true });
    const source = localPinSource(history(), shots);
    save({ id: "by-session-id", page: { title: "T", url: "https://u.example" }, pins: [{ comment: "A" }] });
    writeFileSync(join(shots, "by-session-id.png"), PNG);
    assert.equal((await source.shot("by-session-id"))?.mimeType, "image/png");

    // A stored shotPath elsewhere is never read.
    const elsewhere = join(root, "elsewhere.png");
    writeFileSync(elsewhere, PNG);
    save({ id: "stored-path", page: { title: "T", url: "https://u.example" }, pins: [{ comment: "A" }], shotId: "missing-shot", shotPath: elsewhere });
    assert.equal(await source.shot("stored-path"), null);

    save({ id: "dir", page: { title: "T", url: "https://u.example" }, pins: [{ comment: "A" }], shotId: "a-directory" });
    mkdirSync(join(shots, "a-directory.png"));
    assert.equal(await source.shot("dir"), null);

    assert.equal(await source.shot("missing-session"), null);
    assert.equal(await localPinSource(history(), join(root, "no-shots-dir")).shot("by-session-id"), null);
  });

  test("shot never follows a symlink in the shots folder", async () => {
    const shots = shotsDir(root);
    mkdirSync(shots, { recursive: true });
    const outside = join(root, "outside.png");
    writeFileSync(outside, PNG);
    save({ id: "linked", page: { title: "T", url: "https://u.example" }, pins: [{ comment: "A" }] });
    symlinkSync(outside, join(shots, "linked.png"));
    assert.equal(await localPinSource(history(), shots).shot("linked"), null);
  });

  test("shotMimeType recognizes only PNG, JPEG and WebP signatures", () => {
    assert.equal(shotMimeType(PNG), "image/png");
    assert.equal(shotMimeType(JPEG), "image/jpeg");
    assert.equal(shotMimeType(WEBP), "image/webp");
    assert.equal(shotMimeType(GIF), null);
    assert.equal(shotMimeType(PNG.subarray(0, 7)), null, "a truncated PNG signature");
    assert.equal(shotMimeType(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20])), null, "RIFF but not WebP");
  });
});
