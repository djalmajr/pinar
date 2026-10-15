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

const ORIGIN_HEADER = "x-pinar-origin-auth";
const ORIGIN_SECRET = "s3cr3t-origin";

function entryWith(deps: { originSecret?: string } = {}) {
  const calls: string[] = [];
  const logs: string[] = [];
  const tanstackRequests: Request[] = [];
  const fetch = createEdgerFetch({
    ...deps,
    jobs: JOB_NAMES.map((name) => ({
      name,
      run: async () => {
        calls.push(name);
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

describe("origin defense (EDG-27)", () => {
  test("without a secret the request reaches tanstackFetch unchanged", async () => {
    for (const originSecret of [undefined, ""] as Array<string | undefined>) {
      const { fetch, tanstackRequests } = entryWith({ originSecret });
      const request = new Request("https://pinar.test/checkout", {
        headers: { "cf-ipcountry": "BR", "cf-connecting-ip": "1.2.3.4", [ORIGIN_HEADER]: "anything" },
      });
      const response = await fetch(request);
      assert.equal(response.status, 200);
      assert.equal(tanstackRequests.length, 1);
      assert.equal(tanstackRequests[0], request);
      assert.equal(tanstackRequests[0].headers.get("cf-ipcountry"), "BR");
      assert.equal(tanstackRequests[0].headers.get("cf-connecting-ip"), "1.2.3.4");
      assert.equal(tanstackRequests[0].headers.get(ORIGIN_HEADER), "anything");
    }
  });

  test("with the secret and the right header, the cf-* headers pass and the auth header does not", async () => {
    const { fetch, tanstackRequests } = entryWith({ originSecret: ORIGIN_SECRET });
    const controller = new AbortController();
    const request = new Request("https://pinar.test/checkout", {
      signal: controller.signal,
      headers: {
        [ORIGIN_HEADER]: ORIGIN_SECRET,
        "cf-ipcountry": "BR",
        "cf-connecting-ip": "1.2.3.4",
        "user-agent": "pinar-agent",
      },
    });
    await fetch(request);
    const seen = tanstackRequests[0];
    assert.equal(seen.headers.get("cf-ipcountry"), "BR");
    assert.equal(seen.headers.get("cf-connecting-ip"), "1.2.3.4");
    assert.equal(seen.headers.get(ORIGIN_HEADER), null);
    assert.equal(seen.headers.get("user-agent"), "pinar-agent");
    assert.equal(seen.method, request.method);
    assert.equal(seen.url, request.url);
    // The forwarded request is a clone: its signal follows the original's.
    assert.equal(seen.signal.aborted, false);
    controller.abort();
    assert.equal(seen.signal.aborted, true);
  });

  test("with the secret and the wrong header, no cf-* and no auth header reach the app", async () => {
    const { fetch, tanstackRequests } = entryWith({ originSecret: ORIGIN_SECRET });
    const request = new Request("https://pinar.test/checkout", {
      headers: {
        [ORIGIN_HEADER]: "forged",
        "cf-ipcountry": "BR",
        "cf-connecting-ip": "1.2.3.4",
        "user-agent": "pinar-agent",
      },
    });
    await fetch(request);
    const seen = tanstackRequests[0];
    assert.equal(seen.headers.get("cf-ipcountry"), null);
    assert.equal(seen.headers.get("cf-connecting-ip"), null);
    assert.equal(seen.headers.get(ORIGIN_HEADER), null);
    assert.equal(seen.headers.get("user-agent"), "pinar-agent");
  });

  test("with the secret and the header missing, the cf-* headers are still stripped", async () => {
    const { fetch, tanstackRequests } = entryWith({ originSecret: ORIGIN_SECRET });
    const request = new Request("https://pinar.test/checkout", {
      headers: { "cf-ipcountry": "BR", "cf-connecting-ip": "1.2.3.4", "user-agent": "pinar-agent" },
    });
    await fetch(request);
    const seen = tanstackRequests[0];
    assert.equal(seen.headers.get("cf-ipcountry"), null);
    assert.equal(seen.headers.get("cf-connecting-ip"), null);
    assert.equal(seen.headers.get(ORIGIN_HEADER), null);
    assert.equal(seen.headers.get("user-agent"), "pinar-agent");
  });

  test("a POST with the wrong header arrives with the method, the URL and the same body", async () => {
    const { fetch, tanstackRequests } = entryWith({ originSecret: ORIGIN_SECRET });
    const url = "https://pinar.test/api/thing";
    const body = "payload=1&x=2";
    const request = new Request(url, {
      method: "POST",
      body,
      headers: { "content-type": "application/x-www-form-urlencoded", [ORIGIN_HEADER]: "forged", "cf-ipcountry": "BR" },
    });
    await fetch(request);
    const seen = tanstackRequests[0];
    assert.equal(seen.method, "POST");
    assert.equal(seen.url, url);
    assert.equal(seen.headers.get("content-type"), "application/x-www-form-urlencoded");
    assert.equal(await seen.text(), body);
  });

  test("a POST with a streamed body arrives with the same content", async () => {
    const { fetch, tanstackRequests } = entryWith({ originSecret: ORIGIN_SECRET });
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("chunk-one"));
        controller.enqueue(encoder.encode("chunk-two"));
        controller.close();
      },
    });
    const request = new Request("https://pinar.test/api/thing", {
      method: "POST",
      body,
      duplex: "half",
      headers: { [ORIGIN_HEADER]: ORIGIN_SECRET },
    });
    await fetch(request);
    const seen = tanstackRequests[0];
    assert.equal(seen.method, "POST");
    assert.equal(await seen.text(), "chunk-onechunk-two");
  });

  test("a header whose size differs from the secret does not throw", async () => {
    // Only cf-* and the origin header: nothing is left after the strip.
    const { fetch, tanstackRequests } = entryWith({ originSecret: ORIGIN_SECRET });
    const request = new Request("https://pinar.test/", {
      headers: { [ORIGIN_HEADER]: "t", "cf-ipcountry": "BR" },
    });
    const response = await fetch(request);
    assert.equal(response.status, 200);
    assert.deepEqual([...tanstackRequests[0].headers], []);
  });

  test("the cron route is unchanged with the secret set", async () => {
    const { calls, fetch, tanstackRequests } = entryWith({ originSecret: ORIGIN_SECRET });
    const authorized = await fetch(cronRequest({
      method: "POST",
      headers: { "x-edger-internal": "true", "cf-ipcountry": "BR", [ORIGIN_HEADER]: "forged" },
    }));
    assert.equal(authorized.status, 200);
    assert.deepEqual(calls, JOB_NAMES);
    assert.deepEqual(tanstackRequests, []);
    const rejected = await fetch(cronRequest({ method: "GET", headers: { "x-edger-internal": "true" } }));
    assert.equal(rejected.status, 404);
    assert.deepEqual(calls, JOB_NAMES);
  });
});

describe("public URL (EdgeR hands the worker http://edger.local)", () => {
  const EDGER_URL = "http://edger.local/api/shots?x=1";

  test("rebuilds the URL from Host and X-Forwarded-Proto", async () => {
    const { fetch, tanstackRequests } = entryWith();
    await fetch(new Request(EDGER_URL, { headers: { host: "stg.pinar.dev", "x-forwarded-proto": "https" } }));
    assert.equal(tanstackRequests[0].url, "https://stg.pinar.dev/api/shots?x=1");
    assert.equal(new URL(tanstackRequests[0].url).origin, "https://stg.pinar.dev");
  });

  test("keeps the scheme it came with when X-Forwarded-Proto is absent", async () => {
    const { fetch, tanstackRequests } = entryWith();
    await fetch(new Request(EDGER_URL, { headers: { host: "stg.pinar.dev" } }));
    assert.equal(tanstackRequests[0].url, "http://stg.pinar.dev/api/shots?x=1");
  });

  test("takes the first X-Forwarded-Proto value and ignores an unknown one", async () => {
    const { fetch, tanstackRequests } = entryWith();
    await fetch(new Request(EDGER_URL, { headers: { host: "pinar.dev", "x-forwarded-proto": "https, http" } }));
    await fetch(new Request(EDGER_URL, { headers: { host: "pinar.dev", "x-forwarded-proto": "gopher" } }));
    assert.equal(tanstackRequests[0].url, "https://pinar.dev/api/shots?x=1");
    assert.equal(tanstackRequests[1].url, "http://pinar.dev/api/shots?x=1");
  });

  test("leaves the request untouched without a Host, with a malformed one, or when nothing changes", async () => {
    const { fetch, tanstackRequests } = entryWith();
    const bare = new Request(EDGER_URL);
    const malformed = new Request(EDGER_URL, { headers: { host: "evil.test/@x" } });
    const same = new Request("https://pinar.dev/", { headers: { host: "pinar.dev", "x-forwarded-proto": "https" } });
    await fetch(bare);
    await fetch(malformed);
    await fetch(same);
    assert.equal(tanstackRequests[0], bare);
    assert.equal(tanstackRequests[1], malformed);
    assert.equal(tanstackRequests[2], same);
  });

  test("a POST keeps its method, headers and streamed body", async () => {
    const { fetch, tanstackRequests } = entryWith();
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"id":'));
        controller.enqueue(encoder.encode('"abc"}'));
        controller.close();
      },
    });
    await fetch(new Request(EDGER_URL, {
      body,
      duplex: "half",
      headers: {
        "content-type": "application/json",
        cookie: "pinar_session=x",
        host: "stg.pinar.dev",
        origin: "https://stg.pinar.dev",
        "x-forwarded-proto": "https",
      },
      method: "POST",
    }));
    const seen = tanstackRequests[0];
    assert.equal(seen.method, "POST");
    assert.equal(seen.headers.get("origin"), new URL(seen.url).origin);
    assert.equal(seen.headers.get("cookie"), "pinar_session=x");
    assert.equal(seen.headers.get("content-type"), "application/json");
    assert.equal(await seen.text(), '{"id":"abc"}');
  });

  test("the origin defense still applies to the rebuilt request", async () => {
    const { fetch, tanstackRequests } = entryWith({ originSecret: ORIGIN_SECRET });
    await fetch(new Request(EDGER_URL, {
      headers: { "cf-ipcountry": "BR", host: "stg.pinar.dev", "x-forwarded-proto": "https", [ORIGIN_HEADER]: "forged" },
    }));
    const seen = tanstackRequests[0];
    assert.equal(seen.url, "https://stg.pinar.dev/api/shots?x=1");
    assert.equal(seen.headers.get("cf-ipcountry"), null);
    assert.equal(seen.headers.get(ORIGIN_HEADER), null);
  });

  test("the cron route still answers on the EdgeR URL", async () => {
    const { calls, fetch } = entryWith();
    const response = await fetch(new Request("http://edger.local/_internal/cron/daily", {
      headers: { host: "stg.pinar.dev", "x-edger-internal": "true" },
      method: "POST",
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(calls, JOB_NAMES);
  });
});

describe("edger entry wiring", () => {
  test("default export exposes the fetch handler", () => {
    assert.equal(typeof edgerEntry.fetch, "function");
  });
});
