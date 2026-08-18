import {
  evaluateFounderCapacity,
  founderReservationExpiresAt,
} from "../lib/founder-capacity";

export type SqlValue = number | string | null;

export interface FounderReservationRecord {
  checkout_request_id: string;
  checkout_session_id: string | null;
  claim_hash: string;
  expires_at: string;
  id: string;
  status: "active" | "confirmed" | "released";
}

export interface FounderCapacityStore {
  firstPurchase(sql: string, values: SqlValue[]): Promise<FounderPurchaseRecord | null>;
  firstReservation(sql: string, values: SqlValue[]): Promise<FounderReservationRecord | null>;
}

export interface FounderPurchaseRecord {
  checkout_session_id: string;
  id: string;
  purchased_at: string;
  reservation_id: string;
  stripe_customer_id: string;
  user_id: string;
}

export interface AttachFounderCheckoutSessionInput {
  now: Date;
  reservationId: string;
  sessionId: string;
}

export interface FindFounderCheckoutReservationInput {
  reservationId: string;
  sessionId: string;
}

export interface ConfirmFounderPurchaseInput {
  checkoutSessionId: string;
  id: string;
  now: Date;
  reservationId: string;
  stripeCustomerId: string;
  userId: string;
}

export interface ReleaseFounderSlotInput {
  now: Date;
  reservationId: string;
}

export interface ReserveFounderSlotInput {
  claimHash: string;
  enabled: boolean;
  id: string;
  limit: number;
  now: Date;
  requestId: string;
  ttlMs: number;
}

export interface ReserveFounderSlotResult {
  reservation: FounderReservationRecord | null;
  status: "conflict" | "existing" | "reserved" | "sold_out";
}

export function founderReservationRecord(
  row: Record<string, unknown> | null,
): FounderReservationRecord | null {
  if (!row) return null;
  const status = row.status;
  if (status !== "active" && status !== "confirmed" && status !== "released") return null;
  if (typeof row.checkout_request_id !== "string"
    || typeof row.claim_hash !== "string"
    || typeof row.expires_at !== "string"
    || typeof row.id !== "string") return null;
  return {
    checkout_request_id: row.checkout_request_id,
    checkout_session_id: typeof row.checkout_session_id === "string" ? row.checkout_session_id : null,
    claim_hash: row.claim_hash,
    expires_at: row.expires_at,
    id: row.id,
    status,
  };
}

export function founderPurchaseRecord(
  row: Record<string, unknown> | null,
): FounderPurchaseRecord | null {
  if (!row
    || typeof row.checkout_session_id !== "string"
    || typeof row.id !== "string"
    || typeof row.purchased_at !== "string"
    || typeof row.reservation_id !== "string"
    || typeof row.stripe_customer_id !== "string"
    || typeof row.user_id !== "string") return null;
  return {
    checkout_session_id: row.checkout_session_id,
    id: row.id,
    purchased_at: row.purchased_at,
    reservation_id: row.reservation_id,
    stripe_customer_id: row.stripe_customer_id,
    user_id: row.user_id,
  };
}

export const FIND_FOUNDER_RESERVATION_SQL = `
SELECT id, checkout_request_id, checkout_session_id, claim_hash, expires_at, status
FROM founder_reservations
WHERE checkout_request_id = ?
LIMIT 1
`;

export const FIND_FOUNDER_CHECKOUT_RESERVATION_SQL = `
SELECT id, checkout_request_id, checkout_session_id, claim_hash, expires_at, status
FROM founder_reservations
WHERE id = ?
  AND checkout_session_id = ?
  AND status IN ('active', 'confirmed')
LIMIT 1
`;

export const RESERVE_FOUNDER_SLOT_SQL = `
INSERT INTO founder_reservations (
  id, checkout_request_id, claim_hash, status, expires_at, created_at, updated_at
)
SELECT ?, ?, ?, 'active', ?, ?, ?
WHERE ? = 1
  AND (
    (SELECT COUNT(*) FROM founder_purchases)
    + (SELECT COUNT(*) FROM founder_reservations
       WHERE status = 'active' AND (checkout_session_id IS NOT NULL OR expires_at > ?))
  ) < ?
ON CONFLICT(checkout_request_id) DO NOTHING
RETURNING id, checkout_request_id, checkout_session_id, claim_hash, expires_at, status
`;

