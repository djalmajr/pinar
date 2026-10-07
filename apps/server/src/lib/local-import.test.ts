import { LOCAL_EXPORT_FORMAT, LOCAL_EXPORT_SCHEMA_VERSION, writeStoredZip } from "@pinar/shared";
import { describe, expect, test } from "bun:test";
import { importLocalExport, LocalImportStoppedError, type LocalImportProgress } from "./local-import";

// A real 1x1 PNG so the data-URL assertion is checked against a real file.
const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);
const PNG_DATA_URL = `data:image/png;base64,${Buffer.from(PNG_BYTES).toString("base64")}`;

interface ManifestFixture {
  batches: Array<Record<string, unknown>>;
  collections: Array<Record<string, unknown>>;
  exportedAt: string;
  format: string;
  projects: Array<Record<string, unknown>>;
  schemaVersion: number;
  sessions: Array<Record<string, unknown>>;
  source: { runtime: string; version: string };
}

function manifestFixture(): ManifestFixture {
  return {
    batches: [
      { finishedAt: "2026-10-07T10:00:00.000Z", id: "b1", label: "Draft", startedAt: "2026-10-07T09:00:00.000Z" },
    ],
    collections: [
      { createdAt: "2026-10-01T00:00:00.000Z", id: "c1", isProtected: true, name: "Inbox", parentId: null, position: 0, projectId: "p1", updatedAt: "2026-10-01T00:00:00.000Z" },
    ],
    exportedAt: "2026-10-07T12:00:00.000Z",
    format: LOCAL_EXPORT_FORMAT,
    projects: [
      { createdAt: "2026-10-01T00:00:00.000Z", icon: "folder", id: "p1", isProtected: false, name: "Pinar", position: 0, updatedAt: "2026-10-01T00:00:00.000Z" },
    ],
    schemaVersion: LOCAL_EXPORT_SCHEMA_VERSION,
    sessions: [
      {
        batchId: "b1",
        capture: { captureId: "cap-s1", page: { title: "Page" }, pins: [], privacy: {}, schemaVersion: 1 },
        collectionId: "c1",
        createdAt: "2026-10-07T09:01:00.000Z",
        id: "s1",
        includeScreenshot: true,
        position: 1,
        shot: "shots/s1.png",
      },
      {
        batchId: null,
        capture: { page: { title: "Page" }, pins: [], privacy: {}, schemaVersion: 1 },
        collectionId: "c1",
        createdAt: "2026-10-07T09:02:00.000Z",
        id: "s2",
        includeScreenshot: false,
        position: 2,
        shot: null,
      },
    ],
    source: { runtime: "local", version: "0.6.0" },
  };
}

async function zipBlob(entries: Array<{ data: Uint8Array; name: string }>): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of writeStoredZip(entries)) chunks.push(chunk);
  const all = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.length;
  }
  return new Blob([all]);
}

async function exportBlob(manifest: ManifestFixture = manifestFixture(), withShot = true): Promise<Blob> {
  const entries: Array<{ data: Uint8Array; name: string }> = [
    { data: new TextEncoder().encode(JSON.stringify(manifest)), name: "manifest.json" },
  ];
  if (withShot) entries.push({ data: PNG_BYTES, name: "shots/s1.png" });
  return zipBlob(entries);
}

interface FakeCall {
  body: Record<string, unknown>;
  path: string;
}

function makeFakeFetch(respond: (call: FakeCall) => Response | Promise<Response>) {
  const calls: FakeCall[] = [];
  let active = 0;
  let maxActive = 0;
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: FakeCall = { body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>, path: String(input) };
    calls.push(call);
    active += 1;
    maxActive = Math.max(maxActive, active);
    try {
      await Promise.resolve(); // yield the scheduler so overlapping requests would count
      return await respond(call);
    } finally {
      active -= 1;
    }
  }) as typeof fetch;
  return { calls, fetcher, maxActive: () => maxActive };
}

const okResponses = {
  "/api/batches/cb1/finish": { ok: true },
  "/api/history": { ok: true },
  "/api/import/structure": {
    batchIds: { b1: "cb1" },
    collectionIds: { c1: "cc1" },
    ok: true,
    projectIds: { p1: "cp1" },
    sessionIds: { s1: "cs1", s2: "cs2" },
  },
  "/api/shots": { ok: true },
};

