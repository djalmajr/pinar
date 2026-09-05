import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("./keyboard.js", import.meta.url), "utf8");
const context = vm.createContext({});
vm.runInContext(source, context);
const { handleComposerKeyDown, stopComposerKeyboardEvent } = context.__pinarKeyboardEvents;

function createKeyboardEvent(overrides = {}) {
  const calls = { prevented: false, stopped: false };
  return {
    calls,
    event: {
      altKey: false,
      ctrlKey: false,
      key: "d",
      metaKey: false,
      shiftKey: false,
      ...overrides,
      preventDefault() {
        calls.prevented = true;
      },
      stopPropagation() {
        calls.stopped = true;
      },
    },
  };
}

describe("composer keyboard isolation", () => {
  test("typing a host shortcut stays in the composer without blocking text input", () => {
    // Mutation captured: removing stopPropagation lets the host page receive the shortcut.
    const { calls, event } = createKeyboardEvent({ key: "d" });

    assert.equal(handleComposerKeyDown(event), false);
    assert.equal(calls.stopped, true);
    assert.equal(calls.prevented, false);
  });

  test("plain Enter submits the comment without reaching the host page", () => {
    const { calls, event } = createKeyboardEvent({ key: "Enter" });

    assert.equal(handleComposerKeyDown(event), true);
    assert.equal(calls.stopped, true);
    assert.equal(calls.prevented, true);
  });

  test("Shift+Enter keeps the multiline default without reaching the host page", () => {
    const { calls, event } = createKeyboardEvent({ key: "Enter", shiftKey: true });

    assert.equal(handleComposerKeyDown(event), false);
    assert.equal(calls.stopped, true);
    assert.equal(calls.prevented, false);
  });

  test("Alt+Enter leaves the composer so capture can copy", () => {
    const { calls, event } = createKeyboardEvent({ key: "Enter", altKey: true });

    assert.equal(handleComposerKeyDown(event), false);
    assert.equal(calls.stopped, true);
    assert.equal(calls.prevented, false);
  });

  test("keyup and keypress can be isolated without canceling their defaults", () => {
    const { calls, event } = createKeyboardEvent();

    stopComposerKeyboardEvent(event);
    assert.equal(calls.stopped, true);
    assert.equal(calls.prevented, false);
  });
});
