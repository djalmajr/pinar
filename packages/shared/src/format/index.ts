import type { HandoffMode, Pin, PageInfo } from "../types/index.js";
import { formatCompactHandoffBundle, formatFullHandoffBundle } from "../handoff/index.js";
import { parseVisualCapture } from "../visual-context/index.js";

export function formatClipboardText(
  page: PageInfo,
  pins: Pin[],
  shotPath?: string | null,
  viewerUrl?: string | null,
  captureId?: string,
  includeScreenshot = true,
  handoffMode: HandoffMode = "compact",
): string {
  const id = captureId || "clipboard";
  const capture = parseVisualCapture({
    captureId: id,
    page,
    pins,
    screenshot: {
      missing: includeScreenshot ? !shotPath : false,
      url: includeScreenshot ? shotPath || null : null,
    },
  }, id);
  return (handoffMode === "full" ? formatFullHandoffBundle : formatCompactHandoffBundle)(capture, viewerUrl).plain;
}

export function formatClipboardHtml(
  page: PageInfo,
  pins: Pin[],
  shotPath?: string | null,
  viewerUrl?: string | null,
  captureId?: string,
  includeScreenshot = true,
  handoffMode: HandoffMode = "compact",
): string {
  const id = captureId || "clipboard";
  const capture = parseVisualCapture({
    captureId: id,
    page,
    pins,
    screenshot: {
      missing: includeScreenshot ? !shotPath : false,
      url: includeScreenshot ? shotPath || null : null,
    },
  }, id);
  return (handoffMode === "full" ? formatFullHandoffBundle : formatCompactHandoffBundle)(capture, viewerUrl).html;
}
