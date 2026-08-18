export const FOUNDER_SOLD_OUT_ERROR = "founder_sold_out";

export type FounderCapacityState = "available" | "closed" | "sold_out";
export type FounderReservationStatus = "active" | "confirmed" | "released";

export interface FounderReservationSnapshot {
  checkoutAttached?: boolean;
  expiresAt: string;
  status: FounderReservationStatus;
}

export interface FounderCapacityInput {
  enabled: boolean;
  limit: number;
  now: Date;
  reservations: FounderReservationSnapshot[];
  sold: number;
}

export interface FounderCapacity {
  activeReservations: number;
  available: boolean;
  error: typeof FOUNDER_SOLD_OUT_ERROR | null;
  limit: number;
  remaining: number;
  sold: number;
  state: FounderCapacityState;
}

function requirePositiveInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer`);
  }
}

function requireNonNegativeInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
}

function reservationIsActive(reservation: FounderReservationSnapshot, nowMs: number) {
  if (reservation.status !== "active") return false;
  if (reservation.checkoutAttached) return true;
  const expiresAtMs = Date.parse(reservation.expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    throw new TypeError("Founder reservation expiration must be a valid timestamp");
  }
  return expiresAtMs > nowMs;
}

export function evaluateFounderCapacity(input: FounderCapacityInput): FounderCapacity {
  requirePositiveInteger(input.limit, "Founder capacity limit");
  requireNonNegativeInteger(input.sold, "Founder sold count");
  const nowMs = input.now.getTime();
  if (!Number.isFinite(nowMs)) throw new TypeError("Founder capacity time must be valid");
  const activeReservations = input.reservations.filter((reservation) => (
    reservationIsActive(reservation, nowMs)
  )).length;
  const remaining = Math.max(0, input.limit - input.sold - activeReservations);
  const state: FounderCapacityState = !input.enabled
    ? "closed"
    : remaining === 0
      ? "sold_out"
      : "available";
  return {
    activeReservations,
    available: state === "available",
    error: state === "available" ? null : FOUNDER_SOLD_OUT_ERROR,
    limit: input.limit,
    remaining,
    sold: input.sold,
    state,
  };
}

export function founderReservationExpiresAt(now: Date, ttlMs: number) {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new TypeError("Founder reservation time must be valid");
  requirePositiveInteger(ttlMs, "Founder reservation TTL");
  return new Date(nowMs + ttlMs);
}
