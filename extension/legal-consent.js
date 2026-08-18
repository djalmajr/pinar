export function parseLegalBundle(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (typeof value.version !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.version)) return null;
  if (typeof value.acceptableUseUrl !== "string"
    || typeof value.privacyUrl !== "string"
    || typeof value.termsUrl !== "string") return null;
  return {
    acceptableUseUrl: value.acceptableUseUrl,
    privacyUrl: value.privacyUrl,
    termsUrl: value.termsUrl,
    version: value.version,
  };
}

export function acceptedRemoteLegalAcceptance(value, bundle) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !bundle) return null;
  if (value.accepted !== true || (value.locale !== "en" && value.locale !== "pt")) return null;
  if (value.acceptableUseVersion !== bundle.version
    || value.privacyVersion !== bundle.version
    || value.termsVersion !== bundle.version) return null;
  return {
    acceptableUseVersion: value.acceptableUseVersion,
    accepted: true,
    locale: value.locale,
    privacyVersion: value.privacyVersion,
    termsVersion: value.termsVersion,
  };
}

export function createRemoteLegalAcceptance(bundle, language, acceptedAt = new Date().toISOString()) {
  if (!bundle) return null;
  return {
    acceptableUseVersion: bundle.version,
    accepted: true,
    acceptedAt,
    locale: language === "pt" ? "pt" : "en",
    privacyVersion: bundle.version,
    termsVersion: bundle.version,
  };
}
