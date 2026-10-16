import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("./keyboard.js", import.meta.url), "utf8");
const context = vm.createContext({ Event });
vm.runInContext(source, context);
const {
  copyShortcutLabel,
  handleComposerKeyDown,
  insertSuppressedKey,
  isCopyShortcut,
  pinarTextField,
  stopComposerKeyboardEvent,
} = context.__pinarKeyboardEvents;

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

  test("modified Enter is left for the platform shortcut handler", () => {
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

describe("copy shortcut by platform", () => {
  test("macOS accepts only Command+Enter", () => {
    assert.equal(copyShortcutLabel(true), "⌘ + Enter");
    assert.equal(isCopyShortcut(createKeyboardEvent({ key: "Enter", metaKey: true }).event, true), true);
    assert.equal(isCopyShortcut(createKeyboardEvent({ key: "Enter", altKey: true }).event, true), false);
    assert.equal(isCopyShortcut(createKeyboardEvent({ key: "Enter", ctrlKey: true }).event, true), false);
    assert.equal(isCopyShortcut(createKeyboardEvent({ key: "Enter", metaKey: true, shiftKey: true }).event, true), false);
    assert.equal(isCopyShortcut(createKeyboardEvent({ key: "Enter", altKey: true, metaKey: true }).event, true), false);
  });

  test("Windows and Linux accept only Alt+Enter", () => {
    assert.equal(copyShortcutLabel(false), "Alt + Enter");
    assert.equal(isCopyShortcut(createKeyboardEvent({ key: "Enter", altKey: true }).event, false), true);
    assert.equal(isCopyShortcut(createKeyboardEvent({ key: "Enter", ctrlKey: true }).event, false), false);
    assert.equal(isCopyShortcut(createKeyboardEvent({ key: "Enter", metaKey: true }).event, false), false);
    assert.equal(isCopyShortcut(createKeyboardEvent({ key: "Enter", altKey: true, shiftKey: true }).event, false), false);
    assert.equal(isCopyShortcut(createKeyboardEvent({ key: "Enter", altKey: true, ctrlKey: true }).event, false), false);
  });
});

describe("pinar text field detection", () => {
  function createEvent({ crossesHost = true, isEditable = false, tag = "textarea" } = {}) {
    const target = {
      isContentEditable: isEditable,
      matches: (selector) => (selector === "textarea, input" ? tag === "textarea" || tag === "input" : false),
      tag,
    };
    const host = { tagName: "DIV", __pinar: true };
    const path = crossesHost ? [target, host] : [target];
    return { event: { composedPath: () => path }, host, target };
  }

  test("a textarea inside the host is a Pinar text field", () => {
    const { event, host, target } = createEvent();
    assert.equal(pinarTextField(event, host), target);
  });

  test("an input inside the host is a Pinar text field", () => {
    const { event, host, target } = createEvent({ tag: "input" });
    assert.equal(pinarTextField(event, host), target);
  });

  test("a contenteditable inside the host is a Pinar text field", () => {
    const { event, host, target } = createEvent({ isEditable: true, tag: "div" });
    assert.equal(pinarTextField(event, host), target);
  });

  test("a page text field outside the host is not reported", () => {
    const { event, host } = createEvent({ crossesHost: false });
    assert.equal(pinarTextField(event, host), null);
  });

  test("a non-editable element inside the host is not reported", () => {
    const { event, host } = createEvent({ tag: "button" });
    assert.equal(pinarTextField(event, host), null);
  });
  test("an event with no element target is not reported", () => {
    assert.equal(pinarTextField({ composedPath: () => [] }, { tagName: "DIV" }), null);
  });
});

describe("pinar text field detection - input types", () => {
  // Only textual inputs are Pinar text fields: checkbox, range, number and
  // the like never go through the isolation.
  function createTypedEvent({ type, tag = "input" } = {}) {
    const target = {
      isContentEditable: false,
      tag,
      matches: (selector) => {
        if (selector === "textarea, input") return tag === "textarea" || tag === "input";
        if (selector === "input") return tag === "input";
        return false;
      },
      ...(typeof type === "string" ? { type } : {}),
    };
    const host = { tagName: "DIV", __pinar: true };
    return { event: { composedPath: () => [target, host] }, host, target };
  }

  for (const type of [undefined, "text", "search", "url", "email", "tel", "password"]) {
    test(`an input of type ${type ?? "(none)"} is a Pinar text field`, () => {
      const { event, host, target } = createTypedEvent({ type });
      assert.equal(pinarTextField(event, host), target);
    });
  }

  for (const type of ["checkbox", "range", "radio", "number", "date", "hidden"]) {
    test(`an input of type ${type} is not a Pinar text field`, () => {
      const { event, host } = createTypedEvent({ type });
      assert.equal(pinarTextField(event, host), null);
    });
  }

  test("a focused checkbox in a closed root is not a Pinar text field", () => {
    const field = {
      isContentEditable: false,
      tag: "input",
      type: "checkbox",
      matches: (selector) => (selector === "textarea, input" || selector === "input" ? true : false),
    };
    const host = { tagName: "DIV", matches: () => false };
    const shadow = { activeElement: field, contains: () => false };
    assert.equal(pinarTextField({ composedPath: () => [host] }, host, shadow), null);
  });
});

describe("pinar text field detection with a closed shadow root", () => {
  // A closed shadow root keeps its inner nodes out of composedPath(): the
  // path starts at the host, so the field can only come from the root's
  // activeElement (the way extension/content.js holds the root).
  function createClosedEvent({ isEditable = false, tag = "textarea" } = {}) {
    const field = {
      isContentEditable: isEditable,
      matches: (selector) => (selector === "textarea, input" ? tag === "textarea" || tag === "input" : false),
      tag,
    };
    const host = { tagName: "DIV", matches: () => false };
    const shadow = { activeElement: field, contains: () => false };
    return { event: { composedPath: () => [host] }, host, shadow, field };
  }

  test("a focused textarea in a closed root is a Pinar text field", () => {
    const { event, host, shadow, field } = createClosedEvent();
    assert.equal(pinarTextField(event, host, shadow), field);
  });

  test("a focused text input in a closed root is a Pinar text field", () => {
    const { event, host, shadow, field } = createClosedEvent({ tag: "input" });
    assert.equal(pinarTextField(event, host, shadow), field);
  });

  test("a focused contenteditable in a closed root is a Pinar text field", () => {
    const { event, host, shadow, field } = createClosedEvent({ isEditable: true, tag: "div" });
    assert.equal(pinarTextField(event, host, shadow), field);
  });

  test("a focused button in a closed root is not a Pinar text field", () => {
    const { event, host, shadow } = createClosedEvent({ tag: "button" });
    assert.equal(pinarTextField(event, host, shadow), null);
  });

  test("an open root still resolves the field from the path when the root is given", () => {
    const target = {
      isContentEditable: false,
      matches: (selector) => selector === "textarea, input",
      tag: "textarea",
    };
    const host = { tagName: "DIV", matches: () => false };
    const shadow = { activeElement: target, contains: (node) => node === target };
    assert.equal(pinarTextField({ composedPath: () => [target, host] }, host, shadow), target);
  });

  test("a closed root with an event that does not cross the host is not reported", () => {
    const field = { isContentEditable: false, matches: () => true, tag: "textarea" };
    const host = { tagName: "DIV" };
    const shadow = { activeElement: field, contains: () => false };
    assert.equal(pinarTextField({ composedPath: () => [{ tagName: "INPUT" }] }, host, shadow), null);
  });
});

describe("suppressed key fallback insertion", () => {
  function createField(value = "abc", start = 3, end = 3) {
    const inputs = [];
    const field = {
      inputs,
      selectionEnd: end,
      selectionStart: start,
      value,
      setRangeText(text, from, to, mode = "end") {
        this.value = this.value.slice(0, from) + text + this.value.slice(to);
        const cursor = from + (mode === "end" ? text.length : 0);
        this.selectionStart = cursor;
        this.selectionEnd = cursor;
      },
    };
    field.dispatchEvent = (event) => {
      if (event.type === "input") inputs.push(event);
      return false;
    };
    return field;
  }

  function createEvent(overrides = {}) {
    return { altKey: false, ctrlKey: false, isComposing: false, key: "x", metaKey: false, ...overrides };
  }

  test("a printable character is inserted at the cursor and announced with input", () => {
    const field = createField("abc");
    assert.equal(insertSuppressedKey(createEvent({ key: "x" }), field), true);
    assert.equal(field.value, "abcx");
    assert.equal(field.selectionStart, 4);
    assert.equal(field.selectionEnd, 4);
    assert.equal(field.inputs.length, 1);
    assert.equal(field.inputs[0].type, "input");
  });

  test("a character replaces the selection and leaves the cursor after it", () => {
    const field = createField("abcdef", 1, 4);
    assert.equal(insertSuppressedKey(createEvent({ key: "x" }), field), true);
    assert.equal(field.value, "axef");
    assert.equal(field.selectionStart, 2);
    assert.equal(field.selectionEnd, 2);
  });

  test("space is inserted like any printable character", () => {
    const field = createField("ab");
    assert.equal(insertSuppressedKey(createEvent({ key: " " }), field), true);
    assert.equal(field.value, "ab ");
  });

  test("Backspace with a selection deletes the selection", () => {
    const field = createField("abcdef", 1, 4);
    assert.equal(insertSuppressedKey(createEvent({ key: "Backspace" }), field), true);
    assert.equal(field.value, "aef");
    assert.equal(field.selectionStart, 1);
  });

  test("Backspace without a selection deletes the previous character", () => {
    const field = createField("abc", 3, 3);
    assert.equal(insertSuppressedKey(createEvent({ key: "Backspace" }), field), true);
    assert.equal(field.value, "ab");
    assert.equal(field.selectionStart, 2);
    assert.equal(field.selectionEnd, 2);
  });

  test("Backspace at the start of the field is a no-op", () => {
    const field = createField("abc", 0, 0);
    assert.equal(insertSuppressedKey(createEvent({ key: "Backspace" }), field), false);
    assert.equal(field.value, "abc");
    assert.equal(field.inputs.length, 0);
  });

  test("Delete with a selection deletes the selection", () => {
    const field = createField("abcdef", 1, 4);
    assert.equal(insertSuppressedKey(createEvent({ key: "Delete" }), field), true);
    assert.equal(field.value, "aef");
    assert.equal(field.selectionStart, 1);
  });

  test("Delete without a selection deletes the following character", () => {
    const field = createField("abc", 1, 1);
    assert.equal(insertSuppressedKey(createEvent({ key: "Delete" }), field), true);
    assert.equal(field.value, "ac");
    assert.equal(field.selectionStart, 1);
  });

  test("Delete at the end of the field is a no-op", () => {
    const field = createField("abc", 3, 3);
    assert.equal(insertSuppressedKey(createEvent({ key: "Delete" }), field), false);
    assert.equal(field.value, "abc");
  });

  test("keys with Ctrl, Meta or Alt are not emulated", () => {
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      const field = createField("abc");
      assert.equal(insertSuppressedKey(createEvent({ key: "x", ...modifier }), field), false);
      assert.equal(field.value, "abc");
      assert.equal(field.inputs.length, 0);
    }
  });

  test("keys during IME composition are not emulated", () => {
    const field = createField("abc");
    assert.equal(insertSuppressedKey(createEvent({ key: "x", isComposing: true }), field), false);
    assert.equal(field.value, "abc");
  });

  test("arrows, Enter and editing keys are not emulated", () => {
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", "Escape", "Home", "End"]) {
      const field = createField("abc");
      assert.equal(insertSuppressedKey(createEvent({ key }), field), false);
      assert.equal(field.value, "abc");
    }
  });
});

