import type {
  CaptureDestination,
  Collection,
  CollectionPlacement,
  PageInfo,
  Pin,
  Project,
  ProjectTree,
  ProjectTreeCollection,
  ProjectTreeProject,
  Session,
} from "@pinar/shared";
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
  API_KEY?: string;
  AUTH_KEY?: string;
  DB?: D1Database;
  PINAR_API_KEY?: string;
  PINAR_BUCKET?: R2Bucket;
  STRIPE_PRICE_LIFETIME?: string;
  STRIPE_PRICE_MONTHLY?: string;
  STRIPE_PRICE_YEARLY?: string;
  STRIPE_SECRET_KEY?: string;
}

interface Principal {
  id: string;
  isPermanent: boolean;
  kind: "account" | "browser" | "installation";
  plan: "free" | "pro";
  user?: Record<string, unknown>;
}

interface InstallationRecord {
  status: "active" | "revoked";
  tokenHash: string;
}

interface BrowserTicketRecord {
  expiresAt: string;
  principal: Principal;
  usedAt: string | null;
}

interface BrowserSessionRecord {
  expiresAt: string;
  principal: Principal;
  revokedAt: string | null;
}

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz-";
const BROWSER_SESSION_COOKIE = "pinar_session";
const BROWSER_SESSION_PATTERN = /^pbs_[A-Za-z0-9_-]{43}$/;
const BROWSER_TICKET_PATTERN = /^pbt_[A-Za-z0-9_-]{43}$/;
const INSTALLATION_ID_PATTERN = /^ins_[A-Za-z0-9_-]{24}$/;
const INSTALLATION_TOKEN_PATTERN = /^pit_[A-Za-z0-9_-]{43}$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const memoryBrowserSessions = new Map<string, BrowserSessionRecord>();
const memoryBrowserTickets = new Map<string, BrowserTicketRecord>();
const memoryCollections = new Map<string, Collection>();
const memoryInstallations = new Map<string, InstallationRecord>();
const memoryProjects = new Map<string, Project>();
const memorySessions = new Map<string, Session>();

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
  headers.set("Access-Control-Allow-Headers", "authorization, content-type, x-api-key, x-license-key, x-pinar-installation-id");
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
    plan: row.plan === "pro" ? "pro" : "free",
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

async function resolvePrincipal(request: Request, env: CloudEnv): Promise<Principal | null> {
  const now = new Date().toISOString();
  const browserToken = cookieValue(request, BROWSER_SESSION_COOKIE);
  if (BROWSER_SESSION_PATTERN.test(browserToken)) {
    const tokenHash = await hashCredential(browserToken);
    if (env.DB) {
      try {
        const session = await env.DB.prepare(
          "SELECT owner_id, plan, is_permanent FROM browser_sessions WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?",
        ).bind(tokenHash, now).first();
        if (session) {
          return {
            id: String(session.owner_id),
            isPermanent: Number(session.is_permanent) === 1,
            kind: "browser",
            plan: session.plan === "pro" ? "pro" : "free",
          };
        }
      } catch {
        return null;
      }
    } else {
      const session = memoryBrowserSessions.get(tokenHash);
      if (session && !session.revokedAt && session.expiresAt > now) return session.principal;
    }
  }
  const token = bearerToken(request);
  const keyHeader = request.headers.get("x-license-key") || request.headers.get("x-api-key") || "";
  const candidateKey = token || keyHeader;
  if (candidateKey && env.DB) {
    try {
      const user = await env.DB.prepare("SELECT * FROM users WHERE license_key = ? AND status = 'active'")
        .bind(candidateKey).first();
      if (user?.plan === "pro") {
        return { id: String(user.id), isPermanent: true, kind: "account", plan: "pro", user };
      }
    } catch {
      return null;
    }
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
        .bind(now, now, installationId).run().catch(() => undefined);
      return { id: String(installation.id), isPermanent: false, kind: "installation", plan: "free" };
    } catch {
      return null;
    }
  }
  const installation = memoryInstallations.get(installationId);
  if (!installation || installation.status !== "active" || installation.tokenHash !== tokenHash) return null;
  return { id: installationId, isPermanent: false, kind: "installation", plan: "free" };
}

