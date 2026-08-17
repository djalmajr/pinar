import {
  type ProjectIcon,
  type AccountAuthSession,
  type AccountPlan,
  type AuthSession,
  type CaptureDestination,
  type Collection,
  type CollectionPlacement,
  type PageInfo,
  type Pin,
  type Project,
  type ProjectTree,
  type ProjectTreeCollection,
  type ProjectTreeProject,
  type Session,
} from "@pinar/shared";
import {
  DEFAULT_PROJECT_ICON,
  PERSONAL_PROJECT_ICON,
  isProjectIcon,
} from "@pinar/shared/project-icons";
import {
  FREE_AI_CREDITS,
  LIFETIME_AI_CREDITS,
  PRO_MONTHLY_AI_CREDITS,
  PURCHASED_AI_CREDITS,
  STORAGE_20GB_BYTES,
  STORAGE_5GB_BYTES,
  addUtcMonths,
  addUtcYears,
  baseStorageBytes,
  canStoreBytes,
  checkoutOffer,
  isSubscriptionOffer,
  legacyCheckoutOffer,
  planForOffer,
  storageEntitlement,
  type CheckoutOffer,
  type StorageEntitlement,
} from "../lib/entitlements";
import { type PricingConfig, pricingForCountry } from "../lib/pricing";
import { formatCollectionMarkdown, formatProjectMarkdown, formatSessionMarkdown } from "./markdown";
import { decodePngDataUrl } from "./png";

interface D1Result {
  results?: Record<string, unknown>[];
}

interface D1Statement {
  all(): Promise<D1Result>;
  bind(...values: unknown[]): D1Statement;
  first(): Promise<Record<string, unknown> | null>;
  run(): Promise<unknown>;
}

interface D1Database {
  batch(statements: D1Statement[]): Promise<unknown>;
  prepare(query: string): D1Statement;
}

interface R2Object {
  body: ReadableStream<Uint8Array>;
  httpEtag: string;
  writeHttpMetadata(headers: Headers): void;
}

interface R2Bucket {
  delete(key: string): Promise<unknown>;
  get(key: string): Promise<R2Object | null>;
  put(key: string, value: Uint8Array, options: { httpMetadata: { contentType: string } }): Promise<unknown>;
}

export interface CloudEnv {
  ADMIN_API_KEY?: string;
  AUTH_PEPPER?: string;
  DB?: D1Database;
  EMAIL?: SendEmail;
  EXTENSION_ORIGIN?: string;
  PINAR_BUCKET?: R2Bucket;
  PRICING_AI_CREDITS_1000_BRL_CENTS?: string;
  PRICING_AI_CREDITS_1000_USD_CENTS?: string;
  PRICING_LIFETIME_BRL_CENTS?: string;
  PRICING_LIFETIME_USD_CENTS?: string;
  PRICING_MONTHLY_BRL_CENTS?: string;
  PRICING_MONTHLY_USD_CENTS?: string;
  PRICING_STORAGE_20GB_12M_BRL_CENTS?: string;
  PRICING_STORAGE_20GB_12M_USD_CENTS?: string;
  PRICING_STORAGE_5GB_12M_BRL_CENTS?: string;
  PRICING_STORAGE_5GB_12M_USD_CENTS?: string;
  PRICING_YEARLY_BRL_CENTS?: string;
  PRICING_YEARLY_USD_CENTS?: string;
  STRIPE_PRICE_AI_CREDITS_1000?: string;
  STRIPE_PRICE_BR_AI_CREDITS_1000?: string;
  STRIPE_PRICE_BR_LIFETIME?: string;
  STRIPE_PRICE_BR_MONTHLY?: string;
  STRIPE_PRICE_BR_STORAGE_20GB_12M?: string;
  STRIPE_PRICE_BR_STORAGE_5GB_12M?: string;
  STRIPE_PRICE_BR_YEARLY?: string;
  STRIPE_PRICE_LIFETIME?: string;
  STRIPE_PRICE_MONTHLY?: string;
  STRIPE_PRICE_STORAGE_20GB_12M?: string;
  STRIPE_PRICE_STORAGE_5GB_12M?: string;
  STRIPE_PRICE_YEARLY?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
}

interface Principal {
  id: string;
  isPermanent: boolean;
  kind: "account" | "installation";
  plan: AccountPlan;
}

interface InstallationRecord {
  status: "active" | "migrated" | "revoked";
  tokenHash: string;
}

interface AccountRecord {
  aiCreditRefillAt: string;
  billingStatus: "active" | "canceled" | "past_due";
  email: string;
  everPaid: boolean;
  id: string;
  plan: AccountPlan;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
}

type AiCreditSourceType = "free_initial" | "lifetime_initial" | "pro_monthly" | "purchase";

interface AiCreditGrantRecord {
  consumedCredits: number;
  createdAt: string;
  credits: number;
  expiresAt: string | null;
  id: string;
  ownerId: string;
  ownerType: Principal["kind"];
  sourceId: string;
  sourceType: AiCreditSourceType;
}

interface StorageGrantRecord {
  byteCount: number;
  createdAt: string;
  expiresAt: string;
  id: string;
  sourceId: string;
  sourceType: "storage_20gb_12m" | "storage_5gb_12m";
  startsAt: string;
  userId: string;
}

interface WebSessionRecord {
  expiresAt: string;
  ownerId: string;
  ownerType: Principal["kind"];
  revokedAt: string | null;
}

interface DeviceSessionRecord {
  expiresAt: string;
  installationId: string;
  revokedAt: string | null;
  userId: string;
}

interface ExtensionCodeRecord {
  expiresAt: string;
  ownerId: string;
  ownerType: Principal["kind"];
  usedAt: string | null;
}

interface EmailChallengeRecord {
  attempts: number;
  codeHash: string;
  createdAt: string;
  expiresAt: string;
  id: string;
  usedAt: string | null;
  userId: string;
}

interface RateLimitRecord {
  attempts: number;
  windowStartedAt: number;
}

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz-";
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const DEVICE_TOKEN_PATTERN = /^pdt_[A-Za-z0-9_-]{43}$/;
const EMAIL_CODE_PATTERN = /^\d{6}$/;
const EXTENSION_CODE_PATTERN = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/;
const INSTALLATION_ID_PATTERN = /^ins_[A-Za-z0-9_-]{24}$/;
const INSTALLATION_TOKEN_PATTERN = /^pit_[A-Za-z0-9_-]{43}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const WEB_SESSION_COOKIE = "pinar_session";
const WEB_SESSION_PATTERN = /^pws_[A-Za-z0-9_-]{43}$/;
const memoryAccounts = new Map<string, AccountRecord>();
const memoryAiCreditGrants = new Map<string, AiCreditGrantRecord>();
const memoryCollections = new Map<string, Collection>();
const memoryDeviceSessions = new Map<string, DeviceSessionRecord>();
const memoryEmailChallenges = new Map<string, EmailChallengeRecord>();
const memoryExtensionCodes = new Map<string, ExtensionCodeRecord>();
const memoryInstallations = new Map<string, InstallationRecord>();
const memoryProjects = new Map<string, Project>();
const memoryRateLimits = new Map<string, RateLimitRecord>();
const memorySessions = new Map<string, Session>();
const memoryStorageGrants = new Map<string, StorageGrantRecord>();
const memoryStripeEvents = new Set<string>();
const memoryWebSessions = new Map<string, WebSessionRecord>();
let memoryMigrationFailure = false;
let testNow: number | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function numberValue(record: Record<string, unknown>, key: string) {
  const value = Number(record[key]);
  return Number.isFinite(value) ? value : 0;
}

function protectedValue(value: unknown) {
  return isRecord(value) && Boolean(value.isProtected ?? value.is_protected);
}

function stringArrayValue(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function collectionPlacementsValue(record: Record<string, unknown>) {
  const value = record.items;
  if (!Array.isArray(value)) return stringArrayValue(record, "ids");
  return value.flatMap((item): CollectionPlacement[] => {
    if (!isRecord(item) || typeof item.id !== "string") return [];
    return [{
      id: item.id,
      parentId: typeof item.parentId === "string" && item.parentId ? item.parentId : null,
    }];
  });
}

function pageValue(value: unknown): PageInfo {
  if (!isRecord(value)) return { title: "", url: "" };
  return { title: stringValue(value, "title"), url: stringValue(value, "url") };
}

function pinsValue(value: unknown): Pin[] {
  if (!Array.isArray(value)) return [];
  return JSON.parse(JSON.stringify(value));
}

async function readJson(message: Request | Response) {
  try {
    const value: unknown = await message.json();
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

function corsHeaders(initial?: HeadersInit) {
  const headers = new Headers(initial);
  headers.set("Access-Control-Allow-Headers", "authorization, content-type, x-pinar-installation-id");
  headers.set("Access-Control-Allow-Methods", "DELETE, GET, OPTIONS, PATCH, POST");
  headers.set("Access-Control-Allow-Origin", "*");
  return headers;
}

function json(data: unknown, status = 200, initial?: HeadersInit) {
  return Response.json(data, { headers: corsHeaders(initial), status });
}

function text(body: string, status = 200, initial?: HeadersInit) {
  return new Response(body, { headers: corsHeaders(initial), status });
}

function bearerToken(request: Request) {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : header.trim();
}

function cookieValue(request: Request, name: string) {
  const cookies = request.headers.get("cookie") || "";
  for (const part of cookies.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return "";
}

function generateNanoId(size = 12) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  let id = "";
  for (let index = 0; index < size; index += 1) id += ALPHABET[bytes[index] & 63];
  return id;
}

function currentDate() {
  return new Date(testNow ?? Date.now());
}

function generateCode(size: number) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte & 31]).join("");
}

function generateEmailCode() {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(bytes[0] % 1_000_000).padStart(6, "0");
}

function randomLetters(size = 8) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function randomCredential(prefix: string, byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `${prefix}${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")}`;
}

