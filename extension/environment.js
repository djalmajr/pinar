export const DEVELOPMENT_EXTENSION_KEY = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAmkNabf6ZtL0IPuCEEFlnf8YxL9j92z9eIbPksunV62jHw001fI3JLiou3NVyfV8qyT5Qp7suOkKwImuqvzWwRlHQCObEhtCMhnq7TAYvPT5k9WiB6pUs8t1RJzuwS3vLicklGxGPHPyWnNHbPmh/Ovn2iZWIhp55eQxujsGUzZ9P66WIDYR8459GBa0o3x4AQ2l2hlP0ANsyeJjg/f+3T038ulOfQr0TMvgsmLN/Ca+OByAKKR9f5wWIl2y7EdJMCBfZ8hWLlmy/vaM4tF6n9U+E/W4h9nwzQfgd/VuAZnSBS01KORSrv6JEbdKoo9LRR0mdvramaVNDhUzQDLOLpwIDAQAB";
export const DEVELOPMENT_EXTENSION_ID = "bobfbkbogoiemdcjchoakflgepmekdeh";
export const PRODUCTION_CLOUD_URL = "https://pinar.dev";
// Default origin of the local Cloud runtime (`bun run dev:cloud`,
// DEFAULT_PORT in apps/server/scripts/cloud-local.mjs).
export const LOCAL_CLOUD_URL = "http://127.0.0.1:3000";

function normalizedUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function isLoopbackUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  } catch {
    return false;
  }
}

export function isDevelopmentExtension(manifest) {
  return manifest?.key === DEVELOPMENT_EXTENSION_KEY;
}

export function resolveCloudUrl(manifest, storedCloudUrl) {
  const stored = normalizedUrl(storedCloudUrl);
  if (isDevelopmentExtension(manifest)) {
    if (isLoopbackUrl(stored)) return stored;
    return LOCAL_CLOUD_URL;
  }
  return PRODUCTION_CLOUD_URL;
}

export function cloudEnvironment(manifest, storedCloudUrl) {
  return resolveCloudUrl(manifest, storedCloudUrl) === PRODUCTION_CLOUD_URL ? "production" : "local-cloud";
}

export function requiresExplicitLegalConsent() {
  return true;
}
