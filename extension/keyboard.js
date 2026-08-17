(() => {
  function handleComposerKeyDown(event) {
    event.stopPropagation();
    if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey) return false;
    event.preventDefault();
    return true;
  }

  function stopComposerKeyboardEvent(event) {
    event.stopPropagation();
  }

  globalThis.__pinarKeyboardEvents = {
    handleComposerKeyDown,
    stopComposerKeyboardEvent,
  };
})();
