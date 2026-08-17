const INSTALLATION_ID_KEY = "installationId";
const INSTALLATION_TOKEN_KEY = "installationToken";
const DEVICE_TOKEN_KEY = "deviceToken";

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

export async function getDeviceToken(storage) {
  const current = await storage.get({ [DEVICE_TOKEN_KEY]: "" });
  const token = String(current[DEVICE_TOKEN_KEY] || "");
  return DEVICE_TOKEN_PATTERN.test(token) ? token : "";
}

export async function storeDeviceToken(storage, token) {
  if (!DEVICE_TOKEN_PATTERN.test(String(token || ""))) throw new Error("Invalid device token");
  await storage.set({ [DEVICE_TOKEN_KEY]: token });
  return token;
}

export async function clearDeviceToken(storage) {
  if (typeof storage.remove === "function") await storage.remove(DEVICE_TOKEN_KEY);
  else await storage.set({ [DEVICE_TOKEN_KEY]: "" });
}

export function deviceAuthHeaders(token) {
  if (!DEVICE_TOKEN_PATTERN.test(String(token || ""))) throw new Error("Invalid device token");
  return { authorization: `Bearer ${token}` };
}
