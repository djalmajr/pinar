import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  formatClipboardHtml,
  formatClipboardText,
  generateNanoId,
  getPinColor,
} from "@pinar/shared";
import {
  getProjectIconData,
  isProjectIcon,
  PROJECT_ICON_OPTIONS,
  PROJECT_ICONS,
} from "@pinar/shared/project-icons";

const PAGE = {
  title: "Checkout <review>",
  url: "https://example.test/checkout?a=1&b=2",
};

const PINS = [{
  comment: "Move <button>",
  coords: { x: 10, y: 20 },
  domPath: "body > main > button",
  innerText: "Pay\nnow",
  number: 1,
  selector: 'button[name="pay"]',
  type: "point" as const,
}];

describe("shared clipboard formats", () => {
  // Mutation captured: dropping any optional field loses one observable line from the plain payload.
  test("preserves complete page and pin context in plain text", () => {
    const text = formatClipboardText(
      PAGE,
      PINS,
      "/tmp/pinar-shot.png",
      "https://pinar.dev/v/session-one",
    );

    assert.match(text, /^Page: Checkout <review>$/m);
    assert.match(text, /^URL: https:\/\/example\.test\/checkout\?a=1&b=2$/m);
    assert.match(text, /^Viewer: https:\/\/pinar\.dev\/v\/session-one$/m);
    assert.match(text, /^Screenshot: \/tmp\/pinar-shot\.png$/m);
    assert.match(text, /^DOM: body > main > button$/m);
    assert.match(text, /^Selector: button\[name="pay"\]$/m);
    assert.match(text, /^Text: "Pay now"$/m);
  });

  // Mutation captured: interpolating raw user content exposes tags or unescaped URL attributes.
  test("escapes untrusted content in the HTML clipboard payload", () => {
    const html = formatClipboardHtml(
      PAGE,
      PINS,
      "/tmp/<shot>.png",
      "https://pinar.dev/v/session-one?x=1&y=2",
    );

    assert.match(html, /Checkout &lt;review&gt;/);
    assert.match(html, /checkout\?a=1&amp;b=2/);
    assert.match(html, /session-one\?x=1&amp;y=2/);
    assert.match(html, /\/tmp\/&lt;shot&gt;\.png/);
    assert.match(html, /Move &lt;button&gt;/);
    assert.match(html, /button\[name=&quot;pay&quot;\]/);
    assert.doesNotMatch(html, /<review>|<shot>|Move <button>/);
  });

  // Mutation captured: replacing the placeholders with empty strings makes the payload ambiguous.
  test("uses safe placeholders when page metadata is absent", () => {
    assert.match(formatClipboardText({ title: "", url: "" }, []), /Page: \(untitled\)\nURL: \(unknown\)/);
    assert.match(formatClipboardHtml({ title: "", url: "" }, []), /<h3>Page<\/h3>/);
  });
});

describe("shared identifiers and visual tokens", () => {
  // Mutation captured: using bytes without the 63 mask emits characters outside the URL-safe alphabet.
  test("generates fixed-size URL-safe ids with crypto and fallback randomness", () => {
    const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    const originalRandom = Math.random;

    try {
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: {
          getRandomValues(bytes: Uint8Array) {
            bytes.set([0, 1, 36, 255]);
            return bytes;
          },
        },
      });
      assert.equal(generateNanoId(4), "01_-");

      Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined });
      Math.random = () => 0;
      assert.equal(generateNanoId(4), "0000");
    } finally {
      Math.random = originalRandom;
      if (cryptoDescriptor) Object.defineProperty(globalThis, "crypto", cryptoDescriptor);
      else Reflect.deleteProperty(globalThis, "crypto");
    }
  });

  // Mutation captured: removing modulo wrapping makes the first color after the palette undefined.
  test("keeps pin colors stable after the palette wraps", () => {
    assert.equal(getPinColor(1), getPinColor(12));
    assert.equal(getPinColor(0), getPinColor(1));
  });

  // Mutation captured: accepting arbitrary icon strings makes the invalid-icon assertion pass.
  test("resolves direct and aliased Lucide project icons only", () => {
    const alias = PROJECT_ICONS.find((icon) => !PROJECT_ICON_OPTIONS.includes(icon));
    assert.ok(alias);
    assert.equal(isProjectIcon("folder-kanban"), true);
    assert.equal(isProjectIcon("not-a-lucide-icon"), false);
    assert.ok(getProjectIconData("folder-kanban"));
    assert.ok(getProjectIconData(alias));
    assert.equal(getProjectIconData("not-a-lucide-icon"), undefined);
  });
});