describe("suppressed key fallback insertion - grapheme aware deletion", () => {
  function createField(value, start, end) {
    const field = {
      inputs: [],
      selectionEnd: end,
      selectionStart: start,
      value,
      setRangeText(text, from, to, mode = "end") {
        this.value = this.value.slice(0, from) + text + this.value.slice(to);
        const cursor = from + (mode === "end" ? text.length : 0);
        this.selectionStart = cursor;
        this.selectionEnd = cursor;
      },
    };
    field.dispatchEvent = (event) => {
      if (event.type === "input") field.inputs.push(event);
      return false;
    };
    return field;
  }

  function createEvent(overrides = {}) {
    return { altKey: false, ctrlKey: false, isComposing: false, key: "x", metaKey: false, ...overrides };
  }

  const clusters = [
    { name: "a simple emoji", unit: "\u{1F600}" }, // 😀
    { name: "a ZWJ sequence", unit: "\u{1F469}\u200D\u{1F4BB}" }, // 👩‍💻
    { name: "a combining character", unit: "e\u0301" }, // e + combining acute
    { name: "a flag", unit: "\u{1F1E7}\u{1F1F7}" }, // 🇧🇷
  ];

  for (const { name, unit } of clusters) {
    test(`Backspace removes ${name} at the end of the field`, () => {
      const value = `abc${unit}`;
      const field = createField(value, value.length, value.length);
      assert.equal(insertSuppressedKey(createEvent({ key: "Backspace" }), field), true);
      assert.equal(field.value, "abc");
      assert.equal(field.selectionStart, 3);
      assert.equal(field.inputs.length, 1);
    });

    test(`Delete removes ${name} at the start of the field`, () => {
      const field = createField(`${unit}abc`, 0, 0);
      assert.equal(insertSuppressedKey(createEvent({ key: "Delete" }), field), true);
      assert.equal(field.value, "abc");
      assert.equal(field.selectionStart, 0);
      assert.equal(field.inputs.length, 1);
    });

    test(`Backspace removes ${name} in the middle of the field`, () => {
      const value = `a${unit}b`;
      const caret = 1 + unit.length; // right after the cluster
      const field = createField(value, caret, caret);
      assert.equal(insertSuppressedKey(createEvent({ key: "Backspace" }), field), true);
      assert.equal(field.value, "ab");
    });
  }

  test("Backspace removes the only character or cluster of the field", () => {
    for (const value of ["a", "\u{1F600}", "\u{1F469}\u200D\u{1F4BB}"]) {
      const field = createField(value, value.length, value.length);
      assert.equal(insertSuppressedKey(createEvent({ key: "Backspace" }), field), true);
      assert.equal(field.value, "");
      assert.equal(field.selectionStart, 0);
    }
  });

  test("Backspace at the start and Delete at the end remove nothing", () => {
    const atStart = createField("\u{1F600}", 0, 0);
    assert.equal(insertSuppressedKey(createEvent({ key: "Backspace" }), atStart), false);
    assert.equal(atStart.value, "\u{1F600}");
    const atEnd = createField("\u{1F600}", 2, 2);
    assert.equal(insertSuppressedKey(createEvent({ key: "Delete" }), atEnd), false);
    assert.equal(atEnd.value, "\u{1F600}");
  });

  for (const { name, unit } of clusters) {
    if (unit.length < 2) continue;
    for (const key of ["Backspace", "Delete"]) {
      test(`${key} with the caret inside ${name} removes the whole cluster`, () => {
        for (let inner = 1; inner < unit.length; inner += 1) {
          const field = createField(`a${unit}b`, 1 + inner, 1 + inner);
          assert.equal(insertSuppressedKey(createEvent({ key }), field), true);
          assert.equal(field.value, "ab", `caret ${inner} of ${unit.length}`);
          assert.equal(field.selectionStart, 1);
        }
      });
    }
  }

  test("a selection is still removed whole when it contains clusters", () => {
    const field = createField(`abc\u{1F600}de`, 0, 5); // selects "abc😀"
    assert.equal(insertSuppressedKey(createEvent({ key: "Backspace" }), field), true);
    assert.equal(field.value, "de");
    assert.equal(field.selectionStart, 0);
  });
});

