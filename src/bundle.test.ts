import { describe, expect, test } from "bun:test";
import { emptyTakeMessage, renderBundle } from "./bundle";
import { makePin } from "./factory";
import type { Bundle } from "./types";

function makeBundle(overrides: Partial<Bundle> = {}): Bundle {
  return {
    pins: [makePin()],
    sentAt: "2026-08-13T12:00:00.000Z",
    title: "Pricing",
    url: "http://localhost:3000/pricing",
    viewport: { dpr: 2, height: 900, width: 1440 },
    viewportScreenshotPath: "/tmp/viewport.png",
    ...overrides,
  };
}

describe("renderBundle", () => {
  test("includes url, comment, selector, and screenshot path", () => {
    // Mutation captured: dropping selector or screenshot path from the agent-facing markdown.
    const markdown = renderBundle(
      makeBundle({
        pins: [
          makePin({
            comment: "Make the CTA bolder",
            path: "main > a.hero-cta",
            screenshotPath: "/tmp/cta.png",
            selector: "a.hero-cta",
          }),
        ],
      }),
    );
    expect(markdown).toContain("http://localhost:3000/pricing");
    expect(markdown).toContain("Make the CTA bolder");
    expect(markdown).toContain("a.hero-cta");
    expect(markdown).toContain("main > a.hero-cta");
    expect(markdown).toContain("/tmp/cta.png");
    expect(markdown).toContain("/tmp/viewport.png");
  });

  test("labels area pins separately from element pins", () => {
    // Mutation captured: rendering every pin as an element even when kind is area.
    const markdown = renderBundle(
      makeBundle({
        pins: [makePin({ kind: "area", label: "hero", selector: undefined })],
      }),
    );
    expect(markdown).toContain("## 1. area — hero");
    expect(markdown).not.toContain("Selector:");
  });
});

describe("emptyTakeMessage", () => {
  test("tells the agent the user must press ⌘/Ctrl+Enter", () => {
    // Mutation captured: implying draft pins are already available to the agent.
    expect(emptyTakeMessage()).toContain("⌘/Ctrl+Enter");
  });
});