async function registerInstallation(request: Request, env: CloudEnv) {
  const body = await readJson(request);
  const installationId = stringValue(body, "installationId");
  const installationToken = stringValue(body, "installationToken");
  if (!INSTALLATION_ID_PATTERN.test(installationId) || !INSTALLATION_TOKEN_PATTERN.test(installationToken)) {
    return json({ error: "Invalid installation identity" }, 400);
  }
  const tokenHash = await hashCredential(installationToken);
  const now = new Date().toISOString();
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
    if (existing) return json({ installationId, ok: true });
    memoryInstallations.set(installationId, { status: "active", tokenHash });
  }
  return json({ installationId, ok: true }, 201);
}

async function rotateInstallation(request: Request, env: CloudEnv) {
  const current = await resolvePrincipal(request, env);
  if (!current || current.kind !== "installation") return json({ error: "Unauthorized" }, 401);
  const body = await readJson(request);
  const nextId = stringValue(body, "installationId");
  const nextToken = stringValue(body, "installationToken");
  if (nextId === current.id || !INSTALLATION_ID_PATTERN.test(nextId) || !INSTALLATION_TOKEN_PATTERN.test(nextToken)) {
    return json({ error: "Invalid replacement identity" }, 400);
  }
  const nextTokenHash = await hashCredential(nextToken);
  const now = new Date().toISOString();
  if (env.DB) {
    try {
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO installations (id, token_hash, status, created_at, updated_at, last_seen_at) VALUES (?, ?, 'active', ?, ?, ?)",
        ).bind(nextId, nextTokenHash, now, now, now),
        env.DB.prepare("UPDATE sessions SET user_id = ? WHERE user_id = ?").bind(nextId, current.id),
        env.DB.prepare("UPDATE projects SET owner_id = ? WHERE owner_id = ?").bind(nextId, current.id),
        env.DB.prepare("UPDATE collections SET owner_id = ? WHERE owner_id = ?").bind(nextId, current.id),
        env.DB.prepare("UPDATE installations SET status = 'revoked', updated_at = ? WHERE id = ?").bind(now, current.id),
        env.DB.prepare("UPDATE browser_sessions SET revoked_at = ? WHERE owner_id = ? AND revoked_at IS NULL")
          .bind(now, current.id),
        env.DB.prepare("DELETE FROM browser_tickets WHERE owner_id = ?").bind(current.id),
      ]);
    } catch {
      return json({ error: "Installation rotation failed" }, 409);
    }
  } else {
    if (memoryInstallations.has(nextId)) return json({ error: "Installation identity already exists" }, 409);
    memoryInstallations.set(nextId, { status: "active", tokenHash: nextTokenHash });
    const previous = memoryInstallations.get(current.id);
    if (previous) previous.status = "revoked";
    for (const session of memorySessions.values()) {
      if (session.userId === current.id) session.userId = nextId;
    }
    for (const project of memoryProjects.values()) {
      if (project.ownerId === current.id) project.ownerId = nextId;
    }
    for (const collection of memoryCollections.values()) {
      if (collection.ownerId === current.id) collection.ownerId = nextId;
    }
    for (const browserSession of memoryBrowserSessions.values()) {
      if (browserSession.principal.id === current.id) browserSession.revokedAt = now;
    }
    for (const [ticketHash, ticket] of memoryBrowserTickets) {
      if (ticket.principal.id === current.id) memoryBrowserTickets.delete(ticketHash);
    }
  }
  return json({ installationId: nextId, ok: true });
}

async function createBrowserTicket(request: Request, env: CloudEnv) {
  const principal = await resolvePrincipal(request, env);
  if (!principal) return json({ error: "Unauthorized" }, 401);
  const ticket = randomCredential("pbt_");
  const tokenHash = await hashCredential(ticket);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60_000).toISOString();
  const ticketPrincipal: Principal = { ...principal, kind: "browser", user: undefined };
  if (env.DB) {
    try {
      await env.DB.prepare(
        "INSERT INTO browser_tickets (token_hash, owner_id, plan, is_permanent, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)",
      ).bind(tokenHash, principal.id, principal.plan, principal.isPermanent ? 1 : 0, expiresAt, now.toISOString()).run();
    } catch {
      return json({ error: "Browser ticket unavailable" }, 503);
    }
  } else {
    memoryBrowserTickets.set(tokenHash, { expiresAt, principal: ticketPrincipal, usedAt: null });
  }
  const origin = new URL(request.url).origin;
  return json({ expiresAt, ok: true, url: `${origin}/api/auth/device?ticket=${encodeURIComponent(ticket)}` });
}

