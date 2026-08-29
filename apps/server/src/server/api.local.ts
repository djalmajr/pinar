import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import type {
  CaptureDestination,
  Collection,
  CollectionPlacement,
  PageInfo,
  Pin,
  Project,
  ProjectIcon,
  ProjectTree,
  Session,
} from "@pinar/shared";
import {
  generateNanoId,
  parseVisualCapture,
  VisualContextError,
  visualContextErrorBody,
  type VisualCapture,
} from "@pinar/shared";
import { DEFAULT_PROJECT_ICON, isProjectIcon } from "@pinar/shared/project-icons";
import { openHistoryDb } from "@pinar/cli/history";
import { pinarHome, shotsDir } from "@pinar/cli/paths";
import { writeShot } from "@pinar/cli/shots";
import { formatCollectionMarkdown, formatProjectMarkdown, formatSessionMarkdown } from "./markdown";
import { installerResponse } from "./installers";
import {
  capabilitySecretFromRequest,
  readOrCreateLocalCapability,
  resetLocalCapabilityForTests,
  revokeLocalCapability,
  rotateLocalCapability,
} from "./local-capability";
import {
  denyUnauthorizedLocalApi,
  localApiPreflightResponse,
  localApiRequestAllowed,
  unauthorizedLocalApiResponse,
  withLocalApiHeaders,
} from "./local-api-policy";
import { localHealthDiscoveryBody } from "./local-api-trust";
import { decodePngDataUrl } from "./png";

interface LocalSession extends Session {
  shotPath?: string | null;
}

interface HistoryDatabase {
  close(): void;
  createCollection(projectId: string, name: string, parentId?: string | null): Collection | null;
  createProject(name: string, icon?: ProjectIcon): Project;
  deleteCollection(id: string): boolean;
  deleteProject(id: string): boolean;
  deleteSession(id: string): boolean;
  getDefaultDestination(): CaptureDestination;
  getProjectTree(): ProjectTree;
  getSession(id: string): LocalSession | null;
  listCollections(projectId: string): Collection[];
  listProjects(): Project[];
  listSessions(options: { collectionId?: string; limit: number; offset: number; query: string }): LocalSession[];
  moveSession(id: string, collectionId: string): LocalSession | null;
  reorderCollections(projectId: string, items: CollectionPlacement[] | string[]): Collection[] | null;
  reorderProjects(ids: string[]): Project[];
  reorderSessions(collectionId: string, ids: string[]): LocalSession[];
  resolveDestination(collectionId?: string): CaptureDestination;
  saveSession(input: {
    collectionId?: string;
    createdAt?: string;
    id?: string;
    page?: PageInfo;
    pins?: Pin[];
    shotId?: string | null;
    shotPath?: string | null;
  }): LocalSession;
  updateCollection(id: string, name: string): Collection | null;
  updateProject(id: string, name: string, icon?: ProjectIcon): Project | null;
}

let activeDatabase: HistoryDatabase | null = null;
let activeRoot = "";

function rootPath() {
  return pinarHome();
}