describe("suppressed key fallback insertion without Intl.Segmenter", () => {
  // The vm context hides Intl, so the module takes its fallback path: it
  // must still refuse to split surrogate pairs.
  const fallbackContext = vm.createContext({ Event, Intl: undefined });
  vm.runInContext(source, fallbackContext);
  const fallbackInsert = fallbackContext.__pinarKeyboardEvents.insertSuppressedKey;

  function createField(value, start, end) {
    const field = {
      inputs: [],
      selectionEnd: end,
      selectionStart: start,
      value,
      setRangeText(text, from, to, mode = "end") {
        this.value = this.value.slice(0, from) + text + this.value.slice(to);
        const cursor = from + (mode === "end" ? text.length : 0);
        this.selectionStart = cursor;
        this.selectionEnd = cursor;
      },
    };
    field.dispatchEvent = (event) => {
      if (event.type === "input") field.inputs.push(event);
      return false;
    };
    return field;
  }

  function createEvent(overrides = {}) {
    return { altKey: false, ctrlKey: false, isComposing: false, key: "x", metaKey: false, ...overrides };
  }

  test("the context really has no Intl.Segmenter", () => {
    assert.equal(vm.runInContext("typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function'", fallbackContext), true);
  });

  test("Backspace and Delete with the caret inside a surrogate pair remove the whole pair", () => {
    for (const key of ["Backspace", "Delete"]) {
      const field = createField("a\ud83d\ude00b", 2, 2);
      assert.equal(fallbackInsert(createEvent({ key }), field), true);
      assert.equal(field.value, "ab", key);
      assert.equal(field.selectionStart, 1);
    }
  });

  test("Backspace removes the only character or emoji of the field", () => {
    for (const value of ["a", "\ud83d\ude00"]) {
      const field = createField(value, value.length, value.length);
      assert.equal(fallbackInsert(createEvent({ key: "Backspace" }), field), true);
      assert.equal(field.value, "");
    }
  });

  test("Backspace removes a whole surrogate pair emoji at the end", () => {
    const field = createField("abc\ud83d\ude00", 5, 5);
    assert.equal(fallbackInsert(createEvent({ key: "Backspace" }), field), true);
    assert.equal(field.value, "abc");
  });

  test("Delete removes a whole surrogate pair emoji at the start", () => {
    const field = createField("\ud83d\ude00abc", 0, 0);
    assert.equal(fallbackInsert(createEvent({ key: "Delete" }), field), true);
    assert.equal(field.value, "abc");
  });

  test("a lone surrogate unit is removed as a single unit", () => {
    const field = createField("a\ud83d", 2, 2);
    assert.equal(fallbackInsert(createEvent({ key: "Backspace" }), field), true);
    assert.equal(field.value, "a");
  });
});

