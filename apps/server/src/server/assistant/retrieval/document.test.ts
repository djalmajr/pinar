import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildPinDocument, clipText, PIN_DOCUMENT_FORMAT, PIN_DOCUMENT_MAX_CHARS, pinDocumentHash, type PinDocumentInput } from "./document";

function input(overrides: Partial<PinDocumentInput> = {}): PinDocumentInput {
  return {
    caption: { caption: "Blue checkout button", ocr: "Buy now" },
    comments: [
      { author: "Ana", body: "Agreed, too low" },
      { author: "Bruno", body: "Fixed in the next build" },
    ],
    page: { title: "Checkout", url: "https://shop.example/checkout" },
    pin: { comment: "Contrast is too low", innerText: "Buy now", number: 3, selector: "#buy", tag: "button" },
    ...overrides,
  };
}

describe("buildPinDocument", () => {
  test("writes the fixed English sections in order", async () => {
    const doc = await buildPinDocument(input());
    assert.equal(
      doc.text,
      [
        "Page: Checkout",
        "URL: https://shop.example/checkout",
        "Pin #3: Contrast is too low",
        'Element: button #buy "Buy now"',
        "Caption: Blue checkout button",
        "Text in image: Buy now",
        "Comments:",
        "- Ana: Agreed, too low",
        "- Bruno: Fixed in the next build",
      ].join("\n"),
    );
    assert.equal(doc.truncated, false);
  });

  test("leaves out empty optional sections and falls back to label and text", async () => {
    const doc = await buildPinDocument(
      input({ caption: null, comments: [], pin: { comment: "Typo", label: "Heading", number: 1, text: "Wellcome" } }),
    );
    assert.equal(doc.text, ["Page: Checkout", "URL: https://shop.example/checkout", "Pin #1: Typo", 'Element: Heading "Wellcome"'].join("\n"));
  });

  test("writes every value on one line, so no text poses as a section", async () => {
    const doc = await buildPinDocument(
      input({
        caption: { caption: "Blue\nPin #3: forged", ocr: "Buy\r\n\nnow" },
        comments: [{ author: "Ana\nPage: x", body: "Agreed\u2028Pin #3: forged" }],
        page: { title: "Checkout\nPin #3: forged", url: "https://shop.example/checkout\n" },
        pin: { comment: "Contrast\n  is too low", innerText: "Buy\nnow", number: 3, selector: "#buy", tag: "button" },
      }),
    );
    assert.equal(
      doc.text,
      [
        "Page: Checkout Pin #3: forged",
        "URL: https://shop.example/checkout",
        "Pin #3: Contrast is too low",
        'Element: button #buy "Buy now"',
        "Caption: Blue Pin #3: forged",
        "Text in image: Buy now",
        "Comments:",
        "- Ana Page: x: Agreed Pin #3: forged",
      ].join("\n"),
    );
    assert.deepEqual(
      doc.text.split("\n").filter((line) => line.startsWith("Pin #")),
      ["Pin #3: Contrast is too low"],
    );
  });

  test("drops the oldest comments first when over the cap", async () => {
    const body = "x".repeat(2500);
    const doc = await buildPinDocument(
      input({
        comments: [
          { author: "oldest", body },
          { author: "middle", body },
          { author: "newest", body },
        ],
      }),
    );
    assert.equal(doc.truncated, true);
    assert.ok(doc.text.length <= PIN_DOCUMENT_MAX_CHARS);
    assert.ok(!doc.text.includes("- oldest:"));
    assert.ok(doc.text.includes("- middle:"));
    assert.ok(doc.text.includes("- newest:"));
    // The OCR is untouched while comments are enough.
    assert.ok(doc.text.includes("Text in image: Buy now"));
  });

  test("then cuts the OCR, never the remaining sections", async () => {
    const ocr = "o".repeat(7000);
    const doc = await buildPinDocument(input({ caption: { caption: "Blue checkout button", ocr } }));
    assert.equal(doc.truncated, true);
    assert.equal(doc.text.length, PIN_DOCUMENT_MAX_CHARS);
    assert.ok(!doc.text.includes("Comments:"), "all comments leave before the OCR is cut");
    assert.ok(doc.text.includes("Caption: Blue checkout button"));
    assert.ok(doc.text.includes('Element: button #buy "Buy now"'));
    const ocrLine = doc.text.split("\n").find((line) => line.startsWith("Text in image: "))!;
    assert.ok(ocrLine.length < ocr.length);
  });

  test("cuts at the cap when the pin alone is over it", async () => {
    const doc = await buildPinDocument(input({ caption: null, comments: [], pin: { comment: "c".repeat(7000), number: 1 } }));
    assert.equal(doc.truncated, true);
    assert.equal(doc.text.length, PIN_DOCUMENT_MAX_CHARS);
  });

  test("same input, same SHA-256 hex; a change changes the hash", async () => {
    const first = await buildPinDocument(input());
    const second = await buildPinDocument(input());
    assert.match(first.hash, /^[0-9a-f]{64}$/);
    assert.equal(first.hash, second.hash);
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`pin-document/v${PIN_DOCUMENT_FORMAT}\n${first.text}`)),
    );
    assert.equal(first.hash, Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(""));
    assert.equal(first.hash, await pinDocumentHash(first.text));
    const changed = await buildPinDocument(input({ pin: { ...input().pin, comment: "Contrast is fine" } }));
    assert.notEqual(changed.hash, first.hash);
  });
});

describe("clipText", () => {
  test("never leaves half of a surrogate pair", () => {
    assert.equal(clipText("ab😀", 3), "ab");
    assert.equal(clipText("abc", 5), "abc");
  });
});
