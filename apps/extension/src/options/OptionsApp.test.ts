import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
// Module mocks exist only in Bun, which runs this file (bun test), and the
// root tsconfig carries Node types alone.
// @ts-expect-error -- bun:test resolves only under the Bun runtime
import { mock } from "bun:test";
import { translations } from "@pinar/shared";

// Headless rendering of the real components: only the icon virtual modules,
// which resolve under Vite alone, become empty components. The real Cascader
// is wrapped to record its props, so a test reads what the field asked for
// and selects through the real handler; Bun shares module mocks across the
// run, so the wrapper keeps the real exports and is put back after this file.
const ROOTS = [new URL("..", import.meta.url).pathname, new URL("../../../../packages/ui/src", import.meta.url).pathname];
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}
for (const spec of new Set(ROOTS.flatMap(sourceFiles).flatMap((file) => readFileSync(file, "utf8").match(/~icons\/[a-z0-9-]+\/[a-z0-9-]+/g) ?? []))) {
  mock.module(spec, () => ({ default: () => null }));
}

const ui = { ...(await import("@pinar/ui")) };
type CascaderProps = ComponentProps<typeof ui.Cascader>;
let cascader: CascaderProps | null = null;
mock.module("@pinar/ui", () => ({
  ...ui,
  Cascader: (props: CascaderProps) => {
    cascader = props;
    return createElement(ui.Cascader, props);
  },
}));
after(() => {
  mock.module("@pinar/ui", () => ui);
});

const { CaptureDestinationField } = await import("./OptionsApp");

const OPTIONS = [{ children: [{ label: "Design", value: "design" }], label: "Personal", value: "personal" }];

function render(props: Partial<Parameters<typeof CaptureDestinationField>[0]> = {}) {
  cascader = null;
  const selected: string[] = [];
  const html = renderToStaticMarkup(createElement(CaptureDestinationField, {
    automatic: false,
    empty: false,
    loading: false,
    options: OPTIONS,
    t: translations.en,
    value: ["personal", "design"],
    onSelect: (collectionId: string) => selected.push(collectionId),
    ...props,
  }));
  if (!cascader) throw new Error("the field rendered no cascader");
  // The real trigger carries the disabled attribute, not only a style.
  const trigger = html.match(/<button[^>]*role="combobox"[^>]*>/)?.[0] ?? "";
  return { disabledAttribute: / disabled=""/.test(trigger), field: cascader as CascaderProps, html, selected };
}

describe("options capture destination field", () => {
  test("automatic: disabled and reading Automatic instead of the cached collection", () => {
    const { disabledAttribute, field, html } = render({ automatic: true });
    assert.equal(field.disabled, true);
    assert.equal(disabledAttribute, true);
    assert.equal(field.value, null);
    assert.equal(field.placeholder, translations.en.capture_destination_automatic);
    assert.match(html, />Automatic</);
    assert.doesNotMatch(html, /Design/);
    assert.equal(render({ automatic: true, t: translations.pt }).field.placeholder, "Automático");
  });

  test("manual: enabled with the cached collection, and a choice reaches onSelect", () => {
    const { disabledAttribute, field, html, selected } = render();
    assert.equal(field.disabled, false);
    assert.equal(disabledAttribute, false);
    assert.deepEqual(field.value, ["personal", "design"]);
    assert.equal(field.placeholder, translations.en.collection_label);
    assert.match(html, /Personal \/ Design/);
    field.onValueChange(["personal", "design"], []);
    assert.deepEqual(selected, ["design"]);
  });

  test("automatic wins over a loading or empty field", () => {
    assert.equal(render({ automatic: true, loading: true }).field.placeholder, translations.en.capture_destination_automatic);
    assert.equal(render({ empty: true }).field.disabled, true);
    assert.equal(render({ loading: true }).field.placeholder, "…");
  });
});
