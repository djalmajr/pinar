import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { planFullPageCapture, shiftPinsToCapture } from "./full-page.js";

describe("full page capture planning", () => {
  test("captures every viewport between pins near the top and bottom", () => {
    const plan = planFullPageCapture(
      [
        { anchor: { x: 120, y: 100 }, box: { height: 100, width: 200, x: 80, y: 80 }, kind: "area" },
        { anchor: { x: 120, y: 2700 }, box: { height: 120, width: 240, x: 80, y: 2680 }, kind: "area" },
      ],
      { documentHeight: 3200, documentWidth: 1200, viewportHeight: 800, viewportWidth: 1200 },
    );

    assert.deepEqual(plan.scrollYs, [0, 800, 1600, 2400]);
    assert.equal(plan.captureStart, 0);
    assert.equal(plan.captureEnd, 3200);
    assert.ok(plan.wantedStart <= 80);
    assert.ok(plan.wantedEnd >= 2800);
  });

  test("captures the full span between a fixed header pin and a later area pin", () => {
    const pins = [
      {
        anchor: { x: 600, y: 32 },
        box: { height: 64, width: 1200, x: 0, y: 0 },
        kind: "element",
        viewportAnchored: true,
      },
      {
        anchor: { x: 420, y: 4040 },
        box: { height: 260, width: 640, x: 100, y: 3920 },
        kind: "area",
      },
    ];
    const plan = planFullPageCapture(pins, {
      documentHeight: 4600,
      documentWidth: 1200,
      viewportHeight: 800,
      viewportWidth: 1200,
    });

    assert.deepEqual(plan.scrollYs, [0, 800, 1600, 2400, 3200, 3800]);
    assert.equal(plan.captureStart, 0);
    assert.equal(plan.captureEnd, 4600);

    const shifted = shiftPinsToCapture(pins, { x: 0, y: plan.captureStart });
    assert.equal(shifted[0].box.y, 0);
    assert.equal(shifted[1].box.y, 3920);
  });

  test("uses the browser maximum scroll for a pin near the document end", () => {
    const plan = planFullPageCapture(
      [{ anchor: { x: 100, y: 2950 }, box: { height: 20, width: 20, x: 90, y: 2940 }, kind: "area" }],
      { documentHeight: 3000, documentWidth: 1200, viewportHeight: 800, viewportWidth: 1200 },
    );

    assert.deepEqual(plan.scrollYs, [2200]);
    assert.equal(plan.captureEnd, 3000);
  });

  test("shifts document pins into the stitched image coordinate space", () => {
    const [pin] = shiftPinsToCapture(
      [{
        anchor: { x: 120, y: 1450 },
        areaBox: { height: 100, width: 200, x: 80, y: 1400 },
        box: { height: 100, width: 200, x: 80, y: 1400 },
        coords: { x: 120, y: 1450 },
        topBox: { height: 100, width: 200, x: 80, y: 1400 },
      }],
      { x: 0, y: 1200 },
    );

    assert.deepEqual(pin.anchor, { x: 120, y: 250 });
    assert.deepEqual(pin.box, { height: 100, width: 200, x: 80, y: 200 });
    assert.deepEqual(pin.topBox, { height: 100, width: 200, x: 80, y: 200 });
  });
});
