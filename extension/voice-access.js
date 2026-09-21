export function resolveVoiceAvailability(storageMode, session) {
  if (storageMode !== "cloud") return { available: false, reason: "cloud_required" };
  if (session?.kind !== "account") return { available: false, reason: "sign_in_required" };
  if (session.plan !== "pro") return { available: false, reason: "pro_required" };
  return { available: true, reason: null };
}
