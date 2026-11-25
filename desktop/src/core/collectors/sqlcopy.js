// Apple's databases are live and owned by system services. We never open them
// in place: we copy the file (and its write-ahead log) and read the copy.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function withCopy(dbPath, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdmtg-'));
  const copy = path.join(dir, 'db.sqlite');
  try {
    fs.copyFileSync(dbPath, copy);
    if (fs.existsSync(dbPath + '-wal')) fs.copyFileSync(dbPath + '-wal', copy + '-wal');
    const db = new DatabaseSync(copy);
    try {
      return fn(db);
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function columns(db, table) {
  return db.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name);
}

export function tables(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
}

/** Seconds since 2001-01-01 (Apple's epoch) to unix ms. */
export const appleToMs = (s) => Math.round((s + 978307200) * 1000);
