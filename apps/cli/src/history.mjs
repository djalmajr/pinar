import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import {
  DEFAULT_PROJECT_ICON,
  PERSONAL_PROJECT_ICON,
  isProjectIcon,
} from "../../../packages/shared/src/project-icons/index.ts";
import {
  decodeVisualCaptureJson,
  encodeVisualCaptureJson,
  parseVisualCapture,
} from "../../../packages/shared/src/visual-context/index.ts";
import {
  AgentResultError,
  parseAgentExecutionInput,
  pinIdsFromPins,
  presentAgentExecution,
} from "../../../packages/shared/src/agent-results/index.ts";
import {
  PinReviewError,
  countPinReviews,
  defaultPinReviewStatus,
  humanActionsForStatus,
  isPinReviewStatus,
  resolvePinReviewTransition,
} from "../../../packages/shared/src/pin-review/index.ts";
import {
  sanitizeLoopMetric,
} from "../../../packages/shared/src/loop-metrics/index.ts";
import { pinarHome, shotsDir } from "./paths.mjs";

let SqliteDatabase = null;
try {
  const sqlite = await import("node:sqlite");
  SqliteDatabase = sqlite.DatabaseSync;
} catch {
  try {
    const sqlite = await import("bun:sqlite");
    SqliteDatabase = sqlite.Database;
  } catch {
    SqliteDatabase = null;
  }
}

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz-";
const LOCAL_OWNER_ID = "local";

/**
 * @typedef {object} HistoryInput
 * @property {string} [collectionId]
 * @property {string} [createdAt]
 * @property {string} [id]
 * @property {import("@pinar/shared").PageInfo} [page]
 * @property {import("@pinar/shared").Pin[]} [pins]
 * @property {import("@pinar/shared").PrivacyReport} [privacy]
 * @property {string[]} [warnings]
 * @property {string | null} [shotId]
 * @property {string | null} [shotPath]
 * @property {boolean} [includeScreenshot]
 * @property {string | null} [batchId]
 */

function generateNanoId(size = 12) {
  const bytes = new Uint8Array(size);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < size; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  let id = "";
  for (let index = 0; index < size; index += 1) id += ALPHABET[bytes[index] & 63];
  return id;
}

function now() {
  return new Date().toISOString();
}

function formatProject(row) {
  return {
    createdAt: row.created_at,
    id: row.id,
    icon: isProjectIcon(row.icon)
      ? row.icon
      : row.is_protected
        ? PERSONAL_PROJECT_ICON
        : DEFAULT_PROJECT_ICON,
    isProtected: Boolean(row.is_protected),
    name: row.name,
    ownerId: row.owner_id,
    position: row.position,
    updatedAt: row.updated_at,
  };
}

function formatCollection(row) {
  return {
    createdAt: row.created_at,
    id: row.id,
    isProtected: Boolean(row.is_protected),
    name: row.name,
    ownerId: row.owner_id,
    parentId: row.parent_id || null,
    position: row.position,
    projectId: row.project_id,
    updatedAt: row.updated_at,
  };
}

function formatBatch(row, sessionCount = Number(row.session_count) || 0) {
  return {
    finishedAt: row.finished_at || null,
    id: row.id,
    label: row.label,
    sessionCount,
    startedAt: row.started_at,
  };
}

function sortCollectionRows(rows) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const children = new Map();
  const siblingKey = (row) => byId.has(row.parent_id) ? row.parent_id : null;
  for (const row of rows) {
    const key = siblingKey(row);
    const siblings = children.get(key) || [];
    siblings.push(row);
    children.set(key, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort((left, right) => Number(left.position) - Number(right.position)
      || String(left.created_at).localeCompare(String(right.created_at)));
  }
  const result = [];
  const visited = new Set();
  function visit(parentId) {
    for (const row of children.get(parentId) || []) {
      if (visited.has(row.id)) continue;
      visited.add(row.id);
      result.push(row);
      visit(row.id);
    }
  }
  visit(null);
  for (const row of rows) {
    if (!visited.has(row.id)) result.push(row);
  }
  return result;
}

function planCollectionPlacements(rows, requested) {
  if (!Array.isArray(requested) || requested.length !== rows.length) return null;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const seen = new Set();
  const parentById = new Map();
  for (const item of requested) {
    const id = typeof item === "string" ? item : item?.id;
    const row = byId.get(id);
    if (!row || seen.has(id)) return null;
    seen.add(id);
    const parentId = typeof item === "string" ? row.parent_id || null : item.parentId || null;
    if (row.is_protected && parentId) return null;
    if (parentId === id || (parentId && !byId.has(parentId))) return null;
    parentById.set(id, parentId);
  }
  for (const id of parentById.keys()) {
    const ancestors = new Set([id]);
    let parentId = parentById.get(id);
    while (parentId) {
      if (ancestors.has(parentId)) return null;
      ancestors.add(parentId);
      parentId = parentById.get(parentId) || null;
    }
  }
  const positions = new Map();
  return requested.map((item) => {
    const id = typeof item === "string" ? item : item.id;
    const parentId = parentById.get(id) || null;
    const position = positions.get(parentId) || 0;
    positions.set(parentId, position + 1);
    return { id, parentId, position };
  });
}

function includeScreenshotFromRow(row) {
  if (row?.include_screenshot === undefined || row?.include_screenshot === null) return true;
  return Number(row.include_screenshot) !== 0;
}

function formatSession(row) {
  const capture = decodeVisualCaptureJson(row.pins_json, row.id);
  return {
    captureId: capture.captureId,
    batchId: row.batch_id || null,
    collectionId: row.collection_id,
    createdAt: row.created_at,
    id: row.id,
    includeScreenshot: includeScreenshotFromRow(row),
    page: {
      ...(capture.page.description ? { description: capture.page.description } : {}),
      title: row.title,
      url: row.url,
      viewport: capture.page.viewport,
    },
    pinCount: row.pin_count,
    pins: capture.pins,
    position: row.position,
    privacy: capture.privacy,
    schemaVersion: capture.schemaVersion,
    shotId: row.shot_id,
    shotPath: row.shot_path,
  };
}

