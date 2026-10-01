import type { PinarRuntime } from "@/lib/server-header";

export type SettingsSection = "about" | "agentAccess" | "aiUsage" | "capture" | "general" | "interface";

// AI settings are an account feature: the self-hosted server has no AI section,
// and Cloud shows it only to eligible (paid) accounts.
export function showsAiSettings(runtime: PinarRuntime, paidAccount: boolean): boolean {
  return runtime === "cloud" && paidAccount;
}

// A section that is not offered must never open as an empty panel, so a request
// for it lands on General. Cloud keeps its existing behavior for aiUsage.
export function resolveSettingsSection(
  requested: SettingsSection,
  { runtime, showAgentAccess }: { runtime: PinarRuntime; showAgentAccess: boolean },
): SettingsSection {
  if (requested === "agentAccess" && !showAgentAccess) return "general";
  if (requested === "aiUsage" && runtime === "local") return "general";
  return requested;
}
