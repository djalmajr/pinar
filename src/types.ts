export interface Box {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface Viewport {
  dpr: number;
  height: number;
  width: number;
}

export interface Pin {
  anchor?: { x: number; y: number };
  box: Box;
  comment: string;
  createdAt: string;
  id: string;
  kind: "area" | "element";
  label?: string;
  path?: string;
  screenshotPath?: string;
  selector?: string;
  text?: string;
}

export interface NewPin {
  anchor?: { x: number; y: number };
  box: Box;
  comment: string;
  kind: "area" | "element";
  label?: string;
  path?: string;
  selector?: string;
  text?: string;
}

export interface PageContext {
  title: string;
  url: string;
  viewport: Viewport;
}

export interface Draft extends PageContext {
  pins: Pin[];
}

export interface Bundle extends Draft {
  sentAt: string;
  viewportScreenshotPath?: string;
}

export interface State {
  draft: Draft;
  sent: Bundle[];
}

export interface Status {
  draftCount: number;
  hasSent: boolean;
  queued: number;
  sentCount: number;
  title: string;
  url: string;
}