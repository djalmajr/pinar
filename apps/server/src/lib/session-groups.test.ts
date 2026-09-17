import { expect, test } from "bun:test";
import type { Session } from "@pinar/shared";
import { expandSessionIds, groupSessions, sessionCaptureIds } from "./session-groups";

function capture(id: string, batchId?: string): Session {
  return { id, captureId: id, batchId, page: { title: id, url: `https://example.test/${id}` }, createdAt: "2026-09-14", pins: [{ id: `pin-${id}`, comment: id } as Session["pins"][number]], shotUrl: `/shots/${id}.png` };
}

test("one history record groups several screenshots without changing originals", () => {
  const original = [capture("a", "review"), capture("b", "review"), capture("c")];
  const groups = groupSessions(original);
  expect(groups).toHaveLength(2);
  expect(groups[0].pinCount).toBe(2);
  expect(groups[0].captures?.map((item) => item.shotUrl)).toEqual(["/shots/a.png", "/shots/b.png"]);
  expect(original[0].pins).toHaveLength(1);
  expect(expandSessionIds(["a", "c"], groups)).toEqual(["a", "b", "c"]);
  expect(sessionCaptureIds(groups, "b")).toEqual(["a", "b"]);
  expect(sessionCaptureIds(groups, "c")).toEqual(["c"]);
});

test("different review sessions at the same URL remain separate", () => {
  const a = capture("a", "first"), b = capture("b", "second");
  b.page = a.page;
  expect(groupSessions([a, b])).toHaveLength(2);
});
