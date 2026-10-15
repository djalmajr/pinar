import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createEdgerFetch, default as edgerEntry } from "./edger-server-entry";

const JOB_NAMES = [
  "cleanupOldRecords",
  "reconcileBillingEntitlements",
  "refundStaleAiReservations",
  "sendStorageExpiryNotices",
];

function cronRequest(init: RequestInit = { method: "POST", headers: { "x-edger-internal": "true" } }) {
  return new Request("https://pinar.test/_internal/cron/daily", init);
}

interface FakeEntry {
  calls: string[];
  fetch: (request: Request) => Promise<Response>;
  logs: string[];
  tanstackRequests: Request[];
}

function fakeEntry(failures: Record<string, string> = {}) {
  const calls: string[] = [];
  const logs: string[] = [];
  const tanstackRequests: Request[] = [];
  const fetch = createEdgerFetch({
    jobs: JOB_NAMES.map((name) => ({
      name,
      run: async () => {
        calls.push(name);
        if (failures[name]) throw new Error(failures[name]);
      },
    })),
    log: (line) => logs.push(line),
    tanstackFetch: async (request) => {
      tanstackRequests.push(request);
      return new Response("tanstack", { status: 200 });
    },
  });
  return { calls, fetch, logs, tanstackRequests };
}

describe("createEdgerFetch", () => {
  test("rejects a non-POST request to the cron path without running jobs", async () => {
    const { calls, fetch, logs, tanstackRequests } = fakeEntry();
    const response = await fetch(cronRequest({ headers: { "x-edger-internal": "true" } }));
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "Not found");
    assert.deepEqual(calls, []);
    assert.deepEqual(logs, []);
    assert.deepEqual(tanstackRequests, []);
  });

  test("rejects a POST to the cron path without the internal header", async () => {
    const { calls, fetch } = fakeEntry();
    const response = await fetch(cronRequest({ method: "POST" }));
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "Not found");
    assert.deepEqual(calls, []);
  });

  test("rejects an internal header value that is not exactly true", async () => {
    // (A padded value like "true " is unrepresentable: the Fetch spec strips
    // leading/trailing whitespace from header values on construction.)
    for (const value of ["TRUE", "false", "1"]) {
      const { calls, fetch } = fakeEntry();
      const response = await fetch(cronRequest({ method: "POST", headers: { "x-edger-internal": value } }));
      assert.equal(response.status, 404);
      assert.deepEqual(calls, []);
    }
  });

  test("runs all jobs for an authorized POST and reports each one", async () => {
    const { calls, fetch, logs } = fakeEntry();
    const response = await fetch(cronRequest());
    assert.equal(response.status, 200);
    assert.equal(await response.text(), JSON.stringify({
      ok: true,
      jobs: JOB_NAMES.map((job) => ({ job, ok: true })),
    }));
    assert.deepEqual(calls, JOB_NAMES);
    assert.deepEqual(logs, JOB_NAMES.map((job) => JSON.stringify({ message: "cron_job", job, ok: true })));
  });

  test("keeps running the other jobs when one rejects", async () => {
    const { calls, fetch, logs } = fakeEntry({ reconcileBillingEntitlements: "billing broke" });
    const response = await fetch(cronRequest());
    assert.equal(response.status, 500);
    assert.equal(await response.text(), JSON.stringify({
      ok: false,
      jobs: JOB_NAMES.map((job) => ({ job, ok: job !== "reconcileBillingEntitlements" })),
    }));
    assert.deepEqual(calls, JOB_NAMES);
    assert.deepEqual(logs, [
      JSON.stringify({ message: "cron_job", job: "cleanupOldRecords", ok: true }),
      JSON.stringify({ message: "cron_job", job: "reconcileBillingEntitlements", ok: false, error: "billing broke" }),
      JSON.stringify({ message: "cron_job", job: "refundStaleAiReservations", ok: true }),
      JSON.stringify({ message: "cron_job", job: "sendStorageExpiryNotices", ok: true }),
    ]);
  });

  test("keeps running the other jobs when one throws before returning a promise", async () => {
    const calls: string[] = [];
    const logs: string[] = [];
    const fetch = createEdgerFetch({
      jobs: JOB_NAMES.map((name) => ({
        name,
        run: () => {
          calls.push(name);
          if (name === "cleanupOldRecords") throw new Error("env broke");
          return Promise.resolve();
        },
      })),
      log: (line) => logs.push(line),
      tanstackFetch: async () => new Response("tanstack"),
    });
    const response = await fetch(cronRequest());
    assert.equal(response.status, 500);
    assert.equal(await response.text(), JSON.stringify({
      ok: false,
      jobs: JOB_NAMES.map((job) => ({ job, ok: job !== "cleanupOldRecords" })),
    }));
    assert.deepEqual(calls, JOB_NAMES);
    assert.equal(logs[0], JSON.stringify({ message: "cron_job", job: "cleanupOldRecords", ok: false, error: "env broke" }));
  });

  test("forwards every other path to tanstackFetch unchanged", async () => {
    const { calls, fetch, tanstackRequests } = fakeEntry();
    const cronLike = new Request(
      "https://pinar.test/_internal/cron/daily/x",
      { method: "POST", headers: { "x-edger-internal": "true" } },
    );
    const home = new Request("https://pinar.test/");
    const cronLikeResponse = await fetch(cronLike);
    assert.equal(cronLikeResponse.status, 200);
    assert.equal(await fetch(home).then((response) => response.text()), "tanstack");
    assert.deepEqual(tanstackRequests, [cronLike, home]);
    assert.deepEqual(calls, []);
  });
});

describe("edger entry wiring", () => {
  test("default export exposes the fetch handler", () => {
    assert.equal(typeof edgerEntry.fetch, "function");
  });
});
