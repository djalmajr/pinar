import type { PinarRuntime } from "@/lib/server-header";

export type SettingsSection = "about" | "agentAccess" | "ai" | "aiUsage" | "capture" | "data" | "general" | "interface";

// AI usage is an account feature: Cloud shows the aiUsage section only to
// eligible (paid) accounts.
export function showsAiSettings(runtime: PinarRuntime, paidAccount: boolean): boolean {
  return runtime === "cloud" && paidAccount;
}

// AI configuration is a local feature: the self-hosted server always offers
// the ai section, while Cloud substitutes the account-gated aiUsage section.
export function showsAiSection(runtime: PinarRuntime): boolean {
  return runtime === "local";
}

// A section that is not offered must never open as an empty panel, so a request
// for it lands on General. Cloud keeps its existing behavior for aiUsage, and
// the local ai configuration section only resolves on the self-hosted server.
// `data` is offered on every runtime, so it always resolves as requested.
export function resolveSettingsSection(
  requested: SettingsSection,
  { runtime, showAgentAccess }: { runtime: PinarRuntime; showAgentAccess: boolean },
): SettingsSection {
  if (requested === "agentAccess" && !showAgentAccess) return "general";
  if (requested === "aiUsage" && runtime === "local") return "general";
  if (requested === "ai" && runtime !== "local") return "general";
  return requested;
}
