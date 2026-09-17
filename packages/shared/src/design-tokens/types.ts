/**
 * Design system extracted from the element snapshots of one collection.
 * Values are what the pages actually render (normalised computed styles);
 * names come from the model or from the deterministic fallback scale.
 */
export const DESIGN_SYSTEM_VERSION = 1 as const;

export interface DesignToken {
  /** How many snapshot nodes rendered this value. */
  count: number;
  /** Kebab-case token name, unique inside its category. */
  name: string;
  /** Optional semantic role, e.g. "primary", "surface", "body". */
  role?: string;
  /** Normalised CSS value: lowercase hex/rgba, px length, raw shadow. */
  value: string;
}

export interface FontToken extends DesignToken {
  /** Distinct font weights seen with this family, ascending. */
  weights: string[];
}

export interface TypographyToken extends DesignToken {
  /** Most frequent line-height rendered with this font size. */
  lineHeight?: string;
  /** Most frequent font weight rendered with this font size. */
  weight?: string;
}

export interface DesignSample {
  /** Hostname that backs the sample (the most frequent one). */
  domain: string;
  /** Distinct page URLs behind the pins. */
  pages: number;
  /** Pins whose snapshot contributed styles. */
  pins: number;
}

export interface DesignSystem {
  colors: DesignToken[];
  fonts: FontToken[];
  /** ISO timestamp of the extraction. */
  generatedAt: string;
  /** Short prose identity written by the model. */
  identity?: string;
  /** Model that named the tokens, absent for a purely deterministic result. */
  model?: string;
  radii: DesignToken[];
  sample: DesignSample;
  shadows: DesignToken[];
  spacing: DesignToken[];
  typography: TypographyToken[];
  version: typeof DESIGN_SYSTEM_VERSION;
  /** `code: detail` strings, e.g. `mixed_domains: a.test, b.test`. */
  warnings: string[];
}

/** Deterministic aggregation of a pin sample, before any model names it. */
export interface AggregatedSample {
  colors: DesignToken[];
  fonts: FontToken[];
  radii: DesignToken[];
  sample: DesignSample;
  shadows: DesignToken[];
  spacing: DesignToken[];
  typography: TypographyToken[];
  warnings: string[];
}

/** Names proposed for sampled values, keyed by the normalised value. */
export interface TokenNames {
  colors?: Record<string, string>;
  fonts?: Record<string, string>;
  radii?: Record<string, string>;
  shadows?: Record<string, string>;
  spacing?: Record<string, string>;
  typography?: Record<string, string>;
}

export interface DesignSystemOptions {
  generatedAt?: string;
  identity?: string;
  model?: string;
  names?: TokenNames;
}

export interface DesignSystemExports {
  css: string;
  markdown: string;
  tailwind: string;
  tokens: string;
}
