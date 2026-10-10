import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DB = DatabaseSync;

/**
 * Schema history. Each entry runs once, in order, inside a transaction; `PRAGMA user_version`
 * records how far a database has got. Never edit a migration that has shipped: add a new one.
 * The shape after all migrations is documented in docs/coordination/contracts/database.md.
 */
interface Migration { version: number; name: string; up(db: DB): void }

const appendOnly = (table: string, key: string) => `
CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT, '${table} is append-only'); END;
CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT, '${table} is append-only'); END;
-- INSERT OR REPLACE deletes the old row without firing DELETE triggers unless recursive_triggers is on
-- for that connection. Refusing the insert itself protects the row whatever the connection settings.
CREATE TRIGGER ${table}_no_replace BEFORE INSERT ON ${table}
WHEN EXISTS (SELECT 1 FROM ${table} WHERE ${key} = NEW.${key})
BEGIN SELECT RAISE(ABORT, '${table} is append-only'); END;`;

const MIGRATIONS: Migration[] = [
  {
    // IF NOT EXISTS throughout: databases created before migrations existed already have these.
    version: 1, name: 'base',
    up: (db) => db.exec(`
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS staff (id TEXT PRIMARY KEY, name TEXT NOT NULL, pin TEXT NOT NULL UNIQUE, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, staff_id TEXT NOT NULL, created_at TEXT NOT NULL);
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
CREATE TABLE IF NOT EXISTS order_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS order_events_no_update BEFORE UPDATE ON order_events BEGIN SELECT RAISE(ABORT, 'order_events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS order_events_no_delete BEFORE DELETE ON order_events BEGIN SELECT RAISE(ABORT, 'order_events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS orders_no_delete BEFORE DELETE ON orders BEGIN SELECT RAISE(ABORT, 'orders cannot be deleted; void them'); END;
CREATE TABLE IF NOT EXISTS audit_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, payload TEXT NOT NULL, staff_id TEXT NOT NULL, at TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_log_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;`),
  },
  {
    /**
     * Makes the sales record tamper-resistant at the database level:
     *  - payments get their own append-only table (before, the only complete copy sat in editable order JSON);
     *  - INSERT OR REPLACE can no longer swap out an order, event, payment or audit row;
     *  - an order's identity, receipt number and existing payments cannot be rewritten;
     *  - counters only go up.
     */
    version: 2, name: 'ledger-hardening',
    up: (db) => {
      db.exec(`
CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  receipt_number INTEGER NOT NULL,
  method TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  tendered_cents INTEGER,
  change_cents INTEGER,
  tip_cents INTEGER NOT NULL DEFAULT 0,
  reference TEXT,
  staff_id TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX payments_order ON payments(order_id);
${appendOnly('payments', 'id')}
CREATE TRIGGER order_events_no_replace BEFORE INSERT ON order_events
WHEN EXISTS (SELECT 1 FROM order_events WHERE seq = NEW.seq)
BEGIN SELECT RAISE(ABORT, 'order_events is append-only'); END;
CREATE TRIGGER audit_log_no_replace BEFORE INSERT ON audit_log
WHEN EXISTS (SELECT 1 FROM audit_log WHERE seq = NEW.seq)
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

CREATE TRIGGER orders_no_replace BEFORE INSERT ON orders
WHEN EXISTS (SELECT 1 FROM orders WHERE id = NEW.id)
  OR (NEW.receipt_number IS NOT NULL AND EXISTS (SELECT 1 FROM orders WHERE receipt_number = NEW.receipt_number))
BEGIN SELECT RAISE(ABORT, 'orders cannot be replaced'); END;
CREATE TRIGGER orders_identity_fixed BEFORE UPDATE ON orders
WHEN NEW.id IS NOT OLD.id OR NEW.ticket_number IS NOT OLD.ticket_number
  OR NEW.business_date IS NOT OLD.business_date OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'an order''s id, ticket number and date cannot change'); END;
CREATE TRIGGER orders_receipt_fixed BEFORE UPDATE ON orders
WHEN OLD.receipt_number IS NOT NULL AND NEW.receipt_number IS NOT OLD.receipt_number
BEGIN SELECT RAISE(ABORT, 'a receipt number cannot change once issued'); END;
CREATE TRIGGER orders_payments_kept BEFORE UPDATE ON orders
WHEN NOT json_valid(NEW.data)
  OR json_type(NEW.data, '$.payments') IS NOT 'array'
  OR json_array_length(NEW.data, '$.payments') < json_array_length(OLD.data, '$.payments')
  OR json_array_length(NEW.data, '$.payments') < (SELECT COUNT(*) FROM payments WHERE order_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'payments cannot be removed from an order'); END;

CREATE TRIGGER counters_no_decrease BEFORE UPDATE ON counters
WHEN NEW.value < OLD.value OR NEW.name IS NOT OLD.name
BEGIN SELECT RAISE(ABORT, 'counters only go up'); END;
CREATE TRIGGER counters_no_delete BEFORE DELETE ON counters BEGIN SELECT RAISE(ABORT, 'counters cannot be deleted'); END;

-- Lets a retried request (double tap, lost reply) return the first result instead of acting twice.
CREATE TABLE requests (key TEXT PRIMARY KEY, kind TEXT NOT NULL, order_id TEXT NOT NULL, at TEXT NOT NULL);`);

      // Copy payments that so far lived only inside order JSON into the protected table.
      const rows = db.prepare("SELECT id, receipt_number, data FROM orders WHERE json_array_length(data, '$.payments') > 0").all() as { id: string; receipt_number: number | null; data: string }[];
      const insert = db.prepare('INSERT INTO payments(id, order_id, receipt_number, method, amount_cents, tendered_cents, change_cents, tip_cents, reference, staff_id, at) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
      for (const r of rows) {
        const order = JSON.parse(r.data) as { createdBy?: string; payments: { id: string; method: string; amountCents: number; tenderedCents?: number; changeCents?: number; tipCents?: number; reference?: string; at: string }[] };
        for (const p of order.payments) {
          insert.run(p.id, r.id, r.receipt_number ?? 0, p.method, p.amountCents, p.tenderedCents ?? null, p.changeCents ?? null, p.tipCents ?? 0, p.reference ?? null, order.createdBy ?? 'unknown', p.at);
        }
      }
    },
  },
  {
    /** Closed days. A Z report is a legal-style record: numbered, never changed, never removed. */
    version: 3, name: 'z-reports',
    up: (db) => db.exec(`
CREATE TABLE z_reports (number INTEGER PRIMARY KEY, business_date TEXT NOT NULL, closed_at TEXT NOT NULL, closed_by TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX z_reports_date ON z_reports(business_date);
${appendOnly('z_reports', 'number')}`),
  },
];

MIGRATIONS.push({ version: 4, name: 'receipt-design-versions', up: (db) => {
  db.exec(`CREATE TABLE receipt_templates (version INTEGER PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL, staff_id TEXT NOT NULL); ${appendOnly('receipt_templates', 'version')}`);
} });

/** The business date of a moment in a time zone, the way `PosService.businessDate` names it. */
function dateIn(timeZone: string, iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(iso));
}

