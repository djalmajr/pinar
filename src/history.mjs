import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { pinarHome, shotsDir } from "./paths.mjs";

let SqliteDatabase = null;
try {
  const sqlite = await import("node:sqlite");
  SqliteDatabase = sqlite.DatabaseSync;
} catch {
  SqliteDatabase = null;
}

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz-";
function generateNanoId(size = 12) {
  const bytes = new Uint8Array(size);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < size; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let id = "";
  for (let i = 0; i < size; i++) id += ALPHABET[bytes[i] & 63];
  return id;
}

class JsonHistoryDb {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.data = this._load();
  }

  _load() {
    try {
      if (existsSync(this.dbPath)) {
        return JSON.parse(readFileSync(this.dbPath, "utf8")) || [];
      }
    } catch {
      /* ignore corrupted json */
    }
    return [];
  }

  _save() {
    try {
      mkdirSync(join(this.dbPath, ".."), { recursive: true });
      writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2), "utf8");
    } catch (error) {
      console.warn("Failed to write history json", error);
    }
  }

  saveSession({ createdAt, id, page = {}, pins = [], shotId = null, shotPath = null }) {
    const entry = {
      created_at: createdAt || new Date().toISOString(),
      id: id || generateNanoId(12),
      pin_count: pins.length,
      pins_json: JSON.stringify(pins),
      shot_id: shotId,
      shot_path: shotPath,
      title: page.title || "(untitled)",
      url: page.url || "",
    };
    this.data = [entry, ...this.data.filter((item) => item.id !== entry.id)];
    this._save();
    return this._format(entry);
  }

  listSessions({ limit = 50, offset = 0, query = "" } = {}) {
    let results = this.data;
    if (query) {
      const q = query.toLowerCase();
      results = results.filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.url.toLowerCase().includes(q) ||
          item.pins_json.toLowerCase().includes(q),
      );
    }
    return results.slice(offset, offset + limit).map((row) => this._format(row));
  }

  getSession(id) {
    const row = this.data.find((item) => item.id === id);
    return row ? this._format(row) : null;
  }

  deleteSession(id) {
    const prevLen = this.data.length;
    this.data = this.data.filter((item) => item.id !== id);
    this._save();
    return prevLen !== this.data.length;
  }

  clearHistory() {
    this.data = [];
    this._save();
    return true;
  }

  close() {}

  replaceShotPathPrefix(previous, next) {
    let changed = false;
    this.data = this.data.map((entry) => {
      if (!entry.shot_path?.startsWith(previous)) return entry;
      changed = true;
      return { ...entry, shot_path: `${next}${entry.shot_path.slice(previous.length)}` };
    });
    if (changed) this._save();
  }

  _format(row) {
    let pins = [];
    try {
      pins = JSON.parse(row.pins_json);
    } catch {
      pins = [];
    }
    return {
      createdAt: row.created_at,
      id: row.id,
      page: { title: row.title, url: row.url },
      pinCount: row.pin_count,
      pins,
      shotId: row.shot_id,
      shotPath: row.shot_path,
    };
  }
}

class SqliteHistoryDb {
  constructor(dbPath) {
    mkdirSync(join(dbPath, ".."), { recursive: true });
    this.db = new SqliteDatabase(dbPath);
    this._initSchema();
  }

