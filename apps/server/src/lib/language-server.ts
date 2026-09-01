import {
  getRequestHeader,
  getRequestUrl,
  setResponseHeader,
} from "@tanstack/react-start/server";
import { getBestLanguage, type SupportedLanguage } from "@pinar/shared";
import {
  isSupportedLanguage,
  parseAcceptLanguage,
  readLanguageCookie,
} from "./language";

export interface RequestLanguage {
  language: SupportedLanguage;
  origin: string;
}

export function resolveRequestLanguage(): RequestLanguage {
  // The same URL renders a different language per cookie/Accept-Language,
  // so any shared cache must key on both.
  setResponseHeader("vary", "Cookie, Accept-Language");
  const url = getRequestUrl();
  const requested = url.searchParams.get("lang");
  if (isSupportedLanguage(requested))
    return { language: requested, origin: url.origin };

  const cookie = readLanguageCookie(getRequestHeader("cookie"));
  if (cookie) return { language: cookie, origin: url.origin };

  return {
    language: getBestLanguage(
      undefined,
      parseAcceptLanguage(getRequestHeader("accept-language")),
    ),
    origin: url.origin,
  };
}
