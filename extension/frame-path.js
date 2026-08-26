(() => {
  const FRAME_BOUNDARY = " ::frame:: ";

  function joinFrameDomPath(framePaths = [], elementPath = "") {
    return [...framePaths, elementPath]
      .map((path) => String(path || "").trim())
      .filter(Boolean)
      .join(FRAME_BOUNDARY);
  }

  globalThis.__pinarFramePath = Object.freeze({
    joinFrameDomPath,
  });
})();