  _initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        url TEXT,
        title TEXT,
        shot_id TEXT,
        shot_path TEXT,
        pin_count INTEGER,
        pins_json TEXT,
        created_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at DESC);
    `);
  }

  saveSession({ createdAt, id, page = {}, pins = [], shotId = null, shotPath = null }) {
    const sid = id || generateNanoId(12);
    const url = page.url || "";
    const title = page.title || "(untitled)";
    const pinsJson = JSON.stringify(pins);
    const pinCount = pins.length;
    const when = createdAt || new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, url, title, shot_id, shot_path, pin_count, pins_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        url=excluded.url,
        title=excluded.title,
        shot_id=excluded.shot_id,
        shot_path=excluded.shot_path,
        pin_count=excluded.pin_count,
        pins_json=excluded.pins_json,
        created_at=excluded.created_at
    `);
    stmt.run(sid, url, title, shotId, shotPath, pinCount, pinsJson, when);

    return this.getSession(sid);
  }

  listSessions({ limit = 50, offset = 0, query = "" } = {}) {
    let rows = [];
    if (query) {
      const pattern = `%${query}%`;
      const stmt = this.db.prepare(`
        SELECT id, url, title, shot_id, shot_path, pin_count, pins_json, created_at
        FROM sessions
        WHERE title LIKE ? OR url LIKE ? OR pins_json LIKE ?
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `);
      rows = stmt.all(pattern, pattern, pattern, limit, offset);
    } else {
      const stmt = this.db.prepare(`
        SELECT id, url, title, shot_id, shot_path, pin_count, pins_json, created_at
        FROM sessions
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `);
      rows = stmt.all(limit, offset);
    }
    return rows.map((row) => this._format(row));
  }

  getSession(id) {
    const stmt = this.db.prepare(`
      SELECT id, url, title, shot_id, shot_path, pin_count, pins_json, created_at
      FROM sessions
      WHERE id = ?
    `);
    const row = stmt.get(id);
    return row ? this._format(row) : null;
  }

  deleteSession(id) {
    const stmt = this.db.prepare("DELETE FROM sessions WHERE id = ?");
    const result = stmt.run(id);
    return result.changes > 0;
  }

  clearHistory() {
    this.db.exec("DELETE FROM sessions;");
    return true;
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

  _format(row) {
    let pins = [];
    try {
      pins = JSON.parse(row.pins_json);
    } catch {
      pins = [];
    }
    return {
      createdAt: row.created_at,
      id: row.id,
      page: { title: row.title, url: row.url },
      pinCount: row.pin_count,
      pins,
      shotId: row.shot_id,
      shotPath: row.shot_path,
    };
  }
}

export function migrateLegacyHistoryDb(root = pinarHome()) {
  const binDir = join(root, "bin");
  const binSqlite = join(binDir, "history.sqlite");
  const rootSqlite = join(root, "history.sqlite");
  const rootDb = join(root, "history.db");
  if (existsSync(binSqlite) || existsSync(rootSqlite) || existsSync(rootDb)) return null;

  const legacyPath = [
    join(root, "shots", "bin", "history.sqlite"),
    join(root, "shots", "history.sqlite"),
    join(root, "shots", "history.db"),
  ].find((path) => existsSync(path));
  if (!legacyPath) return null;

  mkdirSync(binDir, { recursive: true });
  renameSync(legacyPath, binSqlite);
  return { from: legacyPath, to: binSqlite };
}

export function openHistoryDb(root = pinarHome()) {
  migrateLegacyHistoryDb(root);
  const binDir = join(root, "bin");
  const binSqlite = join(binDir, "history.sqlite");
  const rootSqlite = join(root, "history.sqlite");
  const rootDb = join(root, "history.db");

  let targetPath = binSqlite;
  if (!existsSync(binSqlite) && (existsSync(rootSqlite) || existsSync(rootDb))) {
    targetPath = existsSync(rootSqlite) ? rootSqlite : rootDb;
  } else if (!existsSync(binDir)) {
    try {
      mkdirSync(binDir, { recursive: true });
      targetPath = binSqlite;
    } catch {
      targetPath = rootSqlite;
    }
  }

  if (SqliteDatabase) {
    try {
      const db = new SqliteHistoryDb(targetPath);
      db.replaceShotPathPrefix(`${shotsDir(shotsDir(root))}${sep}`, `${shotsDir(root)}${sep}`);
      return db;
    } catch (error) {
      console.warn("Could not initialize SQLite history db, using JSON fallback", error);
    }
  }
  const db = new JsonHistoryDb(join(root, "bin", "history.json"));
  db.replaceShotPathPrefix(`${shotsDir(shotsDir(root))}${sep}`, `${shotsDir(root)}${sep}`);
  return db;
}