async function exchangeBrowserTicket(request: Request, env: CloudEnv) {
  const url = new URL(request.url);
  const ticket = url.searchParams.get("ticket") || "";
  if (!BROWSER_TICKET_PATTERN.test(ticket)) return text("Open history from the Pinar extension.", 401);
  const tokenHash = await hashCredential(ticket);
  const now = new Date();
  const nowIso = now.toISOString();
  let principal: Principal | null = null;
  if (env.DB) {
    try {
      const claimed = await env.DB.prepare(
        "UPDATE browser_tickets SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING owner_id, plan, is_permanent",
      ).bind(nowIso, tokenHash, nowIso).first();
      if (claimed) {
        principal = {
          id: String(claimed.owner_id),
          isPermanent: Number(claimed.is_permanent) === 1,
          kind: "browser",
          plan: claimed.plan === "pro" ? "pro" : "free",
        };
      }
    } catch {
      return text("History authentication is temporarily unavailable.", 503);
    }
  } else {
    const record = memoryBrowserTickets.get(tokenHash);
    if (record && !record.usedAt && record.expiresAt > nowIso) {
      record.usedAt = nowIso;
      principal = record.principal;
    }
  }
  if (!principal) return text("This history link is invalid or expired.", 401);
  const browserToken = randomCredential("pbs_");
  const browserTokenHash = await hashCredential(browserToken);
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  if (env.DB) {
    try {
      await env.DB.prepare(
        "INSERT INTO browser_sessions (token_hash, owner_id, plan, is_permanent, expires_at, revoked_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)",
      ).bind(browserTokenHash, principal.id, principal.plan, principal.isPermanent ? 1 : 0, expiresAt, nowIso).run();
    } catch {
      return text("History authentication is temporarily unavailable.", 503);
    }
  } else {
    memoryBrowserSessions.set(browserTokenHash, { expiresAt, principal, revokedAt: null });
  }
  return new Response(null, {
    headers: {
      "Cache-Control": "no-store",
      Location: "/history",
      "Referrer-Policy": "no-referrer",
      "Set-Cookie": `${BROWSER_SESSION_COOKIE}=${encodeURIComponent(browserToken)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`,
    },
    status: 302,
  });
}

