export function resolveVoiceAvailability(storageMode, session) {
  if (storageMode !== "cloud") return { available: false, reason: "cloud_required" };
  if (session?.kind === "account" && session.plan === "pro") return { available: true, reason: null };
  // A free cloud installation is already on Pinar Cloud. Voice is a subscriber feature.
  if (session?.kind === "account" || session?.kind === "installation") {
    return { available: false, reason: "pro_required" };
  }
  return { available: false, reason: "sign_in_required" };
}
