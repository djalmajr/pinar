import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { applySessionPatch, getPinColor, humanActionsForStatus, normalizePin, parsePinCommentBody, pinIdsFromPins, PinReviewError, type Collection, type CollectionPlacement, type PageInfo, type Pin, type PinComment, type PinLocation, type PinReview, type PinReviewHumanAction, type PinReviewStatus, type PrivacyReport, type Project, type ProjectTree, type Reproduction, type Session } from "@pinar/shared";
import { mergeCategories, sanitizeUrl, type RedactedCategory } from "@pinar/shared/privacy";
import { readDeliveryPreferences } from "@pinar/cli/preferences";
import { canonicalShotPath, removeSessionShotFile, sessionShotIdentity } from "./local-session-files";
import { formatBatchMarkdown, formatCollectionMarkdown, formatProjectMarkdown, formatSessionMarkdown } from "./markdown";
import { handleMcpProtocolRequest, McpToolError, type McpProtocolHandlers, type McpToolDefinition } from "./mcp-protocol";

const MCP_MAX_LIST_SIZE = 50;
const MCP_MAX_ORDER_SIZE = 1000;
const MCP_MAX_SESSION_TEXT_LENGTH = 2000;
const MCP_MAX_PIN_ARG_LENGTH = 256;
const PIN_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const LEGACY_PIN_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}:p\d{1,6}$/;

interface LocalMcpStoreSession extends Session {
  shotId?: string;
  shotPath?: string | null;
}

interface LocalMcpBatch {
  finishedAt: string | null;
  id: string;
  label: string;
  sessionCount: number;
  startedAt: string;
}