function parseFilesJson(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string");
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function formatAgentExecution(row, results = row.results) {
  return presentAgentExecution({
    agent: row.agent,
    captureId: row.capture_id,
    createdAt: row.created_at,
    id: row.id,
    idempotencyKey: row.idempotency_key,
    results: (results || []).map((result) => ({
      commit: result.commit_ref || result.commit || undefined,
      createdAt: result.created_at,
      files: parseFilesJson(result.files ?? result.files_json),
      pinId: result.pin_id,
      pullRequest: result.pull_request || undefined,
      reason: result.reason || undefined,
      status: result.status,
      summary: result.summary,
    })),
  });
}

function formatLoopMetric(row) {
  return {
    agent: row.agent || undefined,
    createdAt: row.created_at,
    degraded: Boolean(Number(row.degraded)),
    durationMs: row.duration_ms == null ? undefined : Number(row.duration_ms),
    event: row.event,
    id: row.id,
    locationConfidence: row.location_confidence || undefined,
  };
}

function loopMetricRows(events) {
  const timestamp = now();
  return events.map((event) => {
    const sanitized = sanitizeLoopMetric(event);
    return {
      agent: sanitized.agent || null,
      created_at: timestamp,
      degraded: sanitized.degraded ? 1 : 0,
      duration_ms: sanitized.durationMs ?? null,
      event: sanitized.event,
      id: generateNanoId(),
      location_confidence: sanitized.locationConfidence || null,
    };
  });
}

function parseExecutionForSession(session, input) {
  if (!session) throw new AgentResultError("capture_not_found");
  const parsed = parseAgentExecutionInput(input, pinIdsFromPins(session.pins));
  if (parsed.captureId !== session.id && parsed.captureId !== session.captureId) {
    throw new AgentResultError("capture_not_found");
  }
  return parsed;
}

function formatPinReviewEvent(row) {
  return {
    actorId: row.actor_id,
    actorType: row.actor_type,
    createdAt: row.created_at,
    executionId: row.execution_id || undefined,
    fromStatus: row.from_status,
    id: row.id,
    origin: row.origin,
    pinId: row.pin_id,
    toStatus: row.to_status,
  };
}

function formatPinReview(pinId, row, events) {
  const status = isPinReviewStatus(row?.status) ? row.status : defaultPinReviewStatus();
  return {
    actions: humanActionsForStatus(status),
    pinId,
    status,
    timeline: events,
    updatedAt: row?.updated_at || "",
  };
}

function requirePinReview(reviews, pinId) {
  const review = reviews.find((item) => item.pinId === pinId);
  if (!review) throw new PinReviewError("pin_not_found");
  return review;
}

function captureForSave(id, page, pins, shotId, shotPath, extras = {}) {
  return parseVisualCapture({
    captureId: id,
    page,
    pins,
    privacy: extras.privacy,
    screenshot: {
      id: shotId || id,
      missing: !shotPath,
      url: shotPath || null,
    },
    warnings: extras.warnings,
  }, id);
}

class JsonHistoryDb {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.data = this._load();
    this._ensureDefaults();
  }

  _load() {
    try {
      if (existsSync(this.dbPath)) {
        const stored = JSON.parse(readFileSync(this.dbPath, "utf8"));
        if (Array.isArray(stored)) {
          return {
            agent_executions: [],
            batches: [],
            collections: [],
            loop_metrics: [],
            pin_review_events: [],
            pin_reviews: [],
            projects: [],
            sessions: stored,
          };
        }
        if (stored && typeof stored === "object") {
          return {
            agent_executions: Array.isArray(stored.agent_executions) ? stored.agent_executions : [],
            batches: Array.isArray(stored.batches) ? stored.batches : [],
            collections: Array.isArray(stored.collections) ? stored.collections : [],
            loop_metrics: Array.isArray(stored.loop_metrics) ? stored.loop_metrics : [],
            pin_review_events: Array.isArray(stored.pin_review_events) ? stored.pin_review_events : [],
            pin_reviews: Array.isArray(stored.pin_reviews) ? stored.pin_reviews : [],
            projects: Array.isArray(stored.projects) ? stored.projects : [],
            sessions: Array.isArray(stored.sessions) ? stored.sessions : [],
          };
        }
      }
    } catch {
      // A corrupt fallback should not prevent the local server from starting.
    }
    return {
      agent_executions: [],
      batches: [],
      collections: [],
      loop_metrics: [],
      pin_review_events: [],
      pin_reviews: [],
      projects: [],
      sessions: [],
    };
  }

  _save() {
    try {
      mkdirSync(join(this.dbPath, ".."), { recursive: true });
      writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2), "utf8");
    } catch (error) {
      console.warn("Failed to write history json", error);
    }
  }

  _ensureDefaults() {
    const timestamp = now();
    for (const item of this.data.projects) {
      item.icon = isProjectIcon(item.icon)
        ? item.icon
        : item.is_protected
          ? PERSONAL_PROJECT_ICON
          : DEFAULT_PROJECT_ICON;
    }
    let project = this.data.projects.find(
      (item) => item.owner_id === LOCAL_OWNER_ID && item.is_protected,
    );
    if (!project) {
      project = {
        created_at: timestamp,
        id: generateNanoId(),
        icon: PERSONAL_PROJECT_ICON,
        is_protected: 1,
        name: "Personal",
        owner_id: LOCAL_OWNER_ID,
        position: 0,
        updated_at: timestamp,
      };
      this.data.projects.push(project);
    }
    let collection = this.data.collections.find(
      (item) => item.owner_id === LOCAL_OWNER_ID && item.is_protected,
    );
    if (!collection) {
      collection = {
        created_at: timestamp,
        id: generateNanoId(),
        is_protected: 1,
        name: "Inbox",
        owner_id: LOCAL_OWNER_ID,
        parent_id: null,
        position: 0,
        project_id: project.id,
        updated_at: timestamp,
      };
      this.data.collections.push(collection);
    }
    const unassigned = this.data.sessions
      .filter((session) => !session.collection_id)
      .sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)));
    let position = this._nextSessionPosition(collection.id);
    for (const session of unassigned) {
      session.collection_id = collection.id;
      session.position = position;
      position += 1;
    }
    this._save();
  }

  _nextSessionPosition(collectionId) {
    return this.data.sessions.reduce(
      (result, session) => session.collection_id === collectionId
        ? Math.max(result, Number(session.position) + 1 || 1)
        : result,
      0,
    );
  }

  getDefaultDestination() {
    const project = this.data.projects.find((item) => item.is_protected);
    const collection = this.data.collections.find((item) => item.is_protected);
    if (!project || !collection) throw new Error("Default destination is unavailable");
    return { collectionId: collection.id, projectId: project.id };
  }

  resolveDestination(collectionId) {
    const collection = this.data.collections.find((item) => item.id === collectionId);
    return collection
      ? { collectionId: collection.id, projectId: collection.project_id }
      : this.getDefaultDestination();
  }

  /** @param {HistoryInput} input */
  saveSession({ batchId = null, collectionId, createdAt, id, includeScreenshot = true, page = {}, pins = [], privacy, shotId = null, shotPath = null, warnings } = {}) {
    const destination = this.resolveDestination(collectionId);
    const existing = id ? this.data.sessions.find((item) => item.id === id) : null;
    const sid = id || generateNanoId();
    const capture = captureForSave(sid, page, pins, shotId, shotPath, { privacy, warnings });
    const entry = {
      batch_id: batchId || null,
      collection_id: destination.collectionId,
      created_at: createdAt || now(),
      id: capture.captureId,
      include_screenshot: includeScreenshot === false ? 0 : 1,
      pin_count: capture.pins.length,
      pins_json: encodeVisualCaptureJson(capture),
      position: existing?.collection_id === destination.collectionId
        ? existing.position
        : this._nextSessionPosition(destination.collectionId),
      shot_id: shotId,
      shot_path: shotPath,
      title: page.title || capture.page.title || "(untitled)",
      url: page.url || capture.page.url || "",
    };
    this.data.sessions = [entry, ...this.data.sessions.filter((item) => item.id !== entry.id)];
    const session = formatSession(entry);
    this._ensureOpenReviews(session);
    this._save();
    return this._decorateSession(session);
  }

  listSessions({ batchId = "", collectionId = "", limit = 50, offset = 0, query = "" } = {}) {
    let results = this.data.sessions;
    if (batchId) results = results.filter((item) => item.batch_id === batchId);
    if (collectionId) results = results.filter((item) => item.collection_id === collectionId);
    if (query) {
      const normalized = query.toLowerCase();
      results = results.filter((item) =>
        item.title.toLowerCase().includes(normalized)
        || item.url.toLowerCase().includes(normalized)
        || item.pins_json.toLowerCase().includes(normalized));
    }
    results = [...results].sort((left, right) => {
      if (collectionId) return Number(left.position) - Number(right.position);
      return String(right.created_at).localeCompare(String(left.created_at));
    });
    return results.slice(offset, offset + limit).map((row) => this._decorateSession(formatSession(row)));
  }

  getSession(id) {
    const row = this.data.sessions.find((item) => item.id === id);
    return row ? this._decorateSession(formatSession(row)) : null;
  }

  _reviewStatusMap(captureId) {
    return new Map(
      this.data.pin_reviews
        .filter((item) => item.capture_id === captureId)
        .map((item) => [item.pin_id, item.status]),
    );
  }

  _decorateSession(session) {
    return {
      ...session,
      reviewCounts: countPinReviews(pinIdsFromPins(session.pins), this._reviewStatusMap(session.id)),
    };
  }

  _ensureOpenReviews(session) {
    const timestamp = now();
    for (const pinId of pinIdsFromPins(session.pins)) {
      const existing = this.data.pin_reviews.find((item) => item.capture_id === session.id && item.pin_id === pinId);
      if (existing) continue;
      this.data.pin_reviews.push({
        capture_id: session.id,
        last_execution_id: null,
        pin_id: pinId,
        status: "open",
        updated_at: timestamp,
      });
    }
  }

  listPinReviews(captureId) {
    const session = this.getSession(captureId);
    if (!session) return [];
    const events = this.data.pin_review_events
      .filter((item) => item.capture_id === captureId)
      .sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)));
    return [...pinIdsFromPins(session.pins)].map((pinId) => {
      const row = this.data.pin_reviews.find((item) => item.capture_id === captureId && item.pin_id === pinId);
      return formatPinReview(
        pinId,
        row,
        events.filter((item) => item.pin_id === pinId).map(formatPinReviewEvent),
      );
    });
  }

  applyPinReview(captureId, pinId, action, actor) {
    const session = this.getSession(captureId);
    if (!session || !pinIdsFromPins(session.pins).has(pinId)) throw new PinReviewError("pin_not_found");
    this._ensureOpenReviews(session);
    let row = this.data.pin_reviews.find((item) => item.capture_id === captureId && item.pin_id === pinId);
    if (!row) throw new PinReviewError("pin_not_found");
    const current = isPinReviewStatus(row.status) ? row.status : "open";
    if (
      action === "agent_changed"
      && actor.executionId
      && row.last_execution_id === actor.executionId
      && current === "correction_ready"
    ) {
      return { changed: false, review: requirePinReview(this.listPinReviews(captureId), pinId) };
    }
    const transition = resolvePinReviewTransition(current, action);
    const timestamp = now();
    if (transition.changed) {
      this.data.pin_review_events.push({
        actor_id: actor.actorId,
        actor_type: actor.actorType,
        capture_id: captureId,
        created_at: timestamp,
        execution_id: actor.executionId || null,
        from_status: current,
        id: generateNanoId(),
        origin: actor.origin,
        pin_id: pinId,
        to_status: transition.next,
      });
      row.status = transition.next;
      row.updated_at = timestamp;
    }
    if (actor.executionId) row.last_execution_id = actor.executionId;
    this._save();
    return {
      changed: transition.changed,
      review: requirePinReview(this.listPinReviews(captureId), pinId),
    };
  }

  listAgentExecutions(captureId) {
    return this.data.agent_executions
      .filter((item) => item.capture_id === captureId)
      .sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)))
      .map((row) => formatAgentExecution(row));
  }

  saveAgentExecution(input) {
    const captureId = typeof input?.captureId === "string" ? input.captureId.trim() : "";
    const parsed = parseExecutionForSession(this.getSession(captureId), input);
    const existing = this.data.agent_executions.find((item) => item.idempotency_key === parsed.idempotencyKey);
    const saved = existing
      ? (() => {
        if (existing.payload_hash !== parsed.fingerprint) throw new AgentResultError("idempotency_conflict");
        return { created: false, execution: formatAgentExecution(existing) };
      })()
      : (() => {
        const timestamp = now();
        const row = {
          agent: parsed.agent,
          capture_id: parsed.captureId,
          created_at: timestamp,
          id: generateNanoId(),
          idempotency_key: parsed.idempotencyKey,
          payload_hash: parsed.fingerprint,
          results: parsed.results.map((result) => ({
            commit_ref: result.commit || null,
            created_at: timestamp,
            files_json: JSON.stringify(result.files),
            id: generateNanoId(),
            pin_id: result.pinId,
            pull_request: result.pullRequest || null,
            reason: result.reason || null,
            status: result.status,
            summary: result.summary,
          })),
        };
        this.data.agent_executions = [...this.data.agent_executions, row];
        this._save();
        return { created: true, execution: formatAgentExecution(row) };
      })();
    for (const result of saved.execution.results) {
      if (result.status !== "changed") continue;
      try {
        this.applyPinReview(parsed.captureId, result.pinId, "agent_changed", {
          actorId: saved.execution.agent,
          actorType: "agent",
          executionId: saved.execution.id,
          origin: "agent_result",
        });
      } catch (error) {
        if (error instanceof PinReviewError && error.code === "invalid_transition") continue;
        throw error;
      }
    }
    return saved;
  }

  listLoopMetrics() {
    return [...this.data.loop_metrics]
      .sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)))
      .map(formatLoopMetric);
  }

  saveLoopMetrics(events) {
    const rows = loopMetricRows(events);
    this.data.loop_metrics = [...this.data.loop_metrics, ...rows];
    this._save();
    return rows.map(formatLoopMetric);
  }

  deleteSession(id) {
    const previousLength = this.data.sessions.length;
    this.data.sessions = this.data.sessions.filter((item) => item.id !== id);
    this.data.agent_executions = this.data.agent_executions.filter((item) => item.capture_id !== id);
    this.data.pin_reviews = this.data.pin_reviews.filter((item) => item.capture_id !== id);
    this.data.pin_review_events = this.data.pin_review_events.filter((item) => item.capture_id !== id);
    this._save();
    return previousLength !== this.data.sessions.length;
  }

  clearHistory() {
    this.data.sessions = [];
    this.data.agent_executions = [];
    this.data.loop_metrics = [];
    this.data.pin_reviews = [];
    this.data.pin_review_events = [];
    this._save();
    return true;
  }

  listProjects() {
    return [...this.data.projects].sort((left, right) => left.position - right.position).map(formatProject);
  }

  createProject(name, icon = DEFAULT_PROJECT_ICON) {
    const timestamp = now();
    const row = {
      created_at: timestamp,
      id: generateNanoId(),
      icon: isProjectIcon(icon) ? icon : DEFAULT_PROJECT_ICON,
      is_protected: 0,
      name,
      owner_id: LOCAL_OWNER_ID,
      position: this.data.projects.length,
      updated_at: timestamp,
    };
    this.data.projects.push(row);
    this._save();
    return formatProject(row);
  }

  updateProject(id, name, icon) {
    const row = this.data.projects.find((item) => item.id === id);
    if (!row) return null;
    row.icon = isProjectIcon(icon) ? icon : formatProject(row).icon;
    row.name = name;
    row.updated_at = now();
    this._save();
    return formatProject(row);
  }

  reorderProjects(ids) {
    ids.forEach((id, position) => {
      const row = this.data.projects.find((item) => item.id === id);
      if (row) row.position = position;
    });
    this._save();
    return this.listProjects();
  }

  deleteProject(id) {
    const project = this.data.projects.find((item) => item.id === id);
    if (!project || project.is_protected) return false;
    const collectionIds = new Set(
      this.data.collections.filter((item) => item.project_id === id).map((item) => item.id),
    );
    const fallback = this.getDefaultDestination();
    let position = this._nextSessionPosition(fallback.collectionId);
    for (const session of this.data.sessions) {
      if (!collectionIds.has(session.collection_id)) continue;
      session.collection_id = fallback.collectionId;
      session.position = position;
      position += 1;
    }
    this.data.collections = this.data.collections.filter((item) => item.project_id !== id);
    this.data.projects = this.data.projects.filter((item) => item.id !== id);
    this._save();
    return true;
  }

  listCollections(projectId) {
    return sortCollectionRows(this.data.collections.filter((item) => item.project_id === projectId))
      .map(formatCollection);
  }

  createCollection(projectId, name, parentId = null) {
    const project = this.data.projects.find((item) => item.id === projectId);
    if (!project) return null;
    const parent = parentId
      ? this.data.collections.find((item) => item.id === parentId && item.project_id === projectId)
      : null;
    if (parentId && !parent) return null;
    const timestamp = now();
    const row = {
      created_at: timestamp,
      id: generateNanoId(),
      is_protected: 0,
      name,
      owner_id: LOCAL_OWNER_ID,
      parent_id: parentId,
      position: this.data.collections.filter(
        (item) => item.project_id === projectId && (item.parent_id || null) === parentId,
      ).length,
      project_id: projectId,
      updated_at: timestamp,
    };
    this.data.collections.push(row);
    this._save();
    return formatCollection(row);
  }

  updateCollection(id, name) {
    const row = this.data.collections.find((item) => item.id === id);
    if (!row) return null;
    row.name = name;
    row.updated_at = now();
    this._save();
    return formatCollection(row);
  }

  reorderCollections(projectId, requested) {
    const rows = this.data.collections.filter((item) => item.project_id === projectId);
    const placements = planCollectionPlacements(rows, requested);
    if (!placements) return null;
    const timestamp = now();
    for (const placement of placements) {
      const row = rows.find((item) => item.id === placement.id);
      row.parent_id = placement.parentId;
      row.position = placement.position;
      row.updated_at = timestamp;
    }
    this._save();
    return this.listCollections(projectId);
  }

  deleteCollection(id) {
    const collection = this.data.collections.find((item) => item.id === id);
    if (!collection || collection.is_protected) return false;
    const fallback = this.getDefaultDestination();
    let position = this._nextSessionPosition(fallback.collectionId);
    for (const session of this.data.sessions) {
      if (session.collection_id !== id) continue;
      session.collection_id = fallback.collectionId;
      session.position = position;
      position += 1;
    }
    const siblings = sortCollectionRows(this.data.collections.filter(
      (item) => item.project_id === collection.project_id
        && (item.parent_id || null) === (collection.parent_id || null),
    ));
    const children = sortCollectionRows(this.data.collections.filter(
      (item) => item.project_id === collection.project_id && item.parent_id === id,
    ));
    const promoted = siblings.flatMap((item) => item.id === id ? children : [item]);
    promoted.forEach((item, index) => {
      item.parent_id = collection.parent_id || null;
      item.position = index;
    });
    this.data.collections = this.data.collections.filter((item) => item.id !== id);
    this._save();
    return true;
  }

  upsertBatch({ id, label, startedAt }) {
    let row = this.data.batches.find((item) => item.id === id);
    if (!row) {
      row = {
        finished_at: null,
        id,
        label,
        started_at: startedAt,
      };
      this.data.batches.push(row);
      this._save();
    }
    return formatBatch(row, this.data.sessions.filter((item) => item.batch_id === id).length);
  }

  listBatches() {
    return [...this.data.batches]
      .sort((left, right) => String(right.started_at).localeCompare(String(left.started_at)))
      .map((row) => formatBatch(
        row,
        this.data.sessions.filter((item) => item.batch_id === row.id).length,
      ));
  }

  finishBatch(id, finishedAt) {
    const row = this.data.batches.find((item) => item.id === id);
    if (!row) return null;
    row.finished_at = finishedAt;
    this._save();
    return formatBatch(row, this.data.sessions.filter((item) => item.batch_id === id).length);
  }

  deleteBatch(id) {
    if (!this.data.batches.some((item) => item.id === id)) return false;
    for (const session of this.data.sessions) {
      if (session.batch_id === id) session.batch_id = null;
    }
    this.data.batches = this.data.batches.filter((item) => item.id !== id);
    this._save();
    return true;
  }

  moveSession(id, collectionId) {
    const session = this.data.sessions.find((item) => item.id === id);
    const collection = this.data.collections.find((item) => item.id === collectionId);
    if (!session || !collection) return null;
    session.collection_id = collectionId;
    session.position = this._nextSessionPosition(collectionId);
    this._save();
    return formatSession(session);
  }

  reorderSessions(collectionId, ids) {
    ids.forEach((id, position) => {
      const row = this.data.sessions.find(
        (item) => item.id === id && item.collection_id === collectionId,
      );
      if (row) row.position = position;
    });
    this._save();
    return this.listSessions({ collectionId, limit: Number.MAX_SAFE_INTEGER });
  }

  getProjectTree() {
    return {
      projects: this.listProjects().map((project) => ({
        ...project,
        collections: this.listCollections(project.id).map((collection) => ({
          ...collection,
          sessions: this.listSessions({ collectionId: collection.id, limit: Number.MAX_SAFE_INTEGER }),
        })),
      })),
    };
  }

  close() {}

  replaceShotPathPrefix(previous, next) {
    let changed = false;
    this.data.sessions = this.data.sessions.map((entry) => {
      if (!entry.shot_path?.startsWith(previous)) return entry;
      changed = true;
      return { ...entry, shot_path: `${next}${entry.shot_path.slice(previous.length)}` };
    });
    if (changed) this._save();
  }
}

