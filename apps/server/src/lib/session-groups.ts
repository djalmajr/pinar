import type { Session } from "@pinar/shared";

export type SessionGroup = Session & { captures?: Session[] };

export function sessionCaptureIds(groups: SessionGroup[], id: string): string[] {
  const group = groups.find((item) => item.id === id || item.captures?.some((capture) => capture.id === id));
  return group?.captures
    ? [...group.captures].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt)).map((capture) => capture.id)
    : [id];
}

export function sessionGroupCount(sessions: Session[]): number {
  return new Set(sessions.map((session) => session.batchId ? `group:${session.batchId}` : `capture:${session.id}`)).size;
}

export function groupSessions(sessions: Session[]): SessionGroup[] {
  const groups = new Map<string, SessionGroup>();
  for (const session of sessions) {
    const key = session.batchId ? `group:${session.batchId}` : `capture:${session.id}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, session.batchId ? { ...session, captures: [session], pins: [...session.pins] } : session);
      continue;
    }
    existing.captures!.push(session);
    existing.pins.push(...session.pins);
    existing.isShared ||= session.isShared;
  }
  for (const group of groups.values()) {
    if (!group.captures) continue;
    group.pinCount = group.captures.reduce((sum, capture) => sum + (capture.pinCount ?? capture.pins.length), 0);
    group.reviewCounts = { accepted: 0, correction_ready: 0, open: 0, reopened: 0 };
    for (const capture of group.captures) {
      const counts = capture.reviewCounts || { accepted: 0, correction_ready: 0, open: capture.pinCount ?? capture.pins.length, reopened: 0 };
      for (const key of ["accepted", "correction_ready", "open", "reopened"] as const) group.reviewCounts[key] += counts[key];
    }
  }
  return [...groups.values()];
}

export function expandSessionIds(ids: string[], groups: SessionGroup[]): string[] {
  const byId = new Map(groups.map((group) => [group.id, group]));
  return [...new Set(ids.flatMap((id) => byId.get(id)?.captures?.map((capture) => capture.id) || [id]))];
}