async function hashCredential(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashCode(env: CloudEnv, purpose: string, value: string) {
  const pepper = env.AUTH_PEPPER;
  if (!pepper) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${purpose}:${value}`),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  if (leftBytes.byteLength !== rightBytes.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.byteLength; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

function accountPlan(value: unknown): AccountPlan {
  return value === "lifetime" || value === "pro" ? value : "free";
}

function accountFromRow(row: Record<string, unknown>): AccountRecord {
  return {
    aiCreditRefillAt: String(row.ai_credit_refill_at || ""),
    billingStatus: row.billing_status === "canceled" || row.billing_status === "past_due"
      ? row.billing_status
      : "active",
    email: String(row.email || ""),
    everPaid: Number(row.ever_paid) === 1,
    id: String(row.id || ""),
    plan: accountPlan(row.plan),
    stripeCustomerId: String(row.stripe_customer_id || ""),
    stripeSubscriptionId: String(row.stripe_subscription_id || ""),
  };
}

function accountAuthSession(account: AccountRecord): AccountAuthSession {
  return {
    email: account.email,
    kind: "account",
    plan: account.plan,
    userId: account.id,
  };
}

function principalForAccount(account: AccountRecord): Principal {
  return {
    id: account.id,
    isPermanent: account.plan === "lifetime" || account.plan === "pro",
    kind: "account",
    plan: account.plan,
  };
}

function installationPrincipal(id: string): Principal {
  return { id, isPermanent: false, kind: "installation", plan: "free" };
}

function normalizeEmail(value: string) {
  return value.trim().toLocaleLowerCase("en-US");
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function clientIp(request: Request) {
  return request.headers.get("cf-connecting-ip")?.trim() || "unknown";
}

function requestCountry(request: Request) {
  const country = request.cf?.country;
  return typeof country === "string" ? country.trim().toUpperCase() : null;
}

function pricingConfig(env: CloudEnv): PricingConfig | null {
  const config: PricingConfig = {
    aiCredits1000BrlCents: Number(env.PRICING_AI_CREDITS_1000_BRL_CENTS),
    aiCredits1000UsdCents: Number(env.PRICING_AI_CREDITS_1000_USD_CENTS),
    lifetimeBrlCents: Number(env.PRICING_LIFETIME_BRL_CENTS),
    lifetimeUsdCents: Number(env.PRICING_LIFETIME_USD_CENTS),
    monthlyBrlCents: Number(env.PRICING_MONTHLY_BRL_CENTS),
    monthlyUsdCents: Number(env.PRICING_MONTHLY_USD_CENTS),
    storage20Gb12MBrlCents: Number(env.PRICING_STORAGE_20GB_12M_BRL_CENTS),
    storage20Gb12MUsdCents: Number(env.PRICING_STORAGE_20GB_12M_USD_CENTS),
    storage5Gb12MBrlCents: Number(env.PRICING_STORAGE_5GB_12M_BRL_CENTS),
    storage5Gb12MUsdCents: Number(env.PRICING_STORAGE_5GB_12M_USD_CENTS),
    yearlyBrlCents: Number(env.PRICING_YEARLY_BRL_CENTS),
    yearlyUsdCents: Number(env.PRICING_YEARLY_USD_CENTS),
  };
  return Object.values(config).every((amount) => Number.isInteger(amount) && amount > 0)
    ? config
    : null;
}

function validMutationOrigin(request: Request, env: CloudEnv) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  if (origin === new URL(request.url).origin) return true;
  const extensionOrigin = env.EXTENSION_ORIGIN?.trim().replace(/\/+$/, "");
  return Boolean(extensionOrigin && origin === extensionOrigin);
}

function internalReturnTo(value: string) {
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")
    ? value
    : "/app";
}

function webSessionCookie(token: string, maxAge: number) {
  return `${WEB_SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

async function findAccountById(env: CloudEnv, id: string) {
  if (env.DB) {
    const row = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
    return row ? accountFromRow(row) : null;
  }
  return memoryAccounts.get(id) || null;
}

async function findAccountByEmail(env: CloudEnv, email: string) {
  if (env.DB) {
    const row = await env.DB.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE")
      .bind(email).first();
    return row ? accountFromRow(row) : null;
  }
  return Array.from(memoryAccounts.values()).find((account) => account.email === email) || null;
}

async function findAccountByStripeCustomer(env: CloudEnv, customerId: string) {
  if (!customerId) return null;
  if (env.DB) {
    const row = await env.DB.prepare("SELECT * FROM users WHERE stripe_customer_id = ?")
      .bind(customerId).first();
    return row ? accountFromRow(row) : null;
  }
  return Array.from(memoryAccounts.values()).find(
    (account) => account.stripeCustomerId === customerId,
  ) || null;
}

interface GrantAiCreditsInput {
  credits: number;
  env: CloudEnv;
  expiresAt: string | null;
  ownerId: string;
  ownerType: Principal["kind"];
  sourceId: string;
  sourceType: AiCreditSourceType;
}

async function grantAiCredits(input: GrantAiCreditsInput) {
  const createdAt = currentDate().toISOString();
  if (input.env.DB) {
    await input.env.DB.prepare(
      "INSERT OR IGNORE INTO ai_credit_grants "
      + "(id, owner_type, owner_id, source_type, source_id, credits, consumed_credits, expires_at, created_at) "
      + "VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)",
    ).bind(
      "aic_" + generateNanoId(24),
      input.ownerType,
      input.ownerId,
      input.sourceType,
      input.sourceId,
      input.credits,
      input.expiresAt,
      createdAt,
    ).run();
    return;
  }
  if (memoryAiCreditGrants.has(input.sourceId)) return;
  memoryAiCreditGrants.set(input.sourceId, {
    consumedCredits: 0,
    createdAt,
    credits: input.credits,
    expiresAt: input.expiresAt,
    id: "aic_" + generateNanoId(24),
    ownerId: input.ownerId,
    ownerType: input.ownerType,
    sourceId: input.sourceId,
    sourceType: input.sourceType,
  });
}

async function moveAiCreditsToAccount(env: CloudEnv, installationId: string, userId: string) {
  if (env.DB) {
    await env.DB.prepare(
      "UPDATE ai_credit_grants SET owner_type = 'account', owner_id = ? "
      + "WHERE owner_type = 'installation' AND owner_id = ?",
    ).bind(userId, installationId).run();
    return;
  }
  for (const grant of memoryAiCreditGrants.values()) {
    if (grant.ownerType !== "installation" || grant.ownerId !== installationId) continue;
    grant.ownerId = userId;
    grant.ownerType = "account";
  }
}

async function aiCreditBalance(env: CloudEnv, principal: Principal) {
  const now = currentDate().toISOString();
  if (env.DB) {
    const row = await env.DB.prepare(
      "SELECT COALESCE(SUM(credits - consumed_credits), 0) AS balance, MIN(expires_at) AS next_expiry_at "
      + "FROM ai_credit_grants WHERE owner_type = ? AND owner_id = ? "
      + "AND (expires_at IS NULL OR expires_at > ?)",
    ).bind(principal.kind, principal.id, now).first();
    return {
      balance: Number(row?.balance || 0),
      nextExpiryAt: typeof row?.next_expiry_at === "string" ? row.next_expiry_at : null,
    };
  }
  const grants = Array.from(memoryAiCreditGrants.values()).filter(
    (grant) => grant.ownerType === principal.kind
      && grant.ownerId === principal.id
      && (!grant.expiresAt || grant.expiresAt > now),
  );
  return {
    balance: grants.reduce((total, grant) => total + grant.credits - grant.consumedCredits, 0),
    nextExpiryAt: grants.map((grant) => grant.expiresAt).filter((value) => value !== null).sort()[0] || null,
  };
}

interface GrantStorageInput {
  byteCount: number;
  env: CloudEnv;
  expiresAt: string;
  sourceId: string;
  sourceType: StorageGrantRecord["sourceType"];
  startsAt: string;
  userId: string;
}

async function grantStorage(input: GrantStorageInput) {
  const createdAt = currentDate().toISOString();
  if (input.env.DB) {
    await input.env.DB.prepare(
      "INSERT OR IGNORE INTO storage_grants "
      + "(id, user_id, source_type, source_id, byte_count, starts_at, expires_at, created_at) "
      + "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      "stg_" + generateNanoId(24),
      input.userId,
      input.sourceType,
      input.sourceId,
      input.byteCount,
      input.startsAt,
      input.expiresAt,
      createdAt,
    ).run();
    return;
  }
  if (memoryStorageGrants.has(input.sourceId)) return;
  memoryStorageGrants.set(input.sourceId, {
    byteCount: input.byteCount,
    createdAt,
    expiresAt: input.expiresAt,
    id: "stg_" + generateNanoId(24),
    sourceId: input.sourceId,
    sourceType: input.sourceType,
    startsAt: input.startsAt,
    userId: input.userId,
  });
}

async function storageGrantSummary(env: CloudEnv, userId: string) {
  const now = currentDate().toISOString();
  if (env.DB) {
    const row = await env.DB.prepare(
      "SELECT COALESCE(SUM(CASE WHEN expires_at > ? THEN byte_count ELSE 0 END), 0) AS active_bytes, "
      + "MAX(CASE WHEN expires_at <= ? THEN expires_at ELSE NULL END) AS latest_expired_at, "
      + "MIN(CASE WHEN expires_at > ? THEN expires_at ELSE NULL END) AS next_expiry_at "
      + "FROM storage_grants WHERE user_id = ?",
    ).bind(now, now, now, userId).first();
    return {
      activeBytes: Number(row?.active_bytes || 0),
      latestExpiredAt: typeof row?.latest_expired_at === "string" ? row.latest_expired_at : null,
      nextExpiryAt: typeof row?.next_expiry_at === "string" ? row.next_expiry_at : null,
    };
  }
  const grants = Array.from(memoryStorageGrants.values()).filter((grant) => grant.userId === userId);
  return {
    activeBytes: grants
      .filter((grant) => grant.expiresAt > now)
      .reduce((total, grant) => total + grant.byteCount, 0),
    latestExpiredAt: grants
      .filter((grant) => grant.expiresAt <= now)
      .map((grant) => grant.expiresAt)
      .sort()
      .at(-1) || null,
    nextExpiryAt: grants
      .filter((grant) => grant.expiresAt > now)
      .map((grant) => grant.expiresAt)
      .sort()[0] || null,
  };
}

async function storageUsedBytes(env: CloudEnv, ownerId: string) {
  if (env.DB) {
    const row = await env.DB.prepare(
      "SELECT COALESCE(SUM(CASE WHEN byte_size > 0 THEN byte_size ELSE 0 END), 0) AS used_bytes "
      + "FROM sessions WHERE user_id = ?",
    ).bind(ownerId).first();
    return Number(row?.used_bytes || 0);
  }
  return Array.from(memorySessions.values())
    .filter((session) => session.userId === ownerId)
    .reduce((total, session) => total + Math.max(0, Number(session.byteSize || 0)), 0);
}

async function existingSessionBytes(env: CloudEnv, ownerId: string, sessionId: string) {
  if (env.DB) {
    const row = await env.DB.prepare("SELECT byte_size FROM sessions WHERE user_id = ? AND id = ?")
      .bind(ownerId, sessionId).first();
    return Number(row?.byte_size || 0);
  }
  const session = memorySessions.get(sessionId);
  return session?.userId === ownerId ? Number(session.byteSize || 0) : 0;
}

async function storageForPrincipal(env: CloudEnv, principal: Principal): Promise<StorageEntitlement> {
  const grants = principal.kind === "account"
    ? await storageGrantSummary(env, principal.id)
    : { activeBytes: 0, latestExpiredAt: null, nextExpiryAt: null };
  return storageEntitlement({
    activeAddOnBytes: grants.activeBytes,
    baseBytes: baseStorageBytes(principal.plan),
    latestExpiredAt: grants.latestExpiredAt,
    nextExpiryAt: grants.nextExpiryAt,
    now: currentDate(),
    usedBytes: await storageUsedBytes(env, principal.id),
  });
}

async function setAccountRefillAt(env: CloudEnv, account: AccountRecord, refillAt: string) {
  if (env.DB) {
    await env.DB.prepare("UPDATE users SET ai_credit_refill_at = ?, updated_at = ? WHERE id = ?")
      .bind(refillAt, currentDate().toISOString(), account.id).run();
  }
  account.aiCreditRefillAt = refillAt;
}

async function ensureProMonthlyCredits(env: CloudEnv, account: AccountRecord) {
  if (account.plan !== "pro" || account.billingStatus !== "active") return;
  const now = currentDate();
  if (account.aiCreditRefillAt && account.aiCreditRefillAt > now.toISOString()) return;
  const sourceMarker = account.aiCreditRefillAt || account.stripeSubscriptionId || "initial";
  const expiresAt = addUtcMonths(now, 1).toISOString();
  await grantAiCredits({
    credits: PRO_MONTHLY_AI_CREDITS,
    env,
    expiresAt,
    ownerId: account.id,
    ownerType: "account",
    sourceId: `pro:${account.id}:${sourceMarker}`,
    sourceType: "pro_monthly",
  });
  await setAccountRefillAt(env, account, expiresAt);
}

async function stripeEventProcessed(env: CloudEnv, eventId: string) {
  if (env.DB) {
    return Boolean(await env.DB.prepare("SELECT id FROM stripe_events WHERE id = ?").bind(eventId).first());
  }
  return memoryStripeEvents.has(eventId);
}

async function recordStripeEvent(env: CloudEnv, eventId: string, eventType: string) {
  const now = currentDate().toISOString();
  if (env.DB) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO stripe_events (id, type, created_at, processed_at) VALUES (?, ?, ?, ?)",
    ).bind(eventId, eventType, now, now).run();
    return;
  }
  memoryStripeEvents.add(eventId);
}

async function authSessionForPrincipal(env: CloudEnv, principal: Principal): Promise<AuthSession | null> {
  if (principal.kind === "installation") {
    return { installationId: principal.id, kind: "installation", plan: "free" };
  }
  const account = await findAccountById(env, principal.id);
  return account ? accountAuthSession(account) : null;
}

async function consumeRateLimit(
  env: CloudEnv,
  action: string,
  scope: string,
  limit: number,
  windowMs: number,
) {
  const scopeHash = await hashCredential(scope);
  const now = currentDate();
  const cutoff = new Date(now.getTime() - windowMs).toISOString();
  if (env.DB) {
    const row = await env.DB.prepare(`
      INSERT INTO auth_rate_limits (action, scope_hash, window_started_at, attempts)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(action, scope_hash) DO UPDATE SET
        attempts = CASE WHEN window_started_at <= ? THEN 1 ELSE attempts + 1 END,
        window_started_at = CASE WHEN window_started_at <= ? THEN excluded.window_started_at ELSE window_started_at END
      RETURNING attempts
    `).bind(action, scopeHash, now.toISOString(), cutoff, cutoff).first();
    return Number(row?.attempts || 0) <= limit;
  }
  const key = `${action}:${scopeHash}`;
  const record = memoryRateLimits.get(key);
  if (!record || record.windowStartedAt <= now.getTime() - windowMs) {
    memoryRateLimits.set(key, { attempts: 1, windowStartedAt: now.getTime() });
    return true;
  }
  record.attempts += 1;
  return record.attempts <= limit;
}

async function withinRateLimits(
  env: CloudEnv,
  action: string,
  scopes: Array<{ limit: number; scope: string }>,
  windowMs: number,
) {
  for (const item of scopes) {
    if (!await consumeRateLimit(env, action, item.scope, item.limit, windowMs)) return false;
  }
  return true;
}

function sessionFromRow(row: Record<string, unknown>): Session {
  let pins: Pin[] = [];
  try {
    pins = pinsValue(JSON.parse(String(row.pins_json || "[]")));
  } catch {
    pins = [];
  }
  return {
    byteSize: Number(row.byte_size || 0),
    collectionId: String(row.collection_id || ""),
    createdAt: String(row.created_at || ""),
    id: String(row.id || ""),
    isPermanent: Boolean(row.is_permanent),
    page: { title: String(row.title || ""), url: String(row.url || "") },
    pinCount: Number(row.pin_count || 0),
    pins,
    plan: accountPlan(row.plan),
    position: Number(row.position || 0),
    shotId: String(row.shot_id || ""),
    shotUrl: typeof row.shot_url === "string" ? row.shot_url : null,
    userId: typeof row.user_id === "string" ? row.user_id : null,
  };
}

function sessionMatchesQuery(session: Session, query: string) {
  if (!query) return true;
  const needle = query.toLocaleLowerCase();
  return [session.page?.title, session.page?.url, JSON.stringify(session.pins || [])].some((value) => {
    return String(value || "").toLocaleLowerCase().includes(needle);
  });
}

async function findPublicSession(env: CloudEnv, id: string) {
  if (!SESSION_ID_PATTERN.test(id)) return null;
  if (env.DB) {
    try {
      const row = await env.DB.prepare("SELECT * FROM sessions WHERE id = ?").bind(id).first();
      return row ? sessionFromRow(row) : null;
    } catch {
      return null;
    }
  }
  return memorySessions.get(id) || null;
}

async function findPublicCollection(env: CloudEnv, id: string): Promise<ProjectTreeCollection | null> {
  if (env.DB) {
    const row = await env.DB.prepare("SELECT * FROM collections WHERE id = ?").bind(id).first();
    if (!row) return null;
    const sessions = await env.DB.prepare(
      "SELECT * FROM sessions WHERE collection_id = ? ORDER BY position ASC",
    ).bind(id).all();
    return { ...collectionFromRow(row), sessions: (sessions.results || []).map(sessionFromRow) };
  }
  const collection = memoryCollections.get(id);
  if (!collection) return null;
  return {
    ...collection,
    sessions: Array.from(memorySessions.values())
      .filter((session) => session.collectionId === id && session.userId === collection.ownerId)
      .sort((left, right) => Number(left.position) - Number(right.position)),
  };
}

async function findPublicProject(env: CloudEnv, id: string): Promise<ProjectTreeProject | null> {
  if (env.DB) {
    const row = await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first();
    if (!row) return null;
    const result = await env.DB.prepare(
      "SELECT * FROM collections WHERE project_id = ? ORDER BY position ASC",
    ).bind(id).all();
    const collections = sortCollections((result.results || []).map(collectionFromRow));
    return {
      ...projectFromRow(row),
      collections: await Promise.all(collections.map(async (collection) => {
        const publicCollection = await findPublicCollection(env, collection.id);
        if (!publicCollection) throw new Error("Collection disappeared while building project aggregate");
        return publicCollection;
      })),
    };
  }
  const project = memoryProjects.get(id);
  if (!project) return null;
  const collections = sortCollections(Array.from(memoryCollections.values())
    .filter((collection) => collection.projectId === id && collection.ownerId === project.ownerId));
  return {
    ...project,
    collections: await Promise.all(collections.map(async (collection) => {
      const publicCollection = await findPublicCollection(env, collection.id);
      if (!publicCollection) throw new Error("Collection disappeared while building project aggregate");
      return publicCollection;
    })),
  };
}

async function listSessions(
  env: CloudEnv,
  principal: Principal,
  query: string,
  requestedLimit: string,
  collectionId = "",
) {
  const limit = Math.min(Math.max(Number(requestedLimit) || 50, 1), 100);
  if (env.DB) {
    const clauses = ["user_id = ?"];
    const values: unknown[] = [principal.id];
    if (collectionId) {
      clauses.push("collection_id = ?");
      values.push(collectionId);
    }
    if (query) {
      clauses.push("(title LIKE ? OR url LIKE ? OR pins_json LIKE ?)");
      values.push(`%${query}%`, `%${query}%`, `%${query}%`);
    }
    const order = collectionId ? "position ASC" : "created_at DESC";
    const statement = env.DB.prepare(
      `SELECT * FROM sessions WHERE ${clauses.join(" AND ")} ORDER BY ${order} LIMIT ?`,
    ).bind(...values, limit);
    const result = await statement.all();
    return (result.results || []).map(sessionFromRow);
  }
  return Array.from(memorySessions.values())
    .filter((session) => session.userId === principal.id
      && (!collectionId || session.collectionId === collectionId)
      && sessionMatchesQuery(session, query))
    .sort((left, right) => collectionId
      ? Number(left.position) - Number(right.position)
      : right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit);
}

async function listCollectionSessions(env: CloudEnv, principal: Principal, collectionId: string) {
  if (env.DB) {
    const result = await env.DB.prepare(`
      SELECT * FROM sessions
      WHERE user_id = ? AND collection_id = ?
      ORDER BY position ASC
    `).bind(principal.id, collectionId).all();
    return (result.results || []).map(sessionFromRow);
  }
  return Array.from(memorySessions.values())
    .filter((session) => session.userId === principal.id && session.collectionId === collectionId)
    .sort((left, right) => Number(left.position) - Number(right.position));
}

async function principalFromOwner(env: CloudEnv, ownerType: Principal["kind"], ownerId: string) {
  if (ownerType === "account") {
    const account = await findAccountById(env, ownerId);
    return account ? principalForAccount(account) : null;
  }
  if (env.DB) {
    const installation = await env.DB.prepare(
      "SELECT id FROM installations WHERE id = ? AND status = 'active'",
    ).bind(ownerId).first();
    return installation ? installationPrincipal(String(installation.id)) : null;
  }
  return memoryInstallations.get(ownerId)?.status === "active" ? installationPrincipal(ownerId) : null;
}

async function resolvePrincipal(request: Request, env: CloudEnv): Promise<Principal | null> {
  const now = currentDate().toISOString();
  const webToken = cookieValue(request, WEB_SESSION_COOKIE);
  if (WEB_SESSION_PATTERN.test(webToken)) {
    const tokenHash = await hashCredential(webToken);
    if (env.DB) {
      try {
        const session = await env.DB.prepare(`
          SELECT owner_id, owner_type FROM web_sessions
          WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?
        `).bind(tokenHash, now).first();
        if (session && (session.owner_type === "account" || session.owner_type === "installation")) {
          return principalFromOwner(env, session.owner_type, String(session.owner_id));
        }
      } catch {
        return null;
      }
    } else {
      const session = memoryWebSessions.get(tokenHash);
      if (session && !session.revokedAt && session.expiresAt > now) {
        return principalFromOwner(env, session.ownerType, session.ownerId);
      }
    }
  }

  const token = bearerToken(request);
  if (DEVICE_TOKEN_PATTERN.test(token)) {
    const tokenHash = await hashCredential(token);
    if (env.DB) {
      try {
        const session = await env.DB.prepare(`
          SELECT user_id FROM device_sessions
          WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?
        `).bind(tokenHash, now).first();
        if (!session) return null;
        await env.DB.prepare("UPDATE device_sessions SET last_seen_at = ? WHERE token_hash = ?")
          .bind(now, tokenHash).run();
        return principalFromOwner(env, "account", String(session.user_id));
      } catch {
        return null;
      }
    }
    const session = memoryDeviceSessions.get(tokenHash);
    if (!session || session.revokedAt || session.expiresAt <= now) return null;
    return principalFromOwner(env, "account", session.userId);
  }

  const installationId = request.headers.get("x-pinar-installation-id") || "";
  if (!INSTALLATION_ID_PATTERN.test(installationId) || !INSTALLATION_TOKEN_PATTERN.test(token)) return null;
  const tokenHash = await hashCredential(token);
  if (env.DB) {
    try {
      const installation = await env.DB.prepare(
        "SELECT id FROM installations WHERE id = ? AND token_hash = ? AND status = 'active'",
      ).bind(installationId, tokenHash).first();
      if (!installation) return null;
      await env.DB.prepare("UPDATE installations SET last_seen_at = ?, updated_at = ? WHERE id = ?")
        .bind(now, now, installationId).run();
      return installationPrincipal(String(installation.id));
    } catch {
      return null;
    }
  }
  const installation = memoryInstallations.get(installationId);
  if (!installation || installation.status !== "active" || installation.tokenHash !== tokenHash) return null;
  return installationPrincipal(installationId);
}

async function registerInstallation(request: Request, env: CloudEnv) {
  const body = await readJson(request);
  const installationId = stringValue(body, "installationId");
  const installationToken = stringValue(body, "installationToken");
  if (!INSTALLATION_ID_PATTERN.test(installationId) || !INSTALLATION_TOKEN_PATTERN.test(installationToken)) {
    return json({ error: "Invalid installation identity" }, 400);
  }
  const tokenHash = await hashCredential(installationToken);
  const now = currentDate().toISOString();
  if (env.DB) {
    try {
      const existing = await env.DB.prepare("SELECT token_hash, status FROM installations WHERE id = ?")
        .bind(installationId).first();
      if (existing) {
        if (existing.token_hash !== tokenHash || existing.status !== "active") {
          return json({ error: "Installation identity already exists" }, 409);
        }
        await env.DB.prepare("UPDATE installations SET last_seen_at = ?, updated_at = ? WHERE id = ?")
          .bind(now, now, installationId).run();
        await grantAiCredits({
          credits: FREE_AI_CREDITS,
          env,
          expiresAt: null,
          ownerId: installationId,
          ownerType: "installation",
          sourceId: `free:${installationId}`,
          sourceType: "free_initial",
        });
        return json({ installationId, ok: true });
      }
      await env.DB.prepare(
        "INSERT INTO installations (id, token_hash, status, created_at, updated_at, last_seen_at) VALUES (?, ?, 'active', ?, ?, ?)",
      ).bind(installationId, tokenHash, now, now, now).run();
    } catch {
      return json({ error: "Installation registration unavailable" }, 503);
    }
  } else {
    const existing = memoryInstallations.get(installationId);
    if (existing && (existing.tokenHash !== tokenHash || existing.status !== "active")) {
      return json({ error: "Installation identity already exists" }, 409);
    }
    if (existing) {
      await grantAiCredits({
        credits: FREE_AI_CREDITS,
        env,
        expiresAt: null,
        ownerId: installationId,
        ownerType: "installation",
        sourceId: `free:${installationId}`,
        sourceType: "free_initial",
      });
      return json({ installationId, ok: true });
    }
    memoryInstallations.set(installationId, { status: "active", tokenHash });
  }
  await grantAiCredits({
    credits: FREE_AI_CREDITS,
    env,
    expiresAt: null,
    ownerId: installationId,
    ownerType: "installation",
    sourceId: `free:${installationId}`,
    sourceType: "free_initial",
  });
  return json({ installationId, ok: true }, 201);
}

async function issueWebSession(env: CloudEnv, principal: Principal) {
  const token = randomCredential("pws_");
  const tokenHash = await hashCredential(token);
  const now = currentDate();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  if (env.DB) {
    await env.DB.prepare(
      "INSERT INTO web_sessions (token_hash, owner_type, owner_id, expires_at, revoked_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
    ).bind(tokenHash, principal.kind, principal.id, expiresAt, now.toISOString()).run();
  } else {
    memoryWebSessions.set(tokenHash, {
      expiresAt,
      ownerId: principal.id,
      ownerType: principal.kind,
      revokedAt: null,
    });
  }
  return { expiresAt, token };
}

async function authSession(request: Request, env: CloudEnv) {
  const principal = await resolvePrincipal(request, env);
  if (!principal) return json({ session: null }, 401, { "Cache-Control": "no-store" });
  return json(
    { session: await authSessionForPrincipal(env, principal) },
    200,
    { "Cache-Control": "no-store" },
  );
}

async function createExtensionCode(request: Request, env: CloudEnv) {
  const principal = await resolvePrincipal(request, env);
  if (!principal) return json({ error: "Unauthorized" }, 401);
  const allowed = await withinRateLimits(
    env,
    "extension-code",
    [
      { limit: 10, scope: "ip:" + clientIp(request) },
      { limit: 10, scope: principal.kind + ":" + principal.id },
    ],
    5 * 60 * 1000,
  );
  if (!allowed) return json({ error: "Too many requests" }, 429);
  const code = generateCode(8);
  const codeHash = await hashCode(env, "extension-code", code);
  if (!codeHash) return json({ error: "Authentication is not configured" }, 503);
  const now = currentDate();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
  if (env.DB) {
    await env.DB.prepare(
      "INSERT INTO extension_codes (code_hash, owner_type, owner_id, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
    ).bind(codeHash, principal.kind, principal.id, expiresAt, now.toISOString()).run();
  } else {
    memoryExtensionCodes.set(codeHash, {
      expiresAt,
      ownerId: principal.id,
      ownerType: principal.kind,
      usedAt: null,
    });
  }
  return json({ code, expiresAt, ok: true }, 201, { "Cache-Control": "no-store" });
}

async function exchangeExtensionCode(request: Request, env: CloudEnv) {
  const body = await readJson(request);
  const code = stringValue(body, "code").replace(/[\s-]/g, "").toUpperCase();
  if (!EXTENSION_CODE_PATTERN.test(code)) return json({ error: "Invalid or expired code" }, 400);
  const allowed = await withinRateLimits(
    env,
    "extension-code-exchange",
    [{ limit: 20, scope: "ip:" + clientIp(request) }],
    5 * 60 * 1000,
  );
  if (!allowed) return json({ error: "Too many requests" }, 429);
  const codeHash = await hashCode(env, "extension-code", code);
  if (!codeHash) return json({ error: "Authentication is not configured" }, 503);
  const now = currentDate().toISOString();
  let ownerId = "";
  let ownerType: Principal["kind"] | null = null;
  if (env.DB) {
    const claimed = await env.DB.prepare(
      "UPDATE extension_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING owner_id, owner_type",
    ).bind(now, codeHash, now).first();
    if (claimed && (claimed.owner_type === "account" || claimed.owner_type === "installation")) {
      ownerId = String(claimed.owner_id);
      ownerType = claimed.owner_type;
    }
  } else {
    const record = memoryExtensionCodes.get(codeHash);
    if (record && !record.usedAt && record.expiresAt > now) {
      record.usedAt = now;
      ownerId = record.ownerId;
      ownerType = record.ownerType;
    }
  }
  if (!ownerType) return json({ error: "Invalid or expired code" }, 400);
  const principal = await principalFromOwner(env, ownerType, ownerId);
  if (!principal) return json({ error: "Invalid or expired code" }, 400);
  const session = await authSessionForPrincipal(env, principal);
  if (!session) return json({ error: "Invalid or expired code" }, 400);
  const issued = await issueWebSession(env, principal);
  const redirectTo = internalReturnTo(stringValue(body, "returnTo"));
  return json({ ok: true, redirectTo, session }, 200, {
    "Cache-Control": "no-store",
    "Set-Cookie": webSessionCookie(issued.token, 30 * 24 * 60 * 60),
  });
}

async function requestEmailCode(request: Request, env: CloudEnv) {
  const body = await readJson(request);
  const email = normalizeEmail(stringValue(body, "email"));
  const generic = { accepted: true, expiresInSeconds: 600 };
  if (!isEmail(email)) return json(generic, 202, { "Cache-Control": "no-store" });
  const allowed = await withinRateLimits(
    env,
    "email-code",
    [
      { limit: 10, scope: "ip:" + clientIp(request) },
      { limit: 5, scope: "email:" + email },
    ],
    15 * 60 * 1000,
  );
  if (!allowed) return json({ error: "Too many requests" }, 429);
  const account = await findAccountByEmail(env, email);
  const code = generateEmailCode();
  const codeHash = await hashCode(env, "email-code", email + ":" + code);
  if (!account?.everPaid || !codeHash || !env.EMAIL) {
    return json(generic, 202, { "Cache-Control": "no-store" });
  }
  const now = currentDate();
  const challenge: EmailChallengeRecord = {
    attempts: 0,
    codeHash,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
    id: "emc_" + generateNanoId(24),
    usedAt: null,
    userId: account.id,
  };
  if (env.DB) {
    await env.DB.prepare(
      "INSERT INTO email_challenges (id, user_id, code_hash, attempts, expires_at, used_at, created_at) VALUES (?, ?, ?, 0, ?, NULL, ?)",
    ).bind(
      challenge.id,
      challenge.userId,
      challenge.codeHash,
      challenge.expiresAt,
      challenge.createdAt,
    ).run();
  } else {
    memoryEmailChallenges.set(challenge.id, challenge);
  }
  try {
    await env.EMAIL.send({
      from: { email: "noreply@pinar.dev", name: "Pinar" },
      html: "<p>Your Pinar sign-in code is:</p><p><strong>" + code + "</strong></p><p>This code expires in 10 minutes.</p>",
      subject: "Your Pinar sign-in code",
      text: "Your Pinar sign-in code is " + code + ". It expires in 10 minutes.",
      to: account.email,
    });
  } catch (error) {
    console.error(JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      message: "email_code_delivery_failed",
    }));
    if (env.DB) {
      await env.DB.prepare("DELETE FROM email_challenges WHERE id = ?").bind(challenge.id).run();
    } else {
      memoryEmailChallenges.delete(challenge.id);
    }
  }
  return json(generic, 202, { "Cache-Control": "no-store" });
}

