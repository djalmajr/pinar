(() => {
  const FRAME_BOUNDARY = " ::frame:: ";

  function joinFrameDomPath(framePaths = [], elementPath = "") {
    return [...framePaths, elementPath]
      .map((path) => String(path || "").trim())
      .filter(Boolean)
      .join(FRAME_BOUNDARY);
  }

  function splitFrameDomPath(path = "") {
    return String(path)
      .split(FRAME_BOUNDARY)
      .map((part) => String(part || "").trim())
      .filter(Boolean);
  }

  globalThis.__pinarFramePath = Object.freeze({
    FRAME_BOUNDARY,
    joinFrameDomPath,
    splitFrameDomPath,
  });
})();
