import type { Bundle, Pin } from "./types";

function pinHeading(pin: Pin, index: number): string {
  const kind = pin.kind === "area" ? "area" : "element";
  const label = pin.label?.trim();
  return `## ${index + 1}. ${kind}${label ? ` — ${label}` : ""}`;
}

function pinFields(pin: Pin): string[] {
  const lines = [pin.comment.trim() ? `Comment: ${pin.comment.trim()}` : "Comment: (none)"];
  if (pin.path) lines.push(`DOM path: \`${pin.path}\``);
  if (pin.selector) lines.push(`Selector: \`${pin.selector}\``);
  if (pin.text) lines.push(`Visible text: ${JSON.stringify(pin.text)}`);
  if (pin.anchor) lines.push(`Pin: x=${pin.anchor.x}, y=${pin.anchor.y}`);
  lines.push(`Box: x=${pin.box.x}, y=${pin.box.y}, w=${pin.box.width}, h=${pin.box.height}`);
  if (pin.screenshotPath) lines.push(`Crop: ${pin.screenshotPath}`);
  return lines;
}

export function renderBundle(bundle: Bundle): string {
  const header = [
    "# Visual feedback",
    "",
    `URL: ${bundle.url || "(unknown)"}`,
    `Title: ${bundle.title || "(untitled)"}`,
    `Viewport: ${bundle.viewport.width}x${bundle.viewport.height} @${bundle.viewport.dpr}x`,
    `Sent: ${bundle.sentAt}`,
    `Pins: ${bundle.pins.length}`,
  ];
  if (bundle.viewportScreenshotPath) {
    header.push(`Page screenshot: ${bundle.viewportScreenshotPath}`);
  }
  header.push(
    "",
    "The user annotated a live page. Treat each pin as an instruction about that region.",
    "Open the screenshot paths with a file/image tool when you need pixels.",
  );

  const body = bundle.pins.map((pin, index) => {
    return [pinHeading(pin, index), "", ...pinFields(pin)].join("\n");
  });

  return `${[...header, "", body.join("\n\n")].join("\n")}\n`;
}

export function emptyTakeMessage(): string {
  return [
    "No sent visual feedback is waiting.",
    "The user must press ⌘/Ctrl+Enter in the AI Feedback Chrome extension after placing pins.",
    "Call feedback_status to see draft pins that were not sent yet.",
  ].join(" ");
}