import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MARKER_CSS, MARKER_TIP, PAD_CSS, cropWindow, drawAreaBox, drawPinMarker, markerPlacement, pinPoint } from "./crop.js";
import { getPinColor } from "./pin-colors.js";

describe("crop", () => {
  test("pinPoint prefers the click and lifts iframe coords", () => {
    assert.deepEqual(
      pinPoint({ anchor: { x: 10, y: 20 }, box: { height: 40, width: 40, x: 0, y: 0 } }),
      { x: 10, y: 20 },
    );
    assert.deepEqual(
      pinPoint({
        anchor: { x: 10, y: 20 },
        box: { height: 40, width: 80, x: 0, y: 0 },
        topBox: { height: 40, width: 80, x: 100, y: 50 },
      }),
      { x: 110, y: 70 },
    );
  });

  test("marker tip sits on the click inside the crop", () => {
    const dpr = 2;
    const pin = { anchor: { x: 200, y: 160 }, box: { height: 40, width: 80, x: 180, y: 140 } };
    const crop = cropWindow({ height: 800, width: 1200 }, pin, dpr);
    const marker = markerPlacement(pinPoint(pin), crop, dpr);
    const tipX = marker.x + marker.size / 2;
    const tipY = marker.y + marker.size * MARKER_TIP;
    assert.equal(Math.round(tipX), Math.round(200 * dpr - crop.x));
    assert.equal(Math.round(tipY), Math.round(160 * dpr - crop.y));
    assert.equal(marker.size, MARKER_CSS * dpr);
    assert.ok(marker.x >= -1);
    assert.ok(marker.y >= -1);
  });

  test("drawPinMarker writes only the pin number", () => {
    const labels = [];
    const OriginalPath2D = globalThis.Path2D;
    globalThis.Path2D = class Path2D {};
    const ctx = {
      fill: () => {},
      fillText: (value) => labels.push(value),
      restore: () => {},
      save: () => {},
      scale: () => {},
      stroke: () => {},
      translate: () => {},
    };

    try {
      drawPinMarker(ctx, { size: MARKER_CSS, x: 10, y: 20 }, 3);
    } finally {
      globalThis.Path2D = OriginalPath2D;
    }

    assert.deepEqual(labels, ["3"]);
  });

  test("pin colors are stable and repeat after the palette", () => {
    assert.equal(getPinColor(1), "#2563EB");
    assert.equal(getPinColor(2), "#0369A1");
    assert.equal(getPinColor(13), getPinColor(1));
  });

  test("cropWindow covers the union of left, middle, and right pins", () => {
    const dpr = 1;
    const pins = [
      { anchor: { x: 40, y: 80 }, box: { height: 20, width: 20, x: 30, y: 70 } },
      { anchor: { x: 400, y: 90 }, box: { height: 20, width: 20, x: 390, y: 80 } },
      { anchor: { x: 220, y: 85 }, box: { height: 20, width: 20, x: 210, y: 75 } },
    ];
    const crop = cropWindow({ height: 900, width: 1200 }, pins, dpr);
    assert.ok(crop.x <= 30);
    assert.ok(crop.x + crop.width >= 410);
    const left = markerPlacement(pinPoint(pins[0]), crop, dpr);
    const right = markerPlacement(pinPoint(pins[1]), crop, dpr);
    assert.ok(left.x + left.size / 2 < right.x + right.size / 2);
    assert.ok(right.x + right.size <= crop.width + 1);
  });

  test("a lone pin on a tall element stays within 200px of the click", () => {
    const dpr = 1;
    const pin = {
      anchor: { x: 200, y: 700 },
      box: { height: 900, width: 400, x: 0, y: 0 },
      kind: "element",
    };
    const crop = cropWindow({ height: 900, width: 400 }, pin, dpr);
    assert.ok(crop.height <= PAD_CSS * 2 + 8);
    assert.ok(crop.y + crop.height >= 700);
    assert.ok(700 - crop.y <= PAD_CSS + 2);
  });

  test("cropWindow covers the entire area selection box", () => {
    const dpr = 1;
    const pin = {
      anchor: { x: 100, y: 100 },
      box: { height: 250, width: 350, x: 100, y: 100 },
      kind: "area",
    };
    const crop = cropWindow({ height: 800, width: 1000 }, pin, dpr);
    assert.ok(crop.x <= 100);
    assert.ok(crop.y <= 100);
    assert.ok(crop.x + crop.width >= 450);
    assert.ok(crop.y + crop.height >= 350);
  });

  test("drawAreaBox strokes dashed rect for area pins", () => {
    const calls = [];
    const ctx = {
      save: () => calls.push("save"),
      restore: () => calls.push("restore"),
      fillRect: (...args) => calls.push(["fillRect", ...args]),
      strokeRect: (...args) => calls.push(["strokeRect", ...args]),
      setLineDash: (...args) => calls.push(["setLineDash", ...args]),
    };
    const box = { height: 100, width: 200, x: 50, y: 60 };
    const crop = { height: 300, width: 400, x: 20, y: 30 };
    drawAreaBox(ctx, box, crop, 2);
    assert.deepEqual(calls[0], "save");
    assert.deepEqual(calls[1], ["setLineDash", [12, 8]]);
    assert.deepEqual(calls[2], ["fillRect", 80, 90, 400, 200]);
    assert.deepEqual(calls[3], ["strokeRect", 80, 90, 400, 200]);
    assert.deepEqual(calls[4], "restore");
  });
});
