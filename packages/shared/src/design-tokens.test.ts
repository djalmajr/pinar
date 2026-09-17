import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  aggregateSnapshots,
  asDesignSystem,
  designSystemFromSample,
  mergeNearbyColors,
  normalizeColor,
  type SampledPin,
  toCssVariables,
  toDesignMarkdown,
  toTailwindTheme,
  toW3cTokens,
} from "./design-tokens/index.ts";
import type { ElementSnapshot, SnapshotNode } from "./visual-context/fields.ts";

const PRIMARY = "rgb(0, 105, 168)";
const INK = "rgb(17, 24, 39)";
const MUTED = "rgb(107, 114, 128)";
const BORDER = "rgb(229, 231, 235)";
const SURFACE = "rgb(249, 250, 251)";
const WHITE = "rgb(255, 255, 255)";
const INTER = "Inter, system-ui, sans-serif";
const SHADOW = "rgba(0, 0, 0, 0.1) 0px 1px 2px 0px";

function snapshot(root: SnapshotNode): ElementSnapshot {
  return { fonts: [{ family: "Inter", weight: "600" }], icons: [], nodeCount: 1, root, truncated: false, version: 1 };
}

function button(label: string): SnapshotNode {
  return {
    styles: {
      "background-color": PRIMARY,
      "border-radius": "8px",
      color: WHITE,
      "font-family": INTER,
      "font-size": "14px",
      "font-weight": "600",
      "line-height": "20px",
      padding: "8px 16px",
    },
    tag: "button",
    text: label,
  };
}

function card(title: string): SnapshotNode {
  return {
    children: [
      { styles: { color: INK, "font-family": INTER, "font-size": "20px", "font-weight": "600", "line-height": "28px", "margin-bottom": "8px" }, tag: "h3", text: title },
      { styles: { color: MUTED, "font-family": INTER, "font-size": "16px", "font-weight": "400", "line-height": "24px", "margin-bottom": "12px" }, tag: "p", text: "Body copy" },
      { styles: { "column-gap": "4px", display: "flex", "row-gap": "4px" }, tag: "div", children: [button("Save")] },
    ],
    styles: { "background-color": SURFACE, "border-color": BORDER, "border-radius": "8px", "box-shadow": SHADOW, padding: "24px" },
    tag: "article",
  };
}

function heading(text: string): SnapshotNode {
  return { styles: { color: INK, "font-family": INTER, "font-size": "32px", "font-weight": "700", "line-height": "40px", "margin-bottom": "32px" }, tag: "h1", text };
}

function input(placeholder: string): SnapshotNode {
  return {
    attrs: { placeholder },
    styles: { "background-color": WHITE, "border-color": BORDER, "border-radius": "8px", color: INK, "font-family": INTER, "font-size": "16px", "line-height": "24px", padding: "8px 12px" },
    tag: "input",
  };
}

function label(text: string): SnapshotNode {
  return { styles: { color: MUTED, "font-family": INTER, "font-size": "12px", "font-weight": "500", "line-height": "16px", "margin-bottom": "4px" }, tag: "label", text };
}

/** Ten pins of one reference site: buttons, cards, headings and inputs on four pages. */
function referencePins(host = "acme.test"): SampledPin[] {
  const pages = ["/", "/pricing", "/docs", "/account"];
  const roots: SnapshotNode[] = [
    button("Get started"),
    card("Starter"),
    heading("Pricing"),
    input("Email"),
    { children: [label("Name"), input("Name")], styles: { "margin-bottom": "16px" }, tag: "div" },
    card("Team"),
    button("Upgrade"),
    heading("Docs"),
    { children: [button("Cancel"), button("Confirm")], styles: { "column-gap": "8px", display: "flex" }, tag: "div" },
    card("Enterprise"),
  ];
  return roots.map((root, index) => ({ snapshot: snapshot(root), url: `https://${host}${pages[index % pages.length]}` }));
}