MIGRATIONS.push({
  /**
   * Records the day the money moved on each order, so day reports count a sale on the day it was paid
   * and a refund on the day it was handed back (before, both landed on the day the order was opened).
   * Like a receipt number, neither date can change once it is set.
   */
  version: 5, name: 'money-dates',
  up: (db) => {
    db.exec(`ALTER TABLE orders ADD COLUMN paid_date TEXT;
ALTER TABLE orders ADD COLUMN void_date TEXT;
CREATE INDEX orders_paid_date ON orders(paid_date);
CREATE INDEX orders_void_date ON orders(void_date);`);
    // Orders already in the database: the payment time and the time of the void event say which day it was.
    let zone = 'America/Kralendijk';
    try {
      const row = db.prepare("SELECT v FROM kv WHERE k = 'business'").get() as { v: string } | undefined;
      const saved = (JSON.parse(row?.v ?? '{}') as { timezone?: string }).timezone;
      if (saved) { dateIn(saved, '2026-01-01T00:00:00Z'); zone = saved; }
    } catch { /* an unusable saved zone: keep the default */ }
    const paid = db.prepare('SELECT order_id, MIN(at) AS at FROM payments GROUP BY order_id').all() as { order_id: string; at: string }[];
    const setPaid = db.prepare('UPDATE orders SET paid_date = ? WHERE id = ?');
    for (const p of paid) setPaid.run(dateIn(zone, p.at), p.order_id);
    const voided = db.prepare(`SELECT o.id AS id,
      COALESCE((SELECT MAX(e.at) FROM order_events e WHERE e.order_id = o.id AND e.type = 'order.void'), json_extract(o.data, '$.updatedAt')) AS at
      FROM orders o WHERE json_extract(o.data, '$.status') = 'void'`).all() as { id: string; at: string | null }[];
    const setVoid = db.prepare('UPDATE orders SET void_date = ? WHERE id = ?');
    for (const v of voided) if (v.at) setVoid.run(dateIn(zone, v.at), v.id);
    db.exec(`CREATE TRIGGER orders_money_dates_fixed BEFORE UPDATE ON orders
WHEN (OLD.paid_date IS NOT NULL AND NEW.paid_date IS NOT OLD.paid_date)
  OR (OLD.void_date IS NOT NULL AND NEW.void_date IS NOT OLD.void_date)
BEGIN SELECT RAISE(ABORT, 'the day an order was paid or voided cannot change once recorded'); END;`);
  },
});

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

export function schemaVersion(db: DB): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
}

/** Brings a database up to the current schema. Safe to run on every start. */
export function migrate(db: DB, upTo = SCHEMA_VERSION): void {
  const current = schemaVersion(db);
  if (current > SCHEMA_VERSION) {
    throw new Error(`This database is at schema version ${current}, newer than this program understands (${SCHEMA_VERSION}). Update CactusPOS rather than opening it with an older copy.`);
  }
  for (const m of MIGRATIONS) {
    if (m.version <= current || m.version > upTo) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      m.up(db);
      db.exec(`PRAGMA user_version = ${m.version}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`Database migration ${m.version} (${m.name}) failed and was rolled back: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
    }
  }
}

export interface OpenOptions {
  /** How long a write waits for another program's write to finish before giving up. */
  busyTimeoutMs?: number;
  /** Tests only: stop at an older schema version. */
  migrateTo?: number;
}

export function openDb(path: string, opts: OpenOptions = {}): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL; PRAGMA recursive_triggers = ON; PRAGMA busy_timeout = ${Math.max(0, Math.floor(opts.busyTimeoutMs ?? 5000))};`);
  try { migrate(db, opts.migrateTo); } catch (e) { db.close(); throw e; } // do not keep a half-opened file locked
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
