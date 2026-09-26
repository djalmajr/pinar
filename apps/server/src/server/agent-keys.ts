export type AgentKeyPermission = "read" | "manage" | "share" | "full";

export type AgentKeyResourceType = "account" | "batch" | "collection" | "project" | "session";

export interface AgentKeyDatabaseResult {
  meta?: { changes?: number };
  results?: Record<string, unknown>[];
}

export interface AgentKeyStatement {
  all(): Promise<AgentKeyDatabaseResult>;
  bind(...values: unknown[]): AgentKeyStatement;
  first(): Promise<Record<string, unknown> | null>;
  run(): Promise<AgentKeyDatabaseResult>;
}

export interface AgentKeyDatabase {
  prepare(query: string): AgentKeyStatement;
}

export interface AgentKeyEnvironment {
  DB?: AgentKeyDatabase;
}

export interface AgentKeyRecord {
  accountId: string;
  createdAt: string;
  expiresAt: string;
  id: string;
  lastUsedAt: string | null;
  name: string;
  permission: AgentKeyPermission;
  prefix: string;
  resourceId: string | null;
  resourceType: AgentKeyResourceType;
  revokedAt: string | null;
}

export interface CreateAgentKeyInput {
  accountId: string;
  expiresAt: string;
  id: string;
  name: string;
  now: string;
  permission: AgentKeyPermission;
  resourceId: string | null;
  resourceType: AgentKeyResourceType;
}

export interface CreatedAgentKey {
  key: AgentKeyRecord;
  token: string;
}

const AGENT_KEY_PATTERN = /^pak_[A-Za-z0-9_-]{43}$/;
const MAX_ACTIVE_AGENT_KEYS = 20;

function randomBase64Url(byteLength: number) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomId(prefix: string) {
  return `${prefix}${randomBase64Url(18)}`;
}

async function hashAgentKey(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function agentKeyFromRow(row: Record<string, unknown>): AgentKeyRecord {
  return {
    accountId: String(row.account_id || ""),
    createdAt: String(row.created_at || ""),
    expiresAt: String(row.expires_at || ""),
    id: String(row.id || ""),
    lastUsedAt: typeof row.last_used_at === "string" ? row.last_used_at : null,
    name: String(row.name || ""),
    permission: row.permission === "manage" || row.permission === "share" || row.permission === "full"
      ? row.permission
      : "read",
    prefix: String(row.token_prefix || "pak_"),
    resourceId: typeof row.resource_id === "string" && row.resource_id ? row.resource_id : null,
    resourceType: row.resource_type === "batch"
      || row.resource_type === "collection"
      || row.resource_type === "project"
      || row.resource_type === "session"
      ? row.resource_type
      : "account",
    revokedAt: typeof row.revoked_at === "string" && row.revoked_at ? row.revoked_at : null,
  };
}

export function agentKeyResourceType(value: unknown): AgentKeyResourceType | null {
  return value === "account"
    || value === "batch"
    || value === "collection"
    || value === "project"
    || value === "session"
    ? value
    : null;
}

export function agentKeyPermission(value: unknown): AgentKeyPermission | null {
  return value === "read" || value === "manage" || value === "share" || value === "full" ? value : null;
}

export function isAgentKeyToken(value: string) {
  return AGENT_KEY_PATTERN.test(value);
}

export async function createAgentKey(
  env: AgentKeyEnvironment,
  input: CreateAgentKeyInput,
): Promise<CreatedAgentKey | null> {
  if (!env.DB) return null;
  const token = `pak_${randomBase64Url(32)}`;
  const tokenHash = await hashAgentKey(token);
  const prefix = token.slice(0, 12);
  const result = await env.DB.prepare(`
    INSERT INTO agent_api_keys (
      id, account_id, name, token_hash, token_prefix, resource_type, resource_id,
      permission, expires_at, revoked_at, created_at, last_used_at
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL
    WHERE (
      SELECT COUNT(*) FROM agent_api_keys
      WHERE account_id = ? AND revoked_at IS NULL AND expires_at > ?
    ) < ${MAX_ACTIVE_AGENT_KEYS}
  `).bind(
    input.id,
    input.accountId,
    input.name,
    tokenHash,
    prefix,
    input.resourceType,
    input.resourceId,
    input.permission,
    input.expiresAt,
    input.now,
    input.accountId,
    input.now,
  ).run();
  if (Number(result.meta?.changes || 0) !== 1) return null;
  return {
    key: {
      accountId: input.accountId,
      createdAt: input.now,
      expiresAt: input.expiresAt,
      id: input.id,
      lastUsedAt: null,
      name: input.name,
      permission: input.permission,
      prefix,
      resourceId: input.resourceId,
      resourceType: input.resourceType,
      revokedAt: null,
    },
    token,
  };
}

export async function listAgentKeys(env: AgentKeyEnvironment, accountId: string) {
  if (!env.DB) return [];
  const result = await env.DB.prepare(
    "SELECT account_id, created_at, expires_at, id, last_used_at, name, permission, token_prefix, resource_id, resource_type, revoked_at "
      + "FROM agent_api_keys WHERE account_id = ? ORDER BY created_at DESC",
  ).bind(accountId).all();
  return (result.results || []).map(agentKeyFromRow);
}

export async function revokeAgentKey(
  env: AgentKeyEnvironment,
  accountId: string,
  id: string,
  revokedAt: string,
) {
  if (!env.DB) return false;
  const result = await env.DB.prepare(
    "UPDATE agent_api_keys SET revoked_at = ? WHERE id = ? AND account_id = ? AND revoked_at IS NULL",
  ).bind(revokedAt, id, accountId).run();
  return Number(result.meta?.changes || 0) === 1;
}

export async function authenticateAgentKey(
  env: AgentKeyEnvironment,
  token: string,
  now: string,
): Promise<AgentKeyRecord | null> {
  if (!env.DB || !isAgentKeyToken(token)) return null;
  const tokenHash = await hashAgentKey(token);
  const row = await env.DB.prepare(`
    SELECT account_id, created_at, expires_at, id, last_used_at, name, permission, token_prefix, resource_id, resource_type, revoked_at
    FROM agent_api_keys
    WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?
  `).bind(tokenHash, now).first();
  if (!row) return null;
  const key = agentKeyFromRow(row);
  const previous = Date.parse(key.lastUsedAt || "");
  if (!Number.isFinite(previous) || Date.parse(now) - previous >= 60 * 60 * 1000) {
    try {
      await env.DB.prepare("UPDATE agent_api_keys SET last_used_at = ? WHERE id = ? AND revoked_at IS NULL")
        .bind(now, key.id).run();
      key.lastUsedAt = now;
    } catch {
      // Usage display is best-effort; authorization rests on the preceding lookup.
    }
  }
  return key;
}

export function newAgentKeyId() {
  return randomId("pak_");
}