export const ATTACH_FOUNDER_CHECKOUT_SESSION_SQL = `
UPDATE founder_reservations
SET checkout_session_id = ?, updated_at = ?
WHERE id = ?
  AND status = 'active'
  AND (checkout_session_id IS NULL OR checkout_session_id = ?)
RETURNING id, checkout_request_id, checkout_session_id, claim_hash, expires_at, status
`;

export const RELEASE_FOUNDER_SLOT_SQL = `
UPDATE founder_reservations
SET status = 'released', released_at = ?, updated_at = ?
WHERE id = ? AND status = 'active'
RETURNING id, checkout_request_id, checkout_session_id, claim_hash, expires_at, status
`;

export const CONFIRM_FOUNDER_PURCHASE_SQL = `
INSERT INTO founder_purchases (
  id, reservation_id, user_id, checkout_session_id, stripe_customer_id, purchased_at, created_at
)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(checkout_session_id) DO NOTHING
RETURNING id, reservation_id, user_id, checkout_session_id, stripe_customer_id, purchased_at
`;

export const FIND_FOUNDER_PURCHASE_SQL = `
SELECT id, reservation_id, user_id, checkout_session_id, stripe_customer_id, purchased_at
FROM founder_purchases
WHERE checkout_session_id = ?
LIMIT 1
`;

function activeExistingReservation(
  reservation: FounderReservationRecord,
  claimHash: string,
  now: Date,
): ReserveFounderSlotResult | null {
  if (reservation.claim_hash !== claimHash) return { reservation: null, status: "conflict" };
  if (reservation.status !== "active" || Date.parse(reservation.expires_at) <= now.getTime()) return null;
  return { reservation, status: "existing" };
}

export async function reserveFounderSlot(
  store: FounderCapacityStore,
  input: ReserveFounderSlotInput,
): Promise<ReserveFounderSlotResult> {
  evaluateFounderCapacity({
    enabled: input.enabled,
    limit: input.limit,
    now: input.now,
    reservations: [],
    sold: 0,
  });
  const existing = await store.firstReservation(FIND_FOUNDER_RESERVATION_SQL, [input.requestId]);
  if (existing) {
    const result = activeExistingReservation(existing, input.claimHash, input.now);
    if (result) return result;
  }
  const now = input.now.toISOString();
  const expiresAt = founderReservationExpiresAt(input.now, input.ttlMs).toISOString();
  const reservation = await store.firstReservation(RESERVE_FOUNDER_SLOT_SQL, [
    input.id,
    input.requestId,
    input.claimHash,
    expiresAt,
    now,
    now,
    input.enabled ? 1 : 0,
    now,
    input.limit,
  ]);
  if (reservation) return { reservation, status: "reserved" };
  const raced = await store.firstReservation(FIND_FOUNDER_RESERVATION_SQL, [input.requestId]);
  if (raced) {
    const result = activeExistingReservation(raced, input.claimHash, input.now);
    if (result) return result;
  }
  return { reservation: null, status: "sold_out" };
}

export function attachFounderCheckoutSession(
  store: FounderCapacityStore,
  input: AttachFounderCheckoutSessionInput,
) {
  const now = input.now.toISOString();
  return store.firstReservation(ATTACH_FOUNDER_CHECKOUT_SESSION_SQL, [
    input.sessionId,
    now,
    input.reservationId,
    input.sessionId,
  ]);
}

export function findFounderCheckoutReservation(
  store: FounderCapacityStore,
  input: FindFounderCheckoutReservationInput,
) {
  return store.firstReservation(FIND_FOUNDER_CHECKOUT_RESERVATION_SQL, [
    input.reservationId,
    input.sessionId,
  ]);
}

export function releaseFounderSlot(
  store: FounderCapacityStore,
  input: ReleaseFounderSlotInput,
) {
  const now = input.now.toISOString();
  return store.firstReservation(RELEASE_FOUNDER_SLOT_SQL, [now, now, input.reservationId]);
}

export async function confirmFounderPurchase(
  store: FounderCapacityStore,
  input: ConfirmFounderPurchaseInput,
) {
  const now = input.now.toISOString();
  const purchase = await store.firstPurchase(CONFIRM_FOUNDER_PURCHASE_SQL, [
    input.id,
    input.reservationId,
    input.userId,
    input.checkoutSessionId,
    input.stripeCustomerId,
    now,
    now,
  ]);
  if (purchase) return purchase;
  return store.firstPurchase(FIND_FOUNDER_PURCHASE_SQL, [input.checkoutSessionId]);
}
