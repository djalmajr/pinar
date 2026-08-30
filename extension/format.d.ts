export interface FormattedClipboard {
  html: string;
  plain: string;
}

export interface FormatClipboardInput {
  capabilities?: {
    fullPage?: boolean;
    iframe?: boolean;
  };
  captureId?: string;
  includeScreenshot?: boolean;
  page?: {
    description?: string;
    title?: string;
    url?: string;
  };
  pins?: object[];
  privacy?: {
    redacted?: string[];
    unevaluated?: boolean;
  };
  schemaVersion?: number;
  sentAt?: string;
  shot?: string;
  viewerUrl?: string;
  warnings?: string[];
}

export interface FormatClipboardPayloadInput extends FormatClipboardInput {
  viewerContent?: string;
}

export function escapeHtml(value: unknown): string;
export function formatViewerLink(viewerUrl: string): FormattedClipboard;
export function formatViewerContent(content: unknown): FormattedClipboard;
export function formatClipboard(input?: FormatClipboardInput): FormattedClipboard;
export function formatClipboardPayload(input?: FormatClipboardPayloadInput): FormattedClipboard;
