import type { ElementSnapshot, SnapshotNode } from "../visual-context/fields.ts";
import {
  DESIGN_SYSTEM_VERSION,
  type AggregatedSample,
  type DesignSystem,
  type DesignSystemOptions,
  type DesignToken,
  type FontToken,
  type TypographyToken,
} from "./types.ts";

export interface SampledPin {
  snapshot: ElementSnapshot;
  url: string;
}

export const SAMPLE_LIMITS = {
  colors: 24,
  fonts: 6,
  radii: 8,
  shadows: 6,
  spacing: 12,
  typography: 12,
} as const;

/** Colors closer than this (Euclidean RGB distance) merge into the more frequent one. */
const COLOR_MERGE_DISTANCE = 6;
const COLOR_PROPERTIES = new Set([
  "background-color",
  "border-bottom-color",
  "border-color",
  "border-left-color",
  "border-right-color",
  "border-top-color",
  "color",
  "fill",
  "outline-color",
  "stroke",
]);
const SPACING_PROPERTIES = new Set([
  "column-gap",
  "gap",
  "margin",
  "margin-bottom",
  "margin-left",
  "margin-right",
  "margin-top",
  "padding",
  "padding-bottom",
  "padding-left",
  "padding-right",
  "padding-top",
  "row-gap",
]);
const TEXT_SCALE_BELOW = ["sm", "xs", "2xs", "3xs"];
const TEXT_SCALE_ABOVE = ["lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl"];
const SIZE_SCALE = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl"];

interface Counter {
  count: number;
  value: string;
}

export interface Rgba {
  a: number;
  b: number;
  g: number;
  r: number;
}

function increment(map: Map<string, number>, key: string, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

function nested<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  const existing = map.get(key);
  if (existing !== undefined) return existing;
  const created = create();
  map.set(key, created);
  return created;
}

