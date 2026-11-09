import type { DatabaseSync as DatabaseSyncT } from 'node:sqlite';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

// Loaded via require: bundlers (Vite/esbuild) don't all know the `node:sqlite` builtin yet.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

export type DB = DatabaseSyncT;

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS licenses (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     key TEXT NOT NULL UNIQUE,
     email TEXT NOT NULL,
     seats INTEGER NOT NULL,
     plan TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'active',
     revoked_reason TEXT,
     session_id TEXT UNIQUE,
     payment_intent TEXT,
     created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
     updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
   )`,
  `CREATE INDEX IF NOT EXISTS licenses_email ON licenses(email)`,
  `CREATE INDEX IF NOT EXISTS licenses_pi ON licenses(payment_intent)`,
  `CREATE TABLE IF NOT EXISTS activations (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     license_id INTEGER NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
     device TEXT NOT NULL,
     name TEXT,
     platform TEXT,
     app_version TEXT,
     created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
     last_seen TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
     UNIQUE(license_id, device)
   )`,
  `CREATE TABLE IF NOT EXISTS checkout_sessions (
     id TEXT PRIMARY KEY,
     provider TEXT NOT NULL,
     plan TEXT NOT NULL,
     email TEXT,
     upgrade_license_id INTEGER,
     status TEXT NOT NULL DEFAULT 'open',
     license_id INTEGER,
     created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
   )`,
  `CREATE TABLE IF NOT EXISTS webhook_events (
     id TEXT PRIMARY KEY,
     type TEXT NOT NULL,
     received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
   )`,
  `CREATE TABLE IF NOT EXISTS offers (
     email TEXT PRIMARY KEY,
     code TEXT,
     sent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
   )`,
  `CREATE TABLE IF NOT EXISTS outbox (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     "to" TEXT NOT NULL,
     subject TEXT NOT NULL,
     text TEXT NOT NULL,
     html TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
   )`,
];

export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  for (const m of MIGRATIONS) db.exec(m);
  return db;
}

/** Run fn inside a transaction (node:sqlite has no helper). */
export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
