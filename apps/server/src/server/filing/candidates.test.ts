import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { FILING_EXAMPLE_TITLES, FILING_LABEL_MAX_CHARS, filingCandidates, filingLabels } from "./candidates";
import { chooseCollection, FILING_NONE_OPTION } from "./choose";

function collection(collectionId: string, projectName: string, collectionName: string) {
  return { collectionId, collectionName, projectName };
}

describe("filingLabels", () => {
  test('"Project / Collection", one line', () => {
    assert.deepEqual(filingLabels([collection("a", "Shop", "Checkout"), collection("b", "Shop\nfront", "  Card \r\n errors ")]), [
      "Shop / Checkout",
      "Shop front / Card errors",
    ]);
  });

  test("a repeated label gets the first free suffix, in the collections' order", () => {
    const labels = filingLabels([
      collection("a", "Shop", "Checkout"),
      collection("b", "Shop", "Checkout"),
      collection("c", "Shop", "Checkout (2)"),
      collection("d", "Shop", "Checkout"),
    ]);
    assert.deepEqual(labels, ["Shop / Checkout", "Shop / Checkout (2)", "Shop / Checkout (2) (2)", "Shop / Checkout (3)"]);
    assert.equal(new Set(labels).size, labels.length);
    // The same order gives the same labels.
    assert.deepEqual(filingLabels([
      collection("a", "Shop", "Checkout"),
      collection("b", "Shop", "Checkout"),
      collection("c", "Shop", "Checkout (2)"),
      collection("d", "Shop", "Checkout"),
    ]), labels);
  });

  test("labels stay within 200 characters, suffix included, and never pose as the none option", () => {
    const long = "x".repeat(300);
    const labels = filingLabels([collection("a", long, "A"), collection("b", long, "B"), collection("c", long, "C")]);
    assert.equal(FILING_LABEL_MAX_CHARS, 200);
    assert.deepEqual(labels.map((label) => label.length), [200, 200, 200]);
    assert.equal(labels[0], "x".repeat(200));
    assert.equal(labels[1], `${"x".repeat(196)} (2)`);
    assert.equal(labels[2], `${"x".repeat(196)} (3)`);

    // A surrogate pair is never cut in half.
    const emoji = filingLabels([collection("a", `${"x".repeat(199)}😀`, "A")])[0]!;
    assert.equal(emoji, "x".repeat(199));

    const names = filingLabels([collection("a", "", ""), collection("b", "", "")]);
    assert.deepEqual(names, [" / ", " /  (2)"]);
    assert.ok(!names.includes(FILING_NONE_OPTION));
  });

  test("the candidates are accepted by chooseCollection, even with repeated names", async () => {
    const collections = Array.from({ length: 25 }, (_, index) => collection(`c${index}`, "P".repeat(250), "Same"));
    const candidates = filingCandidates(collections, []);
    const choice = await chooseCollection({
      candidates,
      engine: { embedding: { baseUrl: "http://127.0.0.1:9/v1", model: "m" }, centroid: async () => null, kind: "similarity" },
      fetch: (async () => Response.json({ data: [{ embedding: new Array(256).fill(1), index: 0 }] })) as unknown as typeof fetch,
      text: "capture",
    });
    assert.equal(choice.reason, "low_confidence", "the labels pass the candidate check");
  });
});

describe("filingCandidates", () => {
  test("examples are the newest non-blank titles (up to 3) and lastUsedAt the newest session", () => {
    const candidates = filingCandidates(
      [collection("a", "Shop", "Checkout"), collection("b", "Shop", "Empty")],
      [
        { collectionId: "a", createdAt: "2026-10-05T00:00:00.000Z", id: "s5", title: "Fifth" },
        { collectionId: "a", createdAt: "2026-10-04T00:00:00.000Z", id: "s4", title: "  " },
        { collectionId: "a", createdAt: "2026-10-03T00:00:00.000Z", id: "s3", title: "Third\nline" },
        { collectionId: "a", createdAt: "2026-10-02T00:00:00.000Z", id: "s2", title: "Second" },
        { collectionId: "a", createdAt: "2026-10-01T00:00:00.000Z", id: "s1", title: "First" },
        { collectionId: "z", createdAt: "2026-10-09T00:00:00.000Z", id: "sz", title: "Not a candidate" },
      ],
    );
    assert.equal(FILING_EXAMPLE_TITLES, 3);
    assert.deepEqual(candidates, [
      { collectionId: "a", examples: ["Fifth", "Third line", "Second"], label: "Shop / Checkout", lastUsedAt: "2026-10-05T00:00:00.000Z" },
      { collectionId: "b", examples: [], label: "Shop / Empty", lastUsedAt: null },
    ]);
  });
});
