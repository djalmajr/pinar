import type { NewPin, PageContext, Pin } from "./types";

export function makePage(overrides: Partial<PageContext> = {}): PageContext {
  return {
    title: "Pricing",
    url: "http://localhost:3000/pricing",
    viewport: { dpr: 2, height: 900, width: 1440 },
    ...overrides,
  };
}

export function makeNewPin(overrides: Partial<NewPin> = {}): NewPin {
  return {
    box: { height: 40, width: 160, x: 24, y: 80 },
    comment: "Move this up",
    kind: "element",
    label: "button.cta",
    selector: "button.cta",
    text: "Get started",
    ...overrides,
  };
}

export function makePin(overrides: Partial<Pin> = {}): Pin {
  return {
    box: { height: 40, width: 160, x: 24, y: 80 },
    comment: "Move this up",
    createdAt: "2026-08-13T12:00:00.000Z",
    id: "pin_1",
    kind: "element",
    label: "button.cta",
    selector: "button.cta",
    text: "Get started",
    ...overrides,
  };
}