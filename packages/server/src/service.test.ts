import { describe, expect, it, beforeEach } from 'vitest';
import { openDb } from './db.js';
import { PosService, type Staff } from './service.js';
import { seedSample } from './seedData.js';
import { buildApp } from './app.js';

const staff: Staff = { id: 'staff1', name: 'Staff', role: 'staff' };
let svc: PosService;
let db: ReturnType<typeof openDb>;
beforeEach(() => { db = openDb(':memory:'); seedSample(db); svc = new PosService(db); });

const burger = (qty = 1, mods: string[] = []) => ({ lines: [{ itemId: 'burger', qty, modifierOptionIds: mods }], source: 'pos' as const });

describe('orders', () => {
  it('prices with modifiers and extracts ABB from the inclusive total', () => {
    const o = svc.createOrder(burger(2, ['cheese']), staff);
    expect(o.totalCents).toBe((1400 + 100) * 2);
    expect(o.taxCents).toBe(Math.round((3000 * 600) / 10600));
    expect(o.ticketNumber).toBe(1);
    expect(svc.createOrder(burger(), staff).ticketNumber).toBe(2);
  });
  it('cash payment gives change and a gapless receipt number', () => {
    const a = svc.createOrder(burger(), staff);
    const b = svc.createOrder(burger(), staff);
    const pb = svc.pay(b.id, { method: 'cash', tenderedCents: 2000, tipCents: 0 }, staff);
    const pa = svc.pay(a.id, { method: 'card', tipCents: 0 }, staff);
    expect(pb.payments[0]!.changeCents).toBe(600);
    expect([pb.receiptNumber, pa.receiptNumber]).toEqual([1, 2]);
    expect(() => svc.pay(a.id, { method: 'cash', tipCents: 0 }, staff)).toThrow(/already paid/);
  });
  it('rejects short cash', () => {
    const a = svc.createOrder(burger(), staff);
    expect(() => svc.pay(a.id, { method: 'cash', tenderedCents: 100, tipCents: 0 }, staff)).toThrow(/less than/);
  });
  it('voiding a paid order needs a manager; receipt number is kept', () => {
    const a = svc.createOrder(burger(), staff);
    svc.pay(a.id, { method: 'cash', tipCents: 0 }, staff);
    expect(() => svc.voidOrder(a.id, 'mistake', undefined, staff)).toThrow(/Manager PIN/);
    const v = svc.voidOrder(a.id, 'mistake', '1234', staff);
    expect(v.status).toBe('void');
    expect(v.receiptNumber).toBe(1);
  });
  it('audit trail is append-only and orders cannot be deleted', () => {
    const a = svc.createOrder(burger(), staff);
    expect(() => db.exec('DELETE FROM order_events')).toThrow(/append-only/);
    expect(() => db.exec("UPDATE order_events SET type='x'")).toThrow(/append-only/);
    expect(() => db.prepare('DELETE FROM orders WHERE id=?').run(a.id)).toThrow(/cannot be deleted/);
  });
  it('refuses sold-out items', () => {
    const it = JSON.parse((db.prepare("SELECT data FROM menu_items WHERE id='burger'").get() as { data: string }).data);
    it.available = false;
    db.prepare("UPDATE menu_items SET data=? WHERE id='burger'").run(JSON.stringify(it));
    expect(() => svc.createOrder(burger(), staff)).toThrow(/sold out/);
  });
});

describe('http + auth', () => {
  it('requires login, then runs the full flow', async () => {
    const { app } = buildApp(db, { webDist: '/nonexistent' });
    expect((await app.inject({ method: 'GET', url: '/api/menu' })).statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/api/login', payload: { pin: '1111' } });
    expect(login.statusCode).toBe(200);
    const h = { 'x-token': login.json().token };
    const created = await app.inject({ method: 'POST', url: '/api/orders', headers: h, payload: { lines: [{ itemId: 'fries', qty: 1 }] } });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    expect((await app.inject({ method: 'POST', url: `/api/orders/${id}/pay`, headers: h, payload: { method: 'cash', tenderedCents: 1000 } })).json().paid).toBe(true);
    expect((await app.inject({ method: 'POST', url: `/api/orders/${id}/status`, headers: h, payload: { status: 'ready' } })).json().status).toBe('ready');
    expect((await app.inject({ method: 'GET', url: '/api/pickup' })).json().ready).toEqual([1]);
    expect((await app.inject({ method: 'POST', url: '/api/login', payload: { pin: '0000' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: `/api/orders/${id}/receipt`, headers: h })).body).toContain('Cactus Blue');
  });
});
