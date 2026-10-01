import { untrustedMarkdownLine } from "../visual-context/index.ts";

export const PIN_REVIEW_STATUSES = [
  "accepted",
  "correction_ready",
  "open",
  "reopened",
] as const;

export type PinReviewStatus = (typeof PIN_REVIEW_STATUSES)[number];

export const PIN_REVIEW_HUMAN_ACTIONS = ["accept", "reopen"] as const;
export type PinReviewHumanAction = (typeof PIN_REVIEW_HUMAN_ACTIONS)[number];

export type PinReviewActorType = "agent" | "human";
export type PinReviewOrigin = "agent_result" | "human";

export const PIN_REVIEW_ERROR_CODES = [
  "invalid_payload",
  "invalid_transition",
  "pin_not_found",
] as const;

export type PinReviewErrorCode = (typeof PIN_REVIEW_ERROR_CODES)[number];

export class PinReviewError extends Error {
  readonly code: PinReviewErrorCode;

  constructor(code: PinReviewErrorCode) {
    super("invalid pin review");
    this.name = "PinReviewError";
    this.code = code;
  }
}

export interface PinReviewEvent {
  actorId: string;
  actorType: PinReviewActorType;
  createdAt: string;
  executionId?: string;
  fromStatus: PinReviewStatus;
  id: string;
  origin: PinReviewOrigin;
  pinId: string;
  toStatus: PinReviewStatus;
}

export interface PinReviewCounts {
  accepted: number;
  correction_ready: number;
  open: number;
  reopened: number;
}

export interface PinReview {
  actions: PinReviewHumanAction[];
  pinId: string;
  status: PinReviewStatus;
  timeline: PinReviewEvent[];
  updatedAt: string;
}

export const PIN_COMMENT_ACTOR_TYPES = ["agent", "human"] as const;
export type PinCommentActorType = (typeof PIN_COMMENT_ACTOR_TYPES)[number];

export interface PinComment {
  id: string;
  captureId: string;
  pinId: string;
  actorId: string;
  actorLabel: string;
  actorType: PinCommentActorType;
  body: string;
  createdAt: string;
}

const PIN_COMMENT_MAX_BODY_LENGTH = 2000;

export function parsePinCommentBody(value: unknown): string {
  if (typeof value !== "string") throw new PinReviewError("invalid_payload");
  const body = value.trim();
  if (!body || body.length > PIN_COMMENT_MAX_BODY_LENGTH) throw new PinReviewError("invalid_payload");
  return body;
}

export function isPinReviewStatus(value: unknown): value is PinReviewStatus {
  return typeof value === "string" && (PIN_REVIEW_STATUSES as readonly string[]).includes(value);
}

export function isPinReviewHumanAction(value: unknown): value is PinReviewHumanAction {
  return typeof value === "string" && (PIN_REVIEW_HUMAN_ACTIONS as readonly string[]).includes(value);
}

export function defaultPinReviewStatus(): PinReviewStatus {
  return "open";
}

export function emptyPinReviewCounts(): PinReviewCounts {
  return { accepted: 0, correction_ready: 0, open: 0, reopened: 0 };
}

export function humanActionsForStatus(status: PinReviewStatus): PinReviewHumanAction[] {
  if (status === "accepted") return ["reopen"];
  return ["accept"];
}

export function resolvePinReviewTransition(
  current: PinReviewStatus,
  action: PinReviewHumanAction | "agent_changed",
): { changed: boolean; next: PinReviewStatus } {
  if (action === "agent_changed") {
    if (current === "open" || current === "reopened") {
      return { changed: true, next: "correction_ready" };
    }
    if (current === "correction_ready") return { changed: false, next: "correction_ready" };
    throw new PinReviewError("invalid_transition");
  }
  if (action === "accept") {
    if (current === "open" || current === "correction_ready" || current === "reopened") {
      return { changed: true, next: "accepted" };
    }
    throw new PinReviewError("invalid_transition");
  }
  if (current !== "accepted") throw new PinReviewError("invalid_transition");
  return { changed: true, next: "reopened" };
}

// The states an agent is expected to act on: exactly the ones `agent_changed`
// accepts above. `correction_ready` waits on a human and `accepted` is done.
export function isPinAwaitingAgent(status: PinReviewStatus) {
  return status === "open" || status === "reopened";
}

// A pin with no review row has never been triaged, so it counts as open.
export function pinReviewStatusFor(
  pinId: string,
  statusByPinId: Map<string, PinReviewStatus> | Record<string, PinReviewStatus>,
): PinReviewStatus {
  const lookup = statusByPinId instanceof Map
    ? statusByPinId
    : new Map(Object.entries(statusByPinId) as Array<[string, PinReviewStatus]>);
  return lookup.get(pinId) || "open";
}

export function countPinReviews(
  pinIds: Iterable<string>,
  statusByPinId: Map<string, PinReviewStatus> | Record<string, PinReviewStatus>,
): PinReviewCounts {
  const counts = emptyPinReviewCounts();
  for (const pinId of pinIds) counts[pinReviewStatusFor(pinId, statusByPinId)] += 1;
  return counts;
}

export function sessionMatchesReviewFilters(
  counts: PinReviewCounts | undefined,
  filters: readonly PinReviewStatus[],
) {
  if (!filters.length) return true;
  const current = counts || emptyPinReviewCounts();
  return filters.some((status) => current[status] > 0);
}

export function pinReviewErrorBody(error: unknown) {
  const code = error instanceof PinReviewError ? error.code : "invalid_payload";
  return { code, error: "invalid pin review" };
}

export function pinReviewHttpStatus(error: unknown) {
  if (!(error instanceof PinReviewError)) return 400;
  if (error.code === "pin_not_found") return 404;
  if (error.code === "invalid_transition") return 409;
  return 400;
}

// The ids and states come from stored records and are printed in the full
// viewer Markdown, so each one is kept on its own line.
export function formatPinReviewsMarkdown(reviews: PinReview[]) {
  if (!reviews.length) return "";
  const lines = ["## Pin review", ""];
  for (const review of reviews) {
    lines.push(`- ${untrustedMarkdownLine(review.pinId)}: ${untrustedMarkdownLine(review.status)}`);
    if (review.timeline.length) {
      const last = review.timeline[review.timeline.length - 1];
      if (last) {
        lines.push(`  - last: ${untrustedMarkdownLine(last.fromStatus)} → ${untrustedMarkdownLine(last.toStatus)} (${untrustedMarkdownLine(last.origin)})`);
      }
    }
  }
  return lines.join("\n").trim();
}
