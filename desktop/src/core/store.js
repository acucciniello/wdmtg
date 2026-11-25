// Local SQLite store. Everything stays on this computer.
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS segments (
  id      INTEGER PRIMARY KEY,
  source  TEXT NOT NULL,          -- mac | mac-history | iphone | call | manual | motion | place
  device  TEXT,
  start   INTEGER NOT NULL,       -- unix ms
  end     INTEGER NOT NULL,       -- unix ms
  app     TEXT,                   -- display name
  bundle  TEXT,                   -- bundle id / executable
  title   TEXT,                   -- window title / contact / place
  url     TEXT,
  idle    INTEGER NOT NULL DEFAULT 0,
  bucket  TEXT,                   -- only for manual entries: the bucket the user picked
  ext_id  TEXT UNIQUE             -- dedupe key for imported rows
);
CREATE INDEX IF NOT EXISTS seg_time ON segments(start, end);
CREATE TABLE IF NOT EXISTS rules (
  key     TEXT PRIMARY KEY,       -- app:<id> | site:<domain> | person:<id> | activity:<name>
  bucket  TEXT NOT NULL,
  label   TEXT
);
CREATE TABLE IF NOT EXISTS names (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
`;

export class Store {
  constructor(file = ':memory:') {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    this.db.exec(SCHEMA);
    this._insert = this.db.prepare(
      `INSERT INTO segments (source, device, start, end, app, bundle, title, url, idle, bucket, ext_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    this._upsert = this.db.prepare(
      `INSERT INTO segments (source, device, start, end, app, bundle, title, url, idle, bucket, ext_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(ext_id) DO UPDATE SET start = excluded.start, end = excluded.end, app = excluded.app,
         title = excluded.title, bucket = excluded.bucket`
    );
    this._setEnd = this.db.prepare('UPDATE segments SET end = ? WHERE id = ?');
    this._range = this.db.prepare(
      'SELECT * FROM segments WHERE end > ? AND start < ? ORDER BY start'
    );
  }

  close() {
    this.db.close();
  }

  #args(s) {
    return [
      s.source, s.device ?? null, Math.round(s.start), Math.round(s.end), s.app ?? null,
      s.bundle ?? null, s.title ?? null, s.url ?? null, s.idle ? 1 : 0, s.bucket ?? null,
      s.extId ?? null,
    ];
  }

  /** Insert a segment, returns its row id. */
  add(s) {
    return Number(this._insert.run(...this.#args(s)).lastInsertRowid);
  }

  /** Insert or update an imported segment keyed by extId. */
  upsert(s) {
    if (!s.extId) throw new Error('upsert needs extId');
    this._upsert.run(...this.#args(s));
  }

  upsertMany(list) {
    this.db.exec('BEGIN');
    try {
      for (const s of list) this.upsert(s);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return list.length;
  }

  setEnd(id, end) {
    this._setEnd.run(Math.round(end), id);
  }

  remove(id) {
    this.db.prepare('DELETE FROM segments WHERE id = ?').run(id);
  }

  /** All segments overlapping [from, to). */
  range(from, to) {
    return this._range.all(from, to);
  }

  earliest() {
    const row = this.db.prepare('SELECT MIN(start) AS t FROM segments').get();
    return row?.t ?? null;
  }

  latest(source) {
    const row = this.db.prepare('SELECT MAX(end) AS t FROM segments WHERE source = ?').get(source);
    return row?.t ?? null;
  }

  count(source) {
    return this.db.prepare('SELECT COUNT(*) AS n FROM segments WHERE source = ?').get(source).n;
  }

  // --- rules the user has set by sorting apps/sites/people ---
  rules() {
    const out = new Map();
    for (const r of this.db.prepare('SELECT key, bucket, label FROM rules').all()) out.set(r.key, r);
    return out;
  }

  setRule(key, bucket, label = null) {
    this.db
      .prepare(
        `INSERT INTO rules (key, bucket, label) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET bucket = excluded.bucket, label = COALESCE(excluded.label, rules.label)`
      )
      .run(key, bucket, label);
  }

  clearRule(key) {
    this.db.prepare('DELETE FROM rules WHERE key = ?').run(key);
  }

  // --- friendly names for bundle ids ---
  name(id) {
    const name = this.db.prepare('SELECT name FROM names WHERE id = ?').get(id)?.name;
    return name && name !== id ? name : null; // a miss is remembered as the id itself
  }

  setName(id, name) {
    this.db
      .prepare('INSERT INTO names (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name')
      .run(id, name);
  }

  // --- small settings ---
  get(k, fallback = null) {
    const row = this.db.prepare('SELECT v FROM kv WHERE k = ?').get(k);
    return row ? JSON.parse(row.v) : fallback;
  }

  set(k, v) {
    this.db
      .prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
      .run(k, JSON.stringify(v));
  }
}
