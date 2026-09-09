import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ComponentFile, ElementSnapshot, Pin, PinComponent, Session } from "@pinar/shared";
import {
  componentBundleFiles,
  componentPromptInput,
  crc32,
  fontLink,
  iconifyId,
  parseComponentOutput,
  stackblitzForm,
  storeZip,
} from "./component-export";

function snapshot(overrides: Partial<ElementSnapshot> = {}): ElementSnapshot {
  return {
    fonts: [{ family: "Inter", src: "https://fonts.gstatic.com/s/inter/v13/inter.woff2", weight: "600" }],
    icons: [{ kind: "class", name: "lucide-arrow-right" }],
    nodeCount: 3,
    root: {
      attrs: { class: "card" },
      children: [
        { styles: { "font-size": "18px" }, tag: "h3", text: "Plan" },
        { attrs: { "aria-label": "Continue" }, tag: "button", text: "Continue" },
      ],
      styles: { "background-color": "rgb(255, 255, 255)", padding: "24px" },
      tag: "article",
    },
    truncated: false,
    version: 1,
    ...overrides,
  };
}

function pin(overrides: Partial<Pin> = {}): Pin {
  return {
    box: { height: 120.4, width: 320.6, x: 40.2, y: 80.7 },
    comment: "Extract this card",
    coords: { x: 50, y: 90 },
    number: 1,
    pinId: "pin_card",
    snapshot: snapshot(),
    type: "point",
    ...overrides,
  };
}

function session(): Session {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    id: "session_1",
    page: { title: "Pricing", url: "https://example.test/pricing" },
    pins: [pin()],
  };
}

function reply(files: Record<string, string>, tail = "===DEPENDENCIES===\n(none)\n===NOTES===\n(none)") {
  return `${Object.entries(files).map(([path, content]) => `===FILE: ${path}===\n${content}\n===END===`).join("\n")}\n${tail}`;
}

const PREVIEW = "<!doctype html><html><head><style>.card{padding:24px}</style></head><body><article class=\"card\">Plan</article></body></html>";

describe("iconifyId", () => {
  test("maps known icon class prefixes to Iconify ids", () => {
    assert.equal(iconifyId({ kind: "class", name: "lucide-arrow-right" }).iconify, "lucide:arrow-right");
    assert.equal(iconifyId({ kind: "class", name: "fas fa-check" }).iconify, "fa6-solid:check");
    assert.equal(iconifyId({ kind: "class", name: "far fa-heart" }).iconify, "fa6-regular:heart");
    assert.equal(iconifyId({ kind: "class", name: "fa-check" }).iconify, "fa6-solid:check");
    assert.equal(iconifyId({ kind: "class", name: "material-icons arrow_forward" }).iconify, "material-symbols:arrow-forward");
    assert.equal(iconifyId({ kind: "class", name: "bi-x" }).iconify, "bi:x");
    assert.equal(iconifyId({ kind: "class", name: "ph-x" }).iconify, "ph:x");
    assert.equal(iconifyId({ kind: "class", name: "ri-x" }).iconify, "ri:x");
    assert.equal(iconifyId({ kind: "class", name: "tabler-icon-x" }).iconify, "tabler:x");
    assert.equal(iconifyId({ kind: "class", name: "heroicon-home" }).iconify, "heroicons:home");
    assert.equal(iconifyId({ kind: "class", name: "mdi-home" }).iconify, "mdi:home");
  });

  test("keeps unknown classes with a note", () => {
    const result = iconifyId({ kind: "class", name: "icon icon-custom" });
    assert.equal(result.iconify, undefined);
    assert.equal(result.name, "icon icon-custom");
    assert.match(result.note ?? "", /unknown icon class/);
  });
});

