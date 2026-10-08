import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Order, ServerEventSchema, AuditList, Ack } from '@cactus/shared';
import { migrate, openDb, schemaVersion, SCHEMA_VERSION, type DB } from './db.js';
import { PosService, type Staff } from './service.js';
import { seedSample } from './seedData.js';
import { buildApp } from './app.js';

const staff: Staff = { id: 'staff1', name: 'Staff', role: 'staff' };
const owner: Staff = { id: 'owner', name: 'Owner', role: 'owner' };
const fries = { lines: [{ itemId: 'fries', qty: 1, modifierOptionIds: [] }], source: 'pos' as const };
const cash = { method: 'cash' as const, tenderedCents: 1000, tipCents: 0 };

let dir: string;
let db: DB;
let svc: PosService;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cactus-ledger-')); db = openDb(join(dir, 'pos.sqlite')); seedSample(db); svc = new PosService(db); });
afterEach(() => { try { db.close(); } catch { /* already closed */ } rmSync(dir, { recursive: true, force: true }); });

describe('the sales record cannot be rewritten', () => {
  it('INSERT OR REPLACE cannot swap out an order, an event, a payment or an audit row', () => {
    const o = svc.pay(svc.createOrder(fries, staff).id, cash, staff);
    const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(o.id) as Record<string, string | number>;
    // same receipt number under another id (the reviewer's reproduction)
    expect(() => db.prepare('INSERT OR REPLACE INTO orders(id, ticket_number, receipt_number, business_date, data, created_at) VALUES (?,?,?,?,?,?)')
      .run('replacement', row.ticket_number!, row.receipt_number!, row.business_date!, row.data!, row.created_at!)).toThrow(/cannot be replaced/);
    expect(() => db.prepare('INSERT OR REPLACE INTO orders(id, ticket_number, receipt_number, business_date, data, created_at) VALUES (?,?,?,?,?,?)')
      .run(o.id, 99, null, row.business_date!, '{}', row.created_at!)).toThrow(/cannot be replaced/);
    const ev = db.prepare('SELECT * FROM order_events WHERE order_id = ? ORDER BY seq DESC').get(o.id) as Record<string, string | number>;
    expect(() => db.prepare('INSERT OR REPLACE INTO order_events(seq, order_id, type, payload, staff_id, at) VALUES (?,?,?,?,?,?)')
      .run(ev.seq!, ev.order_id!, 'rewritten', '{}', ev.staff_id!, ev.at!)).toThrow(/append-only/);
    const pay = db.prepare('SELECT * FROM payments WHERE order_id = ?').get(o.id) as Record<string, string | number>;
    expect(() => db.prepare('INSERT OR REPLACE INTO payments(id, order_id, receipt_number, method, amount_cents, staff_id, at) VALUES (?,?,?,?,?,?,?)')
      .run(pay.id!, o.id, 1, 'cash', 1, 'x', pay.at!)).toThrow(/append-only/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM orders').get()).toEqual({ n: 1 });
    expect((db.prepare('SELECT type FROM order_events WHERE seq = ?').get(ev.seq!) as { type: string }).type).toBe('order.paid');
  });

  it('holds on a connection that did not turn recursive triggers on', () => {
    const o = svc.pay(svc.createOrder(fries, staff).id, cash, staff);
    const raw = new DatabaseSync(join(dir, 'pos.sqlite'));
    expect((raw.prepare('PRAGMA recursive_triggers').get() as { recursive_triggers: number }).recursive_triggers).toBe(0);
    const row = raw.prepare('SELECT * FROM orders WHERE id = ?').get(o.id) as Record<string, string | number>;
    expect(() => raw.prepare('INSERT OR REPLACE INTO orders(id, ticket_number, receipt_number, business_date, data, created_at) VALUES (?,?,?,?,?,?)')
      .run('replacement', row.ticket_number!, row.receipt_number!, row.business_date!, row.data!, row.created_at!)).toThrow(/cannot be replaced/);
    expect(() => raw.exec('DELETE FROM payments')).toThrow(/append-only/);
    raw.close();
  });

  it('payments cannot be removed or edited, receipt numbers and identity cannot change', () => {
    const o = svc.pay(svc.createOrder(fries, staff).id, cash, staff);
    expect(() => db.prepare("UPDATE orders SET data = json_set(data, '$.payments', json('[]')) WHERE id = ?").run(o.id)).toThrow(/payments cannot be removed/);
    expect(() => db.prepare("UPDATE orders SET data = '{}' WHERE id = ?").run(o.id)).toThrow(/payments cannot be removed/);
    expect(() => db.prepare("UPDATE orders SET data = 'not json' WHERE id = ?").run(o.id)).toThrow(/payments cannot be removed/);
    expect(() => db.prepare('UPDATE orders SET receipt_number = 77 WHERE id = ?').run(o.id)).toThrow(/receipt number cannot change/);
    expect(() => db.prepare('UPDATE orders SET receipt_number = NULL WHERE id = ?').run(o.id)).toThrow(/receipt number cannot change/);
    expect(() => db.prepare('UPDATE orders SET ticket_number = 500 WHERE id = ?').run(o.id)).toThrow(/cannot change/);
    expect(() => db.exec('UPDATE payments SET amount_cents = 1')).toThrow(/append-only/);
    expect(() => db.exec('DELETE FROM payments')).toThrow(/append-only/);
    expect(() => db.exec("UPDATE counters SET value = 0 WHERE name = 'receipt'")).toThrow(/only go up/);
    expect(() => db.exec('DELETE FROM counters')).toThrow(/cannot be deleted/);
    expect(svc.getOrder(o.id).payments).toHaveLength(1);
    expect(svc.verifyLedger()).toEqual([]);
  });

  it('the payments table holds the complete payment, not a summary', () => {
    const o = svc.pay(svc.createOrder(fries, staff).id, { method: 'card', reference: 'AUTH-7', tipCents: 25 }, staff);
    expect(db.prepare('SELECT order_id, receipt_number, method, amount_cents, tip_cents, reference, staff_id FROM payments').get())
      .toEqual({ order_id: o.id, receipt_number: 1, method: 'card', amount_cents: 500, tip_cents: 25, reference: 'AUTH-7', staff_id: 'staff1' });
    expect((db.prepare('SELECT id, at FROM payments').get() as { id: string; at: string })).toEqual({ id: o.payments[0]!.id, at: o.payments[0]!.at });
  });
});

describe('a sale can be rebuilt from the event log alone', () => {
  it('survives menu and price changes, and a damaged order row is detected and repaired', async () => {
    const { app, admin } = buildApp(db, { webDist: '/nonexistent' });
    const created = svc.createOrder({ lines: [{ itemId: 'burger', qty: 2, modifierOptionIds: ['cheese'] }], source: 'pos' }, staff);
    const paid = svc.pay(created.id, { method: 'cash', tenderedCents: 5000, tipCents: 0 }, staff);
    // Today's menu no longer matches what was sold.
    admin.deleteItem('burger', owner);
    db.prepare("UPDATE tax_categories SET data = json_set(data, '$.rates[0].bps', 900) WHERE id = 'service_6'").run();
    const rebuilt = svc.orderFromEvents(paid.id)!;
    expect(Order.parse(rebuilt)).toEqual(Order.parse(svc.getOrder(paid.id)));
    expect(rebuilt.lines[0]).toMatchObject({ name: 'Burger', qty: 2, unitPriceCents: 1500, lineTotalCents: 3000, taxCents: 170 });
    expect(rebuilt).toMatchObject({ ticketNumber: 1, receiptNumber: 1, totalCents: 3000, taxCents: 170, paid: true });
    expect(rebuilt.payments[0]).toMatchObject({ method: 'cash', amountCents: 3000, tenderedCents: 5000, changeCents: 2000 });
    // The order row is the one editable copy: damage it in a way the triggers allow.
    db.prepare("UPDATE orders SET data = json_set(data, '$.totalCents', 1) WHERE id = ?").run(paid.id);
    expect(svc.verifyLedger()).toEqual([`order ${paid.id}: current record differs from its last event`]);
    expect(svc.repairOrder(paid.id)).toBe(true);
    expect(svc.getOrder(paid.id).totalCents).toBe(3000);
    expect(svc.verifyLedger()).toEqual([]);
    await app.close();
  });
});

describe('prices can never go below zero', () => {
  const discounted = {
    categoryId: 'sides', name: 'Discount Probe', priceCents: 1400, taxCategoryId: 'service_6', station: 'kitchen', available: true,
    modifierGroups: [
      { id: 'g1', name: 'Staff', required: false, multi: false, options: [{ id: 'a', name: 'Staff discount', priceDeltaCents: -800 }] },
      { id: 'g2', name: 'Promo', required: false, multi: false, options: [{ id: 'b', name: 'Promo', priceDeltaCents: -800 }] },
    ],
  };
  const login = async (app: ReturnType<typeof buildApp>['app'], pin: string) =>
    ({ 'x-token': (await app.inject({ method: 'POST', url: '/api/login', payload: { pin } })).json().token as string });

  it('the menu refuses discounts that can add up to more than the price', async () => {
    const { app } = buildApp(db, { webDist: '/nonexistent' });
    const h = await login(app, '1234');
    const res = await app.inject({ method: 'PUT', url: '/api/admin/menu/items/probe', headers: h, payload: discounted });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/below a price of zero/);
    // a single discount, or several that stay above zero, are fine
    const fine = { ...discounted, modifierGroups: [{ ...discounted.modifierGroups[0]!, multi: true, options: [{ id: 'a', name: 'A', priceDeltaCents: -700 }, { id: 'b', name: 'B', priceDeltaCents: -700 }] }] };
    expect((await app.inject({ method: 'PUT', url: '/api/admin/menu/items/probe', headers: h, payload: fine })).statusCode).toBe(200);
    await app.close();
  });

  it('an order whose options undercut the price is rejected before a ticket is issued or anyone is told', async () => {
    // An item saved before the menu check existed (or a market-price item) can still be over-discounted.
    db.prepare('INSERT INTO menu_items(id, data) VALUES (?, ?)').run('probe', JSON.stringify({ id: 'probe', ...discounted, openPrice: false }));
    const { app } = buildApp(db, { webDist: '/nonexistent' });
    const h = await login(app, '1111');
    const res = await app.inject({ method: 'POST', url: '/api/orders', headers: h, payload: { lines: [{ itemId: 'probe', qty: 1, modifierOptionIds: ['a', 'b'] }] } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/less than nothing/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM orders').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM order_events').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM counters').get()).toEqual({ n: 0 }); // no ticket number burned
    expect((await app.inject({ method: 'GET', url: '/api/pickup' })).json()).toEqual({ preparing: [], ready: [] });
    // one discount is a valid sale and produces a contract-valid order and event
    const good = await app.inject({ method: 'POST', url: '/api/orders', headers: h, payload: { lines: [{ itemId: 'probe', qty: 1, modifierOptionIds: ['a'] }] } });
    expect(good.statusCode).toBe(201);
    expect(Order.parse(good.json()).totalCents).toBe(600);
    expect(ServerEventSchema.safeParse({ type: 'order.changed', order: good.json() }).success).toBe(true);
    await app.close();
  });

  it('the same option sent twice is rejected instead of charged twice', () => {
    expect(() => svc.createOrder({ lines: [{ itemId: 'burger', qty: 1, modifierOptionIds: ['cheese', 'cheese'] }], source: 'pos' }, staff)).toThrow(/chosen twice/);
    expect(svc.createOrder({ lines: [{ itemId: 'burger', qty: 1, modifierOptionIds: ['cheese', 'bacon'] }], source: 'pos' }, staff).totalCents).toBe(1700);
  });
});

describe('a repeated request acts once', () => {
  it('same Idempotency-Key: one order, one payment, one receipt number, one announcement', async () => {
    const sent: string[] = [];
    const { app, printing } = buildApp(db, { webDist: '/nonexistent', printerTransport: (s) => (s.enabled ? { send: async (d) => { sent.push(Buffer.from(d).toString('latin1')); } } : null) });
    const h = { 'x-token': (await app.inject({ method: 'POST', url: '/api/login', payload: { pin: '1234' } })).json().token as string };
    await app.inject({ method: 'PUT', url: '/api/admin/printer', headers: h, payload: { enabled: true, host: 'p', port: 9100, columns: 48, cutter: true, drawer: false, autoReceipt: true, autoKitchen: true } });
    const key = { ...h, 'idempotency-key': 'cart-0001-abcdef' };
    const first = await app.inject({ method: 'POST', url: '/api/orders', headers: key, payload: { lines: [{ itemId: 'fries', qty: 1 }] } });
    const again = await app.inject({ method: 'POST', url: '/api/orders', headers: key, payload: { lines: [{ itemId: 'fries', qty: 1 }] } });
    expect(first.statusCode).toBe(201);
    expect(again.json().id).toBe(first.json().id);
    expect(db.prepare('SELECT COUNT(*) AS n FROM orders').get()).toEqual({ n: 1 });
    const id = first.json().id as string;
    const payKey = { ...h, 'idempotency-key': `pay-${id}` };
    const p1 = await app.inject({ method: 'POST', url: `/api/orders/${id}/pay`, headers: payKey, payload: { method: 'cash', tenderedCents: 1000 } });
    const p2 = await app.inject({ method: 'POST', url: `/api/orders/${id}/pay`, headers: payKey, payload: { method: 'cash', tenderedCents: 1000 } });
    expect(p1.statusCode).toBe(200);
    expect(p2.statusCode).toBe(200); // the retry gets the paid order back, not an "already paid" error
    expect(p2.json().receiptNumber).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM payments').get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT value FROM counters WHERE name = 'receipt'").get()).toEqual({ value: 1 });
    await printing.queue.idle();
    expect(sent).toHaveLength(2); // one kitchen ticket, one receipt: the repeats printed nothing
    // without a key, a second payment is still refused
    expect((await app.inject({ method: 'POST', url: `/api/orders/${id}/pay`, headers: h, payload: { method: 'cash' } })).statusCode).toBe(409);
    // a key cannot be reused for a different order, and a malformed key is rejected
    const other = (await app.inject({ method: 'POST', url: '/api/orders', headers: h, payload: { lines: [{ itemId: 'fries', qty: 1 }] } })).json().id as string;
    expect((await app.inject({ method: 'POST', url: `/api/orders/${other}/pay`, headers: payKey, payload: { method: 'cash' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/api/orders', headers: { ...h, 'idempotency-key': 'short' }, payload: { lines: [{ itemId: 'fries', qty: 1 }] } })).statusCode).toBe(400);
    await app.close();
  });

  it('shared contracts cover audit rows and acknowledgements', async () => {
    const { app } = buildApp(db, { webDist: '/nonexistent' });
    const h = { 'x-token': (await app.inject({ method: 'POST', url: '/api/login', payload: { pin: '1234' } })).json().token as string };
    await app.inject({ method: 'PUT', url: '/api/admin/menu/categories/extra', headers: h, payload: { name: 'Extra', sort: 9 } });
    Ack.parse((await app.inject({ method: 'DELETE', url: '/api/admin/menu/categories/extra', headers: h })).json());
    const audit = AuditList.parse((await app.inject({ method: 'GET', url: '/api/admin/audit', headers: h })).json());
    expect(audit.map((a) => a.type)).toEqual(['menu.category.deleted', 'menu.category.saved']);
    Ack.parse((await app.inject({ method: 'POST', url: '/api/logout', headers: h, payload: {} })).json());
    await app.close();
  });
});

describe('receipt numbers', () => {
  it('a payment that fails after its number was taken leaves no gap', () => {
    const a = svc.createOrder(fries, staff);
    const b = svc.createOrder(fries, staff);
    svc.pay(a.id, cash, staff);
    // Fail the event insert, which happens after the counter, the payment row and the order update.
    db.exec("CREATE TEMP TRIGGER fail_paid BEFORE INSERT ON order_events WHEN NEW.type = 'order.paid' BEGIN SELECT RAISE(ABORT, 'injected failure'); END;");
    expect(() => svc.pay(b.id, cash, staff)).toThrow(/injected failure/);
    expect(db.prepare("SELECT value FROM counters WHERE name = 'receipt'").get()).toEqual({ value: 1 });
    expect(svc.getOrder(b.id)).toMatchObject({ paid: false, receiptNumber: null, payments: [] });
    expect(db.prepare('SELECT COUNT(*) AS n FROM payments').get()).toEqual({ n: 1 });
    db.exec('DROP TRIGGER fail_paid');
    expect(svc.pay(b.id, cash, staff).receiptNumber).toBe(2);
    expect(svc.verifyLedger()).toEqual([]);
  });

  it('a second writer waits its turn or fails cleanly; nothing is half-written', () => {
    const a = svc.createOrder(fries, staff);
    const other = openDb(join(dir, 'pos.sqlite'), { busyTimeoutMs: 50 });
    const otherSvc = new PosService(other);
    db.exec('BEGIN IMMEDIATE'); // this connection is mid-write
    expect(() => otherSvc.pay(a.id, cash, staff)).toThrow(/locked/);
    db.exec('COMMIT');
    expect(otherSvc.pay(a.id, cash, staff).receiptNumber).toBe(1);
    expect(svc.verifyLedger()).toEqual([]);
    other.close();
  });

  it('four separate processes paying at once produce exactly 1..N, each once', async () => {
    const ids = Array.from({ length: 12 }, () => svc.createOrder(fries, staff).id);
    const worker = resolve(import.meta.dirname, 'testing/payWorker.ts');
    const run = (chunk: string[]) => new Promise<number[]>((done, fail) => {
      const child = spawn(process.execPath, ['--import', 'tsx', worker, join(dir, 'pos.sqlite'), ...chunk], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('close', (code) => (code === 0 ? done(JSON.parse(out) as number[]) : fail(new Error(`worker exited ${code}: ${err}`))));
    });
    const results = await Promise.all([0, 1, 2, 3].map((w) => run(ids.filter((_, i) => i % 4 === w))));
    const numbers = results.flat().sort((x, y) => x - y);
    expect(numbers).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(db.prepare("SELECT value FROM counters WHERE name = 'receipt'").get()).toEqual({ value: 12 });
    expect(db.prepare('SELECT COUNT(*) AS n, COUNT(DISTINCT receipt_number) AS d FROM payments').get()).toEqual({ n: 12, d: 12 });
    expect(svc.verifyLedger()).toEqual([]);
    expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
  }, 60_000);
});

describe('schema migrations', () => {
  it('a fresh database is at the current version and opening it again changes nothing', () => {
    expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
    const before = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master").get();
    migrate(db);
    db.close();
    db = openDb(join(dir, 'pos.sqlite'));
    expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master").get()).toEqual(before);
  });

  it('upgrades a populated version-1 database without losing sales, and backfills payments', () => {
    const path = join(dir, 'old.sqlite');
    const old = openDb(path, { migrateTo: 1 });
    expect(schemaVersion(old)).toBe(1);
    expect(old.prepare("SELECT name FROM sqlite_master WHERE name = 'payments'").get()).toBeUndefined();
    seedSample(old);
    // A paid order exactly as version 1 stored it: payment only inside the JSON, summary-only events.
    const order = {
      id: 'legacy-1', ticketNumber: 1, receiptNumber: 1, status: 'collected', paid: true, source: 'pos', createdBy: 'staff1',
      lines: [{ id: 'l1', itemId: 'fries', name: 'Fries', qty: 1, unitPriceCents: 500, modifiers: [], taxCategoryId: 'service_6', station: 'kitchen', lineTotalCents: 500 }],
      payments: [{ id: 'pay-legacy', method: 'card', amountCents: 500, reference: 'OLD-1', tipCents: 50, at: '2026-10-01T16:00:00.000Z' }],
      totalCents: 500, taxCents: 28, breakdown: [{ taxCategoryId: 'service_6', name: 'ABB 6%', kind: 'taxed', bps: 600, grossCents: 500, taxCents: 28, netCents: 472 }],
      createdAt: '2026-10-01T15:55:00.000Z', updatedAt: '2026-10-01T16:00:00.000Z',
    };
    old.prepare('INSERT INTO orders(id, ticket_number, receipt_number, business_date, data, created_at) VALUES (?,?,?,?,?,?)').run(order.id, 1, 1, '2026-10-01', JSON.stringify(order), order.createdAt);
    old.prepare('INSERT INTO order_events(order_id, type, payload, staff_id, at) VALUES (?,?,?,?,?)').run(order.id, 'order.paid', '{"method":"card","tip":50}', 'staff1', order.updatedAt);
    old.prepare("INSERT INTO counters(name, value) VALUES ('receipt', 1)").run();
    old.close();

    const upgraded = openDb(path);
    expect(schemaVersion(upgraded)).toBe(SCHEMA_VERSION);
    const s = new PosService(upgraded);
    expect(Order.parse(s.getOrder('legacy-1'))).toMatchObject({ receiptNumber: 1, totalCents: 500 });
    expect(upgraded.prepare('SELECT id, order_id, receipt_number, method, amount_cents, tip_cents, reference, staff_id FROM payments').get())
      .toEqual({ id: 'pay-legacy', order_id: 'legacy-1', receipt_number: 1, method: 'card', amount_cents: 500, tip_cents: 50, reference: 'OLD-1', staff_id: 'staff1' });
    expect(upgraded.prepare('SELECT COUNT(*) AS n FROM order_events').get()).toEqual({ n: 1 });
    expect(s.orderFromEvents('legacy-1')).toBeNull(); // old events carry no snapshot; the order row is still the record
    expect(s.verifyLedger()).toEqual([]);
    // the old row is now protected too, and new sales continue the numbering
    expect(() => upgraded.prepare("UPDATE orders SET data = json_set(data, '$.payments', json('[]')) WHERE id = 'legacy-1'").run()).toThrow(/payments cannot be removed/);
    expect(s.pay(s.createOrder(fries, staff).id, cash, staff).receiptNumber).toBe(2);
    upgraded.close();
  });

  it('refuses a database from a newer version, and a failed migration leaves the database untouched', () => {
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 5}`);
    expect(() => migrate(db)).toThrow(/newer than this program/);
    const path = join(dir, 'broken.sqlite');
    const old = openDb(path, { migrateTo: 1 });
    old.exec('CREATE TABLE payments (x)'); // makes migration 2 fail
    old.close();
    expect(() => openDb(path)).toThrow(/migration 2 .* rolled back/);
    const check = new DatabaseSync(path);
    expect((check.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(1);
    expect(check.prepare("SELECT name FROM sqlite_master WHERE name = 'requests'").get()).toBeUndefined();
    check.close();
  });
});
