export const FRAME_BOUNDARY = " ::frame:: ";

export const LOCATE_CONFIDENCES = ["exact", "probable", "ambiguous", "unresolved"] as const;
export type LocateConfidence = (typeof LOCATE_CONFIDENCES)[number];

export const LOCATE_STRATEGIES = [
  "stable-selector",
  "structure",
  "semantic",
  "geometry",
  "none",
] as const;
export type LocateStrategy = (typeof LOCATE_STRATEGIES)[number];

export interface VisualFingerprint {
  classes?: string[];
  id?: string;
  name?: string;
  nthOfType?: number;
  role?: string;
  tag?: string;
  testId?: string;
  text?: string;
}

export interface PinLocation {
  confidence: LocateConfidence;
  evidence: string[];
  score: number;
  strategy: LocateStrategy;
  warning?: "cross-origin-frame";
}

export interface LocateBox {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface LocateElement {
  readonly children: ArrayLike<LocateElement> & Iterable<LocateElement>;
  readonly classList: { contains(token: string): boolean; [Symbol.iterator](): Iterator<string> };
  readonly contentDocument: LocateRoot | null;
  readonly id: string;
  readonly parentElement: LocateElement | null;
  readonly tagName: string;
  readonly textContent: string | null;
  getAttribute(name: string): string | null;
  getBoundingClientRect(): LocateBox & { left?: number; top?: number };
}

export interface LocateRoot {
  readonly body: LocateElement | null;
  querySelector(selectors: string): LocateElement | null;
  querySelectorAll(selectors: string): ArrayLike<LocateElement> & Iterable<LocateElement>;
}

export interface LocateInput {
  cssSelector?: string;
  domPath?: string;
  fingerprint?: VisualFingerprint;
  geometry?: { box?: LocateBox };
  innerText?: string;
  kind?: "area" | "element";
  label?: string;
  tag?: string;
}

export interface LocateCandidateView {
  evidence: string[];
  key: string;
  score: number;
  strategy: LocateStrategy;
}

export interface LocateResult {
  candidates: LocateCandidateView[];
  confidence: LocateConfidence;
  element: LocateElement | null;
  evidence: string[];
  score: number;
  strategy: LocateStrategy;
  warning?: "cross-origin-frame";
}