async function latestEmailChallenge(env: CloudEnv, userId: string) {
  if (env.DB) {
    const row = await env.DB.prepare(
      "SELECT * FROM email_challenges WHERE user_id = ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1",
    ).bind(userId).first();
    return row
      ? {
        attempts: Number(row.attempts || 0),
        codeHash: String(row.code_hash || ""),
        createdAt: String(row.created_at || ""),
        expiresAt: String(row.expires_at || ""),
        id: String(row.id || ""),
        usedAt: typeof row.used_at === "string" ? row.used_at : null,
        userId: String(row.user_id || ""),
      } satisfies EmailChallengeRecord
      : null;
  }
  return Array.from(memoryEmailChallenges.values())
    .filter((challenge) => challenge.userId === userId && !challenge.usedAt)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] || null;
}

async function recordWrongEmailCode(env: CloudEnv, challenge: EmailChallengeRecord) {
  if (env.DB) {
    const row = await env.DB.prepare(
      "UPDATE email_challenges SET attempts = attempts + 1 WHERE id = ? AND used_at IS NULL RETURNING attempts",
    ).bind(challenge.id).first();
    return Number(row?.attempts || 0);
  }
  challenge.attempts += 1;
  return challenge.attempts;
}

async function claimEmailChallenge(env: CloudEnv, challenge: EmailChallengeRecord) {
  const now = currentDate().toISOString();
  if (env.DB) {
    const row = await env.DB.prepare(
      "UPDATE email_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL AND attempts < 5 AND expires_at > ? RETURNING id",
    ).bind(now, challenge.id, now).first();
    return Boolean(row);
  }
  if (challenge.usedAt || challenge.attempts >= 5 || challenge.expiresAt <= now) return false;
  challenge.usedAt = now;
  return true;
}