describe("fontLink", () => {
  test("turns Google and Fontshare sources into stylesheet links", () => {
    assert.equal(
      fontLink({ family: "Inter", src: "https://fonts.gstatic.com/s/inter/v13/inter.woff2", weight: "600" }).link,
      "https://fonts.googleapis.com/css2?family=Inter:wght@600&display=swap",
    );
    assert.equal(
      fontLink({ family: "Open Sans", src: "https://fonts.googleapis.com/css2?family=Open+Sans" }).link,
      "https://fonts.googleapis.com/css2?family=Open+Sans&display=swap",
    );
    assert.equal(
      fontLink({ family: "Satoshi", src: "https://api.fontshare.com/v2/fonts/satoshi/satoshi.woff2", weight: "700" }).link,
      "https://api.fontshare.com/v2/css?f[]=satoshi@700&display=swap",
    );
  });

  test("marks self-hosted fonts for substitution", () => {
    const result = fontLink({ family: "Brand Sans", src: "https://cdn.example.test/brand.woff2" });
    assert.equal(result.link, undefined);
    assert.match(result.note ?? "", /self-hosted/);
  });
});

describe("componentPromptInput", () => {
  test("carries the snapshot, mapped assets, rounded box and target", () => {
    const input = componentPromptInput(pin(), session(), "react-tailwind");

    assert.ok(input);
    assert.equal(input.target, "react-tailwind");
    assert.equal(input.snapshot.root.tag, "article");
    assert.equal(input.snapshot.root.children?.length, 2);
    assert.deepEqual(input.box, { height: 120, width: 321, x: 40, y: 81 });
    assert.equal(input.icons[0].iconify, "lucide:arrow-right");
    assert.match(input.fonts[0].link ?? "", /fonts\.googleapis\.com/);
    assert.equal(input.page.url, "https://example.test/pricing");
    assert.equal(input.comment, "Extract this card");
  });

  test("returns null without a snapshot and bounds oversized trees", () => {
    assert.equal(componentPromptInput(pin({ snapshot: undefined }), session(), "html"), null);
    const wide = snapshot({
      root: {
        children: Array.from({ length: 400 }, (_, index) => ({ tag: "li", text: `Item ${index} ${"x".repeat(150)}` })),
        tag: "ul",
      },
    });
    const input = componentPromptInput(pin({ snapshot: wide }), session(), "html");
    assert.ok(input);
    assert.ok((input.snapshot.root.children?.length ?? 0) < 400);
    assert.equal(input.snapshot.truncated, true);
    assert.ok(JSON.stringify(input).length < 40_000);
  });
});

describe("parseComponentOutput", () => {
  test("parses html target files, dependencies and notes", () => {
    const text = reply({
      "component.css": ".card { padding: 24px; }",
      "component.html": "<article class=\"card\">Plan</article>",
      "preview.html": PREVIEW,
    }, "===DEPENDENCIES===\nhttps://code.iconify.design/iconify-icon/2.1.0/iconify-icon.min.js\n===NOTES===\n- Inter loaded from Google Fonts\nIcon guessed");

    const component = parseComponentOutput(text, "html", "@cf/qwen/qwen2.5-coder-32b-instruct");

    assert.ok(component);
    assert.equal(component.target, "html");
    assert.equal(component.model, "@cf/qwen/qwen2.5-coder-32b-instruct");
    assert.equal(component.preview, PREVIEW);
    assert.deepEqual(component.files.map((file) => file.path), ["component.css", "component.html"]);
    assert.deepEqual(component.dependencies, ["https://code.iconify.design/iconify-icon/2.1.0/iconify-icon.min.js"]);
    assert.deepEqual(component.notes, ["Inter loaded from Google Fonts", "Icon guessed"]);
  });

  test("accepts react and preact targets, tolerating an outer fence", () => {
    const react = parseComponentOutput(`\`\`\`\n${reply({ "Component.tsx": "export default function Component() { return <div />; }", "preview.html": PREVIEW })}\n\`\`\``, "react-tailwind");
    assert.ok(react);
    assert.equal(react.files[0].path, "Component.tsx");
    const preact = parseComponentOutput(reply({ "component.js": "export function Component() {}", "preview.html": PREVIEW }), "preact-htm");
    assert.ok(preact);
    assert.equal(preact.files[0].path, "component.js");
  });

  test("rejects empty, malformed, incomplete or scripted replies", () => {
    assert.equal(parseComponentOutput("", "html"), null);
    assert.equal(parseComponentOutput("Here is your component: <div />", "html"), null);
    assert.equal(parseComponentOutput(reply({ "component.html": "<div />", "preview.html": PREVIEW }), "html"), null);
    assert.equal(parseComponentOutput(reply({ "component.css": ".a{}", "component.html": "<div />" }), "html"), null);
    assert.equal(parseComponentOutput(reply({ "Component.tsx": "x", "preview.html": "<html><script>alert(1)</script></html>" }), "react-tailwind"), null);
    assert.equal(parseComponentOutput(reply({ "component.js": "x", "preview.html": PREVIEW }), "react-tailwind"), null);
  });
});

