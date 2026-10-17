// Pin documents for retrieval (F3 contract §1.1).
//
// buildPinDocument turns one pin into the text that is embedded and
// ranked: fixed English sections in a fixed order (Page, URL, Pin #n,
// Element, Caption, Text in image, Comments). Sections other than Page,
// URL and Pin #n are left out when they have nothing to say.
//
// The text never exceeds PIN_DOCUMENT_MAX_CHARS and never shrinks
// silently: over the cap, conversation comments go first (oldest first),
// then the OCR text is shortened, and `truncated` is true. Only when the
// remaining sections still exceed the cap is the text cut at the cap.
//
// The hash is the SHA-256 hex of the final text through crypto.subtle,
// which is asynchronous, so buildPinDocument returns a promise.

export const PIN_DOCUMENT_MAX_CHARS = 6000; // well under the 2048-token window

export interface PinDocumentInput {
  caption: { caption: string; ocr: string } | null;
  comments: Array<{ author: string; body: string }>; // conversation comments, oldest first
  page: { title: string; url: string };
  pin: { comment: string; innerText?: string; label?: string; number: number; selector?: string; tag?: string; text?: string };
}

// Cuts `value` to at most `max` UTF-16 units without leaving half of a
// surrogate pair at the end.
export function clipText(value: string, max: number): string {
  if (value.length <= max) return value;
  let cut = value.slice(0, Math.max(0, max));
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut;
}

// The "Pin #n: comment" section exactly as buildPinDocument writes it.
// index.ts looks for it in a stored document to tell whether a pin's
// number or comment changed since that document was built.
export function pinSectionText(pin: Pick<PinDocumentInput["pin"], "comment" | "number">): string {
  return `Pin #${pin.number}: ${pin.comment.trim()}`;
}

function elementLine(pin: PinDocumentInput["pin"]): string {
  const element = (pin.tag || pin.label || "").trim();
  const selector = (pin.selector || "").trim();
  const text = (pin.innerText || pin.text || "").trim();
  return [element, selector, text ? `"${text}"` : ""].filter((part) => part !== "").join(" ");
}

function render(input: PinDocumentInput, comments: PinDocumentInput["comments"], ocr: string): string {
  const lines = [`Page: ${input.page.title.trim()}`, `URL: ${input.page.url.trim()}`, pinSectionText(input.pin)];
  const element = elementLine(input.pin);
  if (element !== "") lines.push(`Element: ${element}`);
  const caption = input.caption?.caption.trim() ?? "";
  if (caption !== "") lines.push(`Caption: ${caption}`);
  if (ocr !== "") lines.push(`Text in image: ${ocr}`);
  if (comments.length > 0) {
    lines.push("Comments:");
    for (const comment of comments) lines.push(`- ${comment.author.trim()}: ${comment.body.trim()}`);
  }
  return lines.join("\n");
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildPinDocument(input: PinDocumentInput): Promise<{ hash: string; text: string; truncated: boolean }> {
  const comments = input.comments.filter((comment) => comment.body.trim() !== "");
  let ocr = input.caption?.ocr.trim() ?? "";
  let text = render(input, comments, ocr);
  let truncated = false;

  // Oldest conversation comments leave first.
  while (text.length > PIN_DOCUMENT_MAX_CHARS && comments.length > 0) {
    comments.shift();
    truncated = true;
    text = render(input, comments, ocr);
  }

  // Then the OCR text shrinks by exactly the overflow (or goes away).
  if (text.length > PIN_DOCUMENT_MAX_CHARS && ocr !== "") {
    truncated = true;
    ocr = clipText(ocr, ocr.length - (text.length - PIN_DOCUMENT_MAX_CHARS)).trimEnd();
    text = render(input, comments, ocr);
  }

  // Page, pin and element alone over the cap: cut at the cap.
  if (text.length > PIN_DOCUMENT_MAX_CHARS) {
    truncated = true;
    text = clipText(text, PIN_DOCUMENT_MAX_CHARS);
  }

  return { hash: await sha256Hex(text), text, truncated };
}
