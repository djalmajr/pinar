import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Pin, PinLocation } from "@pinar/shared";
import { cardOmitsLocationMethod, pinCardTitle } from "./pin-card-title";

const labels = { area: "Area selection", element: "Element" };

function pin(partial: Partial<Pin> & Pick<Pin, "type">): Pin {
  return {
    comment: "note",
    coords: { x: 1, y: 2 },
    number: 1,
    ...partial,
  };
}

function location(confidence: PinLocation["confidence"], strategy: PinLocation["strategy"]): PinLocation {
  return { confidence, evidence: [], score: 1, strategy };
}

describe("pin card title", () => {
  test("uses tag#id, tag.class, the tag alone, and leaves region pins unchanged", () => {
    assert.equal(
      pinCardTitle(pin({ selector: "button#save", tag: "button", type: "point" }), labels),
      "button#save",
    );
    assert.equal(
      pinCardTitle(pin({ selector: "span.price", tag: "span", type: "point" }), labels),
      "span.price",
    );
    assert.equal(
      pinCardTitle(pin({ selector: "button[data-save]", tag: "button", type: "point" }), labels),
      "button",
    );
    assert.equal(
      pinCardTitle(pin({
        kind: "area",
        selector: "main.layout",
        tag: "_r_k_",
        type: "area",
      }), labels),
      "Area selection",
    );
  });

  test("does not title a card with an isolated generated id", () => {
    assert.equal(
      pinCardTitle(pin({ selector: "#_r_k_", tag: "_r_k_", type: "point" }), labels),
      "Element",
    );
    assert.equal(
      pinCardTitle(pin({
        fingerprint: { id: "_r_k_", tag: "div" },
        selector: "#_r_k_",
        tag: "_r_k_",
        type: "point",
      }), labels),
      "div#_r_k_",
    );
  });

  test("omits found-by-selector and found-by-text badges on the card", () => {
    assert.equal(cardOmitsLocationMethod(location("probable", "stable-selector")), true);
    assert.equal(cardOmitsLocationMethod(location("probable", "semantic")), true);
    assert.equal(cardOmitsLocationMethod(location("exact", "stable-selector")), true);
    assert.equal(cardOmitsLocationMethod(location("ambiguous", "semantic")), false);
    assert.equal(cardOmitsLocationMethod(undefined), true);
  });
});