function defaultRespond(call: FakeCall): Response {
  const value = okResponses[call.path];
  if (!value) throw new Error(`unexpected request in the fake fetch: ${call.path}`);
  return Response.json(value);
}

describe("importLocalExport", () => {
  test("imports the structure first, then the sessions one request at a time with remapped ids", async () => {
    const { calls, fetcher, maxActive } = makeFakeFetch(defaultRespond);
    const progress: LocalImportProgress[] = [];
    const manifest = manifestFixture();
    const result = await importLocalExport(await exportBlob(manifest), { fetch: fetcher, onProgress: (value) => progress.push(value) });

    // The structure goes first, with the manifest and no sessions.
    expect(calls[0].path).toBe("/api/import/structure");
    expect(calls[0].body.sessions).toEqual([]);
    expect(calls[0].body.sessionIds).toEqual(["s1", "s2"]);
    expect(calls[0].body.projects).toEqual(manifest.projects);
    expect(calls[0].body.collections).toEqual(manifest.collections);
    expect(calls[0].body.batches).toEqual(manifest.batches);

    // Then the sessions in ascending position order: shot first, then history.
    expect(calls[1].path).toBe("/api/shots");
    expect(calls[2].path).toBe("/api/history");

    // The finished batch is closed with the manifest's finishedAt.
    expect(calls[3].path).toBe("/api/batches/cb1/finish");
    expect(calls[3].body).toEqual({ finishedAt: "2026-10-07T10:00:00.000Z" });
    expect(calls).toHaveLength(4);

    const shotBody = calls[1].body;
    expect(shotBody.id).toBe("cs1");
    expect(shotBody.captureId).toBe("cap-s1");
    expect(shotBody.collectionId).toBe("cc1");
    expect(shotBody.createdAt).toBe("2026-10-07T09:01:00.000Z");
    expect(shotBody.image).toBe(PNG_DATA_URL);
    expect(shotBody.includeScreenshot).toBe(true);
    expect(shotBody.batch).toEqual({ id: "cb1", label: "Draft", startedAt: "2026-10-07T09:00:00.000Z" });
    expect(shotBody.page).toEqual({ title: "Page" });
    expect(shotBody.pins).toEqual([]);

    const historyBody = calls[2].body;
    expect(historyBody.id).toBe("cs2");
    expect(historyBody.captureId).toBe("s2");
    expect(historyBody.collectionId).toBe("cc1");
    expect(historyBody.includeScreenshot).toBe(false);
    expect(historyBody).not.toHaveProperty("image");
    expect(historyBody).not.toHaveProperty("batch");

    expect(result).toEqual({ failed: [], imported: 2 });
    expect(progress).toEqual([
      { done: 1, failed: 0, total: 2 },
      { done: 2, failed: 0, total: 2 },
    ]);
    expect(maxActive()).toBe(1);
  });

  test("a failed session lands in failed and the import continues", async () => {
    const { calls, fetcher } = makeFakeFetch((call) =>
      call.path === "/api/shots" ? Response.json({ error: "boom" }, { status: 500 }) : defaultRespond(call),
    );
    const progress: LocalImportProgress[] = [];
    const result = await importLocalExport(await exportBlob(), { fetch: fetcher, onProgress: (value) => progress.push(value) });

    expect(result).toEqual({ failed: [{ error: "boom", id: "s1" }], imported: 1 });
    expect(progress).toEqual([
      { done: 1, failed: 1, total: 2 },
      { done: 2, failed: 1, total: 2 },
    ]);
    // The second session and the batch finish still run.
    expect(calls.map((call) => call.path)).toEqual([
      "/api/import/structure",
      "/api/shots",
      "/api/history",
      "/api/batches/cb1/finish",
    ]);
  });

  test("a 413 quota answer stops the import before the next session", async () => {
    const { calls, fetcher } = makeFakeFetch((call) =>
      call.path === "/api/shots" ? Response.json({ code: "storage_quota_exceeded", error: "Storage quota exceeded" }, { status: 413 }) : defaultRespond(call),
    );
    const error = await importLocalExport(await exportBlob(), { fetch: fetcher }).catch((value) => value);
    expect(error).toBeInstanceOf(LocalImportStoppedError);
    expect(error.message).toBe("Storage quota exceeded");
    expect(error.invalidFile).toBe(false);
    expect(calls.map((call) => call.path)).toEqual(["/api/import/structure", "/api/shots"]);
  });

  test("a trial code in the body stops the import even with a 2xx answer", async () => {
    const { calls, fetcher } = makeFakeFetch((call) =>
      call.path === "/api/shots" ? Response.json({ code: "cloud_subscription_required", error: "Cloud subscription required" }) : defaultRespond(call),
    );
    const error = await importLocalExport(await exportBlob(), { fetch: fetcher }).catch((value) => value);
    expect(error).toBeInstanceOf(LocalImportStoppedError);
    expect(error.message).toBe("Cloud subscription required");
    expect(calls.map((call) => call.path)).toEqual(["/api/import/structure", "/api/shots"]);
  });

  test("a structure answer that misses an id stops the import before any session", async () => {
    const { calls, fetcher } = makeFakeFetch((call) =>
      call.path === "/api/import/structure"
        ? Response.json({ ...okResponses["/api/import/structure"], sessionIds: { s1: "cs1" } })
        : defaultRespond(call),
    );
    const error = await importLocalExport(await exportBlob(), { fetch: fetcher }).catch((value) => value);
    expect(error).toBeInstanceOf(LocalImportStoppedError);
    expect(error.invalidFile).toBe(false);
    expect(calls.map((call) => call.path)).toEqual(["/api/import/structure"]);
  });

  test("a file that is not a stored zip is an invalid-file stop without any request", async () => {
    const { calls, fetcher } = makeFakeFetch(defaultRespond);
    const error = await importLocalExport(new Blob([new Uint8Array([1, 2, 3, 4, 5, 6])]), { fetch: fetcher }).catch((value) => value);
    expect(error).toBeInstanceOf(LocalImportStoppedError);
    expect(error.invalidFile).toBe(true);
    expect(calls).toHaveLength(0);
  });

  test("a valid zip with an invalid manifest is an invalid-file stop without any request", async () => {
    const { calls, fetcher } = makeFakeFetch(defaultRespond);
    const error = await importLocalExport(await exportBlob({ ...manifestFixture(), format: "not-pinar" }), { fetch: fetcher }).catch((value) => value);
    expect(error).toBeInstanceOf(LocalImportStoppedError);
    expect(error.invalidFile).toBe(true);
    expect(calls).toHaveLength(0);
  });

  test("a manifest pointing at a missing shot file is an invalid-file stop", async () => {
    const { calls, fetcher } = makeFakeFetch(defaultRespond);
    const error = await importLocalExport(await exportBlob(manifestFixture(), false), { fetch: fetcher }).catch((value) => value);
    expect(error).toBeInstanceOf(LocalImportStoppedError);
    expect(error.invalidFile).toBe(true);
    // The structure already ran before the sessions; nothing else did.
    expect(calls.map((call) => call.path)).toEqual(["/api/import/structure"]);
  });

  test("an already aborted signal stops the import without any request", async () => {
    const { calls, fetcher } = makeFakeFetch(defaultRespond);
    const controller = new AbortController();
    controller.abort();
    const error = await importLocalExport(await exportBlob(), { fetch: fetcher, signal: controller.signal }).catch((value) => value);
    expect(error).toBeInstanceOf(LocalImportStoppedError);
    expect(error.invalidFile).toBe(false);
    expect(calls).toHaveLength(0);
  });

  test("an aborted signal stops the import between sessions", async () => {
    const { calls, fetcher } = makeFakeFetch((call) => {
      if (call.path === "/api/shots") return Response.json({ ok: true });
      return defaultRespond(call);
    });
    const controller = new AbortController();
    const pending = importLocalExport(await exportBlob(), {
      fetch: fetcher,
      onProgress: () => controller.abort(), // abort right after the first session
      signal: controller.signal,
    }).catch((value) => value);
    const error = await pending;
    expect(error).toBeInstanceOf(LocalImportStoppedError);
    expect(calls.map((call) => call.path)).toEqual(["/api/import/structure", "/api/shots"]);
  });
});
