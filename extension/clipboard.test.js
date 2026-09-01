import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { clipboardFlavors } from "./clipboard.js";

const backgroundSrc = readFileSync(new URL("./background.js", import.meta.url), "utf8");
const offscreenSrc = readFileSync(new URL("./offscreen.js", import.meta.url), "utf8");

describe("clipboard flavors", () => {
  test("omits text/html when the caller produced no markup", () => {
    // A contenteditable composer prefers text/html when it is offered, so
    // publishing Markdown there collapses newlines and eats tag-like text.
    const markdown = "# Batch\n\n- pin one\n- pin two\n";
    assert.deepEqual(clipboardFlavors({ plain: markdown }), { "text/plain": markdown });
    assert.deepEqual(clipboardFlavors({ html: "", plain: markdown }), { "text/plain": markdown });
    assert.deepEqual(clipboardFlavors({ html: null, plain: markdown }), { "text/plain": markdown });
  });

  test("publishes both flavors when real markup is supplied", () => {
    const flavors = clipboardFlavors({ html: "<p>hi</p>", plain: "hi" });
    assert.deepEqual(flavors, { "text/html": "<p>hi</p>", "text/plain": "hi" });
  });

  test("keeps a bundle's angle brackets and newlines intact in the plain flavor", () => {
    const bundle = "DOM: body > div#root\nText: \"<not a tag>\"\n";
    const flavors = clipboardFlavors({ plain: bundle });
    assert.equal(flavors["text/plain"], bundle);
    assert.ok(!("text/html" in flavors));
  });

  test("tolerates a missing plain payload rather than writing undefined", () => {
    assert.deepEqual(clipboardFlavors({}), { "text/plain": "" });
  });

  test("the execCommand fallback writes exactly the same flavors", () => {
    // Both paths iterate one decision, so a flavor cannot appear in the async
    // write and go missing in the fallback.
    assert.match(offscreenSrc, /const flavors = clipboardFlavors\(message\)/);
    assert.match(offscreenSrc, /writeWithCopyEvent\(flavors\)/);
    assert.match(offscreenSrc, /for \(const \[type, value\] of Object\.entries\(flavors\)\)/);
    assert.doesNotMatch(offscreenSrc, /setData\("text\/html"/);
  });

  test("the batch handoff never offers markdown as html", () => {
    const writer = backgroundSrc.slice(
      backgroundSrc.indexOf("async function writeClipboardPlain"),
      backgroundSrc.indexOf("async function runInTopFrame"),
    );
    assert.ok(writer.length > 0);
    assert.doesNotMatch(writer, /html:/);
    assert.match(writer, /plain: text/);
  });
});