interface LocalMcpStore {
  addPin(captureId: string, pin: Pin): Pin;
  addPinComment(captureId: string, pinId: string, body: unknown, agentName?: string | null): PinComment;
  applyPinReview(
    captureId: string,
    pinId: string,
    action: PinReviewHumanAction,
    actor: { actorId: string; actorType: "human"; origin: "human" },
  ): { changed: boolean; review: PinReview };
  createBatch(label: string): LocalMcpBatch;
  createCollection(projectId: string, name: string, parentId?: string | null): Collection | null;
  createProject(name: string): Project;
  deleteBatch(id: string): boolean;
  deleteCollection(id: string): boolean;
  deletePin(captureId: string, pinId: string): boolean;
  deletePinComment(captureId: string, pinId: string, commentId: string): PinComment;
  deleteProject(id: string): boolean;
  deleteSession(id: string): boolean;
  finishBatch(id: string, finishedAt: string): LocalMcpBatch | null;
  getProjectTree(): ProjectTree;
  getSession(id: string): LocalMcpStoreSession | null;
  listBatches(): LocalMcpBatch[];
  listCollections(projectId: string): Collection[];
  listPinComments(captureId: string): PinComment[];
  listPinReviews(captureId: string): PinReview[];
  listProjects(): Project[];
  listSessions(options: {
    batchId?: string;
    collectionId?: string;
    limit: number;
    offset: number;
    query: string;
  }): LocalMcpStoreSession[];
  moveSession(id: string, collectionId: string): LocalMcpStoreSession | null;
  renameBatch(id: string, label: string): LocalMcpBatch | null;
  reorderCollections(projectId: string, items: CollectionPlacement[]): Collection[] | null;
  reorderProjects(ids: string[]): Project[];
  reorderSessions(collectionId: string, ids: string[]): LocalMcpStoreSession[];
  saveSession(input: {
    batchId?: string | null;
    collectionId?: string;
    createdAt?: string;
    id?: string;
    page?: PageInfo;
    pins?: Pin[];
    privacy?: PrivacyReport;
    reproduction?: Reproduction;
    shotId?: string | null;
    shotPath?: string | null;
    includeScreenshot?: boolean;
    warnings?: string[];
  }): LocalMcpStoreSession;
  updateCollection(id: string, name: string): Collection | null;
  updatePinComment(captureId: string, pinId: string, commentId: string, body: unknown): PinComment;
  updatePinNote(captureId: string, pinId: string, comment: unknown): Pin;
  updateProject(id: string, name: string): Project | null;
  updateSession(id: string, patch: {
    description?: string;
    privacy?: PrivacyReport;
    reproduction?: Reproduction | null;
    title?: string;
    url?: string;
  }): LocalMcpStoreSession | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mcpTool(name: string, description: string, properties: Record<string, unknown>, required: string[] = []): McpToolDefinition {
  return { description, inputSchema: { properties, required, type: "object" }, name };
}

// The local runtime is loopback-only: no key and no login. The six original
// tools cover sessions and the pin conversation; the added tools give agents
// the same local project, collection, batch, and pin review management the
// viewer routes expose, with human-only review semantics, plus the viewer's
// delete and batch-finish operations: containers move their captures to the
// default Inbox and stay protected, batches detach without destroying
// sessions, and sessions clean up their comments, reviews, and screenshot.
export const LOCAL_MCP_INSTRUCTIONS =
  "Pinar Local tools run on the machine's loopback interface without login or API key. "
  + "Agent authorship via agentName is informational and is not authenticated.";
export const LOCAL_MCP_TOOLS: McpToolDefinition[] = [
  mcpTool("pinar.list_sessions", "List local sessions with optional bounded filtering.", {
    batchId: { type: "string" },
    collectionId: { type: "string" },
    limit: { maximum: MCP_MAX_LIST_SIZE, minimum: 1, type: "integer" },
    offset: { maximum: 10_000, minimum: 0, type: "integer" },
    query: { maxLength: 256, type: "string" },
  }),
  mcpTool("pinar.get_session_markdown", "Read local Markdown for a stored session.", { sessionId: { type: "string" } }, ["sessionId"]),
  mcpTool("pinar.list_pin_comments", "List the conversation comments on a pin, with ids, authorship, and bodies.", {
    pinId: { type: "string" },
    sessionId: { type: "string" },
  }, ["sessionId", "pinId"]),
  mcpTool("pinar.add_pin_comment", "Add a comment to a pin conversation. agentName is optional informational authorship for agents.", {
    agentName: { maxLength: 64, type: "string" },
    body: { type: "string" },
    pinId: { type: "string" },
    sessionId: { type: "string" },
  }, ["sessionId", "pinId", "body"]),
  mcpTool("pinar.edit_pin_comment", "Edit a stored comment on a pin. Id, authorship, and createdAt are preserved.", {
    body: { type: "string" },
    commentId: { type: "string" },
    pinId: { type: "string" },
    sessionId: { type: "string" },
  }, ["sessionId", "pinId", "commentId", "body"]),
  mcpTool("pinar.edit_pin_note", "Edit the original note on a pin, preserving the session and pin ids.", {
    comment: { type: "string" },
    pinId: { type: "string" },
    sessionId: { type: "string" },
  }, ["sessionId", "pinId", "comment"]),
  mcpTool("pinar.list_pins", "List the pins of a local session as bounded notes: id, number, comment, locator, location and review status. No screenshots or measured geometry.", {
    limit: { maximum: MCP_MAX_LIST_SIZE, minimum: 1, type: "integer" },
    offset: { maximum: 10_000, minimum: 0, type: "integer" },
    sessionId: { type: "string" },
  }, ["sessionId"]),
  mcpTool("pinar.get_pin", "Read one pin of a local session as a bounded note; legacy captureId:pN pin ids are accepted.", {
    pinId: { type: "string" },
    sessionId: { type: "string" },
  }, ["sessionId", "pinId"]),
  mcpTool("pinar.create_pin", "Create a note pin on a local session: server-generated UUID id and next number, optional locator, explicitly unresolved location, zero stored bytes.", {
    comment: { type: "string" },
    locator: {
      properties: {
        cssSelector: { type: "string" },
        domPath: { type: "string" },
        innerText: { type: "string" },
      },
      type: "object",
    },
    sessionId: { type: "string" },
  }, ["sessionId", "comment"]),
  mcpTool("pinar.delete_pin", "Delete a pin and its current reviews, events and comments; remaining pins keep their numbers and the execution audit is preserved.", {
    pinId: { type: "string" },
    sessionId: { type: "string" },
  }, ["sessionId", "pinId"]),
  mcpTool("pinar.list_projects", "List local projects as metadata only, without screenshots or session payloads.", {
    limit: { maximum: MCP_MAX_LIST_SIZE, minimum: 1, type: "integer" },
    offset: { maximum: 10_000, minimum: 0, type: "integer" },
  }),
  mcpTool("pinar.get_project_markdown", "Read local Markdown for a stored project with its collections and sessions.", { projectId: { type: "string" } }, ["projectId"]),
  mcpTool("pinar.list_collections", "List the collections of one local project as metadata only.", {
    limit: { maximum: MCP_MAX_LIST_SIZE, minimum: 1, type: "integer" },
    offset: { maximum: 10_000, minimum: 0, type: "integer" },
    projectId: { type: "string" },
  }, ["projectId"]),
  mcpTool("pinar.get_collection_markdown", "Read local Markdown for a stored collection with its sessions.", { collectionId: { type: "string" } }, ["collectionId"]),
  mcpTool("pinar.list_batches", "List local capture batches as metadata only.", {
    limit: { maximum: MCP_MAX_LIST_SIZE, minimum: 1, type: "integer" },
    offset: { maximum: 10_000, minimum: 0, type: "integer" },
  }),
  mcpTool("pinar.get_batch_markdown", "Read the local agent handoff Markdown for a stored batch.", { batchId: { type: "string" } }, ["batchId"]),
  mcpTool("pinar.create_project", "Create a local project.", {
    name: { maxLength: 256, type: "string" },
  }, ["name"]),
  mcpTool("pinar.rename_project", "Rename a local project.", {
    name: { maxLength: 256, type: "string" },
    projectId: { type: "string" },
  }, ["projectId", "name"]),
  mcpTool("pinar.reorder_projects", "Reorder local projects. ids must list every project exactly once, in the new order, because omitted projects would keep their old positions.", {
    ids: { items: { maxLength: 256, type: "string" }, maxItems: MCP_MAX_ORDER_SIZE, minItems: 1, type: "array" },
  }, ["ids"]),
  mcpTool("pinar.create_collection", "Create a local collection in a project. parentId null or omitted places it at the project root.", {
    name: { maxLength: 256, type: "string" },
    parentId: { anyOf: [{ maxLength: 256, type: "string" }, { type: "null" }] },
    projectId: { type: "string" },
  }, ["projectId", "name"]),
  mcpTool("pinar.rename_collection", "Rename a local collection.", {
    collectionId: { type: "string" },
    name: { maxLength: 256, type: "string" },
  }, ["collectionId", "name"]),
  mcpTool("pinar.reorder_collections", "Reorder the complete collection hierarchy of one project. items must cover every collection of the project exactly once; parentId null places a collection at the project root.", {
    items: {
      items: {
        properties: {
          id: { maxLength: 256, type: "string" },
          parentId: { anyOf: [{ maxLength: 256, type: "string" }, { type: "null" }] },
        },
        required: ["id"],
        type: "object",
      },
      maxItems: MCP_MAX_ORDER_SIZE,
      minItems: 1,
      type: "array",
    },
    projectId: { type: "string" },
  }, ["projectId", "items"]),
  mcpTool("pinar.move_session", "Move a stored session to another collection.", {
    collectionId: { type: "string" },
    sessionId: { type: "string" },
  }, ["sessionId", "collectionId"]),
  mcpTool("pinar.reorder_sessions", "Reorder the sessions of one collection. ids must list every session of the collection exactly once, in the new order, because omitted sessions would keep their old positions.", {
    collectionId: { type: "string" },
    ids: { items: { maxLength: 256, type: "string" }, maxItems: MCP_MAX_ORDER_SIZE, minItems: 1, type: "array" },
  }, ["collectionId", "ids"]),
  mcpTool("pinar.conclude_pin", "Conclude a pin review as accepted. Repeated actions follow the store transition contract.", {
    pinId: { type: "string" },
    sessionId: { type: "string" },
  }, ["sessionId", "pinId"]),
  mcpTool("pinar.reopen_pin", "Reopen an accepted pin review. Repeated actions follow the store transition contract.", {
    pinId: { type: "string" },
    sessionId: { type: "string" },
  }, ["sessionId", "pinId"]),
  mcpTool("pinar.delete_project", "Delete a local project. Its captures are moved to the default Inbox and its collections are removed; the protected Personal project cannot be deleted.", {
    projectId: { type: "string" },
  }, ["projectId"]),
  mcpTool("pinar.delete_collection", "Delete a local collection. Its captures are moved to the default Inbox and its children are promoted to the deleted collection's parent; the protected Inbox cannot be deleted.", {
    collectionId: { type: "string" },
  }, ["collectionId"]),
  mcpTool("pinar.delete_batch", "Delete a local capture batch. Sessions keep their captures; only the batch tag is detached.", {
    batchId: { type: "string" },
  }, ["batchId"]),
  mcpTool("pinar.finish_batch", "Mark a local capture batch as finished, stamping its finishedAt timestamp.", {
    batchId: { type: "string" },
  }, ["batchId"]),
  mcpTool("pinar.delete_session", "Delete a local session, cleaning up its stored comments, reviews, and screenshot.", {
    sessionId: { type: "string" },
  }, ["sessionId"]),
  mcpTool("pinar.delete_pin_comment", "Delete one stored comment from a pin conversation. Only the target comment is removed; the pin and the other comments stay.", {
    commentId: { type: "string" },
    pinId: { type: "string" },
    sessionId: { type: "string" },
  }, ["sessionId", "pinId", "commentId"]),
  mcpTool("pinar.create_batch", "Create a local capture batch. The id and startedAt timestamp are generated by the server; label is required.", {
    label: { maxLength: 256, type: "string" },
  }, ["label"]),
  mcpTool("pinar.rename_batch", "Rename a local capture batch. The batch id, startedAt, finishedAt, and session membership are preserved.", {
    batchId: { type: "string" },
    label: { maxLength: 256, type: "string" },
  }, ["batchId", "label"]),
  mcpTool("pinar.create_session", "Create a local session from metadata only (no screenshot, no pins, zero image bytes). The id and createdAt are generated by the server; title and url are required and description is optional. An explicit collectionId or batchId must already exist; omitted destinations use the protected default.", {
    batchId: { type: "string" },
    collectionId: { type: "string" },
    page: {
      properties: {
        description: { maxLength: MCP_MAX_SESSION_TEXT_LENGTH, type: "string" },
        title: { maxLength: MCP_MAX_SESSION_TEXT_LENGTH, type: "string" },
        url: { type: "string" },
      },
      required: ["title", "url"],
      type: "object",
    },
  }, ["page"]),
  mcpTool("pinar.update_session", "Update a stored session's page title, url or description and/or its reproduction. Id, createdAt, position, collection, batch, screenshot identity, and every existing pin are preserved; an explicit empty description clears it.", {
    page: {
      properties: {
        description: { maxLength: MCP_MAX_SESSION_TEXT_LENGTH, type: "string" },
        title: { maxLength: MCP_MAX_SESSION_TEXT_LENGTH, type: "string" },
        url: { type: "string" },
      },
      type: "object",
    },
    reproduction: { type: ["object", "null"] },
    sessionId: { type: "string" },
  }, ["sessionId"]),
];

function textArg(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== "string") throw new McpToolError(`${name} is required`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 256 || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new McpToolError(`${name} is invalid`);
  }
  return trimmed;
}

