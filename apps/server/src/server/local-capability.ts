import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { pinarHome } from "@pinar/cli/paths";

export const LOCAL_CAPABILITY_FILENAME = "local-capability.json";
export const LOCAL_CAPABILITY_HEADER = "x-pinar-capability";
export const DEFAULT_CAPABILITY_GRACE_MS = 24 * 60 * 60 * 1000;

interface CapabilitySecret {
  createdAt?: string;
  expiresAt?: string;
  secret: string;
}

interface CapabilityStore {
  current: CapabilitySecret;
  previous: CapabilitySecret | null;
  version: 1;
}

let cached: { root: string; store: CapabilityStore } | null = null;

function rootPath() {
  return pinarHome();
}

export function localCapabilityPath(root = rootPath()) {
  return join(root, LOCAL_CAPABILITY_FILENAME);
}

function graceMs() {
  const raw = process.env.PINAR_CAPABILITY_GRACE_MS;
  if (raw == null || raw === "") return DEFAULT_CAPABILITY_GRACE_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_CAPABILITY_GRACE_MS;
  return parsed;
}

function randomSecret() {
  return randomBytes(32).toString("base64url");
}

function nowIso() {
  return new Date().toISOString();
}

function secretsEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  if (leftBytes.length !== rightBytes.length) return false;
  return timingSafeEqual(leftBytes, rightBytes);
}

function isStore(value: unknown): value is CapabilityStore {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || typeof record.current !== "object" || record.current === null) return false;
  const current = record.current as Record<string, unknown>;
  if (typeof current.secret !== "string" || !current.secret) return false;
  if (record.previous == null) return true;
  if (typeof record.previous !== "object") return false;
  const previous = record.previous as Record<string, unknown>;
  return typeof previous.secret === "string" && Boolean(previous.secret);
}

function secretIsActive(entry: CapabilitySecret | null | undefined) {
  if (!entry?.secret) return false;
  if (!entry.expiresAt) return true;
  const expires = Date.parse(entry.expiresAt);
  return Number.isFinite(expires) && expires > Date.now();
}

function matchesStore(store: CapabilityStore, presented: string) {
  if (!presented) return false;
  if (secretsEqual(presented, store.current.secret)) return true;
  return Boolean(store.previous && secretIsActive(store.previous) && secretsEqual(presented, store.previous.secret));
}

async function persistStore(root: string, store: CapabilityStore) {
  await mkdir(root, { recursive: true });
  const path = localCapabilityPath(root);
  const tmp = `${path}.${process.pid}.tmp`;
  const body = `${JSON.stringify(store)}\n`;
  await writeFile(tmp, body, { encoding: "utf8", mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, path);
  await chmod(path, 0o600);
  cached = { root, store };
  return store;
}

function mintStore(): CapabilityStore {
  return {
    current: { createdAt: nowIso(), secret: randomSecret() },
    previous: null,
    version: 1,
  };
}

async function loadStore(root: string): Promise<CapabilityStore | null> {
  if (cached && cached.root === root) return cached.store;
  const path = localCapabilityPath(root);
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isStore(parsed)) return null;
    cached = { root, store: parsed };
    return parsed;
  } catch {
    return null;
  }
}

export async function readOrCreateLocalCapability() {
  const root = rootPath();
  const existing = await loadStore(root);
  if (existing) return existing;
  return persistStore(root, mintStore());
}

export async function localCapabilityMatches(presented: string) {
  const store = await loadStore(rootPath());
  if (!store) return false;
  return matchesStore(store, presented);
}

export function capabilitySecretFromRequest(request: Request) {
  const header = request.headers.get(LOCAL_CAPABILITY_HEADER)?.trim() || "";
  if (header) return header;
  const authorization = request.headers.get("authorization")?.trim() || "";
  const bearer = /^Bearer\s+(\S+)/i.exec(authorization);
  return bearer?.[1] || "";
}

export async function rotateLocalCapability(presented: string) {
  const root = rootPath();
  const store = await loadStore(root);
  if (!store || !matchesStore(store, presented)) return null;
  const grace = graceMs();
  const next = await persistStore(root, {
    current: { createdAt: nowIso(), secret: randomSecret() },
    previous: grace === 0
      ? null
      : {
        expiresAt: new Date(Date.now() + grace).toISOString(),
        secret: store.current.secret,
      },
    version: 1,
  });
  return next;
}

export async function revokeLocalCapability(presented: string) {
  const root = rootPath();
  const store = await loadStore(root);
  if (!store || !matchesStore(store, presented)) return false;
  cached = null;
  await rm(localCapabilityPath(root), { force: true });
  return true;
}

export function resetLocalCapabilityForTests() {
  cached = null;
}
