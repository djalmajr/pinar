import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const helpSource = readFileSync(new URL("./Help.tsx", import.meta.url), "utf8");

describe("help screenshots", () => {
  test("open in the shared zoom modal instead of a new tab", () => {
    assert.match(helpSource, /<Dialog open=\{open\} onOpenChange=\{setOpen\}>/);
    assert.match(helpSource, /<ImageZoomStage/);
    assert.match(helpSource, /<ImageZoomControls/);
    assert.match(helpSource, /aria-label=\{ui\.openScreenshot\}/);
    assert.match(helpSource, /onClick=\{\(\) => setOpen\(true\)\}/);
    assert.doesNotMatch(helpSource, /href=\{screenshot\.src\}/);
  });

  test("marks the current article section from the internal scroll viewport", () => {
    assert.match(helpSource, /activeSectionIndex/);
    assert.match(helpSource, /\[data-slot="scroll-area-viewport"\]/);
    assert.match(helpSource, /scrollViewport\.addEventListener\("scroll", updateActiveSection/);
    assert.match(helpSource, /aria-current=\{/);
    assert.match(helpSource, /"border-primary font-medium text-primary"/);
  });
});