function optionalTextArg(args: Record<string, unknown>, name: string): string | null {
  const value = args[name];
  if (value === undefined || value === null) return null;
  return textArg(args, name);
}

function limitArg(args: Record<string, unknown>): number {
  const value = args.limit;
  if (value === undefined) return MCP_MAX_LIST_SIZE;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MCP_MAX_LIST_SIZE) {
    throw new McpToolError(`limit must be an integer between 1 and ${MCP_MAX_LIST_SIZE}`);
  }
  return value;
}

function offsetArg(args: Record<string, unknown>): number {
  const value = args.offset;
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new McpToolError("offset must be an integer between 0 and 10000");
  }
  return value;
}

function idArrayArg(args: Record<string, unknown>, name: string): string[] {
  const value = args[name];
  if (!Array.isArray(value) || value.length === 0 || value.length > MCP_MAX_ORDER_SIZE) {
    throw new McpToolError("Invalid payload");
  }
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") throw new McpToolError("Invalid payload");
    const id = entry.trim();
    if (!id || id.length > 256 || /[\u0000-\u001f\u007f]/.test(id)) throw new McpToolError("Invalid payload");
    ids.push(id);
  }
  if (new Set(ids).size !== ids.length) throw new McpToolError("Invalid ordering");
  return ids;
}

function collectionItemsArg(args: Record<string, unknown>): CollectionPlacement[] {
  const value = args.items;
  if (!Array.isArray(value) || value.length === 0 || value.length > MCP_MAX_ORDER_SIZE) {
    throw new McpToolError("Invalid payload");
  }
  const items: CollectionPlacement[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) throw new McpToolError("Invalid payload");
    const record = entry as Record<string, unknown>;
    if (typeof record.id !== "string") throw new McpToolError("Invalid payload");
    const id = record.id.trim();
    if (!id || id.length > 256 || /[\u0000-\u001f\u007f]/.test(id)) throw new McpToolError("Invalid payload");
    const parentId = record.parentId;
    let parent: string | null = null;
    if (parentId !== undefined && parentId !== null) {
      if (typeof parentId !== "string") throw new McpToolError("Invalid payload");
      parent = parentId.trim();
      if (!parent || parent.length > 256 || /[\u0000-\u001f\u007f]/.test(parent)) throw new McpToolError("Invalid payload");
    }
    items.push({ id, parentId: parent });
  }
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new McpToolError("Invalid ordering");
  return items;
}

