import { PAD_CSS, unionPinsBox } from "./crop.js";

export const CAPTURE_TILE_DELAY_MS = 550;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function planFullPageCapture(pins, metrics, pad = PAD_CSS) {
  const viewportHeight = Math.max(1, Math.round(metrics.viewportHeight || 1));
  const viewportWidth = Math.max(1, Math.round(metrics.viewportWidth || 1));
  const documentHeight = Math.max(viewportHeight, Math.round(metrics.documentHeight || viewportHeight));
  const documentWidth = Math.max(viewportWidth, Math.round(metrics.documentWidth || viewportWidth));
  const pinBounds = unionPinsBox(pins);
  const wantedStart = clamp(Math.floor(pinBounds.y - pad), 0, documentHeight);
  const wantedEnd = clamp(Math.ceil(pinBounds.y + pinBounds.height + pad), wantedStart + 1, documentHeight);
  const maxScrollY = Math.max(0, documentHeight - viewportHeight);
  const firstScrollY = clamp(wantedStart, 0, maxScrollY);
  const scrollYs = [firstScrollY];

  while (scrollYs.at(-1) + viewportHeight < wantedEnd) {
    const next = Math.min(scrollYs.at(-1) + viewportHeight, maxScrollY);
    if (next === scrollYs.at(-1)) break;
    scrollYs.push(next);
  }

  return {
    captureEnd: Math.min(documentHeight, scrollYs.at(-1) + viewportHeight),
    captureStart: firstScrollY,
    documentHeight,
    documentWidth,
    scrollYs,
    viewportHeight,
    viewportWidth,
    wantedEnd,
    wantedStart,
  };
}

function shiftPoint(point, origin) {
  if (!point) return point;
  return {
    ...point,
    x: point.x - origin.x,
    y: point.y - origin.y,
  };
}

export function shiftPinsToCapture(pins, origin) {
  return pins.map((pin) => ({
    ...pin,
    anchor: shiftPoint(pin.anchor, origin),
    areaBox: shiftPoint(pin.areaBox, origin),
    box: shiftPoint(pin.box, origin),
    coords: shiftPoint(pin.coords, origin),
    topBox: shiftPoint(pin.topBox, origin),
  }));
}
