// F5/S3c: the retrieval endpoints of the user's BYOK row (byok/endpoints.ts).
// byokSlotEgress holds one per-user concurrency slot per egress call (the
// slot settles with the call: a thrown egress failure and a non-2xx release
// it at once, a 2xx is read whole INSIDE the slot — capped, bounded by the
// call's own signal — and answered with the bytes already in memory, so an
// abandoned body no longer exists; above the cap the call is refused with
// rate_limited, no queue) and classifies every failure into the common
// cause table as a caused ByokCallError (a cut read or the deadline crossing
// as endpoint_unreachable/timeout at the egress; only the JSON and the
// schema are left to the caller, as invalid_response; the provider's body,
// the URL and the key never cross the error). The caption and the embedding
// endpoints mark byok (the legacy plain-model vectors never enter their
// space). byokRetrievalEndpoints answers the caption endpoint on the user's
// chat model (vision ok) and the embedding endpoint on the saved embedding
// model (embeddings ok) — null in the no-route cases, without decrypting a
// key the capabilities would refuse.

import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, test } from "node:test";
import type { CloudEnv, Principal } from "../cloud-api";
import { untestedCapabilities } from "./api";
import { ByokCallError } from "./cause";
import { byokCrypto } from "./crypto";
import { setByokEgressForTests } from "./fetch";
import { byokAcquireSlot, byokSlotRelease, resetByokConcurrencyForTests } from "./route";
import { byokSlotEgress, byokRetrievalEndpoints } from "./endpoints";

const NOW = "2026-10-01T12:00:00.000Z";
const LATER = "2026-12-01T12:00:00.000Z";
const MASTER_KEY = Buffer.alloc(32, 7).toString("base64");
const TEST_KEY = "sk-byok-endpoints-secret";
const BASE_URL = "https://byok.test/v1";

// ---------- D1 shim (same model as byok/route.test.ts) ----------

function sqliteD1(db: Database): NonNullable<CloudEnv["DB"]> {
  const statement = (query: string) => {
    let params: unknown[] = [];
    const bound = {
      async all() {
        return { results: db.query(query).all(...params) as Record<string, unknown>[] };
      },
      bind(...values: unknown[]) {
        params = values.map((value) => value === undefined ? null : value);
        return bound;
      },
      async first() {
        return (db.query(query).get(...params) as Record<string, unknown> | null) ?? null;
      },
      async run() {
        db.query(query).run(...params);
        const changes = db.query("SELECT changes() AS changes").get() as { changes: number };
        return { meta: { changes: changes.changes } };
      },
    };
    return bound;
  };
  return {
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    prepare(query: string) {
      return statement(query);
    },
  };
}

function migratedDatabase() {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const directory = new URL("../../../migrations/", import.meta.url);
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL(file, directory), "utf8"));
  }
  return db;
}

function envFor(db: Database, overrides: Partial<CloudEnv> = {}): CloudEnv {
  return {
    BYOK_MASTER_KEY: MASTER_KEY,
    DB: sqliteD1(db),
    DEPLOYMENT_ENV: "staging",
    ...overrides,
  };
}