async function verifyInstallationCredentials(
  env: CloudEnv,
  installationId: string,
  installationToken: string,
) {
  if (!INSTALLATION_ID_PATTERN.test(installationId) || !INSTALLATION_TOKEN_PATTERN.test(installationToken)) {
    return false;
  }
  const tokenHash = await hashCredential(installationToken);
  if (env.DB) {
    const installation = await env.DB.prepare(
      "SELECT id FROM installations WHERE id = ? AND token_hash = ? AND status = 'active'",
    ).bind(installationId, tokenHash).first();
    return Boolean(installation);
  }
  const installation = memoryInstallations.get(installationId);
  return installation?.status === "active" && installation.tokenHash === tokenHash;
}

async function migrateInstallationToAccount(
  env: CloudEnv,
  account: AccountRecord,
  installationId: string,
) {
  const accountPrincipal = principalForAccount(account);
  const sourcePrincipal = installationPrincipal(installationId);
  const source = await ensureDefaultDestination(env, sourcePrincipal);
  const target = await ensureDefaultDestination(env, accountPrincipal);
  const token = randomCredential("pdt_");
  const tokenHash = await hashCredential(token);
  const now = currentDate();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000).toISOString();
  const deviceId = "dev_" + generateNanoId(24);

  if (env.DB) {
    const projectPosition = await env.DB.prepare(
      "SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM projects WHERE owner_id = ?",
    ).bind(account.id).first();
    const collectionPosition = await env.DB.prepare(
      "SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM collections WHERE owner_id = ? AND project_id = ?",
    ).bind(account.id, target.projectId).first();
    const inboxPosition = await env.DB.prepare(
      "SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM sessions WHERE user_id = ? AND collection_id = ?",
    ).bind(account.id, target.collectionId).first();
    try {
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE sessions SET collection_id = ?, position = position + ? WHERE user_id = ? AND collection_id = ?",
        ).bind(target.collectionId, Number(inboxPosition?.next_position || 0), installationId, source.collectionId),
        env.DB.prepare(
          "UPDATE sessions SET user_id = ?, plan = ?, is_permanent = ? WHERE user_id = ?",
        ).bind(account.id, account.plan, account.plan === "free" ? 0 : 1, installationId),
        env.DB.prepare(
          "UPDATE collections SET parent_id = ? WHERE owner_id = ? AND parent_id = ?",
        ).bind(target.collectionId, installationId, source.collectionId),
        env.DB.prepare(
          "UPDATE collections SET owner_id = ?, project_id = ?, position = position + ?, updated_at = ? WHERE owner_id = ? AND project_id = ? AND id <> ?",
        ).bind(
          account.id,
          target.projectId,
          Number(collectionPosition?.next_position || 0),
          nowIso,
          installationId,
          source.projectId,
          source.collectionId,
        ),
        env.DB.prepare(
          "UPDATE projects SET owner_id = ?, position = position + ?, updated_at = ? WHERE owner_id = ? AND id <> ?",
        ).bind(
          account.id,
          Number(projectPosition?.next_position || 0),
          nowIso,
          installationId,
          source.projectId,
        ),
        env.DB.prepare("DELETE FROM collections WHERE id = ? AND owner_id = ?")
          .bind(source.collectionId, installationId),
        env.DB.prepare(
          "UPDATE collections SET owner_id = ?, updated_at = ? WHERE owner_id = ?",
        ).bind(account.id, nowIso, installationId),
        env.DB.prepare("DELETE FROM projects WHERE id = ? AND owner_id = ?")
          .bind(source.projectId, installationId),
        env.DB.prepare(
          "UPDATE ai_credit_grants SET owner_type = 'account', owner_id = ? "
          + "WHERE owner_type = 'installation' AND owner_id = ?",
        ).bind(account.id, installationId),
        env.DB.prepare(
          "UPDATE installations SET status = 'migrated', migrated_to_user_id = ?, updated_at = ? WHERE id = ? AND status = 'active'",
        ).bind(account.id, nowIso, installationId),
        env.DB.prepare(
          "UPDATE web_sessions SET revoked_at = ? WHERE owner_type = 'installation' AND owner_id = ? AND revoked_at IS NULL",
        ).bind(nowIso, installationId),
        env.DB.prepare(
          "DELETE FROM extension_codes WHERE owner_type = 'installation' AND owner_id = ?",
        ).bind(installationId),
        env.DB.prepare(
          "INSERT INTO device_sessions (id, token_hash, user_id, installation_id, expires_at, revoked_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)",
        ).bind(deviceId, tokenHash, account.id, installationId, expiresAt, nowIso, nowIso),
      ]);
    } catch {
      return null;
    }
  } else {
    if (memoryMigrationFailure) return null;
    const inboxPosition = Array.from(memorySessions.values()).reduce(
      (position, session) => session.userId === account.id && session.collectionId === target.collectionId
        ? Math.max(position, Number(session.position || 0) + 1)
        : position,
      0,
    );
    const projectPosition = Array.from(memoryProjects.values()).reduce(
      (position, project) => project.ownerId === account.id
        ? Math.max(position, project.position + 1)
        : position,
      0,
    );
    const collectionPosition = Array.from(memoryCollections.values()).reduce(
      (position, collection) => collection.ownerId === account.id && collection.projectId === target.projectId
        ? Math.max(position, collection.position + 1)
        : position,
      0,
    );
    for (const session of memorySessions.values()) {
      if (session.userId !== installationId) continue;
      session.userId = account.id;
      session.plan = account.plan;
      session.isPermanent = account.plan !== "free";
      if (session.collectionId === source.collectionId) {
        session.collectionId = target.collectionId;
        session.position = Number(session.position || 0) + inboxPosition;
      }
    }
    for (const project of memoryProjects.values()) {
      if (project.ownerId !== installationId || project.id === source.projectId) continue;
      project.ownerId = account.id;
      project.position += projectPosition;
      project.updatedAt = nowIso;
    }
    for (const collection of memoryCollections.values()) {
      if (collection.ownerId !== installationId || collection.id === source.collectionId) continue;
      collection.ownerId = account.id;
      collection.updatedAt = nowIso;
      if (collection.projectId === source.projectId) {
        collection.projectId = target.projectId;
        collection.position += collectionPosition;
      }
      if (collection.parentId === source.collectionId) collection.parentId = target.collectionId;
    }
    memoryCollections.delete(source.collectionId);
    memoryProjects.delete(source.projectId);
    await moveAiCreditsToAccount(env, installationId, account.id);
    const installation = memoryInstallations.get(installationId);
    if (installation) installation.status = "migrated";
    for (const session of memoryWebSessions.values()) {
      if (session.ownerType === "installation" && session.ownerId === installationId) {
        session.revokedAt = nowIso;
      }
    }
    for (const [codeHash, code] of memoryExtensionCodes) {
      if (code.ownerType === "installation" && code.ownerId === installationId) {
        memoryExtensionCodes.delete(codeHash);
      }
    }
    memoryDeviceSessions.set(tokenHash, {
      expiresAt,
      installationId,
      revokedAt: null,
      userId: account.id,
    });
  }

  return {
    expiresAt,
    session: accountAuthSession(account),
    token,
  };
}

async function verifyEmailCode(request: Request, env: CloudEnv) {
  const body = await readJson(request);
  const code = stringValue(body, "code").trim();
  const email = normalizeEmail(stringValue(body, "email"));
  const invalid = () => json({ error: "Invalid or expired code" }, 400);
  if (!isEmail(email) || !EMAIL_CODE_PATTERN.test(code)) return invalid();
  const allowed = await withinRateLimits(
    env,
    "email-code-verify",
    [
      { limit: 20, scope: "ip:" + clientIp(request) },
      { limit: 10, scope: "email:" + email },
    ],
    15 * 60 * 1000,
  );
  if (!allowed) return json({ error: "Too many requests" }, 429);
  const account = await findAccountByEmail(env, email);
  if (!account?.everPaid) return invalid();
  const challenge = await latestEmailChallenge(env, account.id);
  const now = currentDate().toISOString();
  if (!challenge || challenge.usedAt || challenge.attempts >= 5 || challenge.expiresAt <= now) return invalid();
  const candidateHash = await hashCode(env, "email-code", email + ":" + code);
  if (!candidateHash) return json({ error: "Authentication is not configured" }, 503);
  if (!timingSafeEqual(candidateHash, challenge.codeHash)) {
    await recordWrongEmailCode(env, challenge);
    return invalid();
  }

  const installationId = stringValue(body, "installationId");
  const installationToken = stringValue(body, "installationToken");
  if (installationId || installationToken) {
    if (!await verifyInstallationCredentials(env, installationId, installationToken)) return invalid();
    if (!await claimEmailChallenge(env, challenge)) return invalid();
    const device = await migrateInstallationToAccount(env, account, installationId);
    return device
      ? json({ device, ok: true, session: device.session }, 200, { "Cache-Control": "no-store" })
      : json({ error: "Account migration failed" }, 409);
  }

  if (!await claimEmailChallenge(env, challenge)) return invalid();
  const principal = principalForAccount(account);
  const issued = await issueWebSession(env, principal);
  return json({ ok: true, redirectTo: internalReturnTo(stringValue(body, "returnTo")), session: accountAuthSession(account) }, 200, {
    "Cache-Control": "no-store",
    "Set-Cookie": webSessionCookie(issued.token, 30 * 24 * 60 * 60),
  });
}

async function logout(request: Request, env: CloudEnv) {
  const now = currentDate().toISOString();
  const webToken = cookieValue(request, WEB_SESSION_COOKIE);
  if (WEB_SESSION_PATTERN.test(webToken)) {
    const tokenHash = await hashCredential(webToken);
    if (env.DB) {
      await env.DB.prepare("UPDATE web_sessions SET revoked_at = ? WHERE token_hash = ?")
        .bind(now, tokenHash).run();
    } else {
      const session = memoryWebSessions.get(tokenHash);
      if (session) session.revokedAt = now;
    }
  }
  const deviceToken = bearerToken(request);
  if (DEVICE_TOKEN_PATTERN.test(deviceToken)) {
    const tokenHash = await hashCredential(deviceToken);
    if (env.DB) {
      await env.DB.prepare("UPDATE device_sessions SET revoked_at = ? WHERE token_hash = ?")
        .bind(now, tokenHash).run();
    } else {
      const session = memoryDeviceSessions.get(tokenHash);
      if (session) session.revokedAt = now;
    }
  }
  return json({ ok: true }, 200, {
    "Cache-Control": "no-store",
    "Set-Cookie": webSessionCookie("", 0),
  });
}

function stripePriceForOffer(env: CloudEnv, offer: CheckoutOffer, isBrazil: boolean) {
  if (offer === "ai_credits_1000") {
    return isBrazil ? env.STRIPE_PRICE_BR_AI_CREDITS_1000 : env.STRIPE_PRICE_AI_CREDITS_1000;
  }
  if (offer === "lifetime_founder") {
    return isBrazil ? env.STRIPE_PRICE_BR_LIFETIME : env.STRIPE_PRICE_LIFETIME;
  }
  if (offer === "pro_month") {
    return isBrazil ? env.STRIPE_PRICE_BR_MONTHLY : env.STRIPE_PRICE_MONTHLY;
  }
  if (offer === "pro_year") {
    return isBrazil ? env.STRIPE_PRICE_BR_YEARLY : env.STRIPE_PRICE_YEARLY;
  }
  if (offer === "storage_20gb_12m") {
    return isBrazil ? env.STRIPE_PRICE_BR_STORAGE_20GB_12M : env.STRIPE_PRICE_STORAGE_20GB_12M;
  }
  return isBrazil ? env.STRIPE_PRICE_BR_STORAGE_5GB_12M : env.STRIPE_PRICE_STORAGE_5GB_12M;
}