function sortedCounters(map: Map<string, number>): Counter[] {
  return Array.from(map.entries())
    .map(([value, count]) => ({ count, value }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
}

function mostFrequent(map: Map<string, number> | undefined) {
  return map ? sortedCounters(map)[0]?.value : undefined;
}

function clampChannel(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/** Parses hex, rgb() and rgba() colors; anything else (gradients, keywords) is ignored. */
export function parseColor(raw: string): Rgba | null {
  const value = raw.trim().toLowerCase();
  const hex = value.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    const digits = hex[1];
    if (digits.length === 3 || digits.length === 4) {
      const [r, g, b, a] = digits.split("").map((digit) => parseInt(digit + digit, 16));
      return { a: digits.length === 4 ? a / 255 : 1, b, g, r };
    }
    if (digits.length === 6 || digits.length === 8) {
      const r = parseInt(digits.slice(0, 2), 16);
      const g = parseInt(digits.slice(2, 4), 16);
      const b = parseInt(digits.slice(4, 6), 16);
      const a = digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1;
      return { a, b, g, r };
    }
    return null;
  }
  const rgb = value.match(/^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/);
  if (!rgb) return null;
  const alphaRaw = rgb[4];
  const alpha = alphaRaw === undefined
    ? 1
    : alphaRaw.endsWith("%") ? Number(alphaRaw.slice(0, -1)) / 100 : Number(alphaRaw);
  if (!Number.isFinite(alpha)) return null;
  return {
    a: Math.max(0, Math.min(1, alpha)),
    b: clampChannel(Number(rgb[3])),
    g: clampChannel(Number(rgb[2])),
    r: clampChannel(Number(rgb[1])),
  };
}

function hexChannel(value: number) {
  return value.toString(16).padStart(2, "0");
}

/** Lowercase `#rrggbb`, or `rgba(r, g, b, a)` when translucent. */
export function formatColor(color: Rgba) {
  if (color.a >= 0.995) return `#${hexChannel(color.r)}${hexChannel(color.g)}${hexChannel(color.b)}`;
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${Math.round(color.a * 100) / 100})`;
}

export function normalizeColor(raw: string) {
  const color = parseColor(raw);
  if (!color || color.a < 0.005) return null;
  return formatColor(color);
}

function colorDistance(left: Rgba, right: Rgba) {
  const dr = left.r - right.r;
  const dg = left.g - right.g;
  const db = left.b - right.b;
  return Math.sqrt(dr * dr + dg * dg + db * db) + Math.abs(left.a - right.a) * 255;
}

/** Folds near-identical colors into the more frequent one, keeping the frequency order. */
export function mergeNearbyColors(colors: Counter[]): Counter[] {
  const kept: Array<Counter & { rgba: Rgba }> = [];
  for (const entry of colors) {
    const rgba = parseColor(entry.value);
    if (!rgba) continue;
    const near = kept.find((candidate) => colorDistance(candidate.rgba, rgba) <= COLOR_MERGE_DISTANCE);
    if (near) near.count += entry.count;
    else kept.push({ ...entry, rgba });
  }
  return kept
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value))
    .map(({ count, value }) => ({ count, value }));
}

export function pxValues(raw: string): number[] {
  const values: number[] = [];
  for (const part of raw.trim().split(/\s+/)) {
    const match = part.match(/^(-?\d+(?:\.\d+)?)px$/);
    if (!match) continue;
    const value = Math.round(Number(match[1]) * 100) / 100;
    if (Number.isFinite(value)) values.push(value);
  }
  return values;
}

function formatPx(value: number) {
  return `${Number.isInteger(value) ? value : value.toFixed(2).replace(/\.?0+$/, "")}px`;
}

function normalizeRadius(raw: string): string[] {
  const parts = raw.trim().split("/")[0].split(/\s+/);
  const values: string[] = [];
  for (const part of parts) {
    if (/^\d+(\.\d+)?%$/.test(part)) {
      if (Number(part.slice(0, -1)) > 0) values.push("9999px");
      continue;
    }
    const [px] = pxValues(part);
    if (px === undefined || px <= 0) continue;
    values.push(px >= 999 ? "9999px" : formatPx(px));
  }
  return values;
}

function normalizeFontFamily(raw: string) {
  const first = raw.split(",")[0]?.trim().replace(/^["']|["']$/g, "").trim() ?? "";
  return first.length > 0 && first.length <= 80 ? first : null;
}

/** Rewrites colors inside a shadow value and collapses whitespace. */
export function normalizeShadow(raw: string) {
  const value = raw.trim();
  if (!value || value === "none") return null;
  return value
    .replace(/rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}\b/g, (match) => {
      const color = parseColor(match);
      return color ? formatColor(color) : match.toLowerCase();
    })
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function hostnameOf(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function walk(node: SnapshotNode, visit: (node: SnapshotNode) => void) {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

function toTokens(counters: Counter[], limit: number, name: (value: string, index: number) => string): DesignToken[] {
  return counters.slice(0, limit).map((entry, index) => ({ count: entry.count, name: name(entry.value, index), value: entry.value }));
}

function spacingName(value: string) {
  const [px] = pxValues(value);
  if (px === undefined) return value;
  const step = px / 4;
  return Number.isInteger(step) ? String(step) : formatPx(px).replace(".", "-");
}

function typographyNames(sizes: Counter[]) {
  const names = new Map<string, string>();
  if (!sizes.length) return names;
  const base = sizes[0].value;
  const ordered = sizes.map((entry) => entry.value).sort((left, right) => (pxValues(left)[0] ?? 0) - (pxValues(right)[0] ?? 0));
  const baseIndex = ordered.indexOf(base);
  ordered.forEach((value, index) => {
    if (index === baseIndex) names.set(value, "text-md");
    else if (index < baseIndex) names.set(value, `text-${TEXT_SCALE_BELOW[baseIndex - index - 1] ?? `${baseIndex - index}xs`}`);
    else names.set(value, `text-${TEXT_SCALE_ABOVE[index - baseIndex - 1] ?? `${index - baseIndex}xl`}`);
  });
  return names;
}

function sizeScaleNames(values: string[], prefix: string) {
  const names = new Map<string, string>();
  const ordered = [...values].sort((left, right) => (pxValues(left)[0] ?? 0) - (pxValues(right)[0] ?? 0));
  ordered.forEach((value, index) => {
    if (prefix === "radius" && value === "9999px") names.set(value, "full");
    else names.set(value, SIZE_SCALE[index] ?? `${prefix}-${index + 1}`);
  });
  return names;
}

function fontNames(families: string[]) {
  const names = new Map<string, string>();
  const used = new Set<string>();
  families.forEach((family, index) => {
    const lower = family.toLowerCase();
    let name = /mono|code|courier|consolas|menlo/.test(lower)
      ? "mono"
      : /serif|georgia|times|garamond|playfair|merriweather/.test(lower) && !/sans/.test(lower)
        ? "serif"
        : "sans";
    if (used.has(name)) name = `font-${index + 1}`;
    used.add(name);
    names.set(family, name);
  });
  return names;
}

/** Flags a distribution whose top values do not dominate: no scale can be inferred from it. */
function isScattered(counters: Counter[], minDistinct: number, topCount: number, share: number) {
  if (counters.length < minDistinct) return false;
  const total = counters.reduce((sum, entry) => sum + entry.count, 0);
  const top = counters.slice(0, topCount).reduce((sum, entry) => sum + entry.count, 0);
  return total > 0 && top / total < share;
}

function ensureUnique<T extends DesignToken>(tokens: T[]): T[] {
  const seen = new Map<string, number>();
  for (const token of tokens) {
    const times = seen.get(token.name) ?? 0;
    seen.set(token.name, times + 1);
    if (times > 0) token.name = `${token.name}-${times + 1}`;
  }
  return tokens;
}

/**
 * Walks every snapshot node's styles and groups the rendered values by
 * frequency. Purely deterministic: the same pins always give the same sample.
 */
export function aggregateSnapshots(pins: SampledPin[]): AggregatedSample {
  const colors = new Map<string, number>();
  const families = new Map<string, number>();
  const familyWeights = new Map<string, Set<string>>();
  const sizes = new Map<string, number>();
  const sizeLineHeights = new Map<string, Map<string, number>>();
  const sizeWeights = new Map<string, Map<string, number>>();
  const spacing = new Map<string, number>();
  const radii = new Map<string, number>();
  const shadows = new Map<string, number>();
  const hosts = new Map<string, number>();
  const pages = new Set<string>();
  let styledPins = 0;

  for (const pin of pins) {
    increment(hosts, hostnameOf(pin.url));
    pages.add(pin.url);
    let styledNodes = 0;
    for (const font of pin.snapshot.fonts) {
      const family = normalizeFontFamily(font.family);
      if (!family) continue;
      increment(families, family);
      if (font.weight) nested(familyWeights, family, () => new Set<string>()).add(font.weight);
    }
    walk(pin.snapshot.root, (node) => {
      if (!node.styles) return;
      styledNodes += 1;
      const weight = node.styles["font-weight"]?.trim();
      const lineHeight = node.styles["line-height"]?.trim();
      for (const [property, raw] of Object.entries(node.styles)) {
        if (COLOR_PROPERTIES.has(property)) {
          const color = normalizeColor(raw);
          if (color) increment(colors, color);
        } else if (SPACING_PROPERTIES.has(property)) {
          for (const px of pxValues(raw)) if (px > 0) increment(spacing, formatPx(px));
        } else if (property === "font-family") {
          const family = normalizeFontFamily(raw);
          if (!family) continue;
          increment(families, family);
          if (weight) nested(familyWeights, family, () => new Set<string>()).add(weight);
        } else if (property === "font-size") {
          const [px] = pxValues(raw);
          if (px === undefined || px <= 0) continue;
          const size = formatPx(px);
          increment(sizes, size);
          if (lineHeight) increment(nested(sizeLineHeights, size, () => new Map<string, number>()), lineHeight);
          if (weight) increment(nested(sizeWeights, size, () => new Map<string, number>()), weight);
        } else if (property === "border-radius") {
          for (const radius of normalizeRadius(raw)) increment(radii, radius);
        } else if (property === "box-shadow") {
          const shadow = normalizeShadow(raw);
          if (shadow) increment(shadows, shadow);
        }
      }
    });
    if (styledNodes > 0) styledPins += 1;
  }

  const warnings: string[] = [];
  const hostCounters = sortedCounters(hosts).filter((entry) => entry.value);
  const domain = hostCounters[0]?.value ?? "";
  if (hostCounters.length > 1) warnings.push(`mixed_domains: ${hostCounters.map((entry) => entry.value).join(", ")}`);
  if (styledPins === 0) warnings.push("no_styles: none of the pins carries computed styles");

  const colorCounters = mergeNearbyColors(sortedCounters(colors));
  const sizeCounters = sortedCounters(sizes);
  const spacingCounters = sortedCounters(spacing);
  const radiusCounters = sortedCounters(radii);
  const shadowCounters = sortedCounters(shadows);
  const fontCounters = sortedCounters(families);
  if (isScattered(spacingCounters, 12, 8, 0.6)) warnings.push(`scattered_spacing: ${spacingCounters.length} distinct values`);
  if (isScattered(sizeCounters, 10, 6, 0.6)) warnings.push(`scattered_font_sizes: ${sizeCounters.length} distinct values`);
  if (colorCounters.length > SAMPLE_LIMITS.colors * 2) warnings.push(`scattered_colors: ${colorCounters.length} distinct values`);

  const textNames = typographyNames(sizeCounters.slice(0, SAMPLE_LIMITS.typography));
  const radiusNames = sizeScaleNames(radiusCounters.slice(0, SAMPLE_LIMITS.radii).map((entry) => entry.value), "radius");
  const shadowNames = sizeScaleNames(shadowCounters.slice(0, SAMPLE_LIMITS.shadows).map((entry) => entry.value), "shadow");
  const familyNames = fontNames(fontCounters.slice(0, SAMPLE_LIMITS.fonts).map((entry) => entry.value));

  const fonts = fontCounters.slice(0, SAMPLE_LIMITS.fonts).map((entry): FontToken => ({
    count: entry.count,
    name: familyNames.get(entry.value) ?? "sans",
    value: entry.value,
    weights: Array.from(familyWeights.get(entry.value) ?? []).sort((left, right) => Number(left) - Number(right) || left.localeCompare(right)),
  }));
  const typography = sizeCounters.slice(0, SAMPLE_LIMITS.typography).map((entry): TypographyToken => {
    const token: TypographyToken = { count: entry.count, name: textNames.get(entry.value) ?? entry.value, value: entry.value };
    const lineHeight = mostFrequent(sizeLineHeights.get(entry.value));
    const weight = mostFrequent(sizeWeights.get(entry.value));
    if (lineHeight) token.lineHeight = lineHeight;
    if (weight) token.weight = weight;
    return token;
  });

  return {
    colors: ensureUnique(toTokens(colorCounters, SAMPLE_LIMITS.colors, (_value, index) => `color-${index + 1}`)),
    fonts: ensureUnique(fonts),
    radii: ensureUnique(toTokens(radiusCounters, SAMPLE_LIMITS.radii, (value) => radiusNames.get(value) ?? value)),
    sample: { domain, pages: pages.size, pins: styledPins },
    shadows: ensureUnique(toTokens(shadowCounters, SAMPLE_LIMITS.shadows, (value, index) => shadowNames.get(value) ?? `shadow-${index + 1}`)),
    spacing: ensureUnique(toTokens(spacingCounters, SAMPLE_LIMITS.spacing, spacingName)),
    typography: ensureUnique(typography),
    warnings,
  };
}

/** Kebab-case, ASCII, non-empty; anything else is rejected so exports stay valid. */
export function tokenName(raw: unknown) {
  if (typeof raw !== "string") return null;
  const name = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return name || null;
}

function rename<T extends DesignToken>(tokens: T[], names: Record<string, string> | undefined): T[] {
  const copies = tokens.map((token) => ({ ...token }));
  if (!names) return copies;
  for (const token of copies) {
    const name = tokenName(names[token.value]);
    if (name) token.name = name;
  }
  return ensureUnique(copies);
}

/**
 * Builds the stored design system from a sample. Proposed names only apply to
 * values that exist in the sample; every other value keeps its fallback name.
 */
export function designSystemFromSample(sample: AggregatedSample, options: DesignSystemOptions = {}): DesignSystem {
  const names = options.names ?? {};
  const system: DesignSystem = {
    colors: rename(sample.colors, names.colors),
    fonts: rename(sample.fonts, names.fonts),
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    radii: rename(sample.radii, names.radii),
    sample: { ...sample.sample },
    shadows: rename(sample.shadows, names.shadows),
    spacing: rename(sample.spacing, names.spacing),
    typography: rename(sample.typography, names.typography),
    version: DESIGN_SYSTEM_VERSION,
    warnings: [...sample.warnings],
  };
  if (options.identity) system.identity = options.identity;
  if (options.model) system.model = options.model;
  return system;
}
