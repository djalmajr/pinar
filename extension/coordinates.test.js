import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("./coordinates.js", import.meta.url), "utf8");
const context = vm.createContext({});
vm.runInContext(source, context);
const {
  anchorInBox,
  documentBox,
  documentPoint,
  geometryLabel,
  isScrollContainerRecord,
  layoutScroll,
  pinDocumentGeometry,
  projectPin,
} = context.__pinarCoordinateSpace;
const plain = (value) => JSON.parse(JSON.stringify(value));

describe("pin coordinate projection", () => {
  test("formats viewport position and dimensions for the live selection indicator", () => {
    assert.equal(
      geometryLabel({ height: 77.7, width: 143.6, x: 42.4, y: 19.5 }),
      "(42,20) 144x78",
    );
  });

  test("an element pin follows the page when the viewport scrolls", () => {
    // Mutation captured: ignoring the scroll delta leaves the marker fixed at y=260.
    const pin = {
      anchor: { x: 140, y: 260 },
      box: { height: 40, width: 120, x: 100, y: 240 },
      kind: "element",
      scroll: { x: 0, y: 300 },
    };

    const projected = projectPin(pin, { x: 0, y: 420 });

    assert.deepEqual(plain(projected.anchor), { x: 140, y: 140 });
    assert.deepEqual(plain(projected.box), { height: 40, width: 120, x: 100, y: 120 });
  });

  test("an area pin keeps its rectangle attached to the selected page region", () => {
    // Mutation captured: applying the delta only to the marker leaves the area box at y=360.
    const pin = {
      anchor: { x: 80, y: 360 },
      box: { height: 180, width: 300, x: 80, y: 360 },
      kind: "area",
      scroll: { x: 40, y: 500 },
    };

    const projected = projectPin(pin, { x: 70, y: 620 });

    assert.deepEqual(plain(projected.anchor), { x: 50, y: 240 });
    assert.deepEqual(plain(projected.box), { height: 180, width: 300, x: 50, y: 240 });
  });

  test("an area pin follows a nested scroller even when the window does not move", () => {
    // Mutation captured: Help/app pages scroll `[data-slot=scroll-area-viewport]`.
    // Window scroll stays 0, so a window-only origin leaves the overlay glued
    // to the viewport while the marked region moves.
    const origin = layoutScroll({ x: 0, y: 0 }, [{ scrollLeft: 0, scrollTop: 240 }]);
    const current = layoutScroll({ x: 0, y: 0 }, [{ scrollLeft: 0, scrollTop: 400 }]);
    const pin = {
      anchor: { x: 80, y: 360 },
      box: { height: 180, width: 300, x: 80, y: 360 },
      kind: "area",
      layoutScroll: origin,
      scroll: { x: 0, y: 0 },
    };

    const projected = projectPin(pin, current);

    assert.deepEqual(plain(origin), { x: 0, y: 240 });
    assert.deepEqual(plain(current), { x: 0, y: 400 });
    assert.deepEqual(plain(projected.anchor), { x: 80, y: 200 });
    assert.deepEqual(plain(projected.box), { height: 180, width: 300, x: 80, y: 200 });
  });

  test("overflow auto/scroll boxes count as layout scroll containers", () => {
    assert.equal(
      isScrollContainerRecord({
        clientHeight: 400,
        clientWidth: 640,
        overflowX: "hidden",
        overflowY: "auto",
        scrollHeight: 2400,
        scrollWidth: 640,
      }),
      true,
    );
    assert.equal(
      isScrollContainerRecord({
        clientHeight: 400,
        clientWidth: 640,
        overflowX: "visible",
        overflowY: "visible",
        scrollHeight: 2400,
        scrollWidth: 640,
      }),
      false,
    );
  });

  test("iframe pins are projected into the current top-frame viewport", () => {
    // Mutation captured: reusing the creation-time iframe offset draws the capture overlay in the old frame position.
    const pin = {
      anchor: { x: 60, y: 90 },
      box: { height: 30, width: 100, x: 40, y: 70 },
      kind: "element",
      scroll: { x: 0, y: 20 },
    };

    const projected = projectPin(pin, { x: 0, y: 50 }, { x: 300, y: 200 });

    assert.deepEqual(plain(projected.anchor), { x: 60, y: 60 });
    assert.deepEqual(plain(projected.topBox), { height: 30, width: 100, x: 340, y: 240 });
  });

  test("an element pin keeps the same relative point when its DOM box moves", () => {
    // Mutation captured: using the old absolute anchor detaches fixed and sticky element pins after scroll.
    const pin = {
      anchor: { x: 150, y: 225 },
      box: { height: 50, width: 100, x: 100, y: 200 },
    };

    const anchor = anchorInBox(pin, { height: 100, width: 200, x: 20, y: 30 });

    assert.deepEqual(plain(anchor), { x: 120, y: 80 });
  });

  test("viewport geometry is persisted in document coordinates", () => {
    assert.deepEqual(plain(documentPoint({ x: 40, y: 60 }, { x: 10, y: 500 })), { x: 50, y: 560 });
    assert.deepEqual(
      plain(documentBox({ height: 80, width: 120, x: 40, y: 60 }, { x: 10, y: 500 })),
      { height: 80, width: 120, x: 50, y: 560 },
    );
  });

  test("an area pin keeps its creation-time document geometry after a later scroll", () => {
    const pin = {
      anchor: { x: 80, y: 120 },
      box: { height: 180, width: 300, x: 80, y: 120 },
      documentAnchor: { x: 80, y: 120 },
      documentBox: { height: 180, width: 300, x: 80, y: 120 },
      kind: "area",
      scroll: { x: 0, y: 0 },
    };

    const geometry = pinDocumentGeometry(pin, { x: 0, y: 2400 });

    assert.deepEqual(plain(geometry.anchor), { x: 80, y: 120 });
    assert.deepEqual(plain(geometry.box), { height: 180, width: 300, x: 80, y: 120 });
  });

  test("fixed and sticky element pins keep the document position where they were created", () => {
    const pin = {
      anchor: { x: 160, y: 30 },
      box: { height: 64, width: 320, x: 0, y: 0 },
      documentAnchor: { x: 160, y: 30 },
      documentBox: { height: 64, width: 320, x: 0, y: 0 },
      kind: "element",
      viewportAnchored: true,
    };

    const geometry = pinDocumentGeometry(
      pin,
      { x: 0, y: 2400 },
      { height: 64, width: 320, x: 0, y: 0 },
    );

    assert.deepEqual(plain(geometry.anchor), { x: 160, y: 30 });
    assert.deepEqual(plain(geometry.box), { height: 64, width: 320, x: 0, y: 0 });
  });

  test("normal element pins follow live DOM reflow in document coordinates", () => {
    const pin = {
      anchor: { x: 150, y: 225 },
      box: { height: 50, width: 100, x: 100, y: 200 },
      documentAnchor: { x: 150, y: 225 },
      documentBox: { height: 50, width: 100, x: 100, y: 200 },
      kind: "element",
      viewportAnchored: false,
    };

    const geometry = pinDocumentGeometry(
      pin,
      { x: 0, y: 500 },
      { height: 100, width: 200, x: 20, y: 30 },
    );

    assert.deepEqual(plain(geometry.anchor), { x: 120, y: 580 });
    assert.deepEqual(plain(geometry.box), { height: 100, width: 200, x: 20, y: 530 });
  });
});
