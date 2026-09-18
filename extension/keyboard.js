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

  globalThis.__pinarKeyboardEvents = {
    copyShortcutLabel,
    handleComposerKeyDown,
    isCopyShortcut,
    stopComposerKeyboardEvent,
  };
})();
