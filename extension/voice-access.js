export function resolveVoiceAvailability(storageMode, session, localAi = null) {
  if (storageMode === "local") {
    // The local server reports the AI status; unknown (null) means the check could
    // not run, which is different from "running but not configured".
    if (localAi === null) return { available: false, reason: "unavailable" };
    if (localAi?.configured) return { available: true, reason: null };
    return { available: false, reason: "local_ai_required" };
  }
  if (storageMode !== "cloud") return { available: false, reason: "cloud_required" };
  if (session?.kind === "account" && session.plan === "pro") return { available: true, reason: null };
  // A free cloud installation is already on Pinar Cloud. Voice is a subscriber feature.
  if (session?.kind === "account" || session?.kind === "installation") {
    return { available: false, reason: "pro_required" };
  }
  return { available: false, reason: "sign_in_required" };
}
