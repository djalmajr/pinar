import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { Database } from "bun:sqlite";
import {
  attachFounderCheckoutSession,
  confirmFounderPurchase,
  findFounderCheckoutReservation,
  releaseFounderSlot,
  reserveFounderSlot,
  type FounderCapacityStore,
  type FounderPurchaseRecord,
  type FounderReservationRecord,
  type SqlValue,
} from "./founder-capacity-store";

const schema = readFileSync(new URL("../../schema.sql", import.meta.url), "utf8");

function sqliteStore(db: Database): FounderCapacityStore {
  return {
    async firstPurchase(sql, values) {
      return db.query<FounderPurchaseRecord, SqlValue[]>(sql).get(...values);
    },
    async firstReservation(sql, values) {
      return db.query<FounderReservationRecord, SqlValue[]>(sql).get(...values);
    },
  };
}

function reservationInput(id: string, requestId: string) {
  return {
    claimHash: `claim_${id}`,
    enabled: true,
    id,
    limit: 1,
    now: new Date("2026-08-18T12:00:00.000Z"),
    requestId,
    ttlMs: 15 * 60 * 1_000,
  };
}

describe("Founder capacity store", () => {
  // Mutation captured: changing the atomic count comparison from < to <= grants both contenders the last slot.
  test("atomically grants the last slot to only one concurrent request", async () => {
    const db = new Database(":memory:");
    try {
      db.exec("PRAGMA foreign_keys = ON;");
      db.exec(schema);
      const store = sqliteStore(db);

      const results = await Promise.all([
        reserveFounderSlot(store, reservationInput("reservation_a", "request_a")),
        reserveFounderSlot(store, reservationInput("reservation_b", "request_b")),
      ]);

      assert.equal(results.filter((result) => result.status === "reserved").length, 1);
      assert.equal(results.filter((result) => result.status === "sold_out").length, 1);
      assert.equal(
        db.query<{ count: number }, []>(
          "SELECT COUNT(*) AS count FROM founder_reservations WHERE status = 'active'",
        ).get()?.count,
        1,
      );
    } finally {
      db.close();
    }
  });

  test("returns the same active reservation for an idempotent request", async () => {
    const db = new Database(":memory:");
    try {
      db.exec(schema);
      const store = sqliteStore(db);
      const input = reservationInput("reservation_a", "request_a");

      const first = await reserveFounderSlot(store, input);
      const replay = await reserveFounderSlot(store, { ...input, id: "reservation_replay" });

      assert.equal(first.status, "reserved");
      assert.equal(replay.status, "existing");
      assert.equal(replay.reservation?.id, "reservation_a");
    } finally {
      db.close();
    }
  });

  test("releases expired capacity for a new request", async () => {
    const db = new Database(":memory:");
    try {
      db.exec(schema);
      const store = sqliteStore(db);
      await reserveFounderSlot(store, reservationInput("reservation_a", "request_a"));

      const result = await reserveFounderSlot(store, {
        ...reservationInput("reservation_b", "request_b"),
        now: new Date("2026-08-18T12:16:00.000Z"),
      });

      assert.equal(result.status, "reserved");
      assert.equal(result.reservation?.id, "reservation_b");
    } finally {
      db.close();
    }
  });

  test("rejects an idempotency-key replay with another claim", async () => {
    const db = new Database(":memory:");
    try {
      db.exec(schema);
      const store = sqliteStore(db);
      const input = reservationInput("reservation_a", "request_a");
      await reserveFounderSlot(store, input);

      const result = await reserveFounderSlot(store, {
        ...input,
        claimHash: "claim_other",
        id: "reservation_other",
      });

      assert.equal(result.status, "conflict");
      assert.equal(result.reservation, null);
    } finally {
      db.close();
    }
  });

  test("releases a reservation when Checkout creation fails", async () => {
    const db = new Database(":memory:");
    try {
      db.exec(schema);
      const store = sqliteStore(db);
      const first = await reserveFounderSlot(store, reservationInput("reservation_a", "request_a"));
      assert.equal(first.status, "reserved");

      const released = await releaseFounderSlot(store, {
        now: new Date("2026-08-18T12:01:00.000Z"),
        reservationId: "reservation_a",
      });
      const replacement = await reserveFounderSlot(store, reservationInput("reservation_b", "request_b"));

      assert.equal(released?.status, "released");
      assert.equal(replacement.status, "reserved");
    } finally {
      db.close();
    }
  });

  test("keeps an attached Checkout counted after its initial reservation TTL", async () => {
    const db = new Database(":memory:");
    try {
      db.exec(schema);
      const store = sqliteStore(db);
      await reserveFounderSlot(store, reservationInput("reservation_a", "request_a"));
      await attachFounderCheckoutSession(store, {
        now: new Date("2026-08-18T12:01:00.000Z"),
        reservationId: "reservation_a",
        sessionId: "cs_founder_pending",
      });

      const blocked = await reserveFounderSlot(store, {
        ...reservationInput("reservation_b", "request_b"),
        now: new Date("2026-08-18T12:16:00.000Z"),
      });
      await releaseFounderSlot(store, {
        now: new Date("2026-08-18T12:17:00.000Z"),
        reservationId: "reservation_a",
      });
      const replacement = await reserveFounderSlot(store, {
        ...reservationInput("reservation_c", "request_c"),
        now: new Date("2026-08-18T12:17:00.000Z"),
      });

      assert.equal(blocked.status, "sold_out");
      assert.equal(replacement.status, "reserved");
    } finally {
      db.close();
    }
  });

  // Mutation captured: removing the confirmation trigger leaves a paid Founder reservation counted as active.
  test("attaches Checkout and confirms a purchase idempotently", async () => {
    const db = new Database(":memory:");
    try {
      db.exec("PRAGMA foreign_keys = ON;");
      db.exec(schema);
      db.exec(`
        INSERT INTO users (id, email, plan, ever_paid, created_at, updated_at)
        VALUES ('usr_founder', 'founder@example.test', 'founder', 1,
          '2026-08-18T12:00:00.000Z', '2026-08-18T12:00:00.000Z');
      `);
      const store = sqliteStore(db);
      await reserveFounderSlot(store, reservationInput("reservation_a", "request_a"));
      const attached = await attachFounderCheckoutSession(store, {
        now: new Date("2026-08-18T12:01:00.000Z"),
        reservationId: "reservation_a",
        sessionId: "cs_founder",
      });
      const active = await findFounderCheckoutReservation(store, {
        reservationId: "reservation_a",
        sessionId: "cs_founder",
      });

      const purchase = await confirmFounderPurchase(store, {
        checkoutSessionId: "cs_founder",
        id: "purchase_a",
        now: new Date("2026-08-18T12:05:00.000Z"),
        reservationId: "reservation_a",
        stripeCustomerId: "cus_founder",
        userId: "usr_founder",
      });
      const replay = await confirmFounderPurchase(store, {
        checkoutSessionId: "cs_founder",
        id: "purchase_replay",
        now: new Date("2026-08-18T12:06:00.000Z"),
        reservationId: "reservation_a",
        stripeCustomerId: "cus_founder",
        userId: "usr_founder",
      });
      const confirmed = await findFounderCheckoutReservation(store, {
        reservationId: "reservation_a",
        sessionId: "cs_founder",
      });

      assert.equal(attached?.id, "reservation_a");
      assert.equal(active?.status, "active");
      assert.equal(purchase?.id, "purchase_a");
      assert.equal(replay?.id, "purchase_a");
      assert.equal(confirmed?.status, "confirmed");
      assert.equal(
        db.query<{ status: string }, []>(
          "SELECT status FROM founder_reservations WHERE id = 'reservation_a'",
        ).get()?.status,
        "confirmed",
      );
      assert.equal(
        db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM founder_purchases").get()?.count,
        1,
      );
    } finally {
      db.close();
    }
  });
});