class SqliteHistoryDb {
  constructor(dbPath) {
    mkdirSync(join(dbPath, ".."), { recursive: true });
    this.db = new SqliteDatabase(dbPath);
    this._initSchema();
    this._ensureDefaults();
  }

  _initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        name TEXT NOT NULL,
        icon TEXT NOT NULL DEFAULT 'folder-kanban',
        position INTEGER NOT NULL DEFAULT 0,
        is_protected INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS collections (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        parent_id TEXT,
        name TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        is_protected INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS batches (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        url TEXT,
        title TEXT,
        shot_id TEXT,
        shot_path TEXT,
        pin_count INTEGER,
        pins_json TEXT,
        created_at TEXT,
        collection_id TEXT,
        batch_id TEXT,
        position INTEGER,
        include_screenshot INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS agent_executions (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        capture_id TEXT NOT NULL,
        agent TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload_hash TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_pin_results (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL,
        pin_id TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT NOT NULL,
        reason TEXT,
        files_json TEXT NOT NULL DEFAULT '[]',
        commit_ref TEXT,
        pull_request TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (execution_id, pin_id)
      );
      CREATE TABLE IF NOT EXISTS pin_reviews (
        capture_id TEXT NOT NULL,
        pin_id TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_execution_id TEXT,
        PRIMARY KEY (capture_id, pin_id)
      );
      CREATE TABLE IF NOT EXISTS pin_review_events (
        id TEXT PRIMARY KEY,
        capture_id TEXT NOT NULL,
        pin_id TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        origin TEXT NOT NULL,
        from_status TEXT NOT NULL,
        to_status TEXT NOT NULL,
        execution_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS loop_metrics (
        id TEXT PRIMARY KEY,
        event TEXT NOT NULL,
        duration_ms INTEGER,
        agent TEXT,
        location_confidence TEXT,
        degraded INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_projects_owner_position ON projects(owner_id, position);
      CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_agent_executions_capture ON agent_executions(capture_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_agent_pin_results_execution ON agent_pin_results(execution_id);
      CREATE INDEX IF NOT EXISTS idx_pin_review_events_pin ON pin_review_events(capture_id, pin_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_loop_metrics_created ON loop_metrics(created_at);
    `);
    const projectColumns = new Set(
      this.db.prepare("PRAGMA table_info(projects)").all().map((row) => row.name),
    );
    if (!projectColumns.has("icon")) {
      this.db.exec(`
        ALTER TABLE projects ADD COLUMN icon TEXT NOT NULL DEFAULT 'folder-kanban';
        UPDATE projects SET icon = 'user-round' WHERE is_protected = 1;
      `);
    }
    const collectionColumns = new Set(
      this.db.prepare("PRAGMA table_info(collections)").all().map((row) => row.name),
    );
    if (!collectionColumns.has("parent_id")) {
      this.db.exec("ALTER TABLE collections ADD COLUMN parent_id TEXT;");
    }
    this.db.exec("DROP INDEX IF EXISTS idx_collections_project_position;");
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_collections_project_position
      ON collections(project_id, parent_id, position);
    `);
    const columns = new Set(this.db.prepare("PRAGMA table_info(sessions)").all().map((row) => row.name));
    if (!columns.has("collection_id")) this.db.exec("ALTER TABLE sessions ADD COLUMN collection_id TEXT;");
    if (!columns.has("position")) this.db.exec("ALTER TABLE sessions ADD COLUMN position INTEGER;");
    if (!columns.has("include_screenshot")) {
      this.db.exec("ALTER TABLE sessions ADD COLUMN include_screenshot INTEGER NOT NULL DEFAULT 1;");
    }
    if (!columns.has("batch_id")) this.db.exec("ALTER TABLE sessions ADD COLUMN batch_id TEXT;");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_sessions_collection_position ON sessions(collection_id, position);");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_sessions_batch ON sessions(batch_id, created_at DESC);");
  }

  _ensureDefaults() {
    const timestamp = now();
    let project = this.db.prepare(
      "SELECT * FROM projects WHERE owner_id = ? AND is_protected = 1 LIMIT 1",
    ).get(LOCAL_OWNER_ID);
    if (!project) {
      const id = generateNanoId();
      this.db.prepare(`
        INSERT INTO projects (id, owner_id, name, icon, position, is_protected, created_at, updated_at)
        VALUES (?, ?, 'Personal', ?, 0, 1, ?, ?)
      `).run(id, LOCAL_OWNER_ID, PERSONAL_PROJECT_ICON, timestamp, timestamp);
      project = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
    }
    let collection = this.db.prepare(
      "SELECT * FROM collections WHERE owner_id = ? AND is_protected = 1 LIMIT 1",
    ).get(LOCAL_OWNER_ID);
    if (!collection) {
      const id = generateNanoId();
      this.db.prepare(`
        INSERT INTO collections (
          id, project_id, owner_id, parent_id, name, position, is_protected, created_at, updated_at
        ) VALUES (?, ?, ?, NULL, 'Inbox', 0, 1, ?, ?)
      `).run(id, project.id, LOCAL_OWNER_ID, timestamp, timestamp);
      collection = this.db.prepare("SELECT * FROM collections WHERE id = ?").get(id);
    }
    const rows = this.db.prepare(
      "SELECT id FROM sessions WHERE collection_id IS NULL ORDER BY created_at ASC",
    ).all();
    let position = this._nextSessionPosition(collection.id);
    const update = this.db.prepare("UPDATE sessions SET collection_id = ?, position = ? WHERE id = ?");
    for (const row of rows) {
      update.run(collection.id, position, row.id);
      position += 1;
    }
  }

  _nextSessionPosition(collectionId) {
    const row = this.db.prepare(
      "SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM sessions WHERE collection_id = ?",
    ).get(collectionId);
    return Number(row.next_position);
  }

  getDefaultDestination() {
    const row = this.db.prepare(`
      SELECT collections.id AS collection_id, projects.id AS project_id
      FROM collections
      JOIN projects ON projects.id = collections.project_id
      WHERE collections.owner_id = ? AND collections.is_protected = 1
      LIMIT 1
    `).get(LOCAL_OWNER_ID);
    if (!row) throw new Error("Default destination is unavailable");
    return { collectionId: row.collection_id, projectId: row.project_id };
  }

  resolveDestination(collectionId) {
    const row = collectionId
      ? this.db.prepare("SELECT id, project_id FROM collections WHERE id = ? AND owner_id = ?")
        .get(collectionId, LOCAL_OWNER_ID)
      : null;
    return row
      ? { collectionId: row.id, projectId: row.project_id }
      : this.getDefaultDestination();
  }

  /** @param {HistoryInput} input */
  saveSession({ batchId = null, collectionId, createdAt, id, includeScreenshot = true, page = {}, pins = [], privacy, shotId = null, shotPath = null, warnings } = {}) {
    const sid = id || generateNanoId();
    const destination = this.resolveDestination(collectionId);
    const existing = this.db.prepare("SELECT collection_id, position FROM sessions WHERE id = ?").get(sid);
    const position = existing?.collection_id === destination.collectionId
      ? existing.position
      : this._nextSessionPosition(destination.collectionId);
    const capture = captureForSave(sid, page, pins, shotId, shotPath, { privacy, warnings });
    const includeFlag = includeScreenshot === false ? 0 : 1;
    this.db.prepare(`
      INSERT INTO sessions (
        id, url, title, shot_id, shot_path, pin_count, pins_json, created_at, collection_id, batch_id, position, include_screenshot
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        url=excluded.url,
        title=excluded.title,
        shot_id=excluded.shot_id,
        shot_path=excluded.shot_path,
        pin_count=excluded.pin_count,
        pins_json=excluded.pins_json,
        created_at=excluded.created_at,
        collection_id=excluded.collection_id,
        batch_id=excluded.batch_id,
        position=excluded.position,
        include_screenshot=excluded.include_screenshot
    `).run(
      capture.captureId,
      page.url || capture.page.url || "",
      page.title || capture.page.title || "(untitled)",
      shotId,
      shotPath,
      capture.pins.length,
      encodeVisualCaptureJson(capture),
      createdAt || now(),
      destination.collectionId,
      batchId || null,
      position,
      includeFlag,
    );
    const session = this.getSession(capture.captureId);
    if (!session) throw new Error(`Failed to save history session ${sid}`);
    this._ensureOpenReviews(session);
    return this._decorateSession(this.getSession(capture.captureId));
  }

  listSessions({ batchId = "", collectionId = "", limit = 50, offset = 0, query = "" } = {}) {
    const clauses = [];
    const values = [];
    if (batchId) {
      clauses.push("batch_id = ?");
      values.push(batchId);
    }
    if (collectionId) {
      clauses.push("collection_id = ?");
      values.push(collectionId);
    }
    if (query) {
      clauses.push("(title LIKE ? OR url LIKE ? OR pins_json LIKE ?)");
      const pattern = `%${query}%`;
      values.push(pattern, pattern, pattern);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const order = collectionId ? "position ASC" : "created_at DESC";
    const rows = this.db.prepare(`
      SELECT id, url, title, shot_id, shot_path, pin_count, pins_json, created_at, collection_id, batch_id, position, include_screenshot
      FROM sessions
      ${where}
      ORDER BY ${order}
      LIMIT ? OFFSET ?
    `).all(...values, limit, offset);
    return rows.map((row) => this._decorateSession(formatSession(row)));
  }

  getSession(id) {
    const row = this.db.prepare(`
      SELECT id, url, title, shot_id, shot_path, pin_count, pins_json, created_at, collection_id, batch_id, position, include_screenshot
      FROM sessions WHERE id = ?
    `).get(id);
    return row ? this._decorateSession(formatSession(row)) : null;
  }

  _reviewStatusMap(captureId) {
    return new Map(
      this.db.prepare("SELECT pin_id, status FROM pin_reviews WHERE capture_id = ?")
        .all(captureId)
        .map((row) => [row.pin_id, row.status]),
    );
  }

  _decorateSession(session) {
    return {
      ...session,
      reviewCounts: countPinReviews(pinIdsFromPins(session.pins), this._reviewStatusMap(session.id)),
    };
  }

  _ensureOpenReviews(session) {
    const timestamp = now();
    const insert = this.db.prepare(`
      INSERT INTO pin_reviews (capture_id, pin_id, status, updated_at, last_execution_id)
      VALUES (?, ?, 'open', ?, NULL)
      ON CONFLICT(capture_id, pin_id) DO NOTHING
    `);
    for (const pinId of pinIdsFromPins(session.pins)) insert.run(session.id, pinId, timestamp);
  }

  listPinReviews(captureId) {
    const session = this.getSession(captureId);
    if (!session) return [];
    const rows = this.db.prepare("SELECT * FROM pin_reviews WHERE capture_id = ?").all(captureId);
    const byPin = new Map(rows.map((row) => [row.pin_id, row]));
    const events = this.db.prepare(`
      SELECT * FROM pin_review_events WHERE capture_id = ? ORDER BY created_at ASC
    `).all(captureId);
    return [...pinIdsFromPins(session.pins)].map((pinId) => formatPinReview(
      pinId,
      byPin.get(pinId),
      events.filter((item) => item.pin_id === pinId).map(formatPinReviewEvent),
    ));
  }

  applyPinReview(captureId, pinId, action, actor) {
    const session = this.getSession(captureId);
    if (!session || !pinIdsFromPins(session.pins).has(pinId)) throw new PinReviewError("pin_not_found");
    this._ensureOpenReviews(session);
    const row = this.db.prepare("SELECT * FROM pin_reviews WHERE capture_id = ? AND pin_id = ?")
      .get(captureId, pinId);
    if (!row) throw new PinReviewError("pin_not_found");
    const current = isPinReviewStatus(row.status) ? row.status : "open";
    if (
      action === "agent_changed"
      && actor.executionId
      && row.last_execution_id === actor.executionId
      && current === "correction_ready"
    ) {
      return { changed: false, review: requirePinReview(this.listPinReviews(captureId), pinId) };
    }
    const transition = resolvePinReviewTransition(current, action);
    const timestamp = now();
    if (transition.changed) {
      this.db.prepare(`
        INSERT INTO pin_review_events (
          id, capture_id, pin_id, actor_type, actor_id, origin, from_status, to_status, execution_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        generateNanoId(),
        captureId,
        pinId,
        actor.actorType,
        actor.actorId,
        actor.origin,
        current,
        transition.next,
        actor.executionId || null,
        timestamp,
      );
      this.db.prepare(`
        UPDATE pin_reviews SET status = ?, updated_at = ?, last_execution_id = COALESCE(?, last_execution_id)
        WHERE capture_id = ? AND pin_id = ?
      `).run(transition.next, timestamp, actor.executionId || null, captureId, pinId);
    } else if (actor.executionId) {
      this.db.prepare(`
        UPDATE pin_reviews SET last_execution_id = ? WHERE capture_id = ? AND pin_id = ?
      `).run(actor.executionId, captureId, pinId);
    }
    return {
      changed: transition.changed,
      review: requirePinReview(this.listPinReviews(captureId), pinId),
    };
  }

  _applyChangedResults(execution) {
    if (!execution) return;
    for (const result of execution.results) {
      if (result.status !== "changed") continue;
      try {
        this.applyPinReview(execution.captureId, result.pinId, "agent_changed", {
          actorId: execution.agent,
          actorType: "agent",
          executionId: execution.id,
          origin: "agent_result",
        });
      } catch (error) {
        if (error instanceof PinReviewError && error.code === "invalid_transition") continue;
        throw error;
      }
    }
  }

  listAgentExecutions(captureId) {
    const executions = this.db.prepare(`
      SELECT * FROM agent_executions WHERE capture_id = ? ORDER BY created_at ASC
    `).all(captureId);
    const resultsFor = this.db.prepare(`
      SELECT * FROM agent_pin_results WHERE execution_id = ? ORDER BY pin_id ASC
    `);
    return executions.map((row) => formatAgentExecution(row, resultsFor.all(row.id)));
  }

  saveAgentExecution(input) {
    const captureId = typeof input?.captureId === "string" ? input.captureId.trim() : "";
    const parsed = parseExecutionForSession(this.getSession(captureId), input);
    const existing = this.db.prepare("SELECT * FROM agent_executions WHERE idempotency_key = ?")
      .get(parsed.idempotencyKey);
    if (existing) {
      if (existing.payload_hash !== parsed.fingerprint) throw new AgentResultError("idempotency_conflict");
      const execution = formatAgentExecution(
        existing,
        this.db.prepare("SELECT * FROM agent_pin_results WHERE execution_id = ? ORDER BY pin_id ASC")
          .all(existing.id),
      );
      this._applyChangedResults(execution);
      return { created: false, execution };
    }
    const timestamp = now();
    const id = generateNanoId();
    try {
      this.db.prepare(`
        INSERT INTO agent_executions (
          id, idempotency_key, capture_id, agent, created_at, payload_hash
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, parsed.idempotencyKey, parsed.captureId, parsed.agent, timestamp, parsed.fingerprint);
    } catch (error) {
      const raced = this.db.prepare("SELECT * FROM agent_executions WHERE idempotency_key = ?")
        .get(parsed.idempotencyKey);
      if (raced?.payload_hash === parsed.fingerprint) {
        const execution = formatAgentExecution(
          raced,
          this.db.prepare("SELECT * FROM agent_pin_results WHERE execution_id = ? ORDER BY pin_id ASC")
            .all(raced.id),
        );
        this._applyChangedResults(execution);
        return { created: false, execution };
      }
      if (raced) throw new AgentResultError("idempotency_conflict");
      throw error;
    }
    const insertResult = this.db.prepare(`
      INSERT INTO agent_pin_results (
        id, execution_id, pin_id, status, summary, reason, files_json, commit_ref, pull_request, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const result of parsed.results) {
      insertResult.run(
        generateNanoId(),
        id,
        result.pinId,
        result.status,
        result.summary,
        result.reason || null,
        JSON.stringify(result.files),
        result.commit || null,
        result.pullRequest || null,
        timestamp,
      );
    }
    const execution = this.listAgentExecutions(parsed.captureId).find((item) => item.id === id);
    this._applyChangedResults(execution);
    return { created: true, execution };
  }

  listLoopMetrics() {
    return this.db.prepare("SELECT * FROM loop_metrics ORDER BY created_at ASC").all().map(formatLoopMetric);
  }

  saveLoopMetrics(events) {
    const rows = loopMetricRows(events);
    const insert = this.db.prepare(`
      INSERT INTO loop_metrics (
        id, event, duration_ms, agent, location_confidence, degraded, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of rows) {
      insert.run(
        row.id,
        row.event,
        row.duration_ms,
        row.agent,
        row.location_confidence,
        row.degraded,
        row.created_at,
      );
    }
    return rows.map(formatLoopMetric);
  }

  deleteSession(id) {
    const executions = this.db.prepare("SELECT id FROM agent_executions WHERE capture_id = ?").all(id);
    const deleteResults = this.db.prepare("DELETE FROM agent_pin_results WHERE execution_id = ?");
    for (const row of executions) deleteResults.run(row.id);
    this.db.prepare("DELETE FROM agent_executions WHERE capture_id = ?").run(id);
    this.db.prepare("DELETE FROM pin_review_events WHERE capture_id = ?").run(id);
    this.db.prepare("DELETE FROM pin_reviews WHERE capture_id = ?").run(id);
    return this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id).changes > 0;
  }

  clearHistory() {
    this.db.exec("DELETE FROM loop_metrics; DELETE FROM agent_pin_results; DELETE FROM agent_executions; DELETE FROM pin_review_events; DELETE FROM pin_reviews; DELETE FROM sessions;");
    return true;
  }

  listProjects() {
    return this.db.prepare(
      "SELECT * FROM projects WHERE owner_id = ? ORDER BY position ASC, created_at ASC",
    ).all(LOCAL_OWNER_ID).map(formatProject);
  }

  createProject(name, icon = DEFAULT_PROJECT_ICON) {
    const id = generateNanoId();
    const timestamp = now();
    const position = Number(this.db.prepare(
      "SELECT COUNT(*) AS count FROM projects WHERE owner_id = ?",
    ).get(LOCAL_OWNER_ID).count);
    this.db.prepare(`
      INSERT INTO projects (id, owner_id, name, icon, position, is_protected, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      id,
      LOCAL_OWNER_ID,
      name,
      isProjectIcon(icon) ? icon : DEFAULT_PROJECT_ICON,
      position,
      timestamp,
      timestamp,
    );
    return formatProject(this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id));
  }

  updateProject(id, name, icon) {
    const existing = this.db.prepare(
      "SELECT * FROM projects WHERE id = ? AND owner_id = ?",
    ).get(id, LOCAL_OWNER_ID);
    if (!existing) return null;
    const result = this.db.prepare(
      "UPDATE projects SET name = ?, icon = ?, updated_at = ? WHERE id = ? AND owner_id = ?",
    ).run(
      name,
      isProjectIcon(icon) ? icon : formatProject(existing).icon,
      now(),
      id,
      LOCAL_OWNER_ID,
    );
    if (!result.changes) return null;
    return formatProject(this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id));
  }

  reorderProjects(ids) {
    const update = this.db.prepare("UPDATE projects SET position = ?, updated_at = ? WHERE id = ? AND owner_id = ?");
    const timestamp = now();
    ids.forEach((id, position) => update.run(position, timestamp, id, LOCAL_OWNER_ID));
    return this.listProjects();
  }

  deleteProject(id) {
    const project = this.db.prepare(
      "SELECT * FROM projects WHERE id = ? AND owner_id = ?",
    ).get(id, LOCAL_OWNER_ID);
    if (!project || project.is_protected) return false;
    const fallback = this.getDefaultDestination();
    const sessions = this.db.prepare(`
      SELECT sessions.id
      FROM sessions
      JOIN collections ON collections.id = sessions.collection_id
      WHERE collections.project_id = ?
      ORDER BY sessions.position ASC
    `).all(id);
    let position = this._nextSessionPosition(fallback.collectionId);
    const move = this.db.prepare("UPDATE sessions SET collection_id = ?, position = ? WHERE id = ?");
    for (const session of sessions) {
      move.run(fallback.collectionId, position, session.id);
      position += 1;
    }
    this.db.prepare("DELETE FROM collections WHERE project_id = ? AND owner_id = ?").run(id, LOCAL_OWNER_ID);
    return this.db.prepare("DELETE FROM projects WHERE id = ? AND owner_id = ?").run(id, LOCAL_OWNER_ID).changes > 0;
  }

  listCollections(projectId) {
    const rows = this.db.prepare(`
      SELECT * FROM collections
      WHERE project_id = ? AND owner_id = ?
    `).all(projectId, LOCAL_OWNER_ID);
    return sortCollectionRows(rows).map(formatCollection);
  }

  createCollection(projectId, name, parentId = null) {
    const project = this.db.prepare(
      "SELECT id FROM projects WHERE id = ? AND owner_id = ?",
    ).get(projectId, LOCAL_OWNER_ID);
    if (!project) return null;
    const parent = parentId ? this.db.prepare(
      "SELECT id FROM collections WHERE id = ? AND project_id = ? AND owner_id = ?",
    ).get(parentId, projectId, LOCAL_OWNER_ID) : null;
    if (parentId && !parent) return null;
    const id = generateNanoId();
    const timestamp = now();
    const position = Number(this.db.prepare(
      `SELECT COUNT(*) AS count FROM collections
       WHERE project_id = ? AND owner_id = ?
         AND (parent_id = ? OR (parent_id IS NULL AND ? IS NULL))`,
    ).get(projectId, LOCAL_OWNER_ID, parentId, parentId).count);
    this.db.prepare(`
      INSERT INTO collections (
        id, project_id, owner_id, parent_id, name, position, is_protected, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(id, projectId, LOCAL_OWNER_ID, parentId, name, position, timestamp, timestamp);
    return formatCollection(this.db.prepare("SELECT * FROM collections WHERE id = ?").get(id));
  }

  updateCollection(id, name) {
    const result = this.db.prepare(
      "UPDATE collections SET name = ?, updated_at = ? WHERE id = ? AND owner_id = ?",
    ).run(name, now(), id, LOCAL_OWNER_ID);
    if (!result.changes) return null;
    return formatCollection(this.db.prepare("SELECT * FROM collections WHERE id = ?").get(id));
  }

  reorderCollections(projectId, requested) {
    const rows = this.db.prepare(
      "SELECT * FROM collections WHERE project_id = ? AND owner_id = ?",
    ).all(projectId, LOCAL_OWNER_ID);
    const placements = planCollectionPlacements(rows, requested);
    if (!placements) return null;
    const update = this.db.prepare(`
      UPDATE collections SET parent_id = ?, position = ?, updated_at = ?
      WHERE id = ? AND project_id = ? AND owner_id = ?
    `);
    const timestamp = now();
    placements.forEach(({ id, parentId, position }) => {
      update.run(parentId, position, timestamp, id, projectId, LOCAL_OWNER_ID);
    });
    return this.listCollections(projectId);
  }

  deleteCollection(id) {
    const collection = this.db.prepare(
      "SELECT * FROM collections WHERE id = ? AND owner_id = ?",
    ).get(id, LOCAL_OWNER_ID);
    if (!collection || collection.is_protected) return false;
    const fallback = this.getDefaultDestination();
    const sessions = this.db.prepare(
      "SELECT id FROM sessions WHERE collection_id = ? ORDER BY position ASC",
    ).all(id);
    let position = this._nextSessionPosition(fallback.collectionId);
    const move = this.db.prepare("UPDATE sessions SET collection_id = ?, position = ? WHERE id = ?");
    for (const session of sessions) {
      move.run(fallback.collectionId, position, session.id);
      position += 1;
    }
    const siblingRows = this.db.prepare(`
      SELECT * FROM collections
      WHERE project_id = ? AND owner_id = ?
        AND ((parent_id IS NULL AND ? IS NULL) OR parent_id = ?)
    `).all(
      collection.project_id,
      LOCAL_OWNER_ID,
      collection.parent_id,
      collection.parent_id,
    );
    const childRows = this.db.prepare(
      "SELECT * FROM collections WHERE project_id = ? AND owner_id = ? AND parent_id = ?",
    ).all(collection.project_id, LOCAL_OWNER_ID, id);
    const children = sortCollectionRows(childRows);
    const promoted = sortCollectionRows(siblingRows).flatMap(
      (item) => item.id === id ? children : [item],
    );
    const promote = this.db.prepare(
      "UPDATE collections SET parent_id = ?, position = ?, updated_at = ? WHERE id = ?",
    );
    const timestamp = now();
    promoted.forEach((item, index) => promote.run(
      collection.parent_id || null,
      index,
      timestamp,
      item.id,
    ));
    return this.db.prepare(
      "DELETE FROM collections WHERE id = ? AND owner_id = ?",
    ).run(id, LOCAL_OWNER_ID).changes > 0;
  }

  // Takes a row that exists. Callers that may not have one check first, so the
  // return type stays free of null and the interface can promise a batch.
  _formatBatchRow(row) {
    const count = this.db.prepare(
      "SELECT COUNT(*) AS session_count FROM sessions WHERE batch_id = ?",
    ).get(row.id);
    return formatBatch(row, Number(count.session_count) || 0);
  }

  _batchRow(id) {
    return this.db.prepare("SELECT * FROM batches WHERE id = ?").get(id);
  }

  upsertBatch({ id, label, startedAt }) {
    this.db.prepare(`
      INSERT INTO batches (id, label, started_at) VALUES (?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(id, label, startedAt);
    const row = this._batchRow(id);
    // The insert either created the row or found it already there, so a miss
    // means the write did not land: fail loudly instead of returning null.
    if (!row) throw new Error(`Unable to persist the capture batch ${id}`);
    return this._formatBatchRow(row);
  }

  listBatches() {
    const rows = this.db.prepare(`
      SELECT batches.id, batches.label, batches.started_at, batches.finished_at,
        COUNT(sessions.id) AS session_count
      FROM batches
      LEFT JOIN sessions ON sessions.batch_id = batches.id
      GROUP BY batches.id
      ORDER BY batches.started_at DESC
    `).all();
    return rows.map((row) => formatBatch(row, Number(row.session_count) || 0));
  }

  finishBatch(id, finishedAt) {
    const result = this.db.prepare(
      "UPDATE batches SET finished_at = ? WHERE id = ?",
    ).run(finishedAt, id);
    if (!result.changes) return null;
    const row = this._batchRow(id);
    return row ? this._formatBatchRow(row) : null;
  }

  deleteBatch(id) {
    const existing = this.db.prepare("SELECT id FROM batches WHERE id = ?").get(id);
    if (!existing) return false;
    this.db.prepare("UPDATE sessions SET batch_id = NULL WHERE batch_id = ?").run(id);
    this.db.prepare("DELETE FROM batches WHERE id = ?").run(id);
    return true;
  }

  moveSession(id, collectionId) {
    const collection = this.db.prepare(
      "SELECT id FROM collections WHERE id = ? AND owner_id = ?",
    ).get(collectionId, LOCAL_OWNER_ID);
    if (!collection || !this.getSession(id)) return null;
    this.db.prepare(
      "UPDATE sessions SET collection_id = ?, position = ? WHERE id = ?",
    ).run(collectionId, this._nextSessionPosition(collectionId), id);
    return this.getSession(id);
  }

  reorderSessions(collectionId, ids) {
    const update = this.db.prepare(
      "UPDATE sessions SET position = ? WHERE id = ? AND collection_id = ?",
    );
    ids.forEach((id, position) => update.run(position, id, collectionId));
    return this.listSessions({ collectionId, limit: Number.MAX_SAFE_INTEGER });
  }

  getProjectTree() {
    return {
      projects: this.listProjects().map((project) => ({
        ...project,
        collections: this.listCollections(project.id).map((collection) => ({
          ...collection,
          sessions: this.listSessions({ collectionId: collection.id, limit: Number.MAX_SAFE_INTEGER }),
        })),
      })),
    };
  }

  close() {
    this.db.close();
  }

  replaceShotPathPrefix(previous, next) {
    this.db.prepare(`
      UPDATE sessions
      SET shot_path = replace(shot_path, ?, ?)
      WHERE shot_path LIKE ?
    `).run(previous, next, `${previous}%`);
  }
}

export function migrateLegacyHistoryDb(root = pinarHome()) {
  const rootDb = join(root, "history.db");
  if (existsSync(rootDb)) return null;
  const legacyPath = [
    join(root, "bin", "history.sqlite"),
    join(root, "history.sqlite"),
    join(root, "shots", "bin", "history.sqlite"),
    join(root, "shots", "history.sqlite"),
    join(root, "shots", "history.db"),
  ].find((path) => existsSync(path));
  if (!legacyPath) return null;
  mkdirSync(root, { recursive: true });
  renameSync(legacyPath, rootDb);
  return { from: legacyPath, to: rootDb };
}

export function openHistoryDb(root = pinarHome()) {
  migrateLegacyHistoryDb(root);
  const rootDb = join(root, "history.db");
  if (SqliteDatabase) {
    try {
      const db = new SqliteHistoryDb(rootDb);
      db.replaceShotPathPrefix(`${shotsDir(shotsDir(root))}${sep}`, `${shotsDir(root)}${sep}`);
      return db;
    } catch (error) {
      console.warn("Could not initialize SQLite history db, using JSON fallback", error);
    }
  }
  const db = new JsonHistoryDb(join(root, "history.json"));
  db.replaceShotPathPrefix(`${shotsDir(shotsDir(root))}${sep}`, `${shotsDir(root)}${sep}`);
  return db;
}