describe("suppressed key fallback insertion - field limits", () => {
  function createField(value = "abc", start = 3, end = 3) {
    const inputs = [];
    const field = {
      inputs,
      selectionEnd: end,
      selectionStart: start,
      value,
      setRangeText(text, from, to, mode = "end") {
        this.value = this.value.slice(0, from) + text + this.value.slice(to);
        const cursor = from + (mode === "end" ? text.length : 0);
        this.selectionStart = cursor;
        this.selectionEnd = cursor;
      },
    };
    field.dispatchEvent = (event) => {
      if (event.type === "input") inputs.push(event);
      return false;
    };
    return field;
  }

  function createEvent(overrides = {}) {
    return { altKey: false, ctrlKey: false, isComposing: false, key: "x", metaKey: false, ...overrides };
  }

  test("a readOnly field is not written", () => {
    const field = { ...createField("abc"), readOnly: true };
    assert.equal(insertSuppressedKey(createEvent({ key: "x" }), field), false);
    assert.equal(field.value, "abc");
    assert.equal(field.inputs.length, 0);
  });

  test("a disabled field is not written", () => {
    const field = { ...createField("abc"), disabled: true };
    assert.equal(insertSuppressedKey(createEvent({ key: "x" }), field), false);
    assert.equal(field.value, "abc");
    assert.equal(field.inputs.length, 0);
  });

  test("maxLength is respected when the field is full", () => {
    const field = { ...createField("abc", 3, 3), maxLength: 3 };
    assert.equal(insertSuppressedKey(createEvent({ key: "x" }), field), false);
    assert.equal(field.value, "abc");
    assert.equal(field.inputs.length, 0);
  });

  test("maxLength allows a replacement that fits", () => {
    const field = { ...createField("abcdef", 1, 4), maxLength: 4 };
    assert.equal(insertSuppressedKey(createEvent({ key: "x" }), field), true);
    assert.equal(field.value, "axef");
    assert.equal(field.inputs.length, 1);
  });

  test("a negative maxLength means unlimited", () => {
    const field = { ...createField("abc", 3, 3), maxLength: -1 };
    assert.equal(insertSuppressedKey(createEvent({ key: "x" }), field), true);
    assert.equal(field.value, "abcx");
  });
});
