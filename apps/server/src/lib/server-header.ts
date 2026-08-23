import type { AuthSession } from "@pinar/shared";

export function publicHeaderCta(session: AuthSession | null) {
  if (session?.kind === "account" || session?.kind === "installation") return "open-app";
  return "sign-in";
}
