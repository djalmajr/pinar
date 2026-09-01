import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@pinar/shared";

export const LANGUAGE_STORAGE_KEY = "pinar-language";
const LANGUAGE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isSupportedLanguage(
  value: string | null | undefined,
): value is SupportedLanguage {
  return Boolean(
    value && (SUPPORTED_LANGUAGES as readonly string[]).includes(value),
  );
}

export function readLanguageCookie(cookieHeader: string | null | undefined) {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== LANGUAGE_STORAGE_KEY) continue;
    const value = decodeURIComponent(part.slice(separator + 1).trim());
    if (isSupportedLanguage(value)) return value;
  }
  return undefined;
}

export function parseAcceptLanguage(header: string | null | undefined) {
  if (!header) return [];
  return header
    .split(",")
    .map((entry) => {
      const [tag, ...parameters] = entry.split(";");
      const quality = parameters
        .map((parameter) => parameter.trim())
        .find((parameter) => parameter.startsWith("q="));
      return {
        quality: quality ? Number.parseFloat(quality.slice(2)) || 0 : 1,
        tag: tag.trim(),
      };
    })
    .filter((entry) => entry.tag)
    .sort((left, right) => right.quality - left.quality)
    .map((entry) => entry.tag);
}

export function readClientLanguage(): SupportedLanguage {
  const rendered = document.documentElement.lang;
  if (isSupportedLanguage(rendered)) return rendered;
  const cookie = readLanguageCookie(document.cookie);
  if (cookie) return cookie;
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return isSupportedLanguage(stored) ? stored : "en";
}

export function persistLanguage(language: SupportedLanguage) {
  document.documentElement.lang = language;
  localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  document.cookie = `${LANGUAGE_STORAGE_KEY}=${language}; path=/; max-age=${LANGUAGE_COOKIE_MAX_AGE}; samesite=lax`;
}

export function languageAlternates(origin: string, pathname: string) {
  return SUPPORTED_LANGUAGES.map((language) => ({
    href: `${origin}${pathname}?lang=${language}`,
    language,
  }));
}

const NON_INDEXABLE_PREFIXES = [
  "/api/",
  "/app",
  "/c/",
  "/p/",
  "/shots/",
  "/success",
  "/v/",
];

export function isIndexablePath(pathname: string) {
  return !NON_INDEXABLE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix),
  );
}

export function canonicalHref(
  origin: string,
  pathname: string,
  searchStr: string,
) {
  const requested = new URLSearchParams(searchStr).get("lang");
  return isSupportedLanguage(requested)
    ? `${origin}${pathname}?lang=${requested}`
    : `${origin}${pathname}`;
}
