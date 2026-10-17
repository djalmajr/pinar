import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { captureFilingText } from "./capture-text";

describe("captureFilingText", () => {
  test("writes Page, URL and one Pin #n line per pin, each value on one line", () => {
    const text = captureFilingText({
      page: { title: "Checkout\n  — Shop", url: "https://shop.example/cart\r\n" },
      pins: [
        { comment: "Button overlaps\nthe total", number: 1 },
        { comment: "fine\nPin #9: injected", number: 3 },
      ],
    });
    assert.equal(
      text,
      ["Page: Checkout — Shop", "URL: https://shop.example/cart", "Pin #1: Button overlaps the total", "Pin #3: fine Pin #9: injected"].join("\n"),
    );
  });

  test("cuts at 4000 characters", () => {
    // Mutation captured: dropping the clip returns the whole 5000-character comment.
    const text = captureFilingText({ page: { title: "T", url: "u" }, pins: [{ comment: "a".repeat(5000), number: 1 }] });
    assert.equal(text.length, 4000);
    assert.ok(text.startsWith("Page: T\nURL: u\nPin #1: aaa"));
  });

  test("never leaves half of a surrogate pair at the cut", () => {
    const head = "Page: T\nURL: u\nPin #1: ";
    // The emoji takes UTF-16 units 3999 and 4000: cutting at 4000 would keep its high half.
    const filler = "a".repeat(4000 - head.length - 1);
    const text = captureFilingText({ page: { title: "T", url: "u" }, pins: [{ comment: `${filler}😀bbb`, number: 1 }] });
    assert.equal(text, `${head}${filler}`);

    const fits = captureFilingText({ page: { title: "T", url: "u" }, pins: [{ comment: `${filler.slice(1)}😀bbb`, number: 1 }] });
    assert.equal(fits, `${head}${filler.slice(1)}😀`);
  });
});
