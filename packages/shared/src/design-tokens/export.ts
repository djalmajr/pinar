import { parseColor, pxValues } from "./aggregate.ts";
import type { DesignSystem, DesignSystemExports, DesignToken } from "./types.ts";

interface W3cToken {
  $type: string;
  $value: unknown;
}

interface W3cShadowLayer {
  blur: W3cDimension;
  color: string;
  inset?: boolean;
  offsetX: W3cDimension;
  offsetY: W3cDimension;
  spread: W3cDimension;
}

interface W3cDimension {
  unit: "px";
  value: number;
}

function dimension(value: string): W3cDimension | string {
  const [px] = pxValues(value);
  return px === undefined ? value : { unit: "px", value: px };
}

function toDimension(value: number): W3cDimension {
  return { unit: "px", value };
}

/** One CSS shadow layer into the 2024 Design Tokens shadow shape; null when it is not plain lengths + color. */
function parseShadowLayer(layer: string): W3cShadowLayer | null {
  const colorMatch = layer.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}\b/i);
  const color = colorMatch ? parseColor(colorMatch[0]) : null;
  if (!color) return null;
  const rest = layer.replace(colorMatch?.[0] ?? "", " ");
  const inset = /\binset\b/.test(rest);
  const lengths = pxValues(rest.replace(/\binset\b/, " "));
  if (lengths.length < 2 || lengths.length > 4) return null;
  const [offsetX, offsetY, blur = 0, spread = 0] = lengths;
  const hex = `#${[color.r, color.g, color.b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  const alpha = color.a < 0.995 ? Math.round(color.a * 255).toString(16).padStart(2, "0") : "";
  const parsed: W3cShadowLayer = {
    blur: toDimension(blur),
    color: `${hex}${alpha}`,
    offsetX: toDimension(offsetX),
    offsetY: toDimension(offsetY),
    spread: toDimension(spread),
  };
  if (inset) parsed.inset = true;
  return parsed;
}

function splitShadowLayers(value: string) {
  return value.split(/,(?![^(]*\))/).map((layer) => layer.trim()).filter(Boolean);
}

function shadowValue(value: string): W3cShadowLayer[] | string {
  const layers = splitShadowLayers(value).map(parseShadowLayer);
  if (!layers.length || layers.some((layer) => layer === null)) return value;
  return layers.filter((layer): layer is W3cShadowLayer => layer !== null);
}

function group(tokens: DesignToken[], type: string, value: (token: DesignToken) => unknown) {
  const entries: Record<string, W3cToken> = {};
  for (const token of tokens) entries[token.name] = { $type: type, $value: value(token) };
  return entries;
}

/** W3C Design Tokens (2024 community group draft) as pretty JSON. */
export function toW3cTokens(system: DesignSystem) {
  const tokens = {
    color: group(system.colors, "color", (token) => token.value),
    fontFamily: group(system.fonts, "fontFamily", (token) => token.value),
    fontSize: group(system.typography, "dimension", (token) => dimension(token.value)),
    radius: group(system.radii, "dimension", (token) => dimension(token.value)),
    shadow: group(system.shadows, "shadow", (token) => shadowValue(token.value)),
    spacing: group(system.spacing, "dimension", (token) => dimension(token.value)),
  };
  return `${JSON.stringify(tokens, null, 2)}\n`;
}

function cssFontValue(family: string) {
  return /^[a-z0-9-]+$/i.test(family) ? family : `"${family.replaceAll('"', '\\"')}"`;
}

function cssLines(system: DesignSystem) {
  const lines: string[] = [];
  for (const token of system.colors) lines.push(`--color-${token.name}: ${token.value};`);
  for (const token of system.fonts) lines.push(`--font-${token.name}: ${cssFontValue(token.value)};`);
  for (const token of system.typography) lines.push(`--text-${token.name.replace(/^text-/, "")}: ${token.value};`);
  for (const token of system.spacing) lines.push(`--spacing-${token.name}: ${token.value};`);
  for (const token of system.radii) lines.push(`--radius-${token.name}: ${token.value};`);
  for (const token of system.shadows) lines.push(`--shadow-${token.name}: ${token.value};`);
  return lines;
}

/** `:root { --color-primary: #0069a8; ... }` */
export function toCssVariables(system: DesignSystem) {
  return `:root {\n${cssLines(system).map((line) => `  ${line}`).join("\n")}\n}\n`;
}

/** Tailwind v4 `@theme` block with the same variables. */
export function toTailwindTheme(system: DesignSystem) {
  return `@theme {\n${cssLines(system).map((line) => `  ${line}`).join("\n")}\n}\n`;
}

function cell(value: string | number | undefined) {
  return String(value ?? "").replaceAll("|", "\\|");
}

function table(headers: string[], rows: Array<Array<string | number | undefined>>) {
  if (!rows.length) return "_No values sampled._";
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ].join("\n");
}

/**
 * DESIGN.md: title, identity, one table per category, the sample that backed
 * it and the generation timestamp.
 */
export function toDesignMarkdown(system: DesignSystem) {
  const title = system.sample.domain || "Design system";
  const sections = [
    `# ${title} design system`,
    "",
    system.identity?.trim() || "_No identity written for this sample._",
    "",
    "## Colors",
    "",
    table(["Token", "Value", "Role", "Uses"], system.colors.map((token) => [token.name, token.value, token.role, token.count])),
    "",
    "## Typography",
    "",
    table(["Token", "Size", "Line height", "Weight", "Uses"], system.typography.map((token) => [token.name, token.value, token.lineHeight, token.weight, token.count])),
    "",
    "## Spacing",
    "",
    table(["Token", "Value", "Uses"], system.spacing.map((token) => [token.name, token.value, token.count])),
    "",
    "## Radii",
    "",
    table(["Token", "Value", "Uses"], system.radii.map((token) => [token.name, token.value, token.count])),
    "",
    "## Shadows",
    "",
    table(["Token", "Value", "Uses"], system.shadows.map((token) => [token.name, token.value, token.count])),
    "",
    "## Fonts",
    "",
    table(["Token", "Family", "Weights", "Uses"], system.fonts.map((token) => [token.name, token.value, token.weights.join(", "), token.count])),
    "",
  ];
  if (system.warnings.length) {
    sections.push("## Warnings", "", ...system.warnings.map((warning) => `- ${warning}`), "");
  }
  sections.push(
    `Sample: ${system.sample.pins} pins across ${system.sample.pages} pages on ${system.sample.domain || "unknown domain"}.`,
    "",
    `Generated: ${system.generatedAt}${system.model ? ` with ${system.model}` : ""}.`,
    "",
  );
  return sections.join("\n");
}

export function designSystemExports(system: DesignSystem): DesignSystemExports {
  return {
    css: toCssVariables(system),
    markdown: toDesignMarkdown(system),
    tailwind: toTailwindTheme(system),
    tokens: toW3cTokens(system),
  };
}
