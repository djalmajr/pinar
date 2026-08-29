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

function formatSession(row) {
  const capture = decodeVisualCaptureJson(row.pins_json, row.id);
  return {
    captureId: capture.captureId,
    collectionId: row.collection_id,
    createdAt: row.created_at,
    id: row.id,
    page: {
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
        if (Array.isArray(stored)) return { collections: [], projects: [], sessions: stored };
        if (stored && typeof stored === "object") {
          return {
            collections: Array.isArray(stored.collections) ? stored.collections : [],
            projects: Array.isArray(stored.projects) ? stored.projects : [],
            sessions: Array.isArray(stored.sessions) ? stored.sessions : [],
          };
        }
      }
    } catch {
      // A corrupt fallback should not prevent the local server from starting.
    }
    return { collections: [], projects: [], sessions: [] };
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
  saveSession({ collectionId, createdAt, id, page = {}, pins = [], privacy, shotId = null, shotPath = null, warnings } = {}) {
    const destination = this.resolveDestination(collectionId);
    const existing = id ? this.data.sessions.find((item) => item.id === id) : null;
    const sid = id || generateNanoId();
    const capture = captureForSave(sid, page, pins, shotId, shotPath, { privacy, warnings });
    const entry = {
      collection_id: destination.collectionId,
      created_at: createdAt || now(),
      id: capture.captureId,
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
    this._save();
    return formatSession(entry);
  }

  listSessions({ collectionId = "", limit = 50, offset = 0, query = "" } = {}) {
    let results = this.data.sessions;
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
    return results.slice(offset, offset + limit).map(formatSession);
  }

  getSession(id) {
    const row = this.data.sessions.find((item) => item.id === id);
    return row ? formatSession(row) : null;
  }

  deleteSession(id) {
    const previousLength = this.data.sessions.length;
    this.data.sessions = this.data.sessions.filter((item) => item.id !== id);
    this._save();
    return previousLength !== this.data.sessions.length;
  }

  clearHistory() {
    this.data.sessions = [];
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
        position INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_projects_owner_position ON projects(owner_id, position);
      CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at DESC);
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
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_sessions_collection_position ON sessions(collection_id, position);");
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
  saveSession({ collectionId, createdAt, id, page = {}, pins = [], privacy, shotId = null, shotPath = null, warnings } = {}) {
    const sid = id || generateNanoId();
    const destination = this.resolveDestination(collectionId);
    const existing = this.db.prepare("SELECT collection_id, position FROM sessions WHERE id = ?").get(sid);
    const position = existing?.collection_id === destination.collectionId
      ? existing.position
      : this._nextSessionPosition(destination.collectionId);
    const capture = captureForSave(sid, page, pins, shotId, shotPath, { privacy, warnings });
    this.db.prepare(`
      INSERT INTO sessions (
        id, url, title, shot_id, shot_path, pin_count, pins_json, created_at, collection_id, position
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        url=excluded.url,
        title=excluded.title,
        shot_id=excluded.shot_id,
        shot_path=excluded.shot_path,
        pin_count=excluded.pin_count,
        pins_json=excluded.pins_json,
        created_at=excluded.created_at,
        collection_id=excluded.collection_id,
        position=excluded.position
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
      position,
    );
    const session = this.getSession(capture.captureId);
    if (!session) throw new Error(`Failed to save history session ${sid}`);
    return session;
  }

  listSessions({ collectionId = "", limit = 50, offset = 0, query = "" } = {}) {
    const clauses = [];
    const values = [];
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
      SELECT id, url, title, shot_id, shot_path, pin_count, pins_json, created_at, collection_id, position
      FROM sessions
      ${where}
      ORDER BY ${order}
      LIMIT ? OFFSET ?
    `).all(...values, limit, offset);
    return rows.map(formatSession);
  }

  getSession(id) {
    const row = this.db.prepare(`
      SELECT id, url, title, shot_id, shot_path, pin_count, pins_json, created_at, collection_id, position
      FROM sessions WHERE id = ?
    `).get(id);
    return row ? formatSession(row) : null;
  }

  deleteSession(id) {
    return this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id).changes > 0;
  }

  clearHistory() {
    this.db.exec("DELETE FROM sessions;");
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
