import { describe, expect, test } from "bun:test";
import { collectionBadgeClass, collectionButtonClass, sidebarCountText } from "./history-sidebar-badge";

const idle = { menuActionFocused: false, menuOpen: false };

function classes(state: Parameters<typeof collectionBadgeClass>[0]) {
  return collectionBadgeClass(state).split(/\s+/).filter(Boolean);
}

describe("sidebar row count next to the actions button", () => {
  test("below md the count moves left of the always-visible actions button", () => {
    const list = classes({ ...idle, hasActions: true });
    expect(list).toContain("right-7");
    // A touch screen has no hover: the count must not fade below md.
    expect(list).not.toContain("group-hover/menu-item:opacity-0");
    expect(list).not.toContain("opacity-0");
  });

  test("from md up the count keeps the right edge and fades on hover", () => {
    const list = classes({ ...idle, hasActions: true });
    expect(list).toContain("md:right-1");
    expect(list).toContain("md:group-hover/menu-item:opacity-0");
  });

  test("an open or focused actions menu hides the count only from md up", () => {
    for (const state of [
      { ...idle, hasActions: true, menuOpen: true },
      { ...idle, hasActions: true, menuActionFocused: true },
    ]) {
      const list = classes(state);
      expect(list).toContain("md:opacity-0");
      expect(list).not.toContain("opacity-0");
    }
  });

  test("a row without actions keeps the count at the right edge", () => {
    expect(classes({ ...idle, hasActions: false })).toEqual([]);
    expect(classes({ hasActions: false, menuActionFocused: true, menuOpen: true })).toEqual([]);
  });

  test("the row label reserves room for the shifted count only below md, with actions", () => {
    for (const count of [0, 7, 999]) {
      expect(collectionButtonClass({ count, hasActions: true })).toBe("max-md:group-has-data-[sidebar=menu-badge]/menu-item:pr-18");
      expect(collectionButtonClass({ count, hasActions: false })).toBe("");
    }
  });

  test("a 999+ count widens the reservation from md up, or always on a row without actions", () => {
    for (const count of [1000, 1234]) {
      expect(collectionButtonClass({ count, hasActions: true }).split(" ")).toEqual([
        "max-md:group-has-data-[sidebar=menu-badge]/menu-item:pr-18",
        "md:group-has-data-[sidebar=menu-badge]/menu-item:pr-12",
      ]);
      expect(collectionButtonClass({ count, hasActions: false })).toBe("group-has-data-[sidebar=menu-badge]/menu-item:pr-12");
    }
  });
});

describe("sidebar row count text", () => {
  test("up to three digits the count shows as is", () => {
    expect(sidebarCountText(0)).toBe("0");
    expect(sidebarCountText(7)).toBe("7");
    expect(sidebarCountText(999)).toBe("999");
  });

  test("past three digits the count caps at 999+", () => {
    expect(sidebarCountText(1000)).toBe("999+");
    expect(sidebarCountText(1234)).toBe("999+");
    expect(sidebarCountText(250_000)).toBe("999+");
  });
});
