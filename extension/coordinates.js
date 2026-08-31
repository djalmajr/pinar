(() => {
  function scrollPosition(value = {}) {
    return {
      x: Number(value.x) || 0,
      y: Number(value.y) || 0,
    };
  }

  function viewportPoint(point, originScroll, currentScroll) {
    const origin = scrollPosition(originScroll);
    const current = scrollPosition(currentScroll);
    return {
      x: point.x + origin.x - current.x,
      y: point.y + origin.y - current.y,
    };
  }

  function viewportBox(box, originScroll, currentScroll) {
    return {
      ...box,
      ...viewportPoint(box, originScroll, currentScroll),
    };
  }

  function documentPoint(point, scroll) {
    const offset = scrollPosition(scroll);
    return {
      x: point.x + offset.x,
      y: point.y + offset.y,
    };
  }

  function documentBox(box, scroll) {
    return {
      ...box,
      ...documentPoint(box, scroll),
    };
  }

  function geometryLabel(box) {
    const x = Math.round(Number(box?.x) || 0);
    const y = Math.round(Number(box?.y) || 0);
    const width = Math.max(0, Math.round(Number(box?.width) || 0));
    const height = Math.max(0, Math.round(Number(box?.height) || 0));
    return `(${x},${y}) ${width}x${height}`;
  }

  function anchorInBox(pin, box) {
    const sourceBox = pin.box;
    const sourceAnchor = pin.anchor ?? {
      x: sourceBox.x + sourceBox.width / 2,
      y: sourceBox.y + sourceBox.height / 2,
    };
    const xRatio = (sourceAnchor.x - sourceBox.x) / Math.max(1, sourceBox.width);
    const yRatio = (sourceAnchor.y - sourceBox.y) / Math.max(1, sourceBox.height);
    return {
      x: box.x + box.width * xRatio,
      y: box.y + box.height * yRatio,
    };
  }

  function projectPin(pin, currentScroll, frameOffset = { x: 0, y: 0 }) {
    const box = viewportBox(pin.box, pin.scroll, currentScroll);
    const anchor = viewportPoint(pin.anchor ?? {
      x: pin.box.x + pin.box.width / 2,
      y: pin.box.y + pin.box.height / 2,
    }, pin.scroll, currentScroll);
    return {
      ...pin,
      anchor,
      box,
      topBox: {
        ...box,
        x: box.x + frameOffset.x,
        y: box.y + frameOffset.y,
      },
    };
  }

  function pinDocumentGeometry(pin, currentScroll, liveBox) {
    if (pin.documentBox && (pin.kind === "area" || pin.viewportAnchored || !liveBox)) {
      return {
        anchor: pin.documentAnchor ?? {
          x: pin.documentBox.x + pin.documentBox.width / 2,
          y: pin.documentBox.y + pin.documentBox.height / 2,
        },
        box: pin.documentBox,
      };
    }

    if (liveBox) {
      return {
        anchor: documentPoint(anchorInBox(pin, liveBox), currentScroll),
        box: documentBox(liveBox, currentScroll),
      };
    }

    return {
      anchor: documentPoint(pin.anchor, pin.scroll),
      box: documentBox(pin.box, pin.scroll),
    };
  }

  globalThis.__pinarCoordinateSpace = Object.freeze({
    anchorInBox,
    documentBox,
    documentPoint,
    geometryLabel,
    pinDocumentGeometry,
    projectPin,
    viewportBox,
    viewportPoint,
  });
})();