async function createCheckout(request: Request, env: CloudEnv) {
  if (!env.STRIPE_SECRET_KEY) return json({ error: "STRIPE_SECRET_KEY not configured" }, 500);
  const body = await readJson(request);
  const explicitOffer = checkoutOffer(body.offer);
  if (body.offer !== undefined && !explicitOffer) return json({ error: "Invalid checkout offer" }, 400);
  const offer = explicitOffer || legacyCheckoutOffer(body.interval);
  const requestIdInput = stringValue(body, "requestId");
  if (requestIdInput && !REQUEST_ID_PATTERN.test(requestIdInput)) {
    return json({ error: "Invalid checkout request id" }, 400);
  }
  const requestId = requestIdInput || generateNanoId(24);
  const origin = new URL(request.url).origin;
  const subscription = isSubscriptionOffer(offer);
  const priceId = stripePriceForOffer(env, offer, requestCountry(request) === "BR");
  if (!priceId) return json({ error: "Stripe price is not configured" }, 500);
  const params = new URLSearchParams({
    allow_promotion_codes: "true",
    cancel_url: `${origin}/pricing`,
    integration_identifier: `pinar_web_${randomLetters()}`,
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    "metadata[pinar_offer]": offer,
    mode: subscription ? "subscription" : "payment",
    success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
  });
  const principal = await resolvePrincipal(request, env);
  const account = principal?.kind === "account" ? await findAccountById(env, principal.id) : null;
  const email = normalizeEmail(stringValue(body, "email"));
  if (account) {
    params.set("client_reference_id", account.id);
    params.set("metadata[pinar_user_id]", account.id);
  }
  if (subscription) {
    params.set("subscription_data[metadata][pinar_offer]", offer);
    if (account) params.set("subscription_data[metadata][pinar_user_id]", account.id);
  }
  if (account?.stripeCustomerId) params.set("customer", account.stripeCustomerId);
  else {
    if (isEmail(email)) params.set("customer_email", email);
    if (!subscription) params.set("customer_creation", "always");
  }
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    body: params,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Idempotency-Key": `pinar:checkout:${offer}:${requestId}`,
      "Stripe-Version": "2026-07-29.dahlia",
    },
    method: "POST",
  });
  const data = await readJson(response);
  if (!response.ok) {
    const error = isRecord(data.error) ? stringValue(data.error, "message") : "";
    return json({ error: error || "Checkout failed" }, 400);
  }
  return json({ offer, ok: true, url: stringValue(data, "url") });
}

async function createPortal(request: Request, env: CloudEnv) {
  const principal = await resolvePrincipal(request, env);
  if (!principal || principal.kind !== "account") return json({ error: "Unauthorized" }, 401);
  const account = await findAccountById(env, principal.id);
  if (!account?.stripeCustomerId) return json({ error: "No Stripe customer found" }, 404);
  if (!env.STRIPE_SECRET_KEY) return json({ error: "STRIPE_SECRET_KEY not configured" }, 500);
  const origin = new URL(request.url).origin;
  const response = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
    body: new URLSearchParams({
      customer: account.stripeCustomerId,
      return_url: origin + "/app",
    }),
    headers: {
      Authorization: "Bearer " + env.STRIPE_SECRET_KEY,
      "Stripe-Version": "2026-07-29.dahlia",
    },
    method: "POST",
  });
  const data = await readJson(response);
  if (!response.ok) {
    const error = isRecord(data.error) ? stringValue(data.error, "message") : "";
    return json({ error: error || "Portal session failed" }, 400);
  }
  return json({ ok: true, url: stringValue(data, "url") });
}

interface UpsertStripeAccountInput {
  env: CloudEnv;
  plan: AccountPlan | null;
  session: Record<string, unknown>;
}

async function upsertStripeAccount(input: UpsertStripeAccountInput) {
  const { env, plan, session } = input;
  const customerId = stringValue(session, "customer");
  const customerDetails = isRecord(session.customer_details) ? session.customer_details : {};
  const email = normalizeEmail(
    stringValue(customerDetails, "email") || stringValue(session, "customer_email"),
  );
  if (!customerId || !isEmail(email)) return null;
  const metadata = isRecord(session.metadata) ? session.metadata : {};
  const referencedUserId = stringValue(metadata, "pinar_user_id") || stringValue(session, "client_reference_id");
  const subscriptionId = stringValue(session, "subscription");
  const now = currentDate().toISOString();
  const existing = referencedUserId
    ? await findAccountById(env, referencedUserId)
    : await findAccountByStripeCustomer(env, customerId) || await findAccountByEmail(env, email);
  if (env.DB) {
    if (existing) {
      const nextPlan = plan || existing.plan;
      const nextCustomerId = plan || !existing.stripeCustomerId
        ? customerId
        : existing.stripeCustomerId;
      await env.DB.prepare(
        "UPDATE users SET email = ?, plan = ?, ever_paid = 1, billing_status = 'active', "
        + "stripe_customer_id = ?, stripe_subscription_id = COALESCE(NULLIF(?, ''), stripe_subscription_id), "
        + "ai_credit_refill_at = CASE WHEN ? = 'pro' THEN ai_credit_refill_at ELSE NULL END, updated_at = ? "
        + "WHERE id = ?",
      ).bind(email, nextPlan, nextCustomerId, subscriptionId, nextPlan, now, existing.id).run();
      return findAccountById(env, existing.id);
    }
    try {
      await env.DB.prepare(
        "INSERT INTO users "
        + "(id, email, plan, ever_paid, billing_status, stripe_customer_id, stripe_subscription_id, created_at, updated_at) "
        + "VALUES (?, ?, ?, 1, 'active', ?, NULLIF(?, ''), ?, ?)",
      ).bind("usr_" + generateNanoId(24), email, plan || "free", customerId, subscriptionId, now, now).run();
    } catch {
      const concurrent = await findAccountByEmail(env, email);
      if (!concurrent) return null;
      await env.DB.prepare(
        "UPDATE users SET ever_paid = 1, stripe_customer_id = COALESCE(stripe_customer_id, ?), "
        + "updated_at = ? WHERE id = ?",
      ).bind(customerId, now, concurrent.id).run();
    }
    return findAccountByEmail(env, email);
  }
  let account = existing;
  if (!account) {
    account = {
      aiCreditRefillAt: "",
      billingStatus: "active",
      email,
      everPaid: true,
      id: "usr_" + generateNanoId(24),
      plan: plan || "free",
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
    };
    memoryAccounts.set(account.id, account);
  } else {
    account.billingStatus = "active";
    account.everPaid = true;
    account.email = email;
    if (plan) account.plan = plan;
    if (plan || !account.stripeCustomerId) account.stripeCustomerId = customerId;
    if (subscriptionId) account.stripeSubscriptionId = subscriptionId;
    if (account.plan !== "pro") account.aiCreditRefillAt = "";
  }
  return account;
}

function offerFromCheckoutSession(session: Record<string, unknown>) {
  const metadata = isRecord(session.metadata) ? session.metadata : {};
  return checkoutOffer(metadata.pinar_offer)
    || legacyCheckoutOffer(session.mode === "subscription" ? "month" : "lifetime");
}

function checkoutIsPaid(session: Record<string, unknown>) {
  return session.payment_status === "paid" || session.payment_status === "no_payment_required";
}

async function fulfillCheckout(env: CloudEnv, session: Record<string, unknown>) {
  if (!checkoutIsPaid(session)) return null;
  const offer = offerFromCheckoutSession(session);
  const account = await upsertStripeAccount({ env, plan: planForOffer(offer), session });
  if (!account) return null;
  const sessionId = stringValue(session, "id");
  if (offer === "pro_month" || offer === "pro_year") {
    await ensureProMonthlyCredits(env, account);
  } else if (offer === "lifetime_founder") {
    if (!sessionId) return null;
    await grantAiCredits({
      credits: LIFETIME_AI_CREDITS,
      env,
      expiresAt: null,
      ownerId: account.id,
      ownerType: "account",
      sourceId: `checkout:${sessionId}:lifetime`,
      sourceType: "lifetime_initial",
    });
  } else if (offer === "ai_credits_1000") {
    if (!sessionId) return null;
    await grantAiCredits({
      credits: PURCHASED_AI_CREDITS,
      env,
      expiresAt: addUtcYears(currentDate(), 1).toISOString(),
      ownerId: account.id,
      ownerType: "account",
      sourceId: `checkout:${sessionId}:ai`,
      sourceType: "purchase",
    });
  } else {
    if (!sessionId) return null;
    const startsAt = currentDate().toISOString();
    await grantStorage({
      byteCount: offer === "storage_20gb_12m" ? STORAGE_20GB_BYTES : STORAGE_5GB_BYTES,
      env,
      expiresAt: addUtcYears(currentDate(), 1).toISOString(),
      sourceId: `checkout:${sessionId}:storage`,
      sourceType: offer,
      startsAt,
      userId: account.id,
    });
  }
  return { account, offer };
}

async function completeCheckout(request: Request, env: CloudEnv) {
  const sessionId = new URL(request.url).searchParams.get("session_id") || "";
  if (!sessionId || !env.STRIPE_SECRET_KEY) {
    return json({ error: "Checkout session unavailable" }, 400);
  }
  const response = await fetch(
    "https://api.stripe.com/v1/checkout/sessions/" + encodeURIComponent(sessionId),
    {
      headers: {
        Authorization: "Bearer " + env.STRIPE_SECRET_KEY,
        "Stripe-Version": "2026-07-29.dahlia",
      },
    },
  );
  const session = await readJson(response);
  if (!response.ok || session.status !== "complete" || !checkoutIsPaid(session)) {
    return json({ error: "Checkout session unavailable" }, 400);
  }
  const fulfilled = await fulfillCheckout(env, session);
  if (!fulfilled) return json({ error: "Checkout activation unavailable" }, 503);
  const issued = await issueWebSession(env, principalForAccount(fulfilled.account));
  return json({
    account: accountAuthSession(fulfilled.account),
    offer: fulfilled.offer,
    ok: true,
  }, 200, {
    "Cache-Control": "no-store",
    "Set-Cookie": webSessionCookie(issued.token, 30 * 24 * 60 * 60),
  });
}

async function hmacHex(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verifyStripeWebhook(
  body: string,
  signatureHeader: string,
  secret: string,
) {
  const entries = signatureHeader.split(",").map((entry) => entry.trim().split("=", 2));
  const timestamp = entries.find(([key]) => key === "t")?.[1] || "";
  const signatures = entries.filter(([key]) => key === "v1").map(([, value]) => value || "");
  const timestampNumber = Number(timestamp);
  if (!Number.isFinite(timestampNumber)) return false;
  if (Math.abs(Math.floor(currentDate().getTime() / 1000) - timestampNumber) > 300) return false;
  const expected = await hmacHex(secret, timestamp + "." + body);
  return signatures.some((signature) => timingSafeEqual(signature, expected));
}

async function updateSubscriptionAccount(
  env: CloudEnv,
  customerId: string,
  status: string,
) {
  const account = await findAccountByStripeCustomer(env, customerId);
  if (!account) return null;
  const active = status === "active" || status === "trialing";
  const billingStatus = status === "canceled" ? "canceled" : active ? "active" : "past_due";
  const plan: AccountPlan = account.plan === "lifetime" ? "lifetime" : active ? "pro" : "free";
  if (env.DB) {
    await env.DB.prepare(
      "UPDATE users SET plan = ?, billing_status = ?, ever_paid = 1, updated_at = ? WHERE stripe_customer_id = ?",
    ).bind(plan, billingStatus, currentDate().toISOString(), customerId).run();
    const updated = await findAccountById(env, account.id);
    if (updated) await ensureProMonthlyCredits(env, updated);
    return updated;
  } else {
    account.billingStatus = billingStatus;
    account.everPaid = true;
    account.plan = plan;
    await ensureProMonthlyCredits(env, account);
    return account;
  }
}

async function handleWebhook(request: Request, env: CloudEnv) {
  if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: "Webhook is not configured" }, 503);
  const body = await request.text();
  const signature = request.headers.get("stripe-signature") || "";
  if (!await verifyStripeWebhook(body, signature, env.STRIPE_WEBHOOK_SECRET)) {
    return json({ error: "Invalid webhook signature" }, 400);
  }
  let event: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(body);
    if (isRecord(parsed)) event = parsed;
  } catch {
    return json({ error: "Invalid webhook payload" }, 400);
  }
  const eventId = stringValue(event, "id");
  const eventType = stringValue(event, "type");
  if (!eventId || !eventType) return json({ error: "Invalid webhook event" }, 400);
  if (await stripeEventProcessed(env, eventId)) {
    return json({ duplicate: true, received: true });
  }
  const data = isRecord(event.data) && isRecord(event.data.object) ? event.data.object : {};
  if (eventType === "checkout.session.completed" || eventType === "checkout.session.async_payment_succeeded") {
    if (checkoutIsPaid(data) && !await fulfillCheckout(env, data)) {
      return json({ error: "Checkout fulfillment unavailable" }, 503);
    }
  } else if (eventType === "customer.subscription.deleted") {
    await updateSubscriptionAccount(env, stringValue(data, "customer"), "canceled");
  } else if (eventType === "customer.subscription.updated") {
    await updateSubscriptionAccount(env, stringValue(data, "customer"), stringValue(data, "status"));
  }
  await recordStripeEvent(env, eventId, eventType);
  return json({ received: true });
}

async function assertSessionOwner(env: CloudEnv, id: string, principal: Principal) {
  if (env.DB) {
    const existing = await env.DB.prepare("SELECT user_id FROM sessions WHERE id = ?").bind(id).first();
    return !existing || existing.user_id === principal.id;
  }
  const existing = memorySessions.get(id);
  return !existing || existing.userId === principal.id;
}

function projectFromRow(row: Record<string, unknown>): Project {
  return {
    createdAt: String(row.created_at || ""),
    id: String(row.id || ""),
    icon: isProjectIcon(row.icon)
      ? row.icon
      : row.is_protected
        ? PERSONAL_PROJECT_ICON
        : DEFAULT_PROJECT_ICON,
    isProtected: Boolean(row.is_protected),
    name: String(row.name || ""),
    ownerId: String(row.owner_id || ""),
    position: Number(row.position || 0),
    updatedAt: String(row.updated_at || ""),
  };
}

function collectionFromRow(row: Record<string, unknown>): Collection {
  return {
    createdAt: String(row.created_at || ""),
    id: String(row.id || ""),
    isProtected: Boolean(row.is_protected),
    name: String(row.name || ""),
    ownerId: String(row.owner_id || ""),
    parentId: typeof row.parent_id === "string" && row.parent_id ? row.parent_id : null,
    position: Number(row.position || 0),
    projectId: String(row.project_id || ""),
    updatedAt: String(row.updated_at || ""),
  };
}