function sessionSummary(session: LocalMcpStoreSession) {
  return {
    batchId: session.batchId ?? null,
    collectionId: session.collectionId,
    createdAt: session.createdAt,
    id: session.id,
    pinCount: session.pinCount,
    title: session.page.title,
    url: session.page.url,
  };
}
// Same human-only view the local viewer routes expose: stored agent rows stay
// untouched, presentation follows the last human event.
function visibleReviews(store: LocalMcpStore, captureId: string): PinReview[] {
  const visible: PinReview[] = [];
  for (const review of store.listPinReviews(captureId)) {
    const humanEvents = review.timeline.filter((event) => event.origin === "human");
    const last = humanEvents[humanEvents.length - 1];
    if (!last) continue;
    let fromStatus: PinReviewStatus = "open";
    const timeline = humanEvents.map((event) => {
      const next = { ...event, fromStatus };
      fromStatus = event.toStatus;
      return next;
    });
    visible.push({
      ...review,
      actions: humanActionsForStatus(last.toStatus),
      status: last.toStatus,
      timeline,
      updatedAt: last.createdAt,
    });
  }
  return visible;
}

// The shot identity fallback (shotId || session id) is an identifier, never
// PNG evidence: a shot URL is only presented when the canonical shot file
// actually exists, so a metadata-only session never fakes a screenshot while
// a real captured PNG keeps working.
function localShotUrl(session: LocalMcpStoreSession, origin: string): string | null {
  const identity = sessionShotIdentity(session);
  const canonical = canonicalShotPath(identity);
  return canonical && existsSync(canonical) ? `${origin}/shots/${identity}.png` : null;
}

function presentLocalSession(session: LocalMcpStoreSession, origin: string): Session {
  return {
    ...session,
    isPermanent: true,
    plan: "free",
    schemaVersion: session.schemaVersion ?? 1,
    shotUrl: localShotUrl(session, origin),
    viewerUrl: `${origin}/v/${session.id}.md`,
  };
}

// The tree stores raw sessions; present them once so every Markdown tool
// agrees on the local shot and viewer URLs.
function presentedTree(tree: ProjectTree, origin: string): ProjectTree {
  return {
    projects: tree.projects.map((project) => ({
      ...project,
      collections: project.collections.map((collection) => ({
        ...collection,
        sessions: collection.sessions.map((session) => presentLocalSession(session, origin)),
      })),
    })),
  };
}

function findCollection(store: LocalMcpStore, collectionId: string): Collection | null {
  for (const project of store.listProjects()) {
    const collection = store.listCollections(project.id).find((item) => item.id === collectionId);
    if (collection) return collection;
  }
  return null;
}

function findProject(store: LocalMcpStore, projectId: string): Project | null {
  return store.listProjects().find((item) => item.id === projectId) || null;
}

function storeError(error: unknown): McpToolError {
  if (error instanceof PinReviewError) {
    if (error.code === "pin_not_found") return new McpToolError("Resource not found");
    if (error.code === "invalid_transition") return new McpToolError("Invalid review transition");
    return new McpToolError("Invalid payload");
  }
  return new McpToolError("Local storage failed");
}

function requirePin(store: LocalMcpStore, args: Record<string, unknown>): { pinId: string; sessionId: string } {
  const sessionId = textArg(args, "sessionId");
  const pinId = textArg(args, "pinId");
  const session = store.getSession(sessionId);
  if (!session) throw new McpToolError("Session not found");
  if (!pinIdsFromPins(session.pins).has(pinId)) throw new McpToolError("Pin not found");
  return { pinId, sessionId };
}

// Pin ids are server-generated UUIDs or the legacy captureId:pN form. The
// syntactic check rejects anything else; actual membership is verified
// separately against the stored session pins.
function pinResourceIdArg(args: Record<string, unknown>, name: string): string {
  const value = textArg(args, name);
  if (PIN_ID_PATTERN.test(value) || LEGACY_PIN_ID_PATTERN.test(value)) return value;
  throw new McpToolError(`${name} is invalid`);
}

// Bounded pin projection for MCP reads: identity, note, locator, location and
// review status. Snapshot, data URLs and measured geometry never leave.
function pinView(pin: Pin, reviewStatus: PinReviewStatus) {
  return {
    comment: pin.comment || "",
    id: pin.pinId || pin.id || "",
    location: pin.location || null,
    locator: {
      cssSelector: pin.selector || null,
      domPath: pin.domPath || null,
      innerText: pin.innerText || null,
    },
    number: pin.number,
    reviewStatus,
  };
}

function pinLocatorArg(args: Record<string, unknown>): { cssSelector: string | null; domPath: string | null; innerText: string | null } {
  const locator: { cssSelector: string | null; domPath: string | null; innerText: string | null } = { cssSelector: null, domPath: null, innerText: null };
  if (args.locator === undefined) return locator;
  if (!isRecord(args.locator)) throw new McpToolError("locator is invalid");
  const raw = args.locator;
  if (Object.keys(raw).some((key) => key !== "cssSelector" && key !== "domPath" && key !== "innerText")) {
    throw new McpToolError("locator is invalid");
  }
  for (const key of ["cssSelector", "domPath", "innerText"] as const) {
    const value = raw[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") throw new McpToolError("locator is invalid");
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > MCP_MAX_PIN_ARG_LENGTH || /[\u0000-\u001f\u007f]/.test(trimmed)) {
      throw new McpToolError("locator is invalid");
    }
    locator[key] = trimmed;
  }
  return locator;
}

