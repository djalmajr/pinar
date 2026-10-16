(() => {
  function copyShortcutLabel(apple) {
    return apple ? "⌘ + Enter" : "Alt + Enter";
  }

  function isCopyShortcut(event, apple) {
    if (event.key !== "Enter" || event.shiftKey) return false;
    return apple
      ? event.metaKey && !event.ctrlKey && !event.altKey
      : event.altKey && !event.metaKey && !event.ctrlKey;
  }

  function handleComposerKeyDown(event) {
    event.stopPropagation();
    if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return false;
    event.preventDefault();
    return true;
  }

  function stopComposerKeyboardEvent(event) {
    event.stopPropagation();
  }

  // The composer lives in a shadow root, so for page listeners the event
  // target is retargeted to the host. In an open root, composedPath() reaches
  // the real field (path[0]); in the closed root the extension actually uses
  // (attachShadow({ mode: "closed" })), the inner nodes are hidden from the
  // path, so the field comes from the root's activeElement. A Pinar text
  // field is a textarea/input/contenteditable (host.contains() does not see
  // shadow children, so containment is proved through the path or the root).
  // Only textual inputs qualify: checkbox, range, number and the like never
  // go through the isolation. A bare input (no type attribute) is a text
  // input.
  const TEXT_INPUT_TYPES = new Set(["", "text", "search", "url", "email", "tel", "password"]);

  function pinarTextField(event, host, shadow) {
    const path = event.composedPath?.();
    if (!Array.isArray(path) || !host) return null;
    if (!path.includes(host)) return null;
    let target = path[0];
    if (shadow && typeof shadow.contains === "function" && !shadow.contains(target)) {
      // Closed root: the path starts at the host, so the focused field is
      // only reachable through the root itself.
      target = shadow.activeElement;
    }
    if (!target || typeof target.matches !== "function") return null;
    if (target.matches("textarea, input")) {
      if (target.matches("input")) {
        const type = typeof target.type === "string" ? target.type : "";
        if (!TEXT_INPUT_TYPES.has(type)) return null;
      }
      return target;
    }
    return target.isContentEditable ? target : null;
  }

  // Safety net for a keydown whose default action a page listener already
  // canceled before Pinar's own capture listener ran (site capture listeners
  // on window are registered before the extension is injected). The default
  // cannot be un-prevented, so the suppressed effect is applied straight to
  // the field. Limitation: only printable characters, Backspace and Delete
  // are emulated (no arrows, editing shortcuts or IME composition); the
  // effect is written through setRangeText and announced with an `input`
  // event so the field's existing listeners keep working. Deletion is
  // grapheme-aware: Backspace/Delete remove a whole grapheme cluster, so a
  // canceled key never corrupts an emoji, a ZWJ sequence, a flag or a
  // combining character; without Intl.Segmenter the fallback at least never
  // splits a surrogate pair. readOnly/disabled fields are never written and
  // a non-negative maxLength bounds the result of the replacement.
  let graphemeSegmenter = null;
  try {
    graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  } catch {
    graphemeSegmenter = null;
  }

  const isHighSurrogate = (unit) => unit >= 0xd800 && unit <= 0xdbff;
  const isLowSurrogate = (unit) => unit >= 0xdc00 && unit <= 0xdfff;

  // Range [from, to) a collapsed-caret deletion removes: the whole grapheme
  // cluster before the caret (Backspace) or after it (Delete). A caret that
  // sits inside a cluster removes that entire cluster, so both ends are
  // widened. null means there is nothing to remove in that direction.
  function deletionRange(value, caret, direction) {
    if (graphemeSegmenter) {
      for (const { index, segment } of graphemeSegmenter.segment(value)) {
        const end = index + segment.length;
        const touched = direction === "backward" ? index < caret && caret <= end : index <= caret && caret < end;
        if (touched) return [index, end];
      }
      return null;
    }
    // Fallback: the cluster is at least one code point; never split the two
    // UTF-16 units of a surrogate pair, including a caret between them.
    const insidePair = caret > 0 && caret < value.length
      && isHighSurrogate(value.charCodeAt(caret - 1)) && isLowSurrogate(value.charCodeAt(caret));
    if (insidePair) return [caret - 1, caret + 1];
    if (direction === "backward") {
      if (caret === 0) return null;
      const pair = caret >= 2 && isLowSurrogate(value.charCodeAt(caret - 1)) && isHighSurrogate(value.charCodeAt(caret - 2));
      return [pair ? caret - 2 : caret - 1, caret];
    }
    if (caret >= value.length) return null;
    const pair = isHighSurrogate(value.charCodeAt(caret)) && isLowSurrogate(value.charCodeAt(caret + 1));
    return [caret, pair ? caret + 2 : caret + 1];
  }

  function insertSuppressedKey(event, field) {
    if (!field || typeof field.setRangeText !== "function") return false;
    if (field.readOnly || field.disabled) return false;
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    if (event.isComposing) return false;
    const key = event.key;
    const value = typeof field.value === "string" ? field.value : "";
    const start = Number.isInteger(field.selectionStart) ? field.selectionStart : 0;
    const end = Number.isInteger(field.selectionEnd) ? field.selectionEnd : start;
    let from = start;
    let to = end;
    let text = "";
    if (typeof key === "string" && key.length === 1) {
      text = key;
    } else if (key === "Backspace" || key === "Delete") {
      if (start === end) {
        const range = deletionRange(value, start, key === "Backspace" ? "backward" : "forward");
        if (range === null) return false;
        [from, to] = range;
      }
    } else {
      return false;
    }
    // A real field refuses to grow past maxLength (a negative value is
    // unlimited): the result of the replacement must fit.
    const maxLength = field.maxLength;
    if (Number.isInteger(maxLength) && maxLength >= 0 && value.length - (to - from) + text.length > maxLength) return false;
    field.setRangeText(text, from, to, "end");
    field.dispatchEvent?.(new Event("input", { bubbles: true }));
    return true;
  }

  globalThis.__pinarKeyboardEvents = {
    copyShortcutLabel,
    handleComposerKeyDown,
    insertSuppressedKey,
    isCopyShortcut,
    pinarTextField,
    stopComposerKeyboardEvent,
  };
})();
