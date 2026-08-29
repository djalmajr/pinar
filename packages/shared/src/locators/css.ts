export function escapeCssIdent(value: string) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/[^\w-]/g, (char) => `\\${char}`);
}

export function splitFrameDomPath(path = "", boundary = " ::frame:: ") {
  return String(path)
    .split(boundary)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function normalizeVisibleText(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 160);
}

export function isStableClassName(name: string) {
  if (!name) return false;
  if (/[_-][a-f0-9]{5,}$/i.test(name)) return false;
  if (name.length >= 8 && /\d/.test(name) && /[A-Z]/.test(name) && /[a-z]/.test(name)) return false;
  return true;
}

export interface SimpleSelector {
  attr?: { name: string; value?: string };
  classes: string[];
  id?: string;
  nthOfType?: number;
  tag?: string;
}

const SIMPLE_SELECTOR =
  /^(?<tag>[a-z][\w-]*)?(?<id>#[^\s.#:[]+)?(?<classes>(?:\.[^\s.#:[]+)*)?(?<attr>\[[^\]]+\])?(?<nth>:nth-of-type\(\d+\))?$/i;

export function parseSimpleSelector(raw: string): SimpleSelector | null {
  const value = raw.trim();
  if (!value) return null;
  const match = SIMPLE_SELECTOR.exec(value);
  if (!match?.groups) return null;
  const classes = match.groups.classes
    ? [...match.groups.classes.matchAll(/\.([^\s.#:[]+)/g)].map((item) => item[1] || "")
    : [];
  let attr: SimpleSelector["attr"];
  if (match.groups.attr) {
    const attrMatch = /^\[([^=\]]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\]$/.exec(match.groups.attr);
    if (!attrMatch) return null;
    attr = { name: attrMatch[1], value: attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] };
  }
  const nth = match.groups.nth ? Number(match.groups.nth.replace(/\D+/g, "")) : undefined;
  return {
    attr,
    classes: classes.filter(Boolean),
    id: match.groups.id ? match.groups.id.slice(1) : undefined,
    nthOfType: Number.isFinite(nth) ? nth : undefined,
    tag: match.groups.tag?.toLowerCase(),
  };
}

export function splitChildSelector(selector: string) {
  return selector
    .split(/\s*>\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}
