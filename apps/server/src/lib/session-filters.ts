import { sessionMatchesReviewFilters, type PinReviewStatus, type Session } from "@pinar/shared";
import type { SessionGroup } from "./session-groups";

export type PinCountFilter = "one" | "twoToFive" | "sixOrMore";

function effectiveReviewCounts(session: Session) {
  if (session.reviewCounts) return session.reviewCounts;
  return { accepted: 0, correction_ready: 0, open: pinCount(session), reopened: 0 };
}

export function pinCount(session: Session) {
  return session.pinCount ?? session.pins.length;
}

export function pinCountFilterValue(count: number): PinCountFilter {
  if (count === 1) return "one";
  if (count <= 5) return "twoToFive";
  return "sixOrMore";
}

export function filterSessions(
  sessions: Session[],
  search: string,
  pinFilters: PinCountFilter[],
  reviewFilters: PinReviewStatus[] = [],
  sharedOnly = false,
) {
  const query = search.trim().toLowerCase();
  return sessions.filter((session) => {
    if (pinFilters.length > 0 && !pinFilters.includes(pinCountFilterValue(pinCount(session)))) return false;
    if (!sessionMatchesReviewFilters(effectiveReviewCounts(session), reviewFilters)) return false;
    if (sharedOnly && !session.isShared) return false;
    if (!query) return true;
    if ((session as SessionGroup).captures?.some((capture) => filterSessions([capture], query, [], []).length > 0)) return true;
    return session.page.title.toLowerCase().includes(query)
      || (session.page.description || "").toLowerCase().includes(query)
      || session.page.url.toLowerCase().includes(query)
      || session.pins.some((pin) => pin.comment.toLowerCase().includes(query)
        || (pin.selector || "").toLowerCase().includes(query));
  });
}
