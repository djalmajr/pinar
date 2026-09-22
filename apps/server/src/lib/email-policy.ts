import { disposableEmailBlocklistSet } from "disposable-email-domains-js";

let disposableDomains: Set<string> | null = null;

export function isDisposableEmail(email: string) {
  const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
  disposableDomains ??= disposableEmailBlocklistSet();
  let candidate = domain;
  while (candidate) {
    if (disposableDomains.has(candidate)) return true;
    const dot = candidate.indexOf(".");
    if (dot < 0) break;
    candidate = candidate.slice(dot + 1);
  }
  return false;
}
