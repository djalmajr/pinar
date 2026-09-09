import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import vm from "node:vm";

const storeSource = readFileSync(new URL("./evidence.js", import.meta.url), "utf8");
const hookSource = readFileSync(new URL("./evidence-hook.js", import.meta.url), "utf8");
const contentSrc = readFileSync(new URL("./content.js", import.meta.url), "utf8");
const sessionSrc = readFileSync(new URL("./session.js", import.meta.url), "utf8");
const backgroundSrc = readFileSync(new URL("./background.js", import.meta.url), "utf8");

function storeContext() {
  const listeners = new Map();
  const document = {
    addEventListener(name, handler) {
      listeners.set(name, handler);
    },
  };
  const context = vm.createContext({
    document,
    navigator: { language: "pt-BR", onLine: true, userAgentData: { brands: [{ brand: "Chromium", version: "140" }, { brand: "Google Chrome", version: "140" }], platform: "Windows" } },
    window: { devicePixelRatio: 2, innerHeight: 900, innerWidth: 1440, matchMedia: () => ({ matches: true }) },
    location: { origin: "https://app.example.test" },
  });
  context.window.top = context.window;
  vm.runInContext(storeSource, context);
  return { evidence: context.__pinarEvidence, listeners };
}

function element(name, parent = null) {
  const node = {
    contains(other) {
      let cursor = other;
      while (cursor) {
        if (cursor === node) return true;
        cursor = cursor.parent;
      }
      return false;
    },
    name,
    parent,
  };
  return node;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

describe("extension technical evidence", () => {
  test("hook runs in the MAIN world before the content scripts and never touches console.log", () => {
    assert.match(sessionSrc, /EVIDENCE_HOOK_FILES = \["evidence-hook\.js"\]/);
    assert.ok(sessionSrc.indexOf('"evidence.js"') < sessionSrc.indexOf('"content.js"'));
    assert.match(backgroundSrc, /world: "MAIN"/);
    assert.match(backgroundSrc, /installEvidenceHook\(tab\.id, true\)/);
    assert.match(contentSrc, /evidence: await collectEvidence\(element\)/);
    assert.match(contentSrc, /evidence: await collectEvidence\(null\)/);
    assert.match(contentSrc, /addEventListener\("click", trackInteraction, true\)/);
    assert.doesNotMatch(hookSource, /console\.log\s*=/);
    assert.doesNotMatch(hookSource, /console\.warn\s*=/);
    assert.doesNotMatch(hookSource, /\.text\(\)|\.json\(\)|responseText|requestBody/);
    assert.match(hookSource, /console\.error = function/);
    assert.match(hookSource, /unhandledrejection/);
  });

  test("grades facts by their link to the pinned element", () => {
    const { evidence } = storeContext();
    let clock = 1_000_000;
    const store = evidence.createStore({ frame: () => "top", now: () => clock, origin: () => "https://app.example.test" });
    const form = element("form");
    const button = element("button", form);
    const label = element("span", button);
    const other = element("aside");

    store.record(JSON.stringify({ at: clock, kind: "console_error", message: "Warning: missing key" }));
    clock += 5_000;
    store.interact(label, clock);
    clock += 300;
    store.record(JSON.stringify({ at: clock, kind: "http", method: "POST", status: 500, url: "https://api.example.test/pay?token=abc" }));
    clock += 3_000;
    store.record({ at: clock, kind: "network", message: "Failed to fetch", url: "https://cdn.example.test/late.js" });
    clock += 100;

    const collected = plain(store.collect(button, { redactUrl: (url) => url.replace("token=abc", "token=[redacted]") }));
    assert.equal(collected.version, 1);
    assert.equal(collected.items.length, 3);
    assert.deepEqual(collected.items.map((item) => [item.kind, item.grade]), [
      ["http", "after_interaction"],
      ["network", "same_page"],
      ["console_error", "same_page"],
    ]);
    assert.equal(collected.items[0].url, "https://api.example.test/pay?token=[redacted]");
    assert.equal(collected.items[0].method, "POST");
    assert.equal(collected.items[0].status, 500);
    assert.equal(collected.items[0].origin, "https://app.example.test");
    assert.equal(collected.items[0].frame, "top");
    assert.equal(collected.environment.browser, "Google Chrome 140");
    assert.equal(collected.environment.theme, "dark");
    assert.deepEqual(collected.environment.viewport, { height: 900, width: 1440 });

    // The same request seen from an unrelated element is only same_page.
    const unrelated = plain(store.collect(other));
    assert.equal(unrelated.items.every((item) => item.grade === "same_page"), true);

    // An error before the interaction never becomes after_interaction.
    let beforeClock = 0;
    const before = evidence.createStore({ now: () => beforeClock });
    beforeClock = 10;
    before.record({ at: 10, kind: "error", message: "early" });
    before.interact(button, 20);
    beforeClock = 50;
    assert.equal(plain(before.collect(button)).items[0].grade, "same_page");
  });

  test("returns nothing for a quiet page and forgets facts on reset", () => {
    const { evidence } = storeContext();
    const store = evidence.createStore({ now: () => 10 });
    assert.equal(store.collect(null), undefined);
    store.record({ at: 10, kind: "error", message: "boom" });
    assert.equal(store.collect(null).items.length, 1);
    store.reset();
    assert.equal(store.collect(null), undefined);
    assert.equal(store.record({ at: 10, kind: "log", message: "ignored" }), false);
    assert.equal(store.record("not json"), false);
  });

  test("bounds the ring buffer, item count and stack length", () => {
    const { evidence } = storeContext();
    const store = evidence.createStore({ now: () => 1 });
    for (let index = 0; index < evidence.LIMITS.ringSize + 25; index += 1) {
      store.record({ at: 1, kind: "console_error", message: `m${index}`, stack: "x".repeat(5_000) });
    }
    assert.equal(store.facts.length, evidence.LIMITS.ringSize);
    const collected = plain(store.collect(null));
    assert.ok(collected.items.length > 0 && collected.items.length <= evidence.LIMITS.maxItems);
    assert.ok(collected.items[0].stack.length <= evidence.LIMITS.maxStackLength);
    assert.ok(JSON.stringify(collected.items).length <= evidence.LIMITS.maxBytes);
  });

  test("feeds the shared store from the hook's DOM event", () => {
    const { evidence, listeners } = storeContext();
    const handler = listeners.get(evidence.EVENT);
    assert.equal(typeof handler, "function");
    handler({ detail: JSON.stringify({ at: 5, kind: "unhandled_rejection", message: "nope" }) });
    handler({ detail: { kind: "error" } });
    assert.equal(evidence.store.facts.length, 1);
    assert.equal(evidence.store.facts[0].kind, "unhandled_rejection");
  });
});