describe("aggregateSnapshots", () => {
  test("yields the reference palette from ten pins of one site", () => {
    // ARRANGE
    const pins = referencePins();

    // ACT
    const sample = aggregateSnapshots(pins);

    // ASSERT
    assert.deepEqual(
      sample.colors.map((token) => token.value).sort(),
      ["#0069a8", "#111827", "#6b7280", "#e5e7eb", "#f9fafb", "#ffffff"],
    );
    assert.equal(sample.colors[0].name, "color-1");
    assert.deepEqual(sample.sample, { domain: "acme.test", pages: 4, pins: 10 });
    assert.deepEqual(sample.warnings, []);
  });

  test("derives the type scale, spacing, radii, shadows and fonts", () => {
    // ARRANGE
    const pins = referencePins();

    // ACT
    const sample = aggregateSnapshots(pins);

    // ASSERT
    assert.deepEqual(
      sample.typography.map((token) => token.value).sort((left, right) => parseInt(left, 10) - parseInt(right, 10)),
      ["12px", "14px", "16px", "20px", "32px"],
    );
    const body = sample.typography.find((token) => token.value === "16px");
    assert.equal(body?.lineHeight, "24px");
    const scale = Object.fromEntries(sample.typography.map((token) => [token.value, token.name]));
    assert.equal(scale["14px"], "text-md");
    assert.equal(scale["12px"], "text-sm");
    assert.equal(scale["16px"], "text-lg");
    assert.equal(scale["32px"], "text-2xl");
    assert.deepEqual(
      sample.spacing.map((token) => token.value).sort((left, right) => parseInt(left, 10) - parseInt(right, 10)),
      ["4px", "8px", "12px", "16px", "24px", "32px"],
    );
    assert.equal(sample.spacing.find((token) => token.value === "8px")?.name, "2");
    assert.deepEqual(sample.radii.map((token) => token.value), ["8px"]);
    assert.equal(sample.radii[0].name, "xs");
    assert.deepEqual(sample.shadows.map((token) => token.value), ["rgba(0, 0, 0, 0.1) 0px 1px 2px 0px"]);
    assert.equal(sample.fonts.length, 1);
    assert.equal(sample.fonts[0].value, "Inter");
    assert.equal(sample.fonts[0].name, "sans");
    assert.deepEqual(sample.fonts[0].weights, ["400", "500", "600", "700"]);
  });

  test("merges near-duplicate colors into the more frequent one", () => {
    // ARRANGE
    const counters = [
      { count: 9, value: "#0069a8" },
      { count: 4, value: "#ffffff" },
      { count: 2, value: "#0169a9" },
      { count: 1, value: "#fefefe" },
    ];

    // ACT
    const merged = mergeNearbyColors(counters);

    // ASSERT
    assert.deepEqual(merged, [{ count: 11, value: "#0069a8" }, { count: 5, value: "#ffffff" }]);
  });

  test("normalises rgb, rgba and hex colors and drops transparent ones", () => {
    assert.equal(normalizeColor("rgb(0, 105, 168)"), "#0069a8");
    assert.equal(normalizeColor("#0069A8"), "#0069a8");
    assert.equal(normalizeColor("#fff"), "#ffffff");
    assert.equal(normalizeColor("rgba(17, 24, 39, 0.5)"), "rgba(17, 24, 39, 0.5)");
    assert.equal(normalizeColor("rgba(0, 0, 0, 0)"), null);
    assert.equal(normalizeColor("linear-gradient(red, blue)"), null);
  });

  test("warns about mixed domains instead of inventing a single sample", () => {
    // ARRANGE
    const pins = [...referencePins("acme.test").slice(0, 6), ...referencePins("other.test").slice(0, 4)];

    // ACT
    const sample = aggregateSnapshots(pins);

    // ASSERT
    assert.equal(sample.sample.domain, "acme.test");
    assert.deepEqual(sample.warnings, ["mixed_domains: acme.test, other.test"]);
  });

  test("warns when spacing is too scattered to form a scale", () => {
    // ARRANGE
    const pins: SampledPin[] = Array.from({ length: 16 }, (_, index) => ({
      snapshot: snapshot({ styles: { padding: `${index * 3 + 5}px` }, tag: "div" }),
      url: "https://acme.test/",
    }));

    // ACT
    const sample = aggregateSnapshots(pins);

    // ASSERT
    assert.ok(sample.warnings.some((warning) => warning.startsWith("scattered_spacing:")));
  });
});

