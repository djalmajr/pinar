/**
 * Pure helpers for "save pin as component": the bounded prompt payload built
 * from a pin snapshot, the parser for the model's delimited reply, the
 * StackBlitz form fields and a dependency-free STORE zip writer.
 */
import {
  asPinComponent,
  type ComponentFile,
  type ComponentTarget,
  type ElementSnapshot,
  type Pin,
  type PinComponent,
  type Session,
  type SnapshotFont,
  type SnapshotIcon,
  type SnapshotNode,
} from "@pinar/shared";

export const COMPONENT_EXPORT_CREDITS = 10;

/** Source files the model must return per target, besides `preview.html`. */
export const COMPONENT_TARGET_FILES: Record<ComponentTarget, string[]> = {
  html: ["component.html", "component.css"],
  "preact-htm": ["component.js"],
  "react-tailwind": ["Component.tsx"],
};

export const COMPONENT_PREVIEW_FILE = "preview.html";

const PROMPT_LIMITS = {
  maxContextChars: 6_000,
  maxRootChars: 28_000,
  maxStyleValue: 160,
  maxText: 200,
} as const;

export interface PromptIcon {
  iconify?: string;
  name: string;
  note?: string;
}

export interface PromptFont {
  family: string;
  link?: string;
  note?: string;
  style?: string;
  weight?: string;
}

export interface ComponentPromptInput {
  box?: { height: number; width: number; x: number; y: number };
  comment: string;
  fonts: PromptFont[];
  icons: PromptIcon[];
  page: { title: string; url: string };
  snapshot: {
    context?: { parent?: SnapshotNode; siblings?: SnapshotNode[] };
    root: SnapshotNode;
    truncated: boolean;
  };
  target: ComponentTarget;
}

interface IconPrefixRule {
  prefix: string;
  /** Iconify collection id. */
  set: string;
}

const ICON_PREFIX_RULES: IconPrefixRule[] = [
  { prefix: "lucide-", set: "lucide" },
  { prefix: "tabler-icon-", set: "tabler" },
  { prefix: "ti-", set: "tabler" },
  { prefix: "bi-", set: "bi" },
  { prefix: "ph-", set: "ph" },
  { prefix: "ri-", set: "ri" },
  { prefix: "mdi-", set: "mdi" },
  { prefix: "heroicon-", set: "heroicons" },
  { prefix: "heroicons-", set: "heroicons" },
  { prefix: "material-symbols-", set: "material-symbols" },
];

const FONT_AWESOME_STYLES: Record<string, string> = {
  fab: "fa6-brands",
  far: "fa6-regular",
  fas: "fa6-solid",
};

