const INSTALLATION_ID_KEY = "installationId";
const INSTALLATION_TOKEN_KEY = "installationToken";
const DEVICE_TOKEN_KEY = "deviceToken";
const DEVICE_TOKEN_ENDPOINT_KEY = "deviceTokenEndpoint";
const DEVICE_TOKENS_KEY = "deviceTokens";
const LEGACY_DEVICE_TOKEN_ENDPOINT = "https://pinar.dev";

export const INSTALLATION_ID_PATTERN = /^ins_[A-Za-z0-9_-]{24}$/;
export const INSTALLATION_TOKEN_PATTERN = /^pit_[A-Za-z0-9_-]{43}$/;
export const DEVICE_TOKEN_PATTERN = /^pdt_[A-Za-z0-9_-]{43}$/;

function randomBytes(size, fillRandom = globalThis.crypto?.getRandomValues?.bind(globalThis.crypto)) {
  if (!fillRandom) throw new Error("Secure random generation is unavailable");
  const bytes = new Uint8Array(size);
  fillRandom(bytes);
  return bytes;
}

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function createInstallationIdentity(fillRandom) {
  return {
    id: `ins_${toBase64Url(randomBytes(18, fillRandom))}`,
    token: `pit_${toBase64Url(randomBytes(32, fillRandom))}`,
  };
}

export function isInstallationIdentity(value) {
  return Boolean(
    value &&
      INSTALLATION_ID_PATTERN.test(String(value.id || "")) &&
      INSTALLATION_TOKEN_PATTERN.test(String(value.token || "")),
  );
}

export async function ensureInstallationIdentity(storage, fillRandom) {
  const current = await storage.get({
    [INSTALLATION_ID_KEY]: "",
    [INSTALLATION_TOKEN_KEY]: "",
  });
  const identity = {
    id: current[INSTALLATION_ID_KEY],
    token: current[INSTALLATION_TOKEN_KEY],
  };
  if (isInstallationIdentity(identity)) return identity;
  return replaceInstallationIdentity(storage, createInstallationIdentity(fillRandom));
}

export async function replaceInstallationIdentity(storage, identity) {
  if (!isInstallationIdentity(identity)) throw new Error("Invalid installation identity");
  await storage.set({
    [INSTALLATION_ID_KEY]: identity.id,
    [INSTALLATION_TOKEN_KEY]: identity.token,
  });
  return identity;
}

export function installationAuthHeaders(identity) {
  if (!isInstallationIdentity(identity)) throw new Error("Invalid installation identity");
  return {
    authorization: `Bearer ${identity.token}`,
    "x-pinar-installation-id": identity.id,
  };
}

export function normalizeAuthEndpoint(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.origin.toLowerCase();
  } catch {
    return "";
  }
}

function validDeviceTokens(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([endpoint, token]) => (
    normalizeAuthEndpoint(endpoint) === endpoint && DEVICE_TOKEN_PATTERN.test(String(token || ""))
  )));
}

export async function getDeviceToken(storage, endpoint = "") {
  const current = await storage.get({
    [DEVICE_TOKEN_KEY]: "",
    [DEVICE_TOKEN_ENDPOINT_KEY]: "",
    [DEVICE_TOKENS_KEY]: {},
  });
  const normalized = normalizeAuthEndpoint(endpoint);
  const tokens = validDeviceTokens(current[DEVICE_TOKENS_KEY]);
  if (normalized && DEVICE_TOKEN_PATTERN.test(String(tokens[normalized] || ""))) return tokens[normalized];
  const token = String(current[DEVICE_TOKEN_KEY] || "");
  if (!DEVICE_TOKEN_PATTERN.test(token)) return "";
  if (!normalized) return token;
  const legacyEndpoint = normalizeAuthEndpoint(current[DEVICE_TOKEN_ENDPOINT_KEY]);
  if (legacyEndpoint && legacyEndpoint !== normalized) return "";
  // Versions before endpoint-scoped credentials only targeted production.
  // Do not leak that unscoped credential to a developer-selected server.
  if (!legacyEndpoint && normalized !== LEGACY_DEVICE_TOKEN_ENDPOINT) return "";
  await storage.set({
    [DEVICE_TOKEN_ENDPOINT_KEY]: normalized,
    [DEVICE_TOKENS_KEY]: { ...tokens, [normalized]: token },
  });
  return token;
}

export async function storeDeviceToken(storage, token, endpoint = "") {
  if (!DEVICE_TOKEN_PATTERN.test(String(token || ""))) throw new Error("Invalid device token");
  const normalized = normalizeAuthEndpoint(endpoint);
  if (!normalized) {
    await storage.set({ [DEVICE_TOKEN_KEY]: token });
    return token;
  }
  const current = await storage.get({ [DEVICE_TOKENS_KEY]: {} });
  const tokens = validDeviceTokens(current[DEVICE_TOKENS_KEY]);
  await storage.set({
    [DEVICE_TOKEN_KEY]: token,
    [DEVICE_TOKEN_ENDPOINT_KEY]: normalized,
    [DEVICE_TOKENS_KEY]: { ...tokens, [normalized]: token },
  });
  return token;
}

export async function clearDeviceToken(storage, endpoint = "") {
  const normalized = normalizeAuthEndpoint(endpoint);
  if (!normalized) {
    if (typeof storage.remove === "function") {
      await storage.remove(DEVICE_TOKEN_KEY);
      await storage.remove(DEVICE_TOKEN_ENDPOINT_KEY);
      await storage.remove(DEVICE_TOKENS_KEY);
    } else {
      await storage.set({ [DEVICE_TOKEN_KEY]: "", [DEVICE_TOKEN_ENDPOINT_KEY]: "", [DEVICE_TOKENS_KEY]: {} });
    }
    return;
  }
  const current = await storage.get({
    [DEVICE_TOKEN_ENDPOINT_KEY]: "",
    [DEVICE_TOKENS_KEY]: {},
  });
  const tokens = validDeviceTokens(current[DEVICE_TOKENS_KEY]);
  delete tokens[normalized];
  await storage.set({ [DEVICE_TOKENS_KEY]: tokens });
  const legacyEndpoint = normalizeAuthEndpoint(current[DEVICE_TOKEN_ENDPOINT_KEY]);
  const legacyOwner = legacyEndpoint || LEGACY_DEVICE_TOKEN_ENDPOINT;
  if (legacyOwner === normalized) {
    if (typeof storage.remove === "function") {
      await storage.remove(DEVICE_TOKEN_KEY);
      await storage.remove(DEVICE_TOKEN_ENDPOINT_KEY);
    } else {
      await storage.set({ [DEVICE_TOKEN_KEY]: "", [DEVICE_TOKEN_ENDPOINT_KEY]: "" });
    }
  }
}

export function deviceAuthHeaders(token) {
  if (!DEVICE_TOKEN_PATTERN.test(String(token || ""))) throw new Error("Invalid device token");
  return { authorization: `Bearer ${token}` };
}