// Agent-created pins are notes without captured geometry: an explicit
// unresolved/none location and zero stored bytes, so no consumer paints a
// marker at a fabricated point. The next number follows the stored pins;
// existing numbers and ids are never renumbered.
function createLocalMcpPin(store: LocalMcpStore, sessionId: string, comment: unknown, locator: { cssSelector: string | null; domPath: string | null; innerText: string | null }): Pin {
  const session = store.getSession(sessionId);
  if (!session) throw new McpToolError("Session not found");
  let body: string;
  try {
    body = parsePinCommentBody(comment);
  } catch {
    throw new McpToolError("comment is invalid");
  }
  const number = Math.max(0, ...session.pins.map((pin) => (Number.isFinite(pin.number) ? pin.number : 0))) + 1;
  const color = getPinColor(number);
  const colorCollides = session.pins.some((pin) => pin.color && pin.color === color);
  const location: PinLocation = { confidence: "unresolved", evidence: [], score: 0, strategy: "none" };
  const pin = normalizePin({
    comment: body,
    id: randomUUID(),
    kind: "element",
    location,
    locator: {
      ...(locator.cssSelector ? { cssSelector: locator.cssSelector } : {}),
      ...(locator.domPath ? { domPath: locator.domPath } : {}),
      ...(locator.innerText ? { innerText: locator.innerText } : {}),
    },
    number,
    ...(colorCollides ? {} : { color }),
  }, session.id, session.pins.length);
  try {
    return store.addPin(sessionId, pin);
  } catch (error) {
    throw storeError(error);
  }
}

function sessionTextArg(args: Record<string, unknown>, name: string, maxLength = MCP_MAX_SESSION_TEXT_LENGTH): string {
  const value = args[name];
  if (typeof value !== "string") throw new McpToolError(`${name} is required`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new McpToolError(`${name} is invalid`);
  }
  return trimmed;
}

function optionalSessionTextArg(args: Record<string, unknown>, name: string, maxLength = MCP_MAX_SESSION_TEXT_LENGTH): string | null {
  const value = args[name];
  if (value === undefined || value === null || value === "") return null;
  return sessionTextArg(args, name, maxLength);
}