function principal(id: string, plan: "free" | "pro" = "pro"): Principal {
  return { id, kind: "account", plan };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function insertUser(db: Database, id: string, email: string, plan: "free" | "pro") {
  // Idempotent: a re-seeded id must not collide on the derived web_sessions
  // token, so the prior rows of the id are cleared first.
  db.query("DELETE FROM web_sessions WHERE owner_type = 'account' AND owner_id = ?").run(id);
  db.query("DELETE FROM users WHERE id = ?").run(id);
  db.query(
    "INSERT INTO users (id, email, plan, ever_paid, billing_status, created_at, updated_at) VALUES (?, ?, ?, 1, 'active', ?, ?)",
  ).run(id, email, plan, NOW, NOW);
  const suffix = (id.split("_").pop() ?? "x").repeat(43).slice(0, 43);
  const token = `pws_${suffix}`;
  db.query(
    "INSERT INTO web_sessions (token_hash, owner_type, owner_id, expires_at, revoked_at, created_at) VALUES (?, 'account', ?, ?, NULL, ?)",
  ).run(await sha256Hex(token), id, LATER, NOW);
}

async function seedByokRow(
  db: Database,
  ownerId: string,
  options: { capabilitiesJson?: string; chatModel?: string; embeddingModel?: string } = {},
) {
  const crypto = (await byokCrypto(MASTER_KEY))!;
  const ciphertext = await crypto.encrypt(TEST_KEY);
  db.query("DELETE FROM byok_endpoints WHERE owner_id = ?").run(ownerId);
  db.query(
    `INSERT INTO byok_endpoints (owner_id, base_url, key_ciphertext, key_last4, key_id, chat_model,
       embedding_model, transcription_model, capabilities_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    ownerId,
    BASE_URL,
    ciphertext,
    "1234",
    crypto.keyId,
    options.chatModel ?? "chat-1",
    options.embeddingModel ?? "embed-1",
    "tr-1",
    options.capabilitiesJson ?? JSON.stringify(untestedCapabilities()),
    NOW,
    NOW,
  );
}

afterEach(() => {
  setByokEgressForTests(null);
  resetByokConcurrencyForTests();
});

// ---------- byokSlotEgress ----------

describe("byokSlotEgress (F5/S3c)", () => {
  test("a 2xx passes through untouched (the caller reads the body)", async () => {
    const body = JSON.stringify({ data: [{ embedding: [0.5], index: 0 }] });
    const egress = byokSlotEgress(async () => new Response(body, { status: 200, headers: { "content-type": "application/json" } }), "owner-x");
    const response = await egress("https://byok.test/embeddings", { method: "POST", body: "{}" });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/json");
    assert.deepEqual(await response.json(), { data: [{ embedding: [0.5], index: 0 }] }, "the body is the provider's, untouched");
  });

  test("a non-2xx is the caused ByokCallError of the common table, without the provider's body", async () => {
    const body = "PROVIDER-BODY-SECRET";
    const cases: Array<[Response, string]> = [
      [new Response(body, { status: 401 }), "key_rejected"],
      [new Response(body, { status: 403 }), "key_rejected"],
      [new Response(body, { status: 404 }), "service_disabled"],
      [new Response(body, { status: 500 }), "unavailable"],
      [new Response(body, { status: 503 }), "unavailable"],
      [new Response(body, { status: 429, headers: { "retry-after": "30" } }), "rate_limited"],
    ];
    for (const [response, expected] of cases) {
      const egress = byokSlotEgress(async () => response, "owner-x");
      await assert.rejects(
        egress("https://byok.test/embeddings"),
        (error: unknown) => {
          assert.ok(error instanceof ByokCallError, `expected ByokCallError, got ${error}`);
          assert.equal(error.cause, expected, `the status ${response.status} classifies to ${expected}`);
          assert.equal(error.message, "byok call failed", "the fixed message; the provider's body never crosses the error");
          const text = String(error) + String((error as Error).message) + String((error as { cause?: unknown }).cause ?? "");
          assert.ok(!text.includes(body), "the provider's body never crosses the error");
          assert.ok(!text.includes("byok.test"), "the URL never crosses the error");
          assert.ok(!text.includes(TEST_KEY), "the key never crosses the error");
          return true;
        },
      );
    }
  });

  test("the 429 carries the retry-after without waiting it", async () => {
    const egress = byokSlotEgress(async () => new Response("slow", { status: 429, headers: { "retry-after": "90" } }), "owner-x");
    await assert.rejects(
      egress("https://byok.test/embeddings"),
      (error: unknown) => {
        assert.ok(error instanceof ByokCallError);
        assert.equal(error.cause, "rate_limited");
        assert.equal(error.retryAfterSeconds, 90, "the retry-after crosses in seconds");
        return true;
      },
    );
  });

  test("a thrown egress failure is the same cause table", async () => {
    // A network failure is endpoint_unreachable.
    const egress = byokSlotEgress(async () => {
      throw new Error("network down");
    }, "owner-x");
    await assert.rejects(
      egress("https://byok.test/embeddings"),
      (error: unknown) => {
        assert.ok(error instanceof ByokCallError);
        assert.equal(error.cause, "endpoint_unreachable");
        return true;
      },
    );
    // A deadline is a timeout.
    const timedOut = byokSlotEgress(async () => {
      throw new DOMException("The operation was aborted", "AbortError");
    }, "owner-x");
    await assert.rejects(
      timedOut("https://byok.test/embeddings"),
      (error: unknown) => {
        assert.ok(error instanceof ByokCallError);
        assert.equal(error.cause, "timeout");
        return true;
      },
    );
    // The refusal until S6 (byok/fetch.ts) is refused in the cause table too.
    const { ByokEgressUnavailableError } = await import("./fetch");
    const refused = byokSlotEgress(async () => {
      throw new ByokEgressUnavailableError();
    }, "owner-x");
    await assert.rejects(
      refused("https://byok.test/embeddings"),
      (error: unknown) => {
        assert.ok(error instanceof ByokCallError);
        assert.equal(error.cause, "egress_unavailable");
        return true;
      },
    );
  });

  test("one slot per egress call: the third in flight is rate_limited, no queue, and the settled answer frees the slot", async () => {
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const slow = byokSlotEgress(async () => {
      await gate;
      return new Response("late", { status: 200 });
    }, "owner-x");
    // The turn (byokAssistantRoute) holds one slot; the in-flight call
    // takes the second while its egress waits; the next is refused without
    // a queue.
    assert.equal(byokAcquireSlot("owner-x"), true, "the turn's slot");
    const inFlight = slow("https://byok.test/embeddings"); // takes the second slot
    await assert.rejects(
      byokSlotEgress(async () => new Response("third", { status: 200 }), "owner-x")("https://byok.test/embeddings"),
      (error: unknown) => {
        assert.ok(error instanceof ByokCallError);
        assert.equal(error.cause, "rate_limited", "above the cap the call is refused, no queue");
        return true;
      },
    );
    releaseGate();
    const first = await inFlight;
    assert.equal(first.status, 200);
    assert.equal(await first.text(), "late");
    // The 2xx's body was read whole INSIDE the slot: the answer's settle
    // already freed the slot — the consumer's read is plain bytes, and a
    // new call fits now (no queue).
    const after = await byokSlotEgress(async () => new Response("after", { status: 200 }), "owner-x")("https://byok.test/embeddings");
    assert.equal(after.status, 200);
    assert.equal(await after.text(), "after");
    assert.equal(byokAcquireSlot("owner-x"), true, "the call's slot is free again");
    assert.equal(byokAcquireSlot("owner-x"), false, "the turn's slot is the only one held, at the cap");
    byokSlotRelease("owner-x")(); // the probe's slot
    byokSlotRelease("owner-x")(); // the turn's slot
  });

  test("the slot settles with the answer, not with the consumer's read: failure frees at once, success with the read whole body, and the release is idempotent", async () => {
    const egress = byokSlotEgress(async () => new Response("ok", { status: 200 }), "owner-x");
    const failing = byokSlotEgress(async () => new Response("no", { status: 500 }), "owner-x");
    const ok = await egress("https://byok.test/embeddings"); // success: settled with the body read whole inside the slot
    await assert.rejects(failing("https://byok.test/embeddings"), ByokCallError); // failure: the slot frees at once
    assert.equal(byokAcquireSlot("owner-x"), true, "both settled calls already freed their slots");
    byokSlotRelease("owner-x")();
    // The release the route hands back is idempotent: a second call frees
    // nothing (the cap is two, so the probe's own slots show it).
    assert.equal(byokAcquireSlot("owner-x"), true, "probe slot one");
    assert.equal(byokAcquireSlot("owner-x"), true, "probe slot two");
    assert.equal(byokAcquireSlot("owner-x"), false, "the cap is two");
    const release = byokSlotRelease("owner-x");
    release();
    release(); // idempotent: nothing to free the second time
    assert.equal(byokAcquireSlot("owner-x"), true, "only one of the two probe slots was freed");
    byokSlotRelease("owner-x")();
  });

  test("a status-only consumer abandons the 2xx (it never reads the body): the slot is free and the third call runs", async () => {
    for (const aborted of [false, true]) {
      let calls = 0;
      const ac = new AbortController();
      const egress = byokSlotEgress(async () => {
        calls++;
        // The source already enqueued the whole body and closed it.
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("{}"));
              controller.close();
            },
          }),
          { headers: { "content-type": "application/json" } },
        );
      }, "owner-abandon");
      const a = await egress("https://byok.test/v1/embeddings", { signal: ac.signal });
      const b = await egress("https://byok.test/v1/embeddings", { signal: ac.signal });
      assert.equal(a.status, 200);
      assert.equal(b.status, 200);
      // The consumer reads only the status: it never touches a.body or
      // b.body — the bytes are already in memory, read by the egress
      // itself, inside the slot.
      if (aborted) ac.abort(new Error("the caller abandoned before the body read"));
      await Bun.sleep(10);
      // No slot is held by an abandoned body: the third call runs, not
      // refused.
      const third = await egress("https://byok.test/v1/embeddings");
      assert.equal(third.status, 200, "the third call ran (abort=" + aborted + ")");
      assert.equal(calls, 3, "the third call reached the egress (abort=" + aborted + ")");
    }
  });

  test("a 2xx whose body never closes: the call's deadline cuts the read (timeout) and the slot frees", async () => {
    let slowCalls = 0;
    const slow = byokSlotEgress(async () => {
      slowCalls++;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("partial"));
            // The source never closes: without the deadline the read would
            // wait forever and hold the slot with it.
          },
        }),
      );
    }, "owner-never");
    const deadline = AbortSignal.timeout(40);
    await assert.rejects(slow("https://byok.test/v1/embeddings", { signal: deadline }), (error: unknown) => {
      assert.ok(error instanceof ByokCallError);
      assert.equal(error.cause, "timeout", "the deadline cutting the read is a timeout");
      return true;
    });
    // The slot settled with the deadline, not with a consumer's read: the
    // user's next call fits.
    const after = await byokSlotEgress(async () => new Response("done", { status: 200 }), "owner-never")("https://byok.test/v1/embeddings");
    assert.equal(after.status, 200);
    assert.equal(slowCalls, 1, "the cut call was not retried by the egress");
  });

  test("the caller's abort during the read cuts it (timeout) and the slot frees", async () => {
    const slow = byokSlotEgress(async () => {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("partial"));
            // The source never closes.
          },
        }),
      );
    }, "owner-abort");
    const ac = new AbortController();
    const pending = slow("https://byok.test/v1/embeddings", { signal: ac.signal });
    await Bun.sleep(10);
    ac.abort(new Error("the caller abandoned the call"));
    await assert.rejects(pending, (error: unknown) => {
      assert.ok(error instanceof ByokCallError);
      assert.equal(error.cause, "timeout", "an abort while reading is a timeout");
      return true;
    });
    const after = await byokSlotEgress(async () => new Response("done", { status: 200 }), "owner-abort")("https://byok.test/v1/embeddings");
    assert.equal(after.status, 200);
  });

  test("a 2xx's body cut by the transport crosses as endpoint_unreachable (not a parse failure) and the slot frees", async () => {
    let calls = 0;
    const egress = byokSlotEgress(async () => {
      calls++;
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.error(new Error("socket destroyed"));
          },
        }),
      );
    }, "owner-cut");
    await assert.rejects(egress("https://byok.test/v1/embeddings"), (error: unknown) => {
      assert.ok(error instanceof ByokCallError);
      assert.equal(error.cause, "endpoint_unreachable", "a cut read is the common table's transport cause, not invalid_response");
      return true;
    });
    assert.equal(calls, 1, "the egress did not retry the cut call");
    // The slot settled with the failure: the next call fits.
    const after = await byokSlotEgress(async () => new Response("done", { status: 200 }), "owner-cut")("https://byok.test/v1/embeddings");
    assert.equal(after.status, 200);
  });

  test("a 2xx's body above the cap is refused as invalid_response (the read stops, the slot frees)", async () => {
    const chunk = new Uint8Array(1024 * 1024); // 1 MiB
    const egress = byokSlotEgress(async () => {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (let i = 0; i < 9; i++) controller.enqueue(chunk); // 9 MiB > the 8 MiB cap
            controller.close();
          },
        }),
      );
    }, "owner-cap");
    await assert.rejects(egress("https://byok.test/v1/embeddings"), (error: unknown) => {
      assert.ok(error instanceof ByokCallError);
      assert.equal(error.cause, "invalid_response", "above the cap the answer is refused, never buffered");
      return true;
    });
    const after = await byokSlotEgress(async () => new Response("done", { status: 200 }), "owner-cap")("https://byok.test/v1/embeddings");
    assert.equal(after.status, 200);
  });

  test("a source whose cancel never settles does not hold the slot past the deadline or the cap", async () => {
    let cancels = 0;
    const neverSettlingCancel = () => {
      cancels++;
      return new Promise<void>(() => {});
    };
    // The deadline: the source never closes, and its cancel never settles.
    const slow = byokSlotEgress(async () => new Response(new ReadableStream<Uint8Array>({
      cancel: neverSettlingCancel,
      start(controller) {
        controller.enqueue(new TextEncoder().encode("partial"));
      },
    })), "owner-pending-cancel");
    await assert.rejects(slow("https://byok.test/v1/embeddings", { signal: AbortSignal.timeout(20) }), (error: unknown) => {
      assert.ok(error instanceof ByokCallError);
      assert.equal(error.cause, "timeout");
      return true;
    });
    // The cap: more than 8 MiB, and the same cancel.
    const chunk = new Uint8Array(1024 * 1024);
    const big = byokSlotEgress(async () => new Response(new ReadableStream<Uint8Array>({
      cancel: neverSettlingCancel,
      start(controller) {
        for (let i = 0; i < 9; i++) controller.enqueue(chunk);
      },
    })), "owner-pending-cancel");
    await assert.rejects(big("https://byok.test/v1/embeddings", { signal: AbortSignal.timeout(2_000) }), (error: unknown) => {
      assert.ok(error instanceof ByokCallError);
      assert.equal(error.cause, "invalid_response");
      return true;
    });
    assert.equal(cancels, 2, "both reads cancelled their source");
    // Both slots were freed although neither cancel settled.
    const after = byokSlotEgress(async () => new Response("done", { status: 200 }), "owner-pending-cancel");
    assert.equal((await after("https://byok.test/v1/embeddings")).status, 200);
    assert.equal((await after("https://byok.test/v1/embeddings")).status, 200);
  });

  test("a bodyless 2xx (204, 205, a null body) stays bodyless, and its parse refuses it", async () => {
    for (const status of [200, 204, 205]) {
      const egress = byokSlotEgress(async () => new Response(null, { status }), "owner-bodyless");
      const response = await egress("https://byok.test/v1/embeddings");
      assert.equal(response.status, status);
      assert.equal(response.body, null, `${status}: no body is invented`);
      await assert.rejects(response.json(), `${status}: the empty answer is not JSON`);
    }
  });

  test("the egress the tests inject (setByokEgressForTests) is the one the endpoints use", async () => {
    const seen: string[] = [];
    setByokEgressForTests(async (url) => {
      seen.push(url);
      return new Response("injected", { status: 200 });
    });
    const db = migratedDatabase();
    try {
      await insertUser(db, "usr_e", "e@example.test", "pro");
      await seedByokRow(db, "usr_e", {
        capabilitiesJson: JSON.stringify({
          chat: { error: null, ok: true, testedAt: NOW },
          embeddings: { dims: 256, error: null, ok: true, testedAt: NOW },
          tools: { error: null, ok: true, testedAt: NOW },
          transcription: { error: null, ok: null, testedAt: null },
          vision: { error: null, ok: true, testedAt: NOW },
        }),
      });
      const endpoints = await byokRetrievalEndpoints(envFor(db), principal("usr_e"));
      assert.ok(endpoints?.embedding?.fetch, "the embedding endpoint carries the egress");
      const response = await endpoints!.embedding!.fetch!(`${BASE_URL}/embeddings`, { method: "POST", body: "{}" });
      assert.equal(await response.text(), "injected");
      assert.deepEqual(seen, [`${BASE_URL}/embeddings`]);
    } finally {
      db.close();
    }
  });
});

// ---------- byokRetrievalEndpoints ----------

describe("byokRetrievalEndpoints (F5/S3c)", () => {
  async function seed(db: Database, options: { capabilitiesJson: string; chatModel?: string; embeddingModel?: string; plan?: "free" | "pro" }) {
    await insertUser(db, "usr_r", `r@example.test`, options.plan ?? "pro");
    await seedByokRow(db, "usr_r", {
      capabilitiesJson: options.capabilitiesJson,
      chatModel: options.chatModel ?? "chat-1",
      embeddingModel: options.embeddingModel ?? "embed-1",
    });
    return envFor(db);
  }

  const caps = (patch: Record<string, unknown>) => {
    const base = untestedCapabilities() as Record<string, unknown>;
    return JSON.stringify({ ...base, ...patch });
  };

  test("vision ok captions on the user's chat model and embeddings ok on the saved model", async () => {
    const db = migratedDatabase();
    try {
      const env = await seed(db, {
        capabilitiesJson: caps({
          embeddings: { dims: 256, error: null, ok: true, testedAt: NOW },
          vision: { error: null, ok: true, testedAt: NOW },
        }),
      });
      const endpoints = await byokRetrievalEndpoints(env, principal("usr_r"));
      assert.ok(endpoints, "both capabilities ok route");
      assert.equal(endpoints!.vision?.model, "chat-1", "the captions run on the user's chat model");
      assert.equal(endpoints!.vision?.baseUrl, BASE_URL);
      assert.equal(endpoints!.embedding?.model, "embed-1");
      assert.equal(endpoints!.embedding?.baseUrl, BASE_URL);
      assert.equal(endpoints!.embedding?.byok, true, "the embedding endpoint is marked byok (the legacy vectors never enter its space)");
      assert.ok(endpoints!.embedding?.fetch, "and it carries the per-call egress");
      assert.equal(endpoints!.vision?.fetch, endpoints!.embedding?.fetch, "the same per-call egress on both endpoints");
    } finally {
      db.close();
    }
  });

  test("only the embeddings ok: the captions stay null (no route on the chat model without the vision ok)", async () => {
    const db = migratedDatabase();
    try {
      const env = await seed(db, {
        capabilitiesJson: caps({ embeddings: { dims: 256, error: null, ok: true, testedAt: NOW } }),
      });
      const endpoints = await byokRetrievalEndpoints(env, principal("usr_r"));
      assert.ok(endpoints);
      assert.equal(endpoints!.vision, null, "without the vision ok there is no caption endpoint");
      assert.equal(endpoints!.embedding?.model, "embed-1");
    } finally {
      db.close();
    }
  });

  test("only the vision ok: the embeddings stay null", async () => {
    const db = migratedDatabase();
    try {
      const env = await seed(db, {
        capabilitiesJson: caps({ vision: { error: null, ok: true, testedAt: NOW } }),
      });
      const endpoints = await byokRetrievalEndpoints(env, principal("usr_r"));
      assert.ok(endpoints);
      assert.equal(endpoints!.embedding, null, "without the embeddings ok there is no embedding endpoint");
      assert.equal(endpoints!.vision?.model, "chat-1");
    } finally {
      db.close();
    }
  });

  test("the no-route cases answer null, and the unusable capabilities answer null before the decrypt", async () => {
    const db = migratedDatabase();
    const originalDecrypt = crypto.subtle.decrypt.bind(crypto.subtle);
    let decrypts = 0;
    try {
      crypto.subtle.decrypt = (async (...args: Parameters<SubtleCrypto["decrypt"]>) => {
        decrypts += 1;
        return originalDecrypt(...args);
      }) as SubtleCrypto["decrypt"];

      // Not Pro: no route, no decrypt.
      let env = await seed(db, {
        capabilitiesJson: caps({ embeddings: { dims: 256, error: null, ok: true, testedAt: NOW }, vision: { error: null, ok: true, testedAt: NOW } }),
        plan: "free",
      });
      decrypts = 0;
      assert.equal(await byokRetrievalEndpoints(env, principal("usr_r", "free")), null);
      assert.equal(decrypts, 0, "the plan check never decrypts");
      // A free plan cannot reuse the pro row seeded above; seed a fresh one.
      db.query("DELETE FROM byok_endpoints WHERE owner_id = 'usr_r'").run();
      db.query("DELETE FROM users WHERE id = 'usr_r'").run();

      // No valid master key: no route.
      env = envFor(db, { BYOK_MASTER_KEY: undefined });
      await insertUser(db, "usr_r", "r2@example.test", "pro");
      await seedByokRow(db, "usr_r", {
        capabilitiesJson: caps({ embeddings: { dims: 256, error: null, ok: true, testedAt: NOW } }),
      });
      decrypts = 0;
      assert.equal(await byokRetrievalEndpoints(env, principal("usr_r")), null, "without the master key there is no route");
      assert.equal(decrypts, 0);
      db.query("DELETE FROM byok_endpoints WHERE owner_id = 'usr_r'").run();
      db.query("DELETE FROM users WHERE id = 'usr_r'").run();

      // No row: no route.
      env = envFor(db);
      await insertUser(db, "usr_r", "r3@example.test", "pro");
      decrypts = 0;
      assert.equal(await byokRetrievalEndpoints(env, principal("usr_r")), null);
      assert.equal(decrypts, 0);
      db.query("DELETE FROM users WHERE id = 'usr_r'").run();

      // The capabilities not ok (both endpoints unusable): null, and the
      // key is never decrypted (the S3a rule).
      await insertUser(db, "usr_r", "r4@example.test", "pro");
      await seedByokRow(db, "usr_r", {
        capabilitiesJson: caps({
          embeddings: { dims: null, error: "egress_unavailable", ok: false, testedAt: NOW },
          vision: { error: "egress_unavailable", ok: false, testedAt: NOW },
        }),
      });
      decrypts = 0;
      assert.equal(await byokRetrievalEndpoints(env, principal("usr_r")), null);
      assert.equal(decrypts, 0, "the unusable capabilities answer null before the decrypt");
      db.query("DELETE FROM byok_endpoints WHERE owner_id = 'usr_r'").run();
      db.query("DELETE FROM users WHERE id = 'usr_r'").run();

      // The capability ok but the model not configured: the endpoint is
      // null; with both unusable there is no route at all (and no decrypt).
      await insertUser(db, "usr_r", "r5@example.test", "pro");
      await seedByokRow(db, "usr_r", {
        capabilitiesJson: caps({ embeddings: { dims: 256, error: null, ok: true, testedAt: NOW } }),
        embeddingModel: "",
      });
      decrypts = 0;
      assert.equal(await byokRetrievalEndpoints(env, principal("usr_r")), null);
      assert.equal(decrypts, 0, "a capability without its model answers null before the decrypt");
    } finally {
      crypto.subtle.decrypt = originalDecrypt as SubtleCrypto["decrypt"];
      db.close();
    }
  });

  test("a ciphertext the master key cannot read answers null, silently", async () => {
    const db = migratedDatabase();
    const otherMaster = Buffer.alloc(32, 32).toString("base64");
    try {
      await insertUser(db, "usr_u", "u@example.test", "pro");
      const otherCrypto = (await byokCrypto(otherMaster))!;
      const ciphertext = await otherCrypto.encrypt("sk-byok-other-master");
      db.query(
        `INSERT INTO byok_endpoints (owner_id, base_url, key_ciphertext, key_last4, key_id, chat_model,
           embedding_model, transcription_model, capabilities_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "usr_u",
        BASE_URL,
        ciphertext,
        "1234",
        otherCrypto.keyId,
        "chat-1",
        "embed-1",
        "tr-1",
        caps({ embeddings: { dims: 256, error: null, ok: true, testedAt: NOW }, vision: { error: null, ok: true, testedAt: NOW } }),
        NOW,
        NOW,
      );
      assert.equal(await byokRetrievalEndpoints(envFor(db), principal("usr_u")), null, "the unreadable ciphertext has no route");
    } finally {
      db.close();
    }
  });
});
