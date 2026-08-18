import type { Session } from "@pinar/shared";

export type PinCountFilter = "one" | "twoToFive" | "sixOrMore";

export function pinCount(session: Session) {
  return session.pinCount ?? session.pins.length;
}

export function pinCountFilterValue(count: number): PinCountFilter {
  if (count === 1) return "one";
  if (count <= 5) return "twoToFive";
  return "sixOrMore";
}

export function filterSessions(sessions: Session[], search: string, pinFilters: PinCountFilter[]) {
  const query = search.trim().toLowerCase();
  return sessions.filter((session) => {
    if (pinFilters.length > 0 && !pinFilters.includes(pinCountFilterValue(pinCount(session)))) return false;
    if (!query) return true;
    return session.page.title.toLowerCase().includes(query)
      || session.page.url.toLowerCase().includes(query)
      || session.pins.some((pin) => pin.comment.toLowerCase().includes(query)
        || (pin.selector || "").toLowerCase().includes(query));
  });
}