function component(target: PinComponent["target"], files: ComponentFile[]): PinComponent {
  return {
    dependencies: [],
    files,
    generatedAt: "2026-01-01T00:00:00.000Z",
    notes: [],
    preview: PREVIEW,
    target,
    version: 1,
  };
}

describe("stackblitzForm", () => {
  test("uses the html template with the preview as index.html", () => {
    const fields = stackblitzForm(component("html", [{ content: "<div />", path: "component.html" }, { content: ".a{}", path: "component.css" }]));
    assert.equal(fields["project[template]"], "html");
    assert.equal(fields["project[files][index.html]"], PREVIEW);
    assert.equal(fields["project[files][component.css]"], ".a{}");
    assert.match(fields["project[title]"], /html/);
  });

  test("scaffolds a Vite project for react-tailwind and a mount for preact-htm", () => {
    const react = stackblitzForm(component("react-tailwind", [{ content: "export default function Component() {}", path: "Component.tsx" }]));
    assert.equal(react["project[template]"], "node");
    assert.match(react["project[files][package.json]"], /"@iconify\/react"/);
    assert.equal(react["project[files][src/Component.tsx]"], "export default function Component() {}");
    assert.match(react["project[files][src/main.tsx]"], /from "\.\/Component"/);
    const preact = stackblitzForm(component("preact-htm", [{ content: "export function Component() {}", path: "component.js" }]));
    assert.equal(preact["project[template]"], "javascript");
    assert.match(preact["project[files][index.html]"], /<div id="app"><\/div>/);
    assert.match(preact["project[files][index.js]"], /from "\.\/component\.js"/);
  });
});

interface ZipEntry {
  crc: number;
  data: string;
  name: string;
  offset: number;
}

function readZip(zip: Uint8Array) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const decoder = new TextDecoder();
  const endOffset = zip.length - 22;
  assert.equal(view.getUint32(endOffset, true), 0x06054b50);
  const entryCount = view.getUint16(endOffset + 10, true);
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  assert.equal(centralOffset + centralSize, endOffset);
  const entries: ZipEntry[] = [];
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(view.getUint32(cursor, true), 0x02014b50);
    assert.equal(view.getUint16(cursor + 10, true), 0);
    const crc = view.getUint32(cursor + 16, true);
    const size = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const offset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(zip.subarray(cursor + 46, cursor + 46 + nameLength));
    assert.equal(view.getUint32(offset, true), 0x04034b50);
    assert.equal(view.getUint32(offset + 14, true), crc);
    const localNameLength = view.getUint16(offset + 26, true);
    assert.equal(decoder.decode(zip.subarray(offset + 30, offset + 30 + localNameLength)), name);
    const dataStart = offset + 30 + localNameLength;
    const bytes = zip.subarray(dataStart, dataStart + size);
    assert.equal(crc32(bytes), crc);
    entries.push({ crc, data: decoder.decode(bytes), name, offset });
    cursor += 46 + nameLength;
  }
  return entries;
}

describe("storeZip", () => {
  test("writes STORE entries that read back through the central directory", () => {
    const files: ComponentFile[] = [
      { content: "<article class=\"card\">Olá</article>\n", path: "component.html" },
      { content: ".card { padding: 24px; }\n", path: "styles/component.css" },
    ];

    const entries = readZip(storeZip(files, new Date("2026-03-04T05:06:08Z")));

    assert.deepEqual(entries.map((entry) => entry.name), ["component.html", "styles/component.css"]);
    assert.equal(entries[0].data, files[0].content);
    assert.equal(entries[1].data, files[1].content);
    assert.equal(entries[0].offset, 0);
  });

  test("computes the standard CRC-32 and bundles the preview", () => {
    assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
    const files = componentBundleFiles(component("html", [{ content: "<div />", path: "component.html" }]));
    assert.deepEqual(files.map((file) => file.path), ["component.html", "preview.html"]);
    assert.equal(readZip(storeZip(files)).length, 2);
  });
});
