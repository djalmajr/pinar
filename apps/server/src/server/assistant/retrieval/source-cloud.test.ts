import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Pin } from "@pinar/shared";
import { PIN_SEARCH_MAX_SESSIONS } from "./index";
import { cloudPinSource, type CloudPinSessionRow, type CloudPinSourceData, type CloudPinSourceSession } from "./source-cloud";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50]);
const GIF = new TextEncoder().encode("GIF89a....");

function pin(number: number, comment: string, extra: Partial<Pin> = {}): Pin {
  return { comment, coords: { x: 0, y: 0 }, number, pinId: `p${number}`, type: "point", ...extra };
}

// A fake data access that records every call.
function fakeData(input: {
  comments?: Record<string, Array<{ actorLabel: string; body: string; pinId: string }>>;
  owned?: CloudPinSessionRow[];
  sessions?: Record<string, CloudPinSourceSession | null>;
  shared?: CloudPinSessionRow[];
  shots?: Record<string, Uint8Array>;
}) {
  const calls: string[] = [];
  const data: CloudPinSourceData = {
    async comments(sessionId) {
      calls.push(`comments:${sessionId}`);
      return input.comments?.[sessionId] ?? [];
    },
    async ownedSessions(limit) {
      calls.push(`owned:${limit}`);
      return (input.owned ?? []).slice(0, limit);
    },
    async session(id) {
      calls.push(`session:${id}`);
      return input.sessions?.[id] ?? null;
    },
    async sharedSessions(limit) {
      calls.push(`shared:${limit}`);
      return (input.shared ?? []).slice(0, limit);
    },
    async shot(sessionId) {
      calls.push(`shot:${sessionId}`);
      return input.shots?.[sessionId] ?? null;
    },
  };
  return { calls, data };
}

function row(id: string, createdAt: string, ownerId: string): CloudPinSessionRow {
  return { createdAt, id, ownerId };
}

