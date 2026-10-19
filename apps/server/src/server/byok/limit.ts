// F5/S2: the per-user limit of the connection tests (F5 contract §2), shared
// by POST /api/byok/test and the PUT that tests before it saves: at most one
// test in flight (the in-flight set of byok/api.ts) and at most
// BYOK_TEST_MAX_PER_HOUR tests per hour, answered 429 byok_test_limited.
//
// The window follows the Cloud's existing limiter (consumeRateLimit in
// cloud-api.ts, which the BYOK module cannot import: cloud-api.ts stays
// touched only to register the route): the same auth_rate_limits table and
// the same sliding window (a fresh window restarts the counter), with a
// module map standing in for the table without a database. The scope is
// hashed like the existing one (SHA-256), so the principal id never rests in
// the table in the clear.

import type { CloudEnv } from "../cloud-api";

export const BYOK_TEST_MAX_PER_HOUR = 6;
const BYOK_TEST_WINDOW_MS = 60 * 60 * 1000;
const BYOK_TEST_ACTION = "byok_test";

interface ByokTestWindow {
  attempts: number;
  windowStartedAt: number;
}

const memoryByokTestWindows = new Map<string, ByokTestWindow>();

export function resetByokTestWindowsForTests() {
  memoryByokTestWindows.clear();
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Consume one test of the account's window and say whether it is within
 * BYOK_TEST_MAX_PER_HOUR: the same upsert and window restart as the Cloud's
 * limiter. A failure of the table is the caller's (the route answers 503
 * byok_unavailable, like the rest of the BYOK).
 */
export async function byokTestConsume(env: CloudEnv, ownerId: string, nowMs: number): Promise<boolean> {
  const scopeHash = await sha256Hex(`${BYOK_TEST_ACTION}:${ownerId}`);
  const nowIso = new Date(nowMs).toISOString();
  const cutoffIso = new Date(nowMs - BYOK_TEST_WINDOW_MS).toISOString();
  if (env.DB) {
    const row = await env.DB.prepare(`
      INSERT INTO auth_rate_limits (action, scope_hash, window_started_at, attempts)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(action, scope_hash) DO UPDATE SET
        attempts = CASE WHEN window_started_at <= ? THEN 1 ELSE attempts + 1 END,
        window_started_at = CASE WHEN window_started_at <= ? THEN excluded.window_started_at ELSE window_started_at END
      RETURNING attempts
    `).bind(BYOK_TEST_ACTION, scopeHash, nowIso, cutoffIso, cutoffIso).first();
    return Number(row?.attempts || 0) <= BYOK_TEST_MAX_PER_HOUR;
  }
  const key = `${BYOK_TEST_ACTION}:${scopeHash}`;
  const record = memoryByokTestWindows.get(key);
  if (!record || record.windowStartedAt <= nowMs - BYOK_TEST_WINDOW_MS) {
    memoryByokTestWindows.set(key, { attempts: 1, windowStartedAt: nowMs });
    return true;
  }
  record.attempts += 1;
  return record.attempts <= BYOK_TEST_MAX_PER_HOUR;
}