function historyDatabase(): HistoryDatabase {
  const root = rootPath();
  if (!activeDatabase || activeRoot !== root) {
    activeDatabase?.close();
    activeDatabase = openHistoryDb(root);
    activeRoot = root;
  }
  if (!activeDatabase) throw new Error("Unable to initialize local history database");
  return activeDatabase;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function stringValue(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function stringArrayValue(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function pageValue(value: unknown): PageInfo {
  if (!isRecord(value)) return { title: "", url: "" };
  const viewport = isRecord(value.viewport) ? value.viewport : undefined;
  return {
    title: stringValue(value, "title"),
    url: stringValue(value, "url"),
    viewport: viewport
      ? {
        dpr: typeof viewport.dpr === "number" ? viewport.dpr : undefined,
        height: typeof viewport.height === "number" ? viewport.height : 0,
        width: typeof viewport.width === "number" ? viewport.width : 0,
      }
      : undefined,
  };
}

function visualCaptureFromBody(
  body: Record<string, unknown>,
  id: string,
): { ok: true; capture: VisualCapture } | { ok: false; response: Response } {
  try {
    return {
      ok: true,
      capture: parseVisualCapture({ ...body, captureId: id, page: body.page ?? pageValue(body.page) }, id),
    };
  } catch (error) {
    return { ok: false, response: json(visualContextErrorBody(error), 400) };
  }
}

async function readJson(request: Request) {
  try {
    const value: unknown = await request.json();
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

function headers(initial?: HeadersInit) {
  const result = new Headers(initial);
  result.set("X-Content-Type-Options", "nosniff");
  if (!result.has("Cache-Control")) result.set("Cache-Control", "no-store");
  return result;
}

function json(data: unknown, status = 200, initial?: HeadersInit) {
  return Response.json(data, { headers: headers(initial), status });
}

function text(body: string, status = 200, initial?: HeadersInit) {
  return new Response(body, { headers: headers(initial), status });
}

function presentSession(session: LocalSession | null, origin: string): Session | null {
  if (!session) return null;
  const shotId = session.shotId || session.id;
  return {
    ...session,
    captureId: session.captureId || session.id,
    isPermanent: true,
    plan: "free",
    schemaVersion: session.schemaVersion ?? 1,
    shotUrl: shotId ? `${origin}/shots/${shotId}.png` : null,
    viewerUrl: `${origin}/v/${session.id}.md`,
  };
}

function presentProjectTree(tree: ProjectTree, origin: string): ProjectTree {
  return {
    projects: tree.projects.map((project) => ({
      ...project,
      collections: project.collections.map((collection) => ({
        ...collection,
        sessions: collection.sessions
          .map((session) => presentSession(session, origin))
          .filter((session): session is Session => session !== null),
      })),
    })),
  };
}

function normalizedName(body: Record<string, unknown>) {
  return stringValue(body, "name").trim();
}

function projectIconValue(body: Record<string, unknown>) {
  return isProjectIcon(body.icon) ? body.icon : undefined;
}

function publicProject(id: string, origin: string) {
  return presentProjectTree(historyDatabase().getProjectTree(), origin).projects.find(
    (project) => project.id === id,
  ) || null;
}

function publicCollection(id: string, origin: string) {
  for (const project of presentProjectTree(historyDatabase().getProjectTree(), origin).projects) {
    const collection = project.collections.find((item) => item.id === id);
    if (collection) return collection;
  }
  return null;
}

async function uploadShot(request: Request): Promise<Response> {
  const body = await readJson(request);
  const id = stringValue(body, "id") || stringValue(body, "captureId");
  const image = stringValue(body, "image");
  if (!id || !image) return json({ error: "id and image required" }, 400);
  let capture = null;
  if (body.page != null || body.pins != null || body.schemaVersion != null || body.captureId) {
    const parsed = visualCaptureFromBody(body, id);
    if (!parsed.ok) return parsed.response;
    capture = parsed.capture;
  }
  try {
    decodePngDataUrl(image);
  } catch {
    return json({ error: "invalid PNG image" }, 400);
  }
  const saved = await writeShot(id, image, rootPath());
  const destination = historyDatabase().resolveDestination(stringValue(body, "collectionId"));
  if (capture) {
    try {
      historyDatabase().saveSession({
        collectionId: destination.collectionId,
        createdAt: stringValue(body, "createdAt") || capture.createdAt,
        id: capture.captureId,
        page: capture.page,
        pins: capture.pins,
        shotId: id,
        shotPath: saved,
      });
    } catch (error) {
      if (error instanceof VisualContextError) return json(visualContextErrorBody(error), 400);
      throw error;
    }
  }
  const origin = new URL(request.url).origin;
  return json({
    destination,
    isPermanent: true,
    markdownUrl: `${origin}/v/${id}.md`,
    ok: true,
    path: saved,
    plan: "free",
    shotUrl: `${origin}/shots/${id}.png`,
    viewerUrl: `${origin}/v/${id}.md`,
  }, 201);
}

async function saveHistory(request: Request): Promise<Response> {
  const body = await readJson(request);
  const destination = historyDatabase().resolveDestination(stringValue(body, "collectionId"));
  const id = stringValue(body, "id") || stringValue(body, "captureId") || generateNanoId();
  const parsed = visualCaptureFromBody(body, id);
  if (!parsed.ok) return parsed.response;
  try {
    const session = historyDatabase().saveSession({
      collectionId: destination.collectionId,
      createdAt: stringValue(body, "createdAt") || parsed.capture.createdAt,
      id: parsed.capture.captureId,
      page: parsed.capture.page,
      pins: parsed.capture.pins,
      shotId: stringValue(body, "shotId"),
      shotPath: stringValue(body, "shotPath"),
    });
    return json({ destination, ok: true, session: presentSession(session, new URL(request.url).origin) }, 201);
  } catch (error) {
    if (error instanceof VisualContextError) return json(visualContextErrorBody(error), 400);
    throw error;
  }
}

async function deleteHistory(id: string) {
  const database = historyDatabase();
  const existing = database.getSession(id);
  if (!existing) return json({ error: "not found" }, 404);
  if (existing.shotPath && existsSync(existing.shotPath)) await rm(existing.shotPath, { force: true });
  return json({ deleted: database.deleteSession(id), ok: true });
}

export async function proxyCloudCheckout(request: Request, fetcher: typeof fetch = fetch) {
  try {
    const response = await fetcher("https://pinar.dev/api/stripe/checkout", {
      body: await request.text(),
      headers: {
        Accept: "application/json",
        "Content-Type": request.headers.get("content-type") || "application/json",
      },
      method: "POST",
    });
    const body = await response.text();
    if (response.headers.get("content-type")?.includes("application/json")) {
      return new Response(body, {
        headers: headers({ "Content-Type": "application/json; charset=utf-8" }),
        status: response.status,
      });
    }
  } catch {
    // Normalize cloud and transport failures into the local JSON API contract.
  }
  return json({ code: "checkout_unavailable", error: "Checkout service unavailable" }, 503);
}

export async function proxyCloudPricing(fetcher: typeof fetch = fetch) {
  try {
    const response = await fetcher("https://pinar.dev/api/pricing", {
      headers: { Accept: "application/json" },
      method: "GET",
    });
    const body = await response.text();
    if (response.headers.get("content-type")?.includes("application/json")) {
      return new Response(body, {
        headers: headers({
          "Cache-Control": "private, no-store",
          "Content-Type": "application/json; charset=utf-8",
        }),
        status: response.status,
      });
    }
  } catch {
    // Normalize cloud and transport failures into the local JSON API contract.
  }
  return json({ code: "pricing_unavailable", error: "Pricing service unavailable" }, 503, {
    "Cache-Control": "private, no-store",
  });
}

export async function authorizeHistoryRequest(request: Request) {
  return localApiRequestAllowed(request);
}

export async function handleApiRequest(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return localApiPreflightResponse(request);
  const denied = await denyUnauthorizedLocalApi(request);
  if (denied) return denied;
  return withLocalApiHeaders(request, await routeLocalApi(request));
}

async function routeLocalApi(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const { method } = request;
  const path = url.pathname;
  if (method === "GET" && path === "/api/local/capability") {
    const store = await readOrCreateLocalCapability();
    return json({ token: store.current.secret });
  }
  if (method === "POST" && path === "/api/local/capability/rotate") {
    const next = await rotateLocalCapability(capabilitySecretFromRequest(request));
    return next ? json({ token: next.current.secret }) : unauthorizedLocalApiResponse(request);
  }
  if (method === "POST" && path === "/api/local/capability/revoke") {
    const revoked = await revokeLocalCapability(capabilitySecretFromRequest(request));
    return revoked ? json({ ok: true }) : unauthorizedLocalApiResponse(request);
  }
  if (method === "GET" && path === "/api/health") {
    return json(localHealthDiscoveryBody());
  }
  if (method === "GET" && path === "/api/auth/session") {
    return json({ session: { kind: "local", plan: "free" } }, 200, { "Cache-Control": "no-store" });
  }
  if (method === "GET" && path === "/api/pricing") return proxyCloudPricing();
  if (method === "POST" && path === "/api/auth/logout") return json({ ok: true });
  if (method === "POST" && path === "/api/stripe/checkout") return proxyCloudCheckout(request);
  if (method === "POST" && path === "/api/shots") return uploadShot(request);
  if (method === "POST" && path === "/api/history") return saveHistory(request);
  if (method === "GET" && path.startsWith("/api/public/projects/")) {
    const project = publicProject(
      decodeURIComponent(path.slice("/api/public/projects/".length)),
      url.origin,
    );
    return project ? json({ ok: true, project }) : json({ error: "not found" }, 404);
  }
  if (method === "GET" && path.startsWith("/api/public/collections/")) {
    const collection = publicCollection(
      decodeURIComponent(path.slice("/api/public/collections/".length)),
      url.origin,
    );
    return collection ? json({ collection, ok: true }) : json({ error: "not found" }, 404);
  }
  if (method === "GET" && path === "/api/project-tree") {
    return json({ ok: true, tree: presentProjectTree(historyDatabase().getProjectTree(), url.origin) });
  }
  if (method === "GET" && path === "/api/projects") {
    return json({ ok: true, projects: historyDatabase().listProjects() });
  }
  if (method === "POST" && path === "/api/projects") {
    const body = await readJson(request);
    const name = normalizedName(body);
    return name
      ? json({
          ok: true,
          project: historyDatabase().createProject(
            name,
            projectIconValue(body) ?? DEFAULT_PROJECT_ICON,
          ),
        }, 201)
      : json({ error: "name required" }, 400);
  }
  if (method === "POST" && path === "/api/projects/reorder") {
    const body = await readJson(request);
    return json({ ok: true, projects: historyDatabase().reorderProjects(stringArrayValue(body, "ids")) });
  }
  const projectCollectionsMatch = path.match(/^\/api\/projects\/([^/]+)\/collections$/);
  if (projectCollectionsMatch && method === "GET") {
    const projectId = decodeURIComponent(projectCollectionsMatch[1]);
    return json({ collections: historyDatabase().listCollections(projectId), ok: true });
  }
  if (projectCollectionsMatch && method === "POST") {
    const projectId = decodeURIComponent(projectCollectionsMatch[1]);
    const body = await readJson(request);
    const name = normalizedName(body);
    if (!name) return json({ error: "name required" }, 400);
    const parentId = stringValue(body, "parentId") || null;
    const collection = historyDatabase().createCollection(projectId, name, parentId);
    return collection ? json({ collection, ok: true }, 201) : json({ error: "project not found" }, 404);
  }
  const collectionReorderMatch = path.match(/^\/api\/projects\/([^/]+)\/collections\/reorder$/);
  if (collectionReorderMatch && method === "POST") {
    const projectId = decodeURIComponent(collectionReorderMatch[1]);
    const body = await readJson(request);
    const collections = historyDatabase().reorderCollections(
      projectId,
      collectionPlacementsValue(body),
    );
    return collections
      ? json({ collections, ok: true })
      : json({ error: "invalid collection hierarchy" }, 400);
  }
  const projectMatch = path.match(/^\/api\/projects\/([^/]+)$/);
  if (projectMatch && method === "PATCH") {
    const body = await readJson(request);
    const name = normalizedName(body);
    if (!name) return json({ error: "name required" }, 400);
    const project = historyDatabase().updateProject(
      decodeURIComponent(projectMatch[1]),
      name,
      projectIconValue(body),
    );
    return project ? json({ ok: true, project }) : json({ error: "project not found" }, 404);
  }
  if (projectMatch && method === "DELETE") {
    const deleted = historyDatabase().deleteProject(decodeURIComponent(projectMatch[1]));
    return deleted ? json({ deleted, ok: true }) : json({ error: "protected or not found" }, 409);
  }
  const collectionMatch = path.match(/^\/api\/collections\/([^/]+)$/);
  if (collectionMatch && method === "PATCH") {
    const body = await readJson(request);
    const name = normalizedName(body);
    if (!name) return json({ error: "name required" }, 400);
    const collection = historyDatabase().updateCollection(decodeURIComponent(collectionMatch[1]), name);
    return collection ? json({ collection, ok: true }) : json({ error: "collection not found" }, 404);
  }
  if (collectionMatch && method === "DELETE") {
    const deleted = historyDatabase().deleteCollection(decodeURIComponent(collectionMatch[1]));
    return deleted ? json({ deleted, ok: true }) : json({ error: "protected or not found" }, 409);
  }
  const sessionMoveMatch = path.match(/^\/api\/sessions\/([^/]+)\/move$/);
  if (sessionMoveMatch && method === "POST") {
    const body = await readJson(request);
    const collectionId = stringValue(body, "collectionId");
    if (!collectionId) return json({ error: "collectionId required" }, 400);
    const session = historyDatabase().moveSession(
      decodeURIComponent(sessionMoveMatch[1]),
      collectionId,
    );
    return session
      ? json({ ok: true, session: presentSession(session, url.origin) })
      : json({ error: "session or collection not found" }, 404);
  }
  const sessionReorderMatch = path.match(/^\/api\/collections\/([^/]+)\/sessions\/reorder$/);
  if (sessionReorderMatch && method === "POST") {
    const collectionId = decodeURIComponent(sessionReorderMatch[1]);
    const body = await readJson(request);
    const sessions = historyDatabase().reorderSessions(collectionId, stringArrayValue(body, "ids"))
      .map((session) => presentSession(session, url.origin));
    return json({ ok: true, sessions });
  }
  if (method === "GET" && path === "/api/history") {
    const limit = Number(url.searchParams.get("limit")) || 50;
    const offset = Number(url.searchParams.get("offset")) || 0;
    const query = url.searchParams.get("q") || "";
    const collectionId = url.searchParams.get("collectionId") || "";
    const sessions = historyDatabase().listSessions({ collectionId, limit, offset, query }).map((session) => {
      return presentSession(session, url.origin);
    });
    return json({ ok: true, sessions });
  }
  if (method === "GET" && path.startsWith("/api/sessions/")) {
    const id = decodeURIComponent(path.slice("/api/sessions/".length));
    const session = presentSession(historyDatabase().getSession(id), url.origin);
    return session ? json({ ok: true, session }) : json({ error: "not found" }, 404);
  }
  if (method === "GET" && path.startsWith("/api/history/")) {
    const id = decodeURIComponent(path.slice("/api/history/".length));
    const session = presentSession(historyDatabase().getSession(id), url.origin);
    return session ? json({ ok: true, session }) : json({ error: "not found" }, 404);
  }
  if (method === "DELETE" && path.startsWith("/api/history/")) {
    return deleteHistory(decodeURIComponent(path.slice("/api/history/".length)));
  }
  return json({ error: "not found" }, 404);
}

export async function handlePublicRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname.startsWith("/shots/")) {
    const rawId = basename(decodeURIComponent(url.pathname));
    const stem = rawId.replace(/\.png$/, "");
    const root = rootPath();
    const candidates = [
      join(shotsDir(root), `${stem}.png`),
      join(shotsDir(root), rawId),
      join(root, `${stem}.png`),
      join(root, rawId),
    ];
    const path = candidates.find(existsSync);
    if (!path) return json({ error: "shot not found" }, 404);
    return new Response(await readFile(path), {
      headers: headers({ "Cache-Control": "no-store", "Content-Type": "image/png" }),
    });
  }
  if (request.method === "GET" && url.pathname.startsWith("/v/")) {
    const rawId = decodeURIComponent(url.pathname.slice("/v/".length));
    if (!rawId.endsWith(".md")) return json({ error: "not found" }, 404);
    const id = rawId.slice(0, -3);
    const session = presentSession(historyDatabase().getSession(id), url.origin);
    if (!session) return text("Session not found", 404);
    return text(formatSessionMarkdown(session, `${url.origin}/v/${id}`), 200, {
      "Cache-Control": "public, max-age=60",
      "Content-Type": "text/markdown; charset=utf-8",
    });
  }
  if (request.method === "GET" && url.pathname.startsWith("/p/")) {
    const rawId = decodeURIComponent(url.pathname.slice("/p/".length));
    if (!rawId.endsWith(".md")) return json({ error: "not found" }, 404);
    const project = publicProject(rawId.slice(0, -3), url.origin);
    return project
      ? text(formatProjectMarkdown(project, url.origin), 200, {
        "Cache-Control": "public, max-age=60",
        "Content-Type": "text/markdown; charset=utf-8",
      })
      : text("Project not found", 404);
  }
  if (request.method === "GET" && url.pathname.startsWith("/c/")) {
    const rawId = decodeURIComponent(url.pathname.slice("/c/".length));
    if (!rawId.endsWith(".md")) return json({ error: "not found" }, 404);
    const collection = publicCollection(rawId.slice(0, -3), url.origin);
    return collection
      ? text(formatCollectionMarkdown(collection, url.origin), 200, {
        "Cache-Control": "public, max-age=60",
        "Content-Type": "text/markdown; charset=utf-8",
      })
      : text("Collection not found", 404);
  }
  if (request.method === "GET" && (url.pathname === "/install.sh" || url.pathname === "/install.ps1")) {
    return installerResponse(url.pathname) || json({ error: "not found" }, 404);
  }
  return json({ error: "not found" }, 404);
}

export function resetLocalApiForTests() {
  activeDatabase?.close();
  activeDatabase = null;
  activeRoot = "";
  resetLocalCapabilityForTests();
}

export function authorizeAppRequest(_request?: Request) {
  return true;
}