function iconNameFromClasses(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/**
 * Maps a captured icon class list (or Material ligature text) to an Iconify
 * id. Unknown classes are kept verbatim with a note so the model can decide.
 */
export function iconifyId(icon: SnapshotIcon): PromptIcon {
  const name = iconNameFromClasses(icon.name);
  if (icon.kind === "svg") return { name, note: "inline svg; reuse the markup from the snapshot" };
  const tokens = name.split(" ").filter(Boolean);
  const lower = tokens.map((token) => token.toLowerCase());

  const materialIndex = lower.findIndex((token) => token === "material-icons" || token.startsWith("material-icons-") || token === "material-symbols-outlined" || token === "material-symbols-rounded" || token === "material-symbols-sharp");
  if (materialIndex >= 0) {
    const ligature = tokens.filter((_, index) => index !== materialIndex).find((token) => /^[a-z0-9_]+$/i.test(token));
    if (ligature) return { iconify: `material-symbols:${ligature.toLowerCase().replaceAll("_", "-")}`, name };
    return { name, note: "material icon without a ligature name; substitute" };
  }

  const faStyle = lower.find((token) => token in FONT_AWESOME_STYLES);
  const faName = lower.find((token) => token.startsWith("fa-") && token !== "fa-fw" && !/^fa-(xs|sm|lg|\dx|spin|pulse|solid|regular|brands)$/.test(token));
  if (faName) {
    const set = faStyle ? FONT_AWESOME_STYLES[faStyle] : "fa6-solid";
    return { iconify: `${set}:${faName.slice(3)}`, name };
  }

  for (const token of lower) {
    for (const rule of ICON_PREFIX_RULES) {
      if (token.startsWith(rule.prefix) && token.length > rule.prefix.length) {
        return { iconify: `${rule.set}:${token.slice(rule.prefix.length)}`, name };
      }
    }
    if (token.startsWith("i-")) {
      const [set, ...rest] = token.slice(2).split("-");
      if (set && rest.length) return { iconify: `${set}:${rest.join("-")}`, name };
    }
  }
  return { name, note: "unknown icon class; pick the closest Iconify icon" };
}

/** Resolves a captured font-face into a stylesheet link or a substitution note. */
export function fontLink(font: SnapshotFont): PromptFont {
  const result: PromptFont = { family: font.family };
  if (font.weight) result.weight = font.weight;
  if (font.style) result.style = font.style;
  const src = font.src ?? "";
  let host = "";
  try {
    host = src ? new URL(src).hostname : "";
  } catch {
    host = "";
  }
  const family = encodeURIComponent(font.family).replaceAll("%20", "+");
  if (host === "fonts.googleapis.com" || host === "fonts.gstatic.com") {
    const weight = font.weight && /^\d{3}$/.test(font.weight) ? font.weight : "";
    const axis = weight ? `:${font.style === "italic" ? "ital," : ""}wght@${font.style === "italic" ? "1," : ""}${weight}` : "";
    result.link = `https://fonts.googleapis.com/css2?family=${family}${axis}&display=swap`;
    return result;
  }
  if (host === "api.fontshare.com" || host === "fontshare.com" || host.endsWith(".fontshare.com")) {
    const weight = font.weight && /^\d{3}$/.test(font.weight) ? `@${font.weight}` : "";
    result.link = `https://api.fontshare.com/v2/css?f[]=${font.family.toLowerCase().replace(/\s+/g, "-")}${weight}&display=swap`;
    return result;
  }
  result.note = src ? "self-hosted font; substitute with a similar system or Google font" : "system font";
  return result;
}

interface CharBudget {
  chars: number;
}

function boundNode(node: SnapshotNode, budget: CharBudget): SnapshotNode {
  const copy: SnapshotNode = { tag: node.tag };
  budget.chars -= node.tag.length + 12;
  if (node.attrs) {
    copy.attrs = {};
    for (const [key, value] of Object.entries(node.attrs)) {
      const bounded = value.slice(0, PROMPT_LIMITS.maxStyleValue);
      copy.attrs[key] = bounded;
      budget.chars -= key.length + bounded.length + 6;
    }
  }
  if (node.styles) {
    copy.styles = {};
    for (const [key, value] of Object.entries(node.styles)) {
      const bounded = value.slice(0, PROMPT_LIMITS.maxStyleValue);
      copy.styles[key] = bounded;
      budget.chars -= key.length + bounded.length + 6;
    }
  }
  if (node.text) {
    copy.text = node.text.slice(0, PROMPT_LIMITS.maxText);
    budget.chars -= copy.text.length + 10;
  }
  if (node.svg) {
    copy.svg = node.svg;
    budget.chars -= node.svg.length + 8;
  }
  if (node.truncated) copy.truncated = true;
  if (node.children?.length) {
    const children: SnapshotNode[] = [];
    for (const child of node.children) {
      if (budget.chars <= 0) {
        copy.truncated = true;
        break;
      }
      children.push(boundNode(child, budget));
    }
    if (children.length) copy.children = children;
  }
  return copy;
}

function boundedContext(snapshot: ElementSnapshot) {
  const context = snapshot.context;
  if (!context) return undefined;
  const budget: CharBudget = { chars: PROMPT_LIMITS.maxContextChars };
  const result: { parent?: SnapshotNode; siblings?: SnapshotNode[] } = {};
  if (context.parent) result.parent = boundNode(context.parent, budget);
  if (context.siblings?.length) {
    const siblings: SnapshotNode[] = [];
    for (const sibling of context.siblings) {
      if (budget.chars <= 0) break;
      siblings.push(boundNode(sibling, budget));
    }
    if (siblings.length) result.siblings = siblings;
  }
  return result.parent || result.siblings ? result : undefined;
}

/** Builds the bounded, model-facing description of the captured element. */
export function componentPromptInput(pin: Pin, session: Session, target: ComponentTarget): ComponentPromptInput | null {
  const snapshot = pin.snapshot;
  if (!snapshot) return null;
  const rootBudget: CharBudget = { chars: PROMPT_LIMITS.maxRootChars };
  const root = boundNode(snapshot.root, rootBudget);
  const box = pin.box ?? pin.areaBox ?? pin.documentBox;
  const input: ComponentPromptInput = {
    comment: pin.comment.slice(0, 500),
    fonts: snapshot.fonts.slice(0, 12).map(fontLink),
    icons: snapshot.icons.slice(0, 40).map(iconifyId),
    page: { title: session.page.title.slice(0, 200), url: session.page.url.slice(0, 500) },
    snapshot: {
      root,
      truncated: snapshot.truncated || rootBudget.chars <= 0,
    },
    target,
  };
  const context = boundedContext(snapshot);
  if (context) input.snapshot.context = context;
  if (box) {
    input.box = {
      height: Math.round(box.height),
      width: Math.round(box.width),
      x: Math.round(box.x),
      y: Math.round(box.y),
    };
  }
  return input;
}

const FILE_BLOCK = /===FILE:\s*([^\n=]+?)\s*===\r?\n([\s\S]*?)\r?\n?===END===/g;

function sectionLines(text: string, marker: string) {
  const start = text.indexOf(`===${marker}===`);
  if (start < 0) return [];
  const bodyStart = start + marker.length + 6;
  const rest = text.slice(bodyStart);
  const nextMarker = rest.search(/\n===[A-Z]+(?::[^\n]*)?===/);
  const body = nextMarker >= 0 ? rest.slice(0, nextMarker) : rest;
  return body
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
    .filter((line) => line && line !== "(none)" && line.toLowerCase() !== "none");
}

function stripOuterFence(text: string) {
  const trimmed = text.trim();
  const match = trimmed.match(/^```[a-z]*\r?\n([\s\S]*?)\r?\n```$/i);
  return match ? match[1] : trimmed;
}

/**
 * Parses the delimited reply (`===FILE: path===` blocks, then
 * `===DEPENDENCIES===` and `===NOTES===` lines). Returns null when the reply
 * is empty, malformed, misses a required file or ships scripts in the preview.
 */
export function parseComponentOutput(text: string, target: ComponentTarget, model?: string): PinComponent | null {
  if (!text || !text.trim()) return null;
  const body = stripOuterFence(text);
  const files: ComponentFile[] = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(FILE_BLOCK)) {
    const path = match[1].trim().replace(/^\.\//, "");
    const content = match[2].replace(/\s+$/, "");
    if (!path || !content.trim() || seen.has(path)) continue;
    seen.add(path);
    files.push({ content, path });
  }
  if (!files.length) return null;
  const preview = files.find((file) => file.path === COMPONENT_PREVIEW_FILE);
  if (!preview || /<script[\s>]/i.test(preview.content)) return null;
  for (const required of COMPONENT_TARGET_FILES[target]) {
    if (!files.some((file) => file.path === required)) return null;
  }
  const component = asPinComponent({
    dependencies: sectionLines(body, "DEPENDENCIES"),
    files: files.filter((file) => file.path !== COMPONENT_PREVIEW_FILE),
    generatedAt: new Date().toISOString(),
    model,
    notes: sectionLines(body, "NOTES"),
    preview: preview.content,
    target,
    version: 1,
  });
  return component ?? null;
}

const REACT_PACKAGE_JSON = {
  dependencies: {
    "@iconify/react": "^5.2.1",
    react: "^19.1.0",
    "react-dom": "^19.1.0",
  },
  devDependencies: {
    "@tailwindcss/vite": "^4.1.0",
    "@vitejs/plugin-react": "^4.5.0",
    tailwindcss: "^4.1.0",
    typescript: "^5.8.0",
    vite: "^6.3.0",
  },
  name: "pinar-component",
  private: true,
  scripts: { dev: "vite", build: "vite build" },
  type: "module",
};

const REACT_SCAFFOLD: ComponentFile[] = [
  { content: JSON.stringify(REACT_PACKAGE_JSON, null, 2), path: "package.json" },
  {
    content: [
      "import react from \"@vitejs/plugin-react\";",
      "import tailwindcss from \"@tailwindcss/vite\";",
      "import { defineConfig } from \"vite\";",
      "",
      "export default defineConfig({ plugins: [react(), tailwindcss()] });",
      "",
    ].join("\n"),
    path: "vite.config.ts",
  },
  {
    content: [
      "<!doctype html>",
      "<html lang=\"en\">",
      "  <head>",
      "    <meta charset=\"utf-8\" />",
      "    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
      "    <title>Pinar component</title>",
      "  </head>",
      "  <body>",
      "    <div id=\"root\"></div>",
      "    <script type=\"module\" src=\"/src/main.tsx\"></script>",
      "  </body>",
      "</html>",
      "",
    ].join("\n"),
    path: "index.html",
  },
  { content: "@import \"tailwindcss\";\n", path: "src/index.css" },
  {
    content: [
      "import { createRoot } from \"react-dom/client\";",
      "import \"./index.css\";",
      "import Component from \"./Component\";",
      "",
      "createRoot(document.getElementById(\"root\")!).render(<Component />);",
      "",
    ].join("\n"),
    path: "src/main.tsx",
  },
  {
    content: JSON.stringify({
      compilerOptions: {
        jsx: "react-jsx",
        lib: ["DOM", "ES2022"],
        module: "ESNext",
        moduleResolution: "bundler",
        skipLibCheck: true,
        strict: true,
        target: "ES2022",
      },
      include: ["src"],
    }, null, 2),
    path: "tsconfig.json",
  },
];

const PREACT_SCAFFOLD: ComponentFile[] = [
  {
    content: [
      "import { h, render } from \"https://esm.sh/preact@10\";",
      "import { Component } from \"./component.js\";",
      "",
      "render(h(Component, {}), document.getElementById(\"app\"));",
      "",
    ].join("\n"),
    path: "index.js",
  },
];

function previewHead(component: PinComponent) {
  const head = component.preview?.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? "";
  return head.replace(/<title>[\s\S]*?<\/title>/i, "").trim();
}

function stackblitzTitle(component: PinComponent) {
  return `Pinar component (${component.target})`;
}

/** StackBlitz `POST https://stackblitz.com/run` form fields. */
export function stackblitzForm(component: PinComponent): Record<string, string> {
  const fields: Record<string, string> = { "project[title]": stackblitzTitle(component) };
  const files: ComponentFile[] = [];
  if (component.target === "html") {
    fields["project[template]"] = "html";
    if (component.preview) files.push({ content: component.preview, path: "index.html" });
    files.push(...component.files);
  } else if (component.target === "react-tailwind") {
    fields["project[template]"] = "node";
    files.push(...REACT_SCAFFOLD);
    for (const file of component.files) {
      files.push({ content: file.content, path: file.path.startsWith("src/") ? file.path : `src/${file.path}` });
    }
    if (component.preview) files.push({ content: component.preview, path: "preview.html" });
  } else {
    fields["project[template]"] = "javascript";
    const head = previewHead(component);
    files.push({
      content: [
        "<!doctype html>",
        "<html lang=\"en\">",
        "  <head>",
        "    <meta charset=\"utf-8\" />",
        "    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
        "    <title>Pinar component</title>",
        "    <script type=\"module\" src=\"https://cdn.jsdelivr.net/npm/iconify-icon@2/dist/iconify-icon.min.js\"></script>",
        head ? `    ${head}` : "",
        "  </head>",
        "  <body>",
        "    <div id=\"app\"></div>",
        "    <script type=\"module\" src=\"./index.js\"></script>",
        "  </body>",
        "</html>",
        "",
      ].filter((line) => line !== "").join("\n"),
      path: "index.html",
    });
    files.push(...PREACT_SCAFFOLD);
    files.push(...component.files);
    if (component.preview) files.push({ content: component.preview, path: "preview.html" });
  }
  const seen = new Set<string>();
  for (const file of files) {
    if (seen.has(file.path)) continue;
    seen.add(file.path);
    fields[`project[files][${file.path}]`] = file.content;
  }
  return fields;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date) {
  const year = Math.max(1980, date.getUTCFullYear());
  const dosTime = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  return { dosDate, dosTime };
}

/**
 * Minimal ZIP writer: STORE entries with CRC-32, UTF-8 names, a central
 * directory and the end record. Enough for browsers and every unzip tool.
 */
export function storeZip(files: ComponentFile[], now: Date = new Date()): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const { dosDate, dosTime } = dosDateTime(now);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.path);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length + data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, dosTime, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, 0, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, dosTime, true);
    centralView.setUint16(14, dosDate, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((total, entry) => total + entry.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true);
  const zip = new Uint8Array(offset + centralSize + 22);
  let cursor = 0;
  for (const chunk of [...locals, ...centrals, end]) {
    zip.set(chunk, cursor);
    cursor += chunk.length;
  }
  return zip;
}

/** Every file of a component, preview included, for downloads and zips. */
export function componentBundleFiles(component: PinComponent): ComponentFile[] {
  const files = [...component.files];
  if (component.preview) files.push({ content: component.preview, path: COMPONENT_PREVIEW_FILE });
  return files;
}
