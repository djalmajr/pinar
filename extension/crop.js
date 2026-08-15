import { getPinColor } from "./pin-colors.js";

export const MARK = "#6691F2";
export const MARKER_CSS = 28;
export const MARKER_TIP = 0.92;
export const PAD_CSS = 200;
const BUBBLE = "M2 12C2 6.477 6.477 2 12 2s10 4.477 10 10s-4.477 10-10 10a10 10 0 0 1-4.262-.951l-4.537.93a1 1 0 0 1-1.18-1.18l.93-4.537A10 10 0 0 1 2 12";

export function pinPoint(pin) {
  const box = pin.box ?? { x: 0, y: 0, width: 0, height: 0 };
  const local = pin.anchor ?? {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
  if (pin.topBox && pin.box) {
    return {
      x: local.x + (pin.topBox.x - pin.box.x),
      y: local.y + (pin.topBox.y - pin.box.y),
    };
  }
  return local;
}

export function pinBox(pin) {
  return pin.topBox ?? pin.box ?? { height: 1, width: 1, x: 0, y: 0 };
}

export function unionPinsBox(pins) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pin of pins) {
    const point = pinPoint(pin);
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
    if (pin.kind === "area") {
      const box = pinBox(pin);
      minX = Math.min(minX, box.x);
      minY = Math.min(minY, box.y);
      maxX = Math.max(maxX, box.x + box.width);
      maxY = Math.max(maxY, box.y + box.height);
    }
  }
  if (!Number.isFinite(minX)) return { height: 1, width: 1, x: 0, y: 0 };
  return {
    height: Math.max(1, maxY - minY),
    width: Math.max(1, maxX - minX),
    x: minX,
    y: minY,
  };
}

export function cropWindow(bitmap, pinOrPins, dpr) {
  const pins = Array.isArray(pinOrPins) ? pinOrPins : [pinOrPins];
  const box = unionPinsBox(pins);
  const pad = PAD_CSS * dpr;
  let x = Math.max(0, Math.round(box.x * dpr - pad));
  let y = Math.max(0, Math.round(box.y * dpr - pad));
  let width = Math.max(1, Math.min(bitmap.width - x, Math.round(box.width * dpr + pad * 2)));
  let height = Math.max(1, Math.min(bitmap.height - y, Math.round(box.height * dpr + pad * 2)));
  for (const pin of pins) {
    const marker = markerPlacement(pinPoint(pin), { x, y }, dpr);
    const minX = Math.min(x, Math.floor(x + marker.x - 2));
    const minY = Math.min(y, Math.floor(y + marker.y - 2));
    const maxX = Math.max(x + width, Math.ceil(x + marker.x + marker.size + 2));
    const maxY = Math.max(y + height, Math.ceil(y + marker.y + marker.size + 2));
    x = Math.max(0, minX);
    y = Math.max(0, minY);
    width = Math.min(bitmap.width - x, Math.max(1, maxX - x));
    height = Math.min(bitmap.height - y, Math.max(1, maxY - y));
  }
  return { height, width, x, y };
}

export function markerPlacement(anchor, crop, dpr) {
  const size = MARKER_CSS * dpr;
  return {
    size,
    x: anchor.x * dpr - crop.x - size / 2,
    y: anchor.y * dpr - crop.y - size * MARKER_TIP,
  };
}

export function drawPinMarker(ctx, placement, label, color = getPinColor(label)) {
  const { size, x, y } = placement;
  const scale = size / MARKER_CSS;
  ctx.save();
  const dpr = size / MARKER_CSS;
  ctx.shadowColor = "rgba(15, 23, 42, 0.45)";
  ctx.shadowBlur = 2 * dpr;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 1 * dpr;
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  const bubble = new Path2D(BUBBLE);
  ctx.fillStyle = color;
  ctx.fill(bubble, "evenodd");
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1.15;
  ctx.stroke(bubble);
  ctx.fill(bubble, "evenodd");
  ctx.restore();

  ctx.fillStyle = "#fff";
  ctx.font = `700 ${Math.max(10, Math.round(11 * scale))}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(label), x + size / 2, y + size * 0.46);
}

export function drawAreaBox(ctx, box, crop, dpr, isElement = false, color = MARK) {
  const x = Math.round(box.x * dpr - crop.x);
  const y = Math.round(box.y * dpr - crop.y);
  const width = Math.round(box.width * dpr);
  const height = Math.round(box.height * dpr);

  if (width < 2 || height < 2) return;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, Math.round(2 * dpr));
  if (!isElement) {
    ctx.setLineDash([Math.round(6 * dpr), Math.round(4 * dpr)]);
  }
  ctx.fillStyle = `${color}14`;
  ctx.fillRect(x, y, width, height);
  ctx.strokeRect(x, y, width, height);
  ctx.restore();
}

export async function renderPinsCrop(bitmap, pins, dpr) {
  const crop = cropWindow(bitmap, pins, dpr);
  if (crop.width < 2 || crop.height < 2) return null;
  const canvas = new OffscreenCanvas(crop.width, crop.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  pins.forEach((pin, index) => {
    const box = pin.topBox || pin.box;
    if (box && box.width > 2 && box.height > 2) {
      drawAreaBox(ctx, pinBox(pin), crop, dpr, pin.kind !== "area", pin.color || getPinColor(index + 1));
    }
  });
  pins.forEach((pin, index) => {
    drawPinMarker(
      ctx,
      markerPlacement(pinPoint(pin), crop, dpr),
      index + 1,
      pin.color || getPinColor(index + 1),
    );
  });
  return canvas.convertToBlob({ type: "image/png" });
}
