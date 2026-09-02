import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  formatClipboardHtml,
  formatClipboardText,
  generateNanoId,
  getPinColor,
  parseHandoffJson,
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
  test("preserves complete page and pin context once in compact structured text", () => {
    const text = formatClipboardText(
      PAGE,
      PINS,
      "/tmp/pinar-shot.png",
      "https://pinar.dev/v/session-one",
    );

    const context = parseHandoffJson(text) as any;
    assert.equal(context.page.title, "Checkout <review>");
    assert.equal(context.page.url, "https://example.test/checkout?a=1&b=2");
    assert.deepEqual(context.screenshot, { url: "/tmp/pinar-shot.png" });
    assert.equal(context.pins[0].locator.domPath, "body > main > button");
    assert.equal(context.pins[0].locator.cssSelector, 'button[name="pay"]');
    assert.equal(context.pins[0].locator.innerText, "Pay\nnow");
    assert.equal(context.captureId, "clipboard");
    assert.match(text, /^Full context \(fetch only if the details above are insufficient\): https:\/\/pinar\.dev\/v\/session-one$/m);
    assert.equal((text.match(/body > main > button/g) || []).length, 1);
    assert.match(text, /```pinar-visual-context/);
  });

  test("omits the screenshot when includeScreenshot is false", () => {
    const text = formatClipboardText(
      PAGE,
      PINS,
      "/tmp/pinar-shot.png",
      "https://pinar.dev/v/session-one.md",
      "session-one",
      false,
    );
    assert.doesNotMatch(text, /Screenshot:/);
    assert.doesNotMatch(text, /screenshot_missing/);
    assert.match(text, /Full context \(fetch only if the details above are insufficient\): https:\/\/pinar\.dev\/v\/session-one\.md/);
    assert.equal((parseHandoffJson(text) as any).screenshot, undefined);
    const html = formatClipboardHtml(
      PAGE,
      PINS,
      "/tmp/pinar-shot.png",
      "https://pinar.dev/v/session-one.md",
      "session-one",
      false,
    );
    assert.doesNotMatch(html, /Screenshot:/);
  });

  test("full agent copy preserves capture geometry while compact remains the default", () => {
    const compact = parseHandoffJson(formatClipboardText(PAGE, PINS)) as any;
    const full = parseHandoffJson(formatClipboardText(PAGE, PINS, null, null, "full-copy", true, "full")) as any;
    assert.equal(compact.pins[0].coords, undefined);
    assert.deepEqual(full.pins[0].coords, { x: 10, y: 20 });
    assert.equal(full.schemaVersion, 1);
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
    assert.match(html, /cssSelector/);
    assert.match(html, /pay/);
    assert.match(html, /data-pinar="pinar-visual-context"/);
    assert.doesNotMatch(html, /<review>|<shot>|Move <button>/);
  });

  test("keeps absent page metadata unambiguous in structured context", () => {
    const text = formatClipboardText({ title: "", url: "" }, []);
    assert.deepEqual((parseHandoffJson(text) as any).page, { url: "" });
    assert.match(formatClipboardHtml({ title: "", url: "" }, []), /&quot;url&quot;:&quot;&quot;/);
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
