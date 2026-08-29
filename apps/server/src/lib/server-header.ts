import type { AuthSession } from "@pinar/shared";

export type PinarRuntime = "cloud" | "local";
export type PublicHeaderCta = "open-app" | "sign-in";

export function pinarRuntime(): PinarRuntime {
  return import.meta.env.VITE_PINAR_RUNTIME === "local" ? "local" : "cloud";
}

export function publicHeaderShowsPlans(runtime: PinarRuntime): boolean {
  return runtime === "cloud";
}

export function publicHeaderCta(
  session: AuthSession | null,
  runtime: PinarRuntime = "cloud",
): PublicHeaderCta {
  if (runtime === "local" || session?.kind === "local") return "open-app";
  if (session?.kind === "account" || session?.kind === "installation") return "open-app";
  return "sign-in";
}
