import {
  DESIGN_SYSTEM_VERSION,
  type DesignSystem,
  type DesignToken,
  type FontToken,
  type TypographyToken,
} from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asToken(value: unknown): DesignToken | null {
  if (!isRecord(value) || typeof value.name !== "string" || typeof value.value !== "string") return null;
  if (typeof value.count !== "number" || !Number.isFinite(value.count)) return null;
  const token: DesignToken = { count: Math.max(0, Math.trunc(value.count)), name: value.name, value: value.value };
  if (typeof value.role === "string" && value.role) token.role = value.role;
  return token;
}

function asTokens(value: unknown): DesignToken[] | null {
  if (!Array.isArray(value)) return null;
  const tokens = value.map(asToken);
  return tokens.every((token): token is DesignToken => token !== null) ? tokens : null;
}

function asFontTokens(value: unknown): FontToken[] | null {
  if (!Array.isArray(value)) return null;
  const tokens: FontToken[] = [];
  for (const item of value) {
    const token = asToken(item);
    if (!token || !isRecord(item)) return null;
    const weights = Array.isArray(item.weights) ? item.weights.filter((weight): weight is string => typeof weight === "string") : [];
    tokens.push({ ...token, weights });
  }
  return tokens;
}

function asTypographyTokens(value: unknown): TypographyToken[] | null {
  if (!Array.isArray(value)) return null;
  const tokens: TypographyToken[] = [];
  for (const item of value) {
    const token = asToken(item);
    if (!token || !isRecord(item)) return null;
    const typography: TypographyToken = { ...token };
    if (typeof item.lineHeight === "string" && item.lineHeight) typography.lineHeight = item.lineHeight;
    if (typeof item.weight === "string" && item.weight) typography.weight = item.weight;
    tokens.push(typography);
  }
  return tokens;
}

/** Validates a stored or transported design system; anything malformed yields null. */
export function asDesignSystem(value: unknown): DesignSystem | null {
  if (!isRecord(value) || value.version !== DESIGN_SYSTEM_VERSION) return null;
  const colors = asTokens(value.colors);
  const fonts = asFontTokens(value.fonts);
  const radii = asTokens(value.radii);
  const shadows = asTokens(value.shadows);
  const spacing = asTokens(value.spacing);
  const typography = asTypographyTokens(value.typography);
  if (!colors || !fonts || !radii || !shadows || !spacing || !typography) return null;
  if (!isRecord(value.sample) || typeof value.sample.domain !== "string") return null;
  if (typeof value.sample.pins !== "number" || typeof value.sample.pages !== "number") return null;
  if (typeof value.generatedAt !== "string") return null;
  const system: DesignSystem = {
    colors,
    fonts,
    generatedAt: value.generatedAt,
    radii,
    sample: { domain: value.sample.domain, pages: value.sample.pages, pins: value.sample.pins },
    shadows,
    spacing,
    typography,
    version: DESIGN_SYSTEM_VERSION,
    warnings: Array.isArray(value.warnings) ? value.warnings.filter((warning): warning is string => typeof warning === "string") : [],
  };
  if (typeof value.identity === "string" && value.identity.trim()) system.identity = value.identity;
  if (typeof value.model === "string" && value.model) system.model = value.model;
  return system;
}