async function logout(request: Request, env: CloudEnv) {
  const browserToken = cookieValue(request, BROWSER_SESSION_COOKIE);
  if (BROWSER_SESSION_PATTERN.test(browserToken)) {
    const tokenHash = await hashCredential(browserToken);
    const now = new Date().toISOString();
    if (env.DB) {
      await env.DB.prepare("UPDATE browser_sessions SET revoked_at = ? WHERE token_hash = ?")
        .bind(now, tokenHash).run().catch(() => undefined);
    } else {
      const session = memoryBrowserSessions.get(tokenHash);
      if (session) session.revokedAt = now;
    }
  }
  return json({ ok: true }, 200, {
    "Set-Cookie": `${BROWSER_SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
  });
}

async function createCheckout(request: Request, env: CloudEnv) {
  if (!env.STRIPE_SECRET_KEY) return json({ error: "STRIPE_SECRET_KEY not configured" }, 500);
  const body = await readJson(request);
  const requestedInterval = stringValue(body, "interval");
  const interval = requestedInterval === "year" || requestedInterval === "lifetime" ? requestedInterval : "month";
  const origin = new URL(request.url).origin;
  const isLifetime = interval === "lifetime";
  const priceId = isLifetime
    ? env.STRIPE_PRICE_LIFETIME || env.STRIPE_PRICE_YEARLY
    : interval === "year" ? env.STRIPE_PRICE_YEARLY : env.STRIPE_PRICE_MONTHLY;
  if (!priceId) return json({ error: "Stripe price is not configured" }, 500);
  const params = new URLSearchParams({
    allow_promotion_codes: "true",
    cancel_url: `${origin}/pricing`,
    integration_identifier: `pinar_web_${randomLetters()}`,
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    mode: isLifetime ? "payment" : "subscription",
    success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
  });
  const email = stringValue(body, "email");
  if (email) params.set("customer_email", email);
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    body: params,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Stripe-Version": "2026-07-29.dahlia",
    },
    method: "POST",
  });
  const data = await readJson(response);
  if (!response.ok) {
    const error = isRecord(data.error) ? stringValue(data.error, "message") : "";
    return json({ error: error || "Checkout failed" }, 400);
  }
  return json({ ok: true, url: stringValue(data, "url") });
}

async function createPortal(request: Request, env: CloudEnv) {
  const body = await readJson(request);
  const licenseKey = stringValue(body, "licenseKey") || request.headers.get("x-license-key") || "";
  const origin = new URL(request.url).origin;
  let customerId = "";
  if (licenseKey && env.DB) {
    const user = await env.DB.prepare("SELECT stripe_customer_id FROM users WHERE license_key = ?").bind(licenseKey).first();
    customerId = user && typeof user.stripe_customer_id === "string" ? user.stripe_customer_id : "";
  }
  if (!customerId) return json({ error: "No active Stripe customer found for this license" }, 404);
  if (!env.STRIPE_SECRET_KEY) return json({ error: "STRIPE_SECRET_KEY not configured" }, 500);
  const response = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
    body: new URLSearchParams({ customer: customerId, return_url: `${origin}/history` }),
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
    method: "POST",
  });
  const data = await readJson(response);
  if (!response.ok) {
    const error = isRecord(data.error) ? stringValue(data.error, "message") : "";
    return json({ error: error || "Portal session failed" }, 400);
  }
  return json({ ok: true, url: stringValue(data, "url") });
}

async function upsertStripeUser(env: CloudEnv, session: Record<string, unknown>) {
  if (!env.DB || !session.customer) return null;
  const customerDetails = isRecord(session.customer_details) ? session.customer_details : {};
  const email = stringValue(customerDetails, "email") || stringValue(session, "customer_email") || `user-${Date.now()}@pinar.dev`;
  const licenseKey = `pinar_${crypto.randomUUID().replace(/-/g, "")}`;
  const now = new Date().toISOString();
  const userId = `usr_${Date.now()}`;
  await env.DB.prepare(
    `INSERT INTO users (id, email, license_key, plan, stripe_customer_id, stripe_subscription_id, status, storage_limit_mb, created_at, updated_at)
     VALUES (?, ?, ?, 'pro', ?, ?, 'active', 5120, ?, ?)
     ON CONFLICT(email) DO UPDATE SET plan='pro', license_key=excluded.license_key, stripe_customer_id=excluded.stripe_customer_id,
     stripe_subscription_id=excluded.stripe_subscription_id, status='active', updated_at=excluded.updated_at`,
  ).bind(userId, email, licenseKey, String(session.customer), String(session.subscription || ""), now, now).run();
  return { email, licenseKey, plan: "pro" };
}

async function completeCheckout(request: Request, env: CloudEnv) {
  const sessionId = new URL(request.url).searchParams.get("session_id") || "";
  if (!sessionId || !env.STRIPE_SECRET_KEY || !env.DB) return json({ error: "Checkout session unavailable" }, 400);
  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  const session = await readJson(response);
  if (!response.ok) return json({ error: "Checkout session unavailable" }, 400);
  const existing = await env.DB.prepare("SELECT email, license_key, plan FROM users WHERE stripe_customer_id = ?")
    .bind(stringValue(session, "customer")).first();
  if (existing) {
    return json({ email: existing.email, licenseKey: existing.license_key, ok: true, plan: existing.plan });
  }
  const user = await upsertStripeUser(env, session);
  return user ? json({ ...user, ok: true }) : json({ error: "Checkout activation unavailable" }, 503);
}

async function handleWebhook(request: Request, env: CloudEnv) {
  const event = await readJson(request);
  const data = isRecord(event.data) && isRecord(event.data.object) ? event.data.object : {};
  if (event.type === "checkout.session.completed") {
    await upsertStripeUser(env, data);
  } else if (event.type === "customer.subscription.deleted" && data.customer && env.DB) {
    await env.DB.prepare("UPDATE users SET plan='free', status='canceled', updated_at=? WHERE stripe_customer_id=?")
      .bind(new Date().toISOString(), String(data.customer)).run();
  }
  return json({ received: true });
}

async function verifyLicense(request: Request, env: CloudEnv) {
  const url = new URL(request.url);
  const candidateKey = bearerToken(request) || url.searchParams.get("key") || "";
  if (!candidateKey) return json({ error: "license key required", valid: false }, 400);
  if (env.DB) {
    const user = await env.DB.prepare(
      "SELECT id, email, plan, status, storage_limit_mb, storage_used_bytes FROM users WHERE license_key = ?",
    ).bind(candidateKey).first();
    if (user?.status === "active") {
      return json({
        email: user.email,
        ok: true,
        plan: user.plan,
        storage: { limitMb: user.storage_limit_mb, usedBytes: user.storage_used_bytes },
        valid: true,
      });
    }
  }
  return json({ error: "Invalid or inactive license key", valid: false }, 404);
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
        INSERT INTO projects (id, owner_id, name, position, is_protected, created_at, updated_at)
        VALUES (?, ?, 'Personal', 0, 1, ?, ?)
      `).bind(projectId, principal.id, timestamp, timestamp).run();
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

async function createProject(env: CloudEnv, principal: Principal, name: string) {
  const projects = await listProjects(env, principal);
  const timestamp = new Date().toISOString();
  const project: Project = {
    createdAt: timestamp,
    id: generateNanoId(),
    isProtected: false,
    name,
    ownerId: principal.id,
    position: projects.length,
    updatedAt: timestamp,
  };
  if (env.DB) {
    await env.DB.prepare(`
      INSERT INTO projects (id, owner_id, name, position, is_protected, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, ?, ?)
    `).bind(project.id, principal.id, name, project.position, timestamp, timestamp).run();
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

async function renameProject(env: CloudEnv, principal: Principal, id: string, name: string) {
  if (env.DB) {
    const timestamp = new Date().toISOString();
    await env.DB.prepare(
      "UPDATE projects SET name = ?, updated_at = ? WHERE id = ? AND owner_id = ?",
    ).bind(name, timestamp, id, principal.id).run();
    const row = await env.DB.prepare("SELECT * FROM projects WHERE id = ? AND owner_id = ?")
      .bind(id, principal.id).first();
    return row ? projectFromRow(row) : null;
  }
  const project = memoryProjects.get(id);
  if (!project || project.ownerId !== principal.id) return null;
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
    byteSize: numberValue(body, "byteSize"),
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
  const secret = env.API_KEY || env.PINAR_API_KEY || env.AUTH_KEY;
  if (!secret) return false;
  return bearerToken(request) === secret || request.headers.get("x-api-key") === secret;
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

export async function authorizeCloudHistoryRequest(request: Request, env: CloudEnv) {
  return Boolean(await resolvePrincipal(request, env));
}

export async function handleCloudApiRequest(request: Request, env: CloudEnv) {
  const url = new URL(request.url);
  const { method } = request;
  const path = url.pathname;
  if (method === "OPTIONS") return new Response(null, { headers: corsHeaders(), status: 204 });
  if (method === "GET" && path === "/api/health") {
    return json({
      hasAuth: Boolean(env.API_KEY || env.PINAR_API_KEY || env.AUTH_KEY),
      hasBucket: Boolean(env.PINAR_BUCKET),
      hasDb: Boolean(env.DB),
      hasStripe: Boolean(env.STRIPE_SECRET_KEY),
      ok: true,
      runtime: "cloud",
      service: "pinar",
    });
  }
  if (method === "POST" && path === "/api/installations") return registerInstallation(request, env);
  if (method === "POST" && path === "/api/installations/rotate") return rotateInstallation(request, env);
  if (method === "POST" && path === "/api/auth/browser-ticket") return createBrowserTicket(request, env);
  if (method === "GET" && path === "/api/auth/device") return exchangeBrowserTicket(request, env);
  if (method === "POST" && path === "/api/auth/logout") return logout(request, env);
  if (path === "/api/auth/verify") return verifyLicense(request, env);
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
      ? json({ ok: true, project: await createProject(env, principal, name) }, 201)
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
    const project = await renameProject(env, principal, decodeURIComponent(projectMatch[1]), name);
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
  memoryBrowserSessions.clear();
  memoryBrowserTickets.clear();
  memoryCollections.clear();
  memoryInstallations.clear();
  memoryProjects.clear();
  memorySessions.clear();
}