function sortCollections(collections: Collection[]) {
  const byId = new Map(collections.map((collection) => [collection.id, collection]));
  const children = new Map<string | null, Collection[]>();
  for (const collection of collections) {
    const parentId = collection.parentId && byId.has(collection.parentId)
      ? collection.parentId
      : null;
    const siblings = children.get(parentId) || [];
    siblings.push(collection);
    children.set(parentId, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort((left, right) => left.position - right.position
      || left.createdAt.localeCompare(right.createdAt));
  }
  const result: Collection[] = [];
  const visited = new Set<string>();
  function visit(parentId: string | null) {
    for (const collection of children.get(parentId) || []) {
      if (visited.has(collection.id)) continue;
      visited.add(collection.id);
      result.push(collection);
      visit(collection.id);
    }
  }
  visit(null);
  for (const collection of collections) {
    if (!visited.has(collection.id)) result.push(collection);
  }
  return result;
}

function planCollectionPlacements(
  collections: Collection[],
  requested: Array<CollectionPlacement | string>,
) {
  if (requested.length !== collections.length) return null;
  const byId = new Map(collections.map((collection) => [collection.id, collection]));
  const seen = new Set<string>();
  const parentById = new Map<string, string | null>();
  for (const item of requested) {
    const id = typeof item === "string" ? item : item.id;
    const collection = byId.get(id);
    if (!collection || seen.has(id)) return null;
    seen.add(id);
    const parentId = typeof item === "string" ? collection.parentId : item.parentId;
    if (collection.isProtected && parentId) return null;
    if (parentId === id || (parentId && !byId.has(parentId))) return null;
    parentById.set(id, parentId);
  }
  for (const id of parentById.keys()) {
    const ancestors = new Set([id]);
    let parentId = parentById.get(id) || null;
    while (parentId) {
      if (ancestors.has(parentId)) return null;
      ancestors.add(parentId);
      parentId = parentById.get(parentId) || null;
    }
  }
  const positions = new Map<string | null, number>();
  return requested.map((item) => {
    const id = typeof item === "string" ? item : item.id;
    const parentId = parentById.get(id) || null;
    const position = positions.get(parentId) || 0;
    positions.set(parentId, position + 1);
    return { id, parentId, position };
  });
}

async function ensureDefaultDestination(env: CloudEnv, principal: Principal): Promise<CaptureDestination> {
  if (env.DB) {
    let project = await env.DB.prepare(
      "SELECT * FROM projects WHERE owner_id = ? AND is_protected = 1 LIMIT 1",
    ).bind(principal.id).first();
    const timestamp = new Date().toISOString();
    if (!project) {
      const projectId = generateNanoId();
      await env.DB.prepare(`
        INSERT INTO projects (id, owner_id, name, icon, position, is_protected, created_at, updated_at)
        VALUES (?, ?, 'Personal', ?, 0, 1, ?, ?)
      `).bind(projectId, principal.id, PERSONAL_PROJECT_ICON, timestamp, timestamp).run();
      project = await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(projectId).first();
    }
    let collection = await env.DB.prepare(
      "SELECT * FROM collections WHERE owner_id = ? AND is_protected = 1 LIMIT 1",
    ).bind(principal.id).first();
    if (!collection) {
      const collectionId = generateNanoId();
      await env.DB.prepare(`
        INSERT INTO collections (
          id, project_id, owner_id, parent_id, name, position, is_protected, created_at, updated_at
        ) VALUES (?, ?, ?, NULL, 'Inbox', 0, 1, ?, ?)
      `).bind(collectionId, String(project?.id || ""), principal.id, timestamp, timestamp).run();
      collection = await env.DB.prepare("SELECT * FROM collections WHERE id = ?").bind(collectionId).first();
    }
    if (!project || !collection) throw new Error("Default destination is unavailable");
    return { collectionId: String(collection.id), projectId: String(project.id) };
  }
  let project = Array.from(memoryProjects.values()).find(
    (item) => item.ownerId === principal.id && item.isProtected,
  );
  const timestamp = new Date().toISOString();
  if (!project) {
    project = {
      createdAt: timestamp,
      id: generateNanoId(),
      icon: PERSONAL_PROJECT_ICON,
      isProtected: true,
      name: "Personal",
      ownerId: principal.id,
      position: 0,
      updatedAt: timestamp,
    };
    memoryProjects.set(project.id, project);
  }
  let collection = Array.from(memoryCollections.values()).find(
    (item) => item.ownerId === principal.id && item.isProtected,
  );
  if (!collection) {
    collection = {
      createdAt: timestamp,
      id: generateNanoId(),
      isProtected: true,
      name: "Inbox",
      ownerId: principal.id,
      parentId: null,
      position: 0,
      projectId: project.id,
      updatedAt: timestamp,
    };
    memoryCollections.set(collection.id, collection);
  }
  return { collectionId: collection.id, projectId: project.id };
}

async function resolveDestination(
  env: CloudEnv,
  principal: Principal,
  collectionId: string,
): Promise<CaptureDestination> {
  const fallback = await ensureDefaultDestination(env, principal);
  if (!collectionId) return fallback;
  if (env.DB) {
    const collection = await env.DB.prepare(
      "SELECT id, project_id FROM collections WHERE id = ? AND owner_id = ?",
    ).bind(collectionId, principal.id).first();
    return collection
      ? { collectionId: String(collection.id), projectId: String(collection.project_id) }
      : fallback;
  }
  const collection = memoryCollections.get(collectionId);
  return collection?.ownerId === principal.id
    ? { collectionId: collection.id, projectId: collection.projectId }
    : fallback;
}

async function nextSessionPosition(env: CloudEnv, principal: Principal, collectionId: string) {
  if (env.DB) {
    const row = await env.DB.prepare(`
      SELECT COALESCE(MAX(position), -1) + 1 AS next_position
      FROM sessions WHERE user_id = ? AND collection_id = ?
    `).bind(principal.id, collectionId).first();
    return Number(row?.next_position || 0);
  }
  return Array.from(memorySessions.values()).reduce(
    (result, session) => session.userId === principal.id && session.collectionId === collectionId
      ? Math.max(result, Number(session.position) + 1 || 1)
      : result,
    0,
  );
}

async function listProjects(env: CloudEnv, principal: Principal) {
  await ensureDefaultDestination(env, principal);
  if (env.DB) {
    const result = await env.DB.prepare(
      "SELECT * FROM projects WHERE owner_id = ? ORDER BY position ASC, created_at ASC",
    ).bind(principal.id).all();
    return (result.results || []).map(projectFromRow);
  }
  return Array.from(memoryProjects.values())
    .filter((project) => project.ownerId === principal.id)
    .sort((left, right) => left.position - right.position);
}

async function listCollections(env: CloudEnv, principal: Principal, projectId: string) {
  await ensureDefaultDestination(env, principal);
  if (env.DB) {
    const result = await env.DB.prepare(`
      SELECT * FROM collections
      WHERE project_id = ? AND owner_id = ?
      ORDER BY position ASC, created_at ASC
    `).bind(projectId, principal.id).all();
    return sortCollections((result.results || []).map(collectionFromRow));
  }
  return sortCollections(Array.from(memoryCollections.values())
    .filter((collection) => collection.ownerId === principal.id && collection.projectId === projectId));
}

async function projectTree(env: CloudEnv, principal: Principal): Promise<ProjectTree> {
  const projects = await listProjects(env, principal);
  return {
    projects: await Promise.all(projects.map(async (project) => ({
      ...project,
      collections: await Promise.all((await listCollections(env, principal, project.id)).map(
        async (collection) => ({
          ...collection,
          sessions: await listCollectionSessions(env, principal, collection.id),
        }),
      )),
    }))),
  };
}

async function createProject(
  env: CloudEnv,
  principal: Principal,
  name: string,
  icon: ProjectIcon,
) {
  const projects = await listProjects(env, principal);
  const timestamp = new Date().toISOString();
  const project: Project = {
    createdAt: timestamp,
    id: generateNanoId(),
    icon,
    isProtected: false,
    name,
    ownerId: principal.id,
    position: projects.length,
    updatedAt: timestamp,
  };
  if (env.DB) {
    await env.DB.prepare(`
      INSERT INTO projects (id, owner_id, name, icon, position, is_protected, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?)
    `).bind(
      project.id,
      principal.id,
      name,
      icon,
      project.position,
      timestamp,
      timestamp,
    ).run();
  } else {
    memoryProjects.set(project.id, project);
  }
  return project;
}

async function createCollection(
  env: CloudEnv,
  principal: Principal,
  projectId: string,
  name: string,
  parentId: string | null,
) {
  const project = (await listProjects(env, principal)).find((item) => item.id === projectId);
  if (!project) return null;
  const collections = await listCollections(env, principal, projectId);
  if (parentId && !collections.some((item) => item.id === parentId)) return null;
  const timestamp = new Date().toISOString();
  const collection: Collection = {
    createdAt: timestamp,
    id: generateNanoId(),
    isProtected: false,
    name,
    ownerId: principal.id,
    parentId,
    position: collections.filter((item) => item.parentId === parentId).length,
    projectId,
    updatedAt: timestamp,
  };
  if (env.DB) {
    await env.DB.prepare(`
      INSERT INTO collections (
        id, project_id, owner_id, parent_id, name, position, is_protected, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).bind(
      collection.id,
      projectId,
      principal.id,
      parentId,
      name,
      collection.position,
      timestamp,
      timestamp,
    ).run();
  } else {
    memoryCollections.set(collection.id, collection);
  }
  return collection;
}

async function renameProject(
  env: CloudEnv,
  principal: Principal,
  id: string,
  name: string,
  icon?: ProjectIcon,
) {
  if (env.DB) {
    const timestamp = new Date().toISOString();
    if (icon) {
      await env.DB.prepare(
        "UPDATE projects SET name = ?, icon = ?, updated_at = ? WHERE id = ? AND owner_id = ?",
      ).bind(name, icon, timestamp, id, principal.id).run();
    } else {
      await env.DB.prepare(
        "UPDATE projects SET name = ?, updated_at = ? WHERE id = ? AND owner_id = ?",
      ).bind(name, timestamp, id, principal.id).run();
    }
    const row = await env.DB.prepare("SELECT * FROM projects WHERE id = ? AND owner_id = ?")
      .bind(id, principal.id).first();
    return row ? projectFromRow(row) : null;
  }
  const project = memoryProjects.get(id);
  if (!project || project.ownerId !== principal.id) return null;
  if (icon) project.icon = icon;
  project.name = name;
  project.updatedAt = new Date().toISOString();
  return project;
}

async function renameCollection(env: CloudEnv, principal: Principal, id: string, name: string) {
  if (env.DB) {
    const timestamp = new Date().toISOString();
    await env.DB.prepare(
      "UPDATE collections SET name = ?, updated_at = ? WHERE id = ? AND owner_id = ?",
    ).bind(name, timestamp, id, principal.id).run();
    const row = await env.DB.prepare("SELECT * FROM collections WHERE id = ? AND owner_id = ?")
      .bind(id, principal.id).first();
    return row ? collectionFromRow(row) : null;
  }
  const collection = memoryCollections.get(id);
  if (!collection || collection.ownerId !== principal.id) return null;
  collection.name = name;
  collection.updatedAt = new Date().toISOString();
  return collection;
}

async function reorderProjects(env: CloudEnv, principal: Principal, ids: string[]) {
  const timestamp = new Date().toISOString();
  if (env.DB) {
    await env.DB.batch(ids.map((id, position) => env.DB?.prepare(
      "UPDATE projects SET position = ?, updated_at = ? WHERE id = ? AND owner_id = ?",
    ).bind(position, timestamp, id, principal.id)).filter((item): item is D1Statement => Boolean(item)));
  } else {
    ids.forEach((id, position) => {
      const project = memoryProjects.get(id);
      if (project?.ownerId === principal.id) project.position = position;
    });
  }
  return listProjects(env, principal);
}

async function reorderCollections(
  env: CloudEnv,
  principal: Principal,
  projectId: string,
  requested: Array<CollectionPlacement | string>,
) {
  const collections = await listCollections(env, principal, projectId);
  const placements = planCollectionPlacements(collections, requested);
  if (!placements) return null;
  const timestamp = new Date().toISOString();
  if (env.DB) {
    await env.DB.batch(placements.map(({ id, parentId, position }) => env.DB?.prepare(`
      UPDATE collections SET parent_id = ?, position = ?, updated_at = ?
      WHERE id = ? AND project_id = ? AND owner_id = ?
    `).bind(parentId, position, timestamp, id, projectId, principal.id)).filter(
      (item): item is D1Statement => Boolean(item),
    ));
  } else {
    placements.forEach(({ id, parentId, position }) => {
      const collection = memoryCollections.get(id);
      if (collection?.ownerId === principal.id && collection.projectId === projectId) {
        collection.parentId = parentId;
        collection.position = position;
        collection.updatedAt = timestamp;
      }
    });
  }
  return listCollections(env, principal, projectId);
}

async function moveSession(
  env: CloudEnv,
  principal: Principal,
  sessionId: string,
  collectionId: string,
) {
  const destination = env.DB
    ? await env.DB.prepare("SELECT id FROM collections WHERE id = ? AND owner_id = ?")
      .bind(collectionId, principal.id).first()
    : memoryCollections.get(collectionId)?.ownerId === principal.id;
  if (!destination) return null;
  const position = await nextSessionPosition(env, principal, collectionId);
  if (env.DB) {
    const existing = await env.DB.prepare("SELECT id FROM sessions WHERE id = ? AND user_id = ?")
      .bind(sessionId, principal.id).first();
    if (!existing) return null;
    await env.DB.prepare(
      "UPDATE sessions SET collection_id = ?, position = ? WHERE id = ? AND user_id = ?",
    ).bind(collectionId, position, sessionId, principal.id).run();
    const row = await env.DB.prepare("SELECT * FROM sessions WHERE id = ? AND user_id = ?")
      .bind(sessionId, principal.id).first();
    return row ? sessionFromRow(row) : null;
  }
  const session = memorySessions.get(sessionId);
  if (!session || session.userId !== principal.id) return null;
  session.collectionId = collectionId;
  session.position = position;
  return session;
}

async function reorderSessionIds(
  env: CloudEnv,
  principal: Principal,
  collectionId: string,
  ids: string[],
) {
  if (env.DB) {
    await env.DB.batch(ids.map((id, position) => env.DB?.prepare(`
      UPDATE sessions SET position = ?
      WHERE id = ? AND collection_id = ? AND user_id = ?
    `).bind(position, id, collectionId, principal.id)).filter(
      (item): item is D1Statement => Boolean(item),
    ));
  } else {
    ids.forEach((id, position) => {
      const session = memorySessions.get(id);
      if (session?.userId === principal.id && session.collectionId === collectionId) {
        session.position = position;
      }
    });
  }
  return listCollectionSessions(env, principal, collectionId);
}

async function deleteCollectionContainer(env: CloudEnv, principal: Principal, id: string) {
  const collection = env.DB
    ? await env.DB.prepare("SELECT * FROM collections WHERE id = ? AND owner_id = ?")
      .bind(id, principal.id).first()
    : memoryCollections.get(id);
  if (!collection || protectedValue(collection)) return false;
  const current = env.DB
    ? collectionFromRow(collection as Record<string, unknown>)
    : collection as Collection;
  const collections = await listCollections(env, principal, current.projectId);
  const siblings = collections.filter((item) => item.parentId === current.parentId);
  const children = collections.filter((item) => item.parentId === id);
  const promoted = siblings.flatMap((item) => item.id === id ? children : [item]);
  const fallback = await ensureDefaultDestination(env, principal);
  const sessions = await listCollectionSessions(env, principal, id);
  if (env.DB) {
    const start = await nextSessionPosition(env, principal, fallback.collectionId);
    const timestamp = new Date().toISOString();
    await env.DB.batch([
      ...sessions.map((session, index) => env.DB?.prepare(`
        UPDATE sessions SET collection_id = ?, position = ? WHERE id = ? AND user_id = ?
      `).bind(fallback.collectionId, start + index, session.id, principal.id)).filter(
        (item): item is D1Statement => Boolean(item),
      ),
      ...promoted.map((item, index) => env.DB?.prepare(`
        UPDATE collections SET parent_id = ?, position = ?, updated_at = ?
        WHERE id = ? AND owner_id = ?
      `).bind(current.parentId, index, timestamp, item.id, principal.id)).filter(
        (item): item is D1Statement => Boolean(item),
      ),
      env.DB.prepare("DELETE FROM collections WHERE id = ? AND owner_id = ?").bind(id, principal.id),
    ]);
  } else {
    let position = await nextSessionPosition(env, principal, fallback.collectionId);
    for (const session of sessions) {
      session.collectionId = fallback.collectionId;
      session.position = position;
      position += 1;
    }
    const timestamp = new Date().toISOString();
    promoted.forEach((item, index) => {
      item.parentId = current.parentId;
      item.position = index;
      item.updatedAt = timestamp;
    });
    memoryCollections.delete(id);
  }
  return true;
}

async function deleteProjectContainer(env: CloudEnv, principal: Principal, id: string) {
  const project = env.DB
    ? await env.DB.prepare("SELECT * FROM projects WHERE id = ? AND owner_id = ?")
      .bind(id, principal.id).first()
    : memoryProjects.get(id);
  if (!project || protectedValue(project)) return false;
  const collections = await listCollections(env, principal, id);
  for (const collection of collections) {
    await deleteCollectionContainer(env, principal, collection.id);
  }
  if (env.DB) {
    await env.DB.prepare("DELETE FROM projects WHERE id = ? AND owner_id = ?")
      .bind(id, principal.id).run();
  } else {
    memoryProjects.delete(id);
  }
  return true;
}

async function persistSession(env: CloudEnv, session: Session) {
  if (env.DB) {
    await env.DB.prepare(
      `INSERT INTO sessions (
         id, url, title, shot_id, shot_url, pin_count, pins_json, created_at, user_id,
         plan, is_permanent, byte_size, collection_id, position
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET url=excluded.url, title=excluded.title, shot_id=excluded.shot_id,
       shot_url=excluded.shot_url, pin_count=excluded.pin_count, pins_json=excluded.pins_json,
       created_at=excluded.created_at, user_id=excluded.user_id, plan=excluded.plan,
       is_permanent=excluded.is_permanent, byte_size=excluded.byte_size,
       collection_id=excluded.collection_id, position=excluded.position`,
    ).bind(
      session.id,
      session.page.url || "",
      session.page.title || "",
      session.shotId || "",
      session.shotUrl || "",
      session.pins.length,
      JSON.stringify(session.pins),
      session.createdAt,
      session.userId || "",
      session.plan || "free",
      session.isPermanent ? 1 : 0,
      session.byteSize || 0,
      session.collectionId || "",
      session.position || 0,
    ).run();
  } else {
    memorySessions.set(session.id, session);
  }
}

async function accountEntitlements(request: Request, env: CloudEnv) {
  const principal = await resolvePrincipal(request, env);
  if (!principal) return json({ error: "Unauthorized" }, 401);
  if (principal.kind === "account") {
    const account = await findAccountById(env, principal.id);
    if (account) await ensureProMonthlyCredits(env, account);
  }
  return json({
    aiCredits: await aiCreditBalance(env, principal),
    ok: true,
    plan: principal.plan,
    storage: await storageForPrincipal(env, principal),
  }, 200, { "Cache-Control": "no-store" });
}

async function uploadShot(request: Request, env: CloudEnv) {
  const principal = await resolvePrincipal(request, env);
  if (!principal) return json({ error: "Unauthorized" }, 401);
  const body = await readJson(request);
  const id = stringValue(body, "id");
  const image = stringValue(body, "image");
  if (!SESSION_ID_PATTERN.test(id) || !image) return json({ error: "valid id and image required" }, 400);
  if (!(await assertSessionOwner(env, id, principal))) return json({ error: "Session id is unavailable" }, 409);
  let imageBytes: Uint8Array;
  try {
    imageBytes = decodePngDataUrl(image);
  } catch {
    return json({ error: "invalid PNG image" }, 400);
  }
  const storage = await storageForPrincipal(env, principal);
  const replacedBytes = await existingSessionBytes(env, principal.id, id);
  if (!canStoreBytes(storage, imageBytes.byteLength, replacedBytes)) {
    return json({
      code: "storage_quota_exceeded",
      error: "Storage quota exceeded",
      storage,
    }, 413);
  }
  const origin = new URL(request.url).origin;
  const shotUrl = `${origin}/shots/${id}.png`;
  const destination = await resolveDestination(env, principal, stringValue(body, "collectionId"));
  if (env.PINAR_BUCKET) {
    await env.PINAR_BUCKET.put(`${id}.png`, imageBytes, { httpMetadata: { contentType: "image/png" } });
  }
  const session: Session = {
    byteSize: imageBytes.byteLength,
    collectionId: destination.collectionId,
    createdAt: stringValue(body, "createdAt") || new Date().toISOString(),
    id,
    isPermanent: principal.isPermanent,
    page: pageValue(body.page),
    pins: pinsValue(body.pins),
    plan: principal.plan,
    position: await nextSessionPosition(env, principal, destination.collectionId),
    shotId: id,
    shotUrl,
    userId: principal.id,
  };
  try {
    await persistSession(env, session);
  } catch {
    return json({ error: "Session persistence failed" }, 503);
  }
  return json({
    destination,
    isPermanent: session.isPermanent,
    markdownUrl: `${origin}/v/${id}.md`,
    ok: true,
    path: shotUrl,
    plan: session.plan,
    shotUrl,
    storage: await storageForPrincipal(env, principal),
    viewerUrl: `${origin}/v/${id}.md`,
  }, 201);
}

async function saveHistory(request: Request, env: CloudEnv) {
  const principal = await resolvePrincipal(request, env);
  if (!principal) return json({ error: "Unauthorized" }, 401);
  const body = await readJson(request);
  const id = stringValue(body, "id") || generateNanoId();
  if (!SESSION_ID_PATTERN.test(id)) return json({ error: "invalid session id" }, 400);
  if (!(await assertSessionOwner(env, id, principal))) return json({ error: "Session id is unavailable" }, 409);
  const origin = new URL(request.url).origin;
  const shotId = stringValue(body, "shotId");
  const destination = await resolveDestination(env, principal, stringValue(body, "collectionId"));
  const session: Session = {
    byteSize: Math.max(0, numberValue(body, "byteSize")),
    collectionId: destination.collectionId,
    createdAt: stringValue(body, "createdAt") || new Date().toISOString(),
    id,
    isPermanent: principal.isPermanent,
    page: pageValue(body.page),
    pins: pinsValue(body.pins),
    plan: principal.plan,
    position: await nextSessionPosition(env, principal, destination.collectionId),
    shotId,
    shotUrl: stringValue(body, "shotUrl") || (shotId ? `${origin}/shots/${shotId}.png` : null),
    userId: principal.id,
  };
  const storage = await storageForPrincipal(env, principal);
  const replacedBytes = await existingSessionBytes(env, principal.id, id);
  if (!canStoreBytes(storage, Number(session.byteSize || 0), replacedBytes)) {
    return json({
      code: "storage_quota_exceeded",
      error: "Storage quota exceeded",
      storage,
    }, 413);
  }
  try {
    await persistSession(env, session);
  } catch {
    return json({ error: "Session persistence failed" }, 503);
  }
  return json({ destination, ok: true, session }, 201);
}

async function queryHistory(request: Request, env: CloudEnv) {
  const principal = await resolvePrincipal(request, env);
  if (!principal) return json({ error: "Unauthorized" }, 401);
  const url = new URL(request.url);
  try {
    const sessions = await listSessions(
      env,
      principal,
      url.searchParams.get("q") || "",
      url.searchParams.get("limit") || "",
      url.searchParams.get("collectionId") || "",
    );
    return json({ ok: true, sessions }, 200, { "Cache-Control": "no-store" });
  } catch {
    return json({ error: "History unavailable" }, 503);
  }
}

async function deleteHistory(request: Request, env: CloudEnv, id: string) {
  const principal = await resolvePrincipal(request, env);
  if (!principal) return json({ error: "Unauthorized" }, 401);
  if (!SESSION_ID_PATTERN.test(id)) return json({ error: "Session not found" }, 404);
  let shotId = id;
  if (env.DB) {
    try {
      const existing = await env.DB.prepare("SELECT shot_id FROM sessions WHERE id = ? AND user_id = ?")
        .bind(id, principal.id).first();
      if (!existing) return json({ error: "Session not found" }, 404);
      shotId = String(existing.shot_id || id);
      await env.DB.prepare("DELETE FROM sessions WHERE id = ? AND user_id = ?").bind(id, principal.id).run();
    } catch {
      return json({ error: "Session deletion failed" }, 503);
    }
  } else {
    const existing = memorySessions.get(id);
    if (!existing || existing.userId !== principal.id) return json({ error: "Session not found" }, 404);
    shotId = existing.shotId || id;
    memorySessions.delete(id);
  }
  if (env.PINAR_BUCKET) await env.PINAR_BUCKET.delete(`${shotId}.png`).catch(() => undefined);
  return json({ ok: true });
}

function checkAdminAuth(request: Request, env: CloudEnv) {
  const secret = env.ADMIN_API_KEY;
  if (!secret) return false;
  return bearerToken(request) === secret;
}

export async function reconcileBillingEntitlements(env: CloudEnv) {
  const now = currentDate().toISOString();
  let accounts: AccountRecord[];
  if (env.DB) {
    const result = await env.DB.prepare(
      "SELECT * FROM users WHERE plan = 'pro' AND billing_status = 'active' "
      + "AND (ai_credit_refill_at IS NULL OR ai_credit_refill_at <= ?)",
    ).bind(now).all();
    accounts = (result.results || []).map(accountFromRow);
  } else {
    accounts = Array.from(memoryAccounts.values()).filter(
      (account) => account.plan === "pro"
        && account.billingStatus === "active"
        && (!account.aiCreditRefillAt || account.aiCreditRefillAt <= now),
    );
  }
  for (const account of accounts) await ensureProMonthlyCredits(env, account);
  return { creditedAccounts: accounts.length };
}

export async function cleanupOldRecords(env: CloudEnv, days = 7) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  let deletedCount = 0;
  if (env.DB) {
    const result = await env.DB.prepare(
      "SELECT id, shot_id FROM sessions WHERE created_at < ? AND (is_permanent = 0 OR is_permanent IS NULL)",
    ).bind(cutoff).all();
    const sessions = result.results || [];
    if (env.PINAR_BUCKET) {
      await Promise.all(sessions.map((session) => env.PINAR_BUCKET?.delete(`${session.shot_id || session.id}.png`)));
    }
    await env.DB.prepare(
      "DELETE FROM sessions WHERE created_at < ? AND (is_permanent = 0 OR is_permanent IS NULL)",
    ).bind(cutoff).run();
    deletedCount = sessions.length;
  } else {
    const expired = Array.from(memorySessions.values()).filter(
      (session) => !session.isPermanent && session.createdAt < cutoff,
    );
    if (env.PINAR_BUCKET) {
      await Promise.all(expired.map((session) => env.PINAR_BUCKET?.delete(`${session.shotId || session.id}.png`)));
    }
    for (const session of expired) memorySessions.delete(session.id);
    deletedCount = expired.length;
  }
  return { cutoff, deletedCount };
}

export async function authorizeCloudAppRequest(request: Request, env: CloudEnv) {
  return Boolean(await resolvePrincipal(request, env));
}

export async function handleCloudApiRequest(request: Request, env: CloudEnv) {
  const url = new URL(request.url);
  const { method } = request;
  const path = url.pathname;
  if (method === "OPTIONS") return new Response(null, { headers: corsHeaders(), status: 204 });
  if (["DELETE", "PATCH", "POST", "PUT"].includes(method) && !validMutationOrigin(request, env)) {
    return json({ error: "Invalid request origin" }, 403);
  }
  if (method === "GET" && path === "/api/health") {
    return json({
      hasAdminAuth: Boolean(env.ADMIN_API_KEY),
      hasAuthPepper: Boolean(env.AUTH_PEPPER),
      hasBucket: Boolean(env.PINAR_BUCKET),
      hasDb: Boolean(env.DB),
      hasEmail: Boolean(env.EMAIL),
      hasExtensionOrigin: Boolean(env.EXTENSION_ORIGIN),
      hasStripe: Boolean(env.STRIPE_SECRET_KEY),
      hasStripeWebhook: Boolean(env.STRIPE_WEBHOOK_SECRET),
      ok: true,
      runtime: "cloud",
      service: "pinar",
    });
  }
  if (method === "GET" && path === "/api/pricing") {
    const config = pricingConfig(env);
    if (!config) return json({ code: "pricing_unavailable", error: "Pricing is not configured" }, 503);
    return json(pricingForCountry(requestCountry(request), config), 200, {
      "Cache-Control": "private, no-store",
      Vary: "CF-IPCountry",
    });
  }
  if (method === "POST" && path === "/api/installations") return registerInstallation(request, env);
  if (method === "GET" && path === "/api/auth/session") return authSession(request, env);
  if (method === "POST" && path === "/api/auth/extension-codes") return createExtensionCode(request, env);
  if (method === "POST" && path === "/api/auth/extension-codes/exchange") {
    return exchangeExtensionCode(request, env);
  }
  if (method === "POST" && path === "/api/auth/email-codes") return requestEmailCode(request, env);
  if (method === "POST" && path === "/api/auth/email-codes/verify") return verifyEmailCode(request, env);
  if (method === "POST" && path === "/api/auth/logout") return logout(request, env);
  if (method === "GET" && path === "/api/account/entitlements") return accountEntitlements(request, env);
  if (method === "POST" && path === "/api/stripe/checkout") return createCheckout(request, env);
  if (method === "POST" && path === "/api/stripe/portal") return createPortal(request, env);
  if (method === "POST" && path === "/api/stripe/webhook") return handleWebhook(request, env);
  if (method === "GET" && path === "/api/stripe/success") return completeCheckout(request, env);
  if (method === "POST" && path === "/api/shots") return uploadShot(request, env);
  if (method === "POST" && path === "/api/history") return saveHistory(request, env);
  if (method === "GET" && path === "/api/history") return queryHistory(request, env);
  if (method === "GET" && path.startsWith("/api/public/projects/")) {
    const project = await findPublicProject(
      env,
      decodeURIComponent(path.slice("/api/public/projects/".length)),
    );
    return project ? json({ ok: true, project }) : json({ error: "Not found" }, 404);
  }
  if (method === "GET" && path.startsWith("/api/public/collections/")) {
    const collection = await findPublicCollection(
      env,
      decodeURIComponent(path.slice("/api/public/collections/".length)),
    );
    return collection ? json({ collection, ok: true }) : json({ error: "Not found" }, 404);
  }
  if (method === "GET" && path === "/api/project-tree") {
    const principal = await resolvePrincipal(request, env);
    return principal
      ? json({ ok: true, tree: await projectTree(env, principal) }, 200, { "Cache-Control": "no-store" })
      : json({ error: "Unauthorized" }, 401);
  }
  if (method === "GET" && path === "/api/projects") {
    const principal = await resolvePrincipal(request, env);
    return principal
      ? json({ ok: true, projects: await listProjects(env, principal) })
      : json({ error: "Unauthorized" }, 401);
  }
  if (method === "POST" && path === "/api/projects") {
    const principal = await resolvePrincipal(request, env);
    if (!principal) return json({ error: "Unauthorized" }, 401);
    const body = await readJson(request);
    const name = stringValue(body, "name").trim();
    return name
      ? json({
          ok: true,
          project: await createProject(
            env,
            principal,
            name,
            isProjectIcon(body.icon) ? body.icon : DEFAULT_PROJECT_ICON,
          ),
        }, 201)
      : json({ error: "name required" }, 400);
  }
  if (method === "POST" && path === "/api/projects/reorder") {
    const principal = await resolvePrincipal(request, env);
    if (!principal) return json({ error: "Unauthorized" }, 401);
    const body = await readJson(request);
    return json({ ok: true, projects: await reorderProjects(env, principal, stringArrayValue(body, "ids")) });
  }
  const projectCollectionsMatch = path.match(/^\/api\/projects\/([^/]+)\/collections$/);
  if (projectCollectionsMatch && method === "GET") {
    const principal = await resolvePrincipal(request, env);
    if (!principal) return json({ error: "Unauthorized" }, 401);
    const projectId = decodeURIComponent(projectCollectionsMatch[1]);
    return json({ collections: await listCollections(env, principal, projectId), ok: true });
  }
  if (projectCollectionsMatch && method === "POST") {
    const principal = await resolvePrincipal(request, env);
    if (!principal) return json({ error: "Unauthorized" }, 401);
    const body = await readJson(request);
    const name = stringValue(body, "name").trim();
    if (!name) return json({ error: "name required" }, 400);
    const collection = await createCollection(
      env,
      principal,
      decodeURIComponent(projectCollectionsMatch[1]),
      name,
      stringValue(body, "parentId") || null,
    );
    return collection ? json({ collection, ok: true }, 201) : json({ error: "project not found" }, 404);
  }
  const collectionReorderMatch = path.match(/^\/api\/projects\/([^/]+)\/collections\/reorder$/);
  if (collectionReorderMatch && method === "POST") {
    const principal = await resolvePrincipal(request, env);
    if (!principal) return json({ error: "Unauthorized" }, 401);
    const body = await readJson(request);
    const projectId = decodeURIComponent(collectionReorderMatch[1]);
    const collections = await reorderCollections(
      env,
      principal,
      projectId,
      collectionPlacementsValue(body),
    );
    return collections
      ? json({ collections, ok: true })
      : json({ error: "invalid collection hierarchy" }, 400);
  }
  const projectMatch = path.match(/^\/api\/projects\/([^/]+)$/);
  if (projectMatch && method === "PATCH") {
    const principal = await resolvePrincipal(request, env);
    if (!principal) return json({ error: "Unauthorized" }, 401);
    const body = await readJson(request);
    const name = stringValue(body, "name").trim();
    if (!name) return json({ error: "name required" }, 400);
    const project = await renameProject(
      env,
      principal,
      decodeURIComponent(projectMatch[1]),
      name,
      isProjectIcon(body.icon) ? body.icon : undefined,
    );
    return project ? json({ ok: true, project }) : json({ error: "project not found" }, 404);
  }
  if (projectMatch && method === "DELETE") {
    const principal = await resolvePrincipal(request, env);
    if (!principal) return json({ error: "Unauthorized" }, 401);
    const deleted = await deleteProjectContainer(env, principal, decodeURIComponent(projectMatch[1]));
    return deleted ? json({ deleted, ok: true }) : json({ error: "protected or not found" }, 409);
  }
  const collectionMatch = path.match(/^\/api\/collections\/([^/]+)$/);
  if (collectionMatch && method === "PATCH") {
    const principal = await resolvePrincipal(request, env);
    if (!principal) return json({ error: "Unauthorized" }, 401);
    const body = await readJson(request);
    const name = stringValue(body, "name").trim();
    if (!name) return json({ error: "name required" }, 400);
    const collection = await renameCollection(env, principal, decodeURIComponent(collectionMatch[1]), name);
    return collection ? json({ collection, ok: true }) : json({ error: "collection not found" }, 404);
  }
  if (collectionMatch && method === "DELETE") {
    const principal = await resolvePrincipal(request, env);
    if (!principal) return json({ error: "Unauthorized" }, 401);
    const deleted = await deleteCollectionContainer(env, principal, decodeURIComponent(collectionMatch[1]));
    return deleted ? json({ deleted, ok: true }) : json({ error: "protected or not found" }, 409);
  }
  const sessionMoveMatch = path.match(/^\/api\/sessions\/([^/]+)\/move$/);
  if (sessionMoveMatch && method === "POST") {
    const principal = await resolvePrincipal(request, env);
    if (!principal) return json({ error: "Unauthorized" }, 401);
    const body = await readJson(request);
    const collectionId = stringValue(body, "collectionId");
    if (!collectionId) return json({ error: "collectionId required" }, 400);
    const session = await moveSession(
      env,
      principal,
      decodeURIComponent(sessionMoveMatch[1]),
      collectionId,
    );
    return session ? json({ ok: true, session }) : json({ error: "session or collection not found" }, 404);
  }
  const sessionReorderMatch = path.match(/^\/api\/collections\/([^/]+)\/sessions\/reorder$/);
  if (sessionReorderMatch && method === "POST") {
    const principal = await resolvePrincipal(request, env);
    if (!principal) return json({ error: "Unauthorized" }, 401);
    const body = await readJson(request);
    const collectionId = decodeURIComponent(sessionReorderMatch[1]);
    return json({
      ok: true,
      sessions: await reorderSessionIds(env, principal, collectionId, stringArrayValue(body, "ids")),
    });
  }
  if (method === "GET" && path.startsWith("/api/sessions/")) {
    const id = decodeURIComponent(path.slice("/api/sessions/".length));
    const session = await findPublicSession(env, id);
    return session
      ? json({ ok: true, session }, 200, { "Cache-Control": "public, max-age=60" })
      : json({ error: "Session not found" }, 404);
  }
  if (method === "DELETE" && path.startsWith("/api/history/")) {
    return deleteHistory(request, env, decodeURIComponent(path.slice("/api/history/".length)));
  }
  if (method === "POST" && path === "/api/cleanup") {
    if (!checkAdminAuth(request, env)) return json({ error: "Unauthorized" }, 401);
    return json({ ok: true, ...(await cleanupOldRecords(env, Number(url.searchParams.get("days")) || 7)) });
  }
  return json({ error: "Not found" }, 404);
}

export async function handleCloudPublicRequest(request: Request, env: CloudEnv) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname.startsWith("/shots/")) {
    const id = decodeURIComponent(url.pathname.slice("/shots/".length));
    const key = id.endsWith(".png") ? id : `${id}.png`;
    const object = env.PINAR_BUCKET ? await env.PINAR_BUCKET.get(key) : null;
    if (!object) return json({ error: "shot not found" }, 404);
    const headers = corsHeaders({ "Cache-Control": "public, max-age=86400", "Content-Type": "image/png" });
    object.writeHttpMetadata(headers);
    headers.set("ETag", object.httpEtag);
    return new Response(object.body, { headers });
  }
  if (request.method === "GET" && url.pathname.startsWith("/v/")) {
    const rawId = decodeURIComponent(url.pathname.slice("/v/".length));
    if (!rawId.endsWith(".md")) return json({ error: "Not found" }, 404);
    const id = rawId.slice(0, -3);
    const session = await findPublicSession(env, id);
    if (!session) return text("Session not found", 404);
    return text(formatSessionMarkdown(session, `${url.origin}/v/${id}`), 200, {
      "Cache-Control": "public, max-age=60",
      "Content-Type": "text/markdown; charset=utf-8",
    });
  }
  if (request.method === "GET" && url.pathname.startsWith("/p/")) {
    const rawId = decodeURIComponent(url.pathname.slice("/p/".length));
    if (!rawId.endsWith(".md")) return json({ error: "Not found" }, 404);
    const project = await findPublicProject(env, rawId.slice(0, -3));
    return project
      ? text(formatProjectMarkdown(project, url.origin), 200, {
        "Cache-Control": "public, max-age=60",
        "Content-Type": "text/markdown; charset=utf-8",
      })
      : text("Project not found", 404);
  }
  if (request.method === "GET" && url.pathname.startsWith("/c/")) {
    const rawId = decodeURIComponent(url.pathname.slice("/c/".length));
    if (!rawId.endsWith(".md")) return json({ error: "Not found" }, 404);
    const collection = await findPublicCollection(env, rawId.slice(0, -3));
    return collection
      ? text(formatCollectionMarkdown(collection, url.origin), 200, {
        "Cache-Control": "public, max-age=60",
        "Content-Type": "text/markdown; charset=utf-8",
      })
      : text("Collection not found", 404);
  }
  if (request.method === "GET" && (url.pathname === "/install.sh" || url.pathname === "/install.ps1")) {
    const filename = url.pathname.slice(1);
    const response = await fetch(`https://raw.githubusercontent.com/djalmajr/pinar/main/${filename}`);
    return text(await response.text(), response.status, { "Content-Type": "text/plain; charset=utf-8" });
  }
  return json({ error: "Not found" }, 404);
}

export function resetCloudMemoryStateForTests() {
  memoryAccounts.clear();
  memoryAiCreditGrants.clear();
  memoryCollections.clear();
  memoryDeviceSessions.clear();
  memoryEmailChallenges.clear();
  memoryExtensionCodes.clear();
  memoryInstallations.clear();
  memoryProjects.clear();
  memoryRateLimits.clear();
  memorySessions.clear();
  memoryStorageGrants.clear();
  memoryStripeEvents.clear();
  memoryWebSessions.clear();
  memoryMigrationFailure = false;
  testNow = null;
}

export function seedCloudAccountForTests(input: {
  aiCreditRefillAt?: string;
  billingStatus?: AccountRecord["billingStatus"];
  email: string;
  everPaid?: boolean;
  id?: string;
  plan?: AccountPlan;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
}) {
  const account: AccountRecord = {
    aiCreditRefillAt: input.aiCreditRefillAt || "",
    billingStatus: input.billingStatus || "active",
    email: normalizeEmail(input.email),
    everPaid: input.everPaid ?? true,
    id: input.id || "usr_" + generateNanoId(24),
    plan: input.plan || "pro",
    stripeCustomerId: input.stripeCustomerId || "",
    stripeSubscriptionId: input.stripeSubscriptionId || "",
  };
  memoryAccounts.set(account.id, account);
  return accountAuthSession(account);
}

export function seedCloudStorageUsageForTests(input: {
  byteSize: number;
  ownerId: string;
  sessionId?: string;
}) {
  const id = input.sessionId || "seeded_storage_usage";
  memorySessions.set(id, {
    byteSize: input.byteSize,
    collectionId: "",
    createdAt: currentDate().toISOString(),
    id,
    isPermanent: false,
    page: { title: "Seeded storage usage", url: "https://example.test/storage" },
    pins: [],
    plan: "free",
    position: 0,
    shotId: id,
    shotUrl: `https://pinar.test/shots/${id}.png`,
    userId: input.ownerId,
  });
}

export function setCloudMigrationFailureForTests(value: boolean) {
  memoryMigrationFailure = value;
}

export function setCloudNowForTests(value: string | number | null) {
  testNow = value === null ? null : new Date(value).getTime();
}