// A page URL must be a valid http(s) URL without embedded credentials. The
// shared sanitizer scrubs sensitive query/hash values; only the sanitized URL
// and its redacted categories are stored, never the secret values.
function sessionUrlArg(value: unknown, name: string): { redacted: RedactedCategory[]; url: string } {
  if (typeof value !== "string") throw new McpToolError(`${name} is required`);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new McpToolError(`${name} is invalid`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new McpToolError(`${name} is invalid`);
  if (parsed.username || parsed.password) throw new McpToolError(`${name} is invalid`);
  const sanitized = sanitizeUrl(parsed.toString());
  return { redacted: sanitized.redacted, url: sanitized.url };
}

// Agent-created sessions are metadata only: a server-generated id and
// createdAt, no pins, no screenshot file and zero image bytes. An explicit
// collection or batch must already exist before any write: unknown
// destinations reject instead of silently falling back to the protected
// default, which is only used when the caller omits them.
function createLocalMcpSession(
  store: LocalMcpStore,
  page: { collectionId: string; description: string | null; redacted: RedactedCategory[]; title: string; url: string },
  batchId: string | null,
): LocalMcpStoreSession {
  if (page.collectionId && !findCollection(store, page.collectionId)) throw new McpToolError("Collection not found");
  if (batchId && !store.listBatches().some((item) => item.id === batchId)) throw new McpToolError("Batch not found");
  return store.saveSession({
    batchId,
    collectionId: page.collectionId || undefined,
    includeScreenshot: false,
    page: page.description ? { description: page.description, title: page.title, url: page.url } : { title: page.title, url: page.url },
    pins: [],
    privacy: { redacted: mergeCategories([...page.redacted, "unevaluated"]), unevaluated: true },
    shotId: null,
    shotPath: null,
  });
}

// A metadata update patches only the allowed fields. The shared validator
// rejects an invalid reproduction (an explicit null clears it), a URL change
// scrubs the new URL and merges its categories into the stored privacy report
// instead of discarding the screenshot/pin redactions, and the store update
// never restamps createdAt, resets position, or detaches the batch.
function updateLocalMcpSession(
  store: LocalMcpStore,
  id: string,
  changes: { description: string | null; redacted: RedactedCategory[] | null; reproduction: unknown; title: string | null; url: string | null },
): LocalMcpStoreSession | null {
  const existing = store.getSession(id);
  if (!existing) throw new McpToolError("Session not found");
  let reproduction: Reproduction | null | undefined;
  if (changes.reproduction !== undefined) {
    const patched = applySessionPatch(existing, { reproduction: changes.reproduction });
    if (!patched) throw new McpToolError("reproduction is invalid");
    reproduction = changes.reproduction === null ? null : patched.reproduction ?? null;
  }
  let privacy: PrivacyReport | undefined;
  if (changes.url !== null) {
    // The new URL's categories join the report already stored for the
    // screenshot/pins (which did not change); the new URL itself is only
    // sanitized, never inspected, so unevaluated stays true.
    privacy = {
      redacted: mergeCategories([...(existing.privacy?.redacted || []), ...(changes.redacted || []), "unevaluated"]),
      unevaluated: true,
    };
  }
  return store.updateSession(id, {
    description: changes.description === null ? undefined : changes.description,
    privacy,
    reproduction,
    title: changes.title === null ? undefined : changes.title,
    url: changes.url === null ? undefined : changes.url,
  });
}

export function localMcpHandlers(store: LocalMcpStore, origin: string): McpProtocolHandlers {
  return {
    async callTool(name, args) {
      switch (name) {
        case "pinar.list_sessions": {
          const batchId = optionalTextArg(args, "batchId") || "";
          const collectionId = optionalTextArg(args, "collectionId") || "";
          const query = optionalTextArg(args, "query") || "";
          const limit = limitArg(args);
          const offset = offsetArg(args);
          const sessions = store.listSessions({ batchId, collectionId, limit, offset, query });
          return { limit, offset, sessions: sessions.map(sessionSummary) };
        }
        case "pinar.get_session_markdown": {
          const sessionId = textArg(args, "sessionId");
          const session = store.getSession(sessionId);
          if (!session) throw new McpToolError("Session not found");
          return formatSessionMarkdown(
            presentLocalSession(session, origin),
            `${origin}/v/${session.id}`,
            [],
            visibleReviews(store, session.id),
            readDeliveryPreferences(),
          );
        }
        case "pinar.list_pin_comments": {
          const { pinId, sessionId } = requirePin(store, args);
          const comments = store.listPinComments(sessionId).filter((comment) => comment.pinId === pinId);
          return { comments, ok: true };
        }
        case "pinar.add_pin_comment": {
          const { pinId, sessionId } = requirePin(store, args);
          if (typeof args.body !== "string") throw new McpToolError("body is required");
          const agentName = optionalTextArg(args, "agentName");
          try {
            const comment = store.addPinComment(sessionId, pinId, args.body, agentName);
            return { comment, ok: true };
          } catch (error) {
            throw storeError(error);
          }
        }
        case "pinar.edit_pin_comment": {
          const { pinId, sessionId } = requirePin(store, args);
          const commentId = textArg(args, "commentId");
          if (typeof args.body !== "string") throw new McpToolError("body is required");
          try {
            const comment = store.updatePinComment(sessionId, pinId, commentId, args.body);
            return { comment, ok: true };
          } catch (error) {
            throw storeError(error);
          }
        }
        case "pinar.edit_pin_note": {
          const { pinId, sessionId } = requirePin(store, args);
          if (typeof args.comment !== "string") throw new McpToolError("comment is required");
          try {
            const pin = store.updatePinNote(sessionId, pinId, args.comment);
            return { ok: true, pin };
          } catch (error) {
            throw storeError(error);
          }
        }
        case "pinar.list_pins": {
          const sessionId = textArg(args, "sessionId");
          if (Object.keys(args).some((key) => key !== "sessionId" && key !== "limit" && key !== "offset")) {
            throw new McpToolError("Unexpected argument");
          }
          const session = store.getSession(sessionId);
          if (!session) throw new McpToolError("Session not found");
          const limit = limitArg(args);
          const offset = offsetArg(args);
          const statusByPinId = new Map(store.listPinReviews(sessionId).map((review) => [review.pinId, review.status] as const));
          const pins = session.pins.slice(offset, offset + limit).map((pin) => {
            const pinId = pin.pinId || pin.id || "";
            return pinView(pin, statusByPinId.get(pinId) || "open");
          });
          return { limit, offset, pins };
        }
        case "pinar.get_pin": {
          const sessionId = textArg(args, "sessionId");
          const pinId = pinResourceIdArg(args, "pinId");
          if (Object.keys(args).some((key) => key !== "sessionId" && key !== "pinId")) {
            throw new McpToolError("Unexpected argument");
          }
          const session = store.getSession(sessionId);
          const pin = session?.pins.find((item) => (item.pinId || item.id) === pinId);
          if (!session || !pin) throw new McpToolError("Pin not found");
          const review = store.listPinReviews(sessionId).find((item) => item.pinId === pinId);
          return { ok: true, pin: pinView(pin, review?.status || "open") };
        }
        case "pinar.create_pin": {
          const sessionId = textArg(args, "sessionId");
          if (Object.keys(args).some((key) => key !== "sessionId" && key !== "comment" && key !== "locator")) {
            throw new McpToolError("Unexpected argument");
          }
          const pin = createLocalMcpPin(store, sessionId, args.comment, pinLocatorArg(args));
          return { ok: true, pin: pinView(pin, "open"), sessionId };
        }
        case "pinar.delete_pin": {
          const sessionId = textArg(args, "sessionId");
          const pinId = pinResourceIdArg(args, "pinId");
          if (Object.keys(args).some((key) => key !== "sessionId" && key !== "pinId")) {
            throw new McpToolError("Unexpected argument");
          }
          if (!store.getSession(sessionId)) throw new McpToolError("Session not found");
          let deleted = false;
          try {
            deleted = store.deletePin(sessionId, pinId);
          } catch (error) {
            throw storeError(error);
          }
          if (!deleted) throw new McpToolError("Pin not found");
          return { ok: true, pinId, sessionId };
        }
        case "pinar.list_projects": {
          const limit = limitArg(args);
          const offset = offsetArg(args);
          const projects = store.listProjects().slice(offset, offset + limit);
          return { limit, offset, projects };
        }
        case "pinar.get_project_markdown": {
          const projectId = textArg(args, "projectId");
          const tree = presentedTree(store.getProjectTree(), origin);
          const project = tree.projects.find((item) => item.id === projectId);
          if (!project) throw new McpToolError("Project not found");
          return formatProjectMarkdown(project, origin, readDeliveryPreferences());
        }
        case "pinar.list_collections": {
          const projectId = textArg(args, "projectId");
          const limit = limitArg(args);
          const offset = offsetArg(args);
          if (!findProject(store, projectId)) throw new McpToolError("Project not found");
          const collections = store.listCollections(projectId).slice(offset, offset + limit);
          return { collections, limit, offset };
        }
        case "pinar.get_collection_markdown": {
          const collectionId = textArg(args, "collectionId");
          const tree = presentedTree(store.getProjectTree(), origin);
          let collection: (typeof tree.projects)[number]["collections"][number] | null = null;
          for (const project of tree.projects) {
            const match = project.collections.find((item) => item.id === collectionId);
            if (match) {
              collection = match;
              break;
            }
          }
          if (!collection) throw new McpToolError("Collection not found");
          return formatCollectionMarkdown(collection, origin, readDeliveryPreferences());
        }
        case "pinar.list_batches": {
          const limit = limitArg(args);
          const offset = offsetArg(args);
          const batches = store.listBatches().slice(offset, offset + limit);
          return { batches, limit, offset };
        }
        case "pinar.get_batch_markdown": {
          const batchId = textArg(args, "batchId");
          const batch = store.listBatches().find((item) => item.id === batchId);
          if (!batch) throw new McpToolError("Batch not found");
          const tree = presentedTree(store.getProjectTree(), origin);
          const sessions: Session[] = [];
          const statusByPinId: Record<string, PinReviewStatus> = {};
          for (const project of tree.projects) {
            for (const collection of project.collections) {
              for (const session of collection.sessions) {
                if (session.batchId !== batchId) continue;
                sessions.push(session);
                for (const review of visibleReviews(store, session.id)) {
                  statusByPinId[review.pinId] = review.status;
                }
              }
            }
          }
          const preferences = readDeliveryPreferences();
          return formatBatchMarkdown(batch, sessions, statusByPinId, origin, {
            ...preferences,
            includeViewerContent: false,
            language: preferences.language ?? "en",
          });
        }
        case "pinar.create_project": {
          const name = textArg(args, "name");
          const project = store.createProject(name);
          return { ok: true, project };
        }
        case "pinar.rename_project": {
          const projectId = textArg(args, "projectId");
          const name = textArg(args, "name");
          if (!findProject(store, projectId)) throw new McpToolError("Project not found");
          const project = store.updateProject(projectId, name);
          if (!project) throw new McpToolError("Project not found");
          return { ok: true, project };
        }
        case "pinar.reorder_projects": {
          const ids = idArrayArg(args, "ids");
          const projects = store.listProjects();
          const known = new Set(projects.map((item) => item.id));
          if (ids.some((id) => !known.has(id))) throw new McpToolError("Project not found");
          if (ids.length !== projects.length) throw new McpToolError("Invalid ordering");
          return { ok: true, projects: store.reorderProjects(ids) };
        }
        case "pinar.create_collection": {
          const projectId = textArg(args, "projectId");
          const name = textArg(args, "name");
          const parentId = optionalTextArg(args, "parentId");
          if (!findProject(store, projectId)) throw new McpToolError("Project not found");
          if (parentId && !store.listCollections(projectId).some((item) => item.id === parentId)) {
            throw new McpToolError("Parent collection not found");
          }
          const collection = store.createCollection(projectId, name, parentId);
          if (!collection) throw new McpToolError("Project not found");
          return { collection, ok: true };
        }
        case "pinar.rename_collection": {
          const collectionId = textArg(args, "collectionId");
          const name = textArg(args, "name");
          if (!findCollection(store, collectionId)) throw new McpToolError("Collection not found");
          const collection = store.updateCollection(collectionId, name);
          if (!collection) throw new McpToolError("Collection not found");
          return { collection, ok: true };
        }
        case "pinar.reorder_collections": {
          const projectId = textArg(args, "projectId");
          const items = collectionItemsArg(args);
          if (!findProject(store, projectId)) throw new McpToolError("Project not found");
          const collections = store.listCollections(projectId);
          const known = new Set(collections.map((item) => item.id));
          if (items.some((item) => !known.has(item.id))) throw new McpToolError("Collection not found");
          if (items.some((item) => item.parentId !== null && !known.has(item.parentId))) {
            throw new McpToolError("Parent collection not found");
          }
          const reordered = store.reorderCollections(projectId, items);
          if (!reordered) throw new McpToolError("Invalid ordering");
          return { collections: reordered, ok: true };
        }
        case "pinar.move_session": {
          const sessionId = textArg(args, "sessionId");
          const collectionId = textArg(args, "collectionId");
          if (!store.getSession(sessionId)) throw new McpToolError("Session not found");
          if (!findCollection(store, collectionId)) throw new McpToolError("Collection not found");
          const session = store.moveSession(sessionId, collectionId);
          if (!session) throw new McpToolError("Session not found");
          return { ok: true, session: sessionSummary(session) };
        }
        case "pinar.reorder_sessions": {
          const collectionId = textArg(args, "collectionId");
          const ids = idArrayArg(args, "ids");
          if (!findCollection(store, collectionId)) throw new McpToolError("Collection not found");
          const sessions = store.listSessions({ batchId: "", collectionId, limit: Number.MAX_SAFE_INTEGER, offset: 0, query: "" });
          const known = new Set(sessions.map((item) => item.id));
          if (ids.some((id) => !known.has(id) && !store.getSession(id))) throw new McpToolError("Session not found");
          if (ids.length !== sessions.length || ids.some((id) => !known.has(id))) throw new McpToolError("Invalid ordering");
          return { ok: true, sessions: store.reorderSessions(collectionId, ids).map(sessionSummary) };
        }
        case "pinar.conclude_pin":
        case "pinar.reopen_pin": {
          const { pinId, sessionId } = requirePin(store, args);
          try {
            const saved = store.applyPinReview(
              sessionId,
              pinId,
              name === "pinar.conclude_pin" ? "accept" : "reopen",
              { actorId: "local", actorType: "human", origin: "human" },
            );
            return { changed: saved.changed, ok: true, review: saved.review };
          } catch (error) {
            throw storeError(error);
          }
        }
        case "pinar.delete_project": {
          const projectId = textArg(args, "projectId");
          if (!findProject(store, projectId)) throw new McpToolError("Project not found");
          if (!store.deleteProject(projectId)) throw new McpToolError("Project protected");
          return { deleted: true, ok: true };
        }
        case "pinar.delete_collection": {
          const collectionId = textArg(args, "collectionId");
          if (!findCollection(store, collectionId)) throw new McpToolError("Collection not found");
          if (!store.deleteCollection(collectionId)) throw new McpToolError("Collection protected");
          return { deleted: true, ok: true };
        }
        case "pinar.delete_batch": {
          const batchId = textArg(args, "batchId");
          if (!store.listBatches().some((item) => item.id === batchId)) throw new McpToolError("Batch not found");
          if (!store.deleteBatch(batchId)) throw new McpToolError("Batch not found");
          return { deleted: true, ok: true };
        }
        case "pinar.finish_batch": {
          const batchId = textArg(args, "batchId");
          const batch = store.finishBatch(batchId, new Date().toISOString());
          if (!batch) throw new McpToolError("Batch not found");
          return { batch, ok: true };
        }
        case "pinar.create_batch": {
          // A narrow allow-list: the id and timestamps are server-generated,
          // so caller-supplied extras are rejected instead of silently
          // ignored before any write.
          if (Object.keys(args).some((key) => key !== "label")) throw new McpToolError("Unexpected argument");
          const label = textArg(args, "label");
          const batch = store.createBatch(label);
          return { batch, ok: true };
        }
        case "pinar.rename_batch": {
          // Caller-supplied id/timestamp extras are rejected instead of
          // silently ignored before any write.
          if (Object.keys(args).some((key) => key !== "batchId" && key !== "label")) {
            throw new McpToolError("Unexpected argument");
          }
          const batchId = textArg(args, "batchId");
          const label = textArg(args, "label");
          const batch = store.renameBatch(batchId, label);
          if (!batch) throw new McpToolError("Batch not found");
          return { batch, ok: true };
        }
        case "pinar.create_session": {
          if (Object.keys(args).some((key) => key !== "page" && key !== "collectionId" && key !== "batchId")) {
            throw new McpToolError("Unexpected argument");
          }
          if (!isRecord(args.page)) throw new McpToolError("page is required");
          const page = args.page as Record<string, unknown>;
          if (Object.keys(page).some((key) => key !== "title" && key !== "url" && key !== "description")) {
            throw new McpToolError("Unexpected argument");
          }
           const title = sessionTextArg(page, "title");
           const description = optionalSessionTextArg(page, "description");
           const url = sessionUrlArg(page.url, "page.url");
           // Only an omitted destination may fall back to the default Inbox:
           // an explicit empty string is invalid input, not an omission.
           let collectionId = "";
           if (Object.hasOwn(args, "collectionId")) {
             const rawCollectionId = args.collectionId;
             if (typeof rawCollectionId !== "string") throw new McpToolError("collectionId is invalid");
             collectionId = rawCollectionId.trim();
             if (!collectionId) throw new McpToolError("collectionId is invalid");
           }
           let batchId: string | null = null;
           if (Object.hasOwn(args, "batchId")) {
             const rawBatchId = args.batchId;
             if (typeof rawBatchId !== "string") throw new McpToolError("batchId is invalid");
             const trimmedBatchId = rawBatchId.trim();
             if (!trimmedBatchId) throw new McpToolError("batchId is invalid");
             batchId = trimmedBatchId;
           }
          const session = createLocalMcpSession(
            store,
            { collectionId, description, redacted: url.redacted, title, url: url.url },
            batchId,
          );
          return { ok: true, session: sessionSummary(session) };
        }
        case "pinar.update_session": {
          const sessionId = textArg(args, "sessionId");
          if (Object.keys(args).some((key) => key !== "sessionId" && key !== "page" && key !== "reproduction")) {
            throw new McpToolError("Unexpected argument");
          }
          const page = isRecord(args.page) ? args.page : {};
          if (Object.keys(page).some((key) => key !== "title" && key !== "url" && key !== "description")) {
            throw new McpToolError("page is invalid");
          }
           // An explicit "" title is invalid input, not an omission: the
           // key's absence preserves the stored title, but a provided empty
           // title rejects the whole update, so the accompanying valid
           // fields are not written either.
           let title: string | null = null;
           if (Object.hasOwn(page, "title")) {
             title = sessionTextArg(page, "title");
           }
           const url = page.url === undefined ? null : sessionUrlArg(page.url, "page.url");
          // An explicit "" description clears the stored value; the key's
          // absence leaves it unchanged. optionalSessionTextArg collapses ""
          // to null, so the clear must be detected from presence.
          let description: string | null = null;
          let descriptionProvided = false;
          if (Object.hasOwn(page, "description")) {
            const rawDescription = page.description;
            if (typeof rawDescription !== "string") throw new McpToolError("description is invalid");
            const trimmedDescription = rawDescription.trim();
            if (
              trimmedDescription.length > MCP_MAX_SESSION_TEXT_LENGTH
              || /[\u0000-\u001f\u007f]/.test(trimmedDescription)
            ) {
              throw new McpToolError("description is invalid");
            }
            description = trimmedDescription;
            descriptionProvided = true;
          }
          if (!title && !descriptionProvided && !url && !Object.hasOwn(args, "reproduction")) {
            throw new McpToolError("No changes provided");
          }
          const session = updateLocalMcpSession(store, sessionId, {
            description,
            redacted: url ? url.redacted : null,
            reproduction: Object.hasOwn(args, "reproduction") ? args.reproduction : undefined,
            title,
            url: url ? url.url : null,
          });
          if (!session) throw new McpToolError("Session not found");
          return { ok: true, session: sessionSummary(session) };
        }
        case "pinar.delete_session": {
          const sessionId = textArg(args, "sessionId");
          const session = store.getSession(sessionId);
          if (!session) throw new McpToolError("Session not found");
          // Same cleanup order as the local DELETE /api/history route: the shot
          // file first (only when it is the canonical screenshot of this
          // session's own shot identity inside the local shots root), then the
          // session row and its stored conversations. Corrupted shotPaths are
          // skipped, never deleted, and never block the delete.
          await removeSessionShotFile(store, session);
          if (!store.deleteSession(sessionId)) throw new McpToolError("Session not found");
          return { deleted: true, ok: true };
        }
        case "pinar.delete_pin_comment": {
          const { pinId, sessionId } = requirePin(store, args);
          const commentId = textArg(args, "commentId");
          try {
            store.deletePinComment(sessionId, pinId, commentId);
            return { deleted: true, ok: true };
          } catch (error) {
            throw storeError(error);
          }
        }
        default:
          throw new McpToolError("Unknown tool");
      }
    },
    instructions: LOCAL_MCP_INSTRUCTIONS,
    tools: LOCAL_MCP_TOOLS,
  };
}

export async function handleLocalMcpRequest(request: Request, store: LocalMcpStore): Promise<Response> {
  return handleMcpProtocolRequest(request, localMcpHandlers(store, new URL(request.url).origin));
}