describe("cloudPinSource", () => {
  test("lists owned and shared sessions together, newest first, each once, read once per source", async () => {
    const { calls, data } = fakeData({
      owned: [row("own-new", "2026-10-03T00:00:00.000Z", "usr_me"), row("own-old", "2026-10-01T00:00:00.000Z", "usr_me")],
      shared: [row("shared", "2026-10-02T00:00:00.000Z", "usr_owner"), row("own-new", "2026-10-03T00:00:00.000Z", "usr_me")],
    });
    const source = cloudPinSource(data);
    assert.deepEqual(await source.listSessions({ limit: 10, offset: 0 }), [
      { id: "own-new", updatedAt: "2026-10-03T00:00:00.000Z" },
      { id: "shared", updatedAt: "2026-10-02T00:00:00.000Z" },
      { id: "own-old", updatedAt: "2026-10-01T00:00:00.000Z" },
    ]);
    assert.deepEqual(await source.listSessions({ limit: 1, offset: 1 }), [{ id: "shared", updatedAt: "2026-10-02T00:00:00.000Z" }]);
    assert.deepEqual(await source.listSessions({ limit: 5, offset: 3 }), []);
    assert.deepEqual([...(await source.owners()).entries()], [["own-new", "usr_me"], ["shared", "usr_owner"], ["own-old", "usr_me"]]);
    assert.deepEqual(calls, [`owned:${PIN_SEARCH_MAX_SESSIONS}`, `shared:${PIN_SEARCH_MAX_SESSIONS}`]);
  });

  test("lists at most PIN_SEARCH_MAX_SESSIONS sessions, ties ordered by id", async () => {
    const owned = Array.from({ length: 400 }, (_, index) => row(`o${String(index).padStart(3, "0")}`, "2026-10-01T00:00:00.000Z", "usr_me"));
    const shared = Array.from({ length: 400 }, (_, index) => row(`s${String(index).padStart(3, "0")}`, "2026-10-02T00:00:00.000Z", "usr_owner"));
    const source = cloudPinSource(fakeData({ owned, shared }).data);
    const all = await source.listSessions({ limit: 1000, offset: 0 });
    assert.equal(all.length, PIN_SEARCH_MAX_SESSIONS);
    assert.equal(all[0]!.id, "s000");
    assert.equal(all[399]!.id, "s399");
    assert.equal(all[400]!.id, "o000");
    assert.equal((await source.owners()).size, PIN_SEARCH_MAX_SESSIONS);
  });

  test("updatedAt is the session's createdAt; the comments are not read to list", async () => {
    const { calls, data } = fakeData({
      comments: { one: [{ actorLabel: "Ana", body: "depois", pinId: "p1" }] },
      owned: [row("one", "2026-10-01T00:00:00.000Z", "usr_me"), row("two", "2026-10-02T00:00:00.000Z", "usr_me")],
    });
    assert.deepEqual(await cloudPinSource(data).listSessions({ limit: 10, offset: 0 }), [
      { id: "two", updatedAt: "2026-10-02T00:00:00.000Z" },
      { id: "one", updatedAt: "2026-10-01T00:00:00.000Z" },
    ]);
    assert.ok(!calls.some((call) => call.startsWith("comments:")));
  });

  test("session asks the data access again and maps the pins; null when the principal cannot see it", async () => {
    const { calls, data } = fakeData({
      sessions: {
        visible: {
          createdAt: "2026-10-01T00:00:00.000Z",
          id: "visible",
          page: { title: "Checkout", url: "https://site.example/checkout" },
          pins: [
            pin(1, "Contraste baixo", { label: "Comprar", selector: "button.buy", tag: "button", text: "Comprar" }),
            pin(2, "sem id", { pinId: undefined }),
            pin(3, "repetido", { pinId: "p1" }),
            pin(4, "pelo id", { id: "p4", pinId: undefined }),
          ],
        },
      },
    });
    const source = cloudPinSource(data);
    assert.deepEqual(await source.session("visible"), {
      id: "visible",
      page: { title: "Checkout", url: "https://site.example/checkout" },
      pinIds: ["p1", "p4"],
      pins: [
        { comment: "Contraste baixo", label: "Comprar", number: 1, selector: "button.buy", tag: "button", text: "Comprar" },
        { comment: "pelo id", number: 4 },
      ],
    });
    assert.equal(await source.session("hidden"), null);
    assert.deepEqual(calls, ["session:visible", "session:hidden"]);
  });

  test("comments and shot read nothing for a session the principal cannot see", async () => {
    const { calls, data } = fakeData({
      comments: { hidden: [{ actorLabel: "Ana", body: "segredo", pinId: "p1" }] },
      shots: { hidden: PNG },
    });
    const source = cloudPinSource(data);
    assert.deepEqual([...(await source.comments("hidden")).entries()], []);
    assert.equal(await source.shot("hidden"), null);
    assert.deepEqual(calls, ["session:hidden", "session:hidden"], "checked on each call, then nothing else is read");
  });

  test("access is checked again on every read: a revocation after session() stops comments, shot and session", async () => {
    let allowed = true;
    let checks = 0;
    const visible: CloudPinSourceSession = { createdAt: "2026-10-01T00:00:00.000Z", id: "shared", page: { title: "Shared", url: "https://u.example" }, pins: [pin(1, "nota privada")] };
    const { calls, data } = fakeData({ comments: { shared: [{ actorLabel: "Dono", body: "conversa privada", pinId: "p1" }] }, shots: { shared: PNG } });
    const source = cloudPinSource({
      ...data,
      async session(id) {
        checks += 1;
        return allowed && id === "shared" ? visible : null;
      },
    });
    assert.ok(await source.session("shared"));
    assert.ok(await source.shot("shared"), "still allowed: the shot is read");
    allowed = false;
    assert.deepEqual([...(await source.comments("shared")).entries()], [], "revoked: no comment read");
    assert.equal(await source.shot("shared"), null, "revoked: no shot read");
    assert.equal(await source.session("shared"), null, "revoked: the session is gone");
    assert.equal(checks, 5, "one access check per call, nothing remembered");
    assert.deepEqual(calls.filter((call) => !call.startsWith("session:")), ["shot:shared"], "the only content read happened before the revocation");
  });

  test("comments are grouped by pin, oldest first, with the actor label as author", async () => {
    const session: CloudPinSourceSession = { createdAt: "2026-10-01T00:00:00.000Z", id: "s", page: { title: "T", url: "https://u.example" }, pins: [pin(1, "A"), pin(2, "B")] };
    const source = cloudPinSource(fakeData({
      comments: { s: [
        { actorLabel: "Ana", body: "primeiro", pinId: "p1" },
        { actorLabel: "Bia", body: "outro pin", pinId: "p2" },
        { actorLabel: "Ana", body: "segundo", pinId: "p1" },
      ] },
      sessions: { s: session },
    }).data);
    assert.deepEqual([...(await source.comments("s")).entries()], [
      ["p1", [{ author: "Ana", body: "primeiro" }, { author: "Ana", body: "segundo" }]],
      ["p2", [{ author: "Bia", body: "outro pin" }]],
    ]);
  });

  test("shot takes the mime type from the bytes and is null without an object or with another format", async () => {
    const session = (id: string): CloudPinSourceSession => ({ createdAt: "2026-10-01T00:00:00.000Z", id, page: { title: "T", url: "https://u.example" }, pins: [pin(1, "A")] });
    const ids = ["png", "jpeg", "webp", "gif", "empty", "missing"];
    const source = cloudPinSource(fakeData({
      sessions: Object.fromEntries(ids.map((id) => [id, session(id)])),
      shots: { empty: new Uint8Array(), gif: GIF, jpeg: JPEG, png: PNG, webp: WEBP },
    }).data);
    assert.deepEqual(await source.shot("png"), { bytes: PNG, mimeType: "image/png" });
    assert.equal((await source.shot("jpeg"))?.mimeType, "image/jpeg");
    assert.equal((await source.shot("webp"))?.mimeType, "image/webp");
    assert.equal(await source.shot("gif"), null);
    assert.equal(await source.shot("empty"), null);
    assert.equal(await source.shot("missing"), null);
  });
});
