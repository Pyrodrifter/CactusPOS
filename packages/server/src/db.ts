import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DB = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS staff (id TEXT PRIMARY KEY, name TEXT NOT NULL, pin TEXT NOT NULL UNIQUE, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS tax_categories (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS menu_categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS menu_items (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  ticket_number INTEGER NOT NULL,
  receipt_number INTEGER UNIQUE,
  business_date TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_date ON orders(business_date);
-- Append-only audit trail. Nothing is ever edited or deleted.
CREATE TABLE IF NOT EXISTS order_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS order_events_no_update BEFORE UPDATE ON order_events
BEGIN SELECT RAISE(ABORT, 'order_events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS order_events_no_delete BEFORE DELETE ON order_events
BEGIN SELECT RAISE(ABORT, 'order_events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS orders_no_delete BEFORE DELETE ON orders
BEGIN SELECT RAISE(ABORT, 'orders cannot be deleted; void them'); END;
`;

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL;');
  db.exec(SCHEMA);
  return db;
}

/** Run fn in an immediate transaction (serialises writers). */
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

export function nextCounter(db: DB, name: string): number {
  db.prepare('INSERT OR IGNORE INTO counters(name, value) VALUES (?, 0)').run(name);
  const row = db.prepare('UPDATE counters SET value = value + 1 WHERE name = ? RETURNING value').get(name) as { value: number };
  return row.value;
}

export function getKv<T>(db: DB, key: string, fallback: T): T {
  const row = db.prepare('SELECT v FROM kv WHERE k = ?').get(key) as { v: string } | undefined;
  return row ? (JSON.parse(row.v) as T) : fallback;
}
export function setKv(db: DB, key: string, value: unknown): void {
  db.prepare('INSERT INTO kv(k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(key, JSON.stringify(value));
}
