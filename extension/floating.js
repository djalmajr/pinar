(() => {
  function fitFloatingPosition({ anchor, size, viewport, margin = 8 }) {
    const availableWidth = Math.max(1, viewport.width - margin * 2);
    const availableHeight = Math.max(1, viewport.height - margin * 2);
    const width = Math.min(Math.max(1, size.width), availableWidth);
    const height = Math.min(Math.max(1, size.height), availableHeight);
    let left = anchor.left;
    let top = anchor.top;
    if (left + width > viewport.width - margin) left = viewport.width - margin - width;
    if (top + height > viewport.height - margin) top = viewport.height - margin - height;
    left = Math.max(margin, left);
    top = Math.max(margin, top);
    return {
      left,
      maxHeight: size.height > availableHeight ? availableHeight : null,
      maxWidth: size.width > availableWidth ? availableWidth : null,
      tooltipBelow: top < 56,
      top,
    };
  }

  globalThis.__pinarFitFloating = fitFloatingPosition;
})();