describe("designSystemFromSample", () => {
  test("applies proposed names only to sampled values and keeps fallbacks otherwise", () => {
    // ARRANGE
    const sample = aggregateSnapshots(referencePins());

    // ACT
    const system = designSystemFromSample(sample, {
      generatedAt: "2026-09-08T10:00:00.000Z",
      identity: "Calm and confident.",
      model: "test-model",
      names: {
        colors: { "#0069a8": "Primary", "#ff00ff": "ghost" },
        typography: { "16px": "body" },
      },
    });

    // ASSERT
    assert.equal(system.colors.find((token) => token.value === "#0069a8")?.name, "primary");
    assert.ok(!system.colors.some((token) => token.value === "#ff00ff"));
    assert.equal(system.typography.find((token) => token.value === "16px")?.name, "body");
    assert.equal(system.typography.find((token) => token.value === "14px")?.name, "text-md");
    assert.equal(system.identity, "Calm and confident.");
    assert.equal(system.model, "test-model");
    assert.equal(system.version, 1);
    assert.deepEqual(asDesignSystem(JSON.parse(JSON.stringify(system))), system);
  });
});

describe("exporters", () => {
  const system = designSystemFromSample(aggregateSnapshots(referencePins()), {
    generatedAt: "2026-09-08T10:00:00.000Z",
    identity: "Blue, quiet, functional.",
    names: { colors: { "#0069a8": "primary" }, typography: { "16px": "body" } },
  });

  test("W3C tokens parse and every token carries $type and $value", () => {
    // ACT
    const parsed: unknown = JSON.parse(toW3cTokens(system));

    // ASSERT
    assert.ok(typeof parsed === "object" && parsed !== null);
    const groups = parsed as Record<string, Record<string, Record<string, unknown>>>;
    assert.deepEqual(Object.keys(groups).sort(), ["color", "fontFamily", "fontSize", "radius", "shadow", "spacing"]);
    for (const tokens of Object.values(groups)) {
      for (const token of Object.values(tokens)) {
        assert.equal(typeof token.$type, "string");
        assert.notEqual(token.$value, undefined);
      }
    }
    assert.deepEqual(groups.color.primary, { $type: "color", $value: "#0069a8" });
    assert.deepEqual(groups.fontSize.body, { $type: "dimension", $value: { unit: "px", value: 16 } });
    assert.deepEqual(groups.shadow.xs, {
      $type: "shadow",
      $value: [{ blur: { unit: "px", value: 2 }, color: "#0000001a", offsetX: { unit: "px", value: 0 }, offsetY: { unit: "px", value: 1 }, spread: { unit: "px", value: 0 } }],
    });
  });

  test("CSS custom properties parse as :root declarations", () => {
    // ACT
    const css = toCssVariables(system);

    // ASSERT
    const match = css.match(/^:root \{\n([\s\S]*)\}\n$/);
    assert.ok(match);
    const lines = match[1].trimEnd().split("\n");
    for (const line of lines) assert.match(line, /^ {2}--[a-z0-9-]+: [^;]+;$/);
    assert.ok(lines.includes("  --color-primary: #0069a8;"));
    assert.ok(lines.includes("  --font-sans: Inter;"));
    assert.ok(lines.includes("  --text-body: 16px;"));
    assert.ok(lines.includes("  --spacing-2: 8px;"));
    assert.ok(lines.includes("  --radius-xs: 8px;"));
  });

  test("Tailwind theme starts with @theme and repeats the variables", () => {
    // ACT
    const theme = toTailwindTheme(system);

    // ASSERT
    assert.ok(theme.startsWith("@theme {\n"));
    assert.ok(theme.endsWith("}\n"));
    assert.match(theme, /--color-primary: #0069a8;/);
    assert.match(theme, /--font-sans: Inter;/);
  });

  test("DESIGN.md carries the title, identity, sections, sample and timestamp", () => {
    // ACT
    const markdown = toDesignMarkdown(system);

    // ASSERT
    assert.ok(markdown.startsWith("# acme.test design system\n"));
    assert.match(markdown, /Blue, quiet, functional\./);
    for (const section of ["## Colors", "## Typography", "## Spacing", "## Radii", "## Shadows", "## Fonts"]) {
      assert.ok(markdown.includes(`\n${section}\n`), section);
    }
    assert.match(markdown, /\| primary \| #0069a8 \|/);
    assert.match(markdown, /Sample: 10 pins across 4 pages on acme\.test\./);
    assert.match(markdown, /Generated: 2026-09-08T10:00:00\.000Z\./);
  });
});
