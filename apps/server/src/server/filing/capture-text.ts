// The text a capture is filed by (F3.5 contract §1): the page title, the
// URL and each pin's comment, one value per line in the line format of the
// F3 pin document (buildPinDocument), without captions. Line breaks inside
// a value become spaces, so a comment can never pose as another line.

import { clipText, oneLine, pinSectionText } from "../assistant/retrieval/document";

const CAPTURE_TEXT_MAX_CHARS = 4000;

export function captureFilingText(input: {
  page: { title: string; url: string };
  pins: Array<{ comment: string; number: number }>;
}): string {
  const lines = [`Page: ${oneLine(input.page.title)}`, `URL: ${oneLine(input.page.url)}`, ...input.pins.map(pinSectionText)];
  return clipText(lines.join("\n"), CAPTURE_TEXT_MAX_CHARS);
}
