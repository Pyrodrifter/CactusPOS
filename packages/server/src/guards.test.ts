import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditList, Order, PickupBoard, ServerEventSchema } from '@cactus/shared';
import { openDb, type DB } from './db.js';
import { seedSample } from './seedData.js';
import { buildApp } from './app.js';

/** Fixes from the app audit of 2026-10-10 (BOARD A02, A03, A04, A06, A07). */
let db: DB;
let app: ReturnType<typeof buildApp>['app'];
let svc: ReturnType<typeof buildApp>['svc'];
let owner: Record<string, string>;
let staff: Record<string, string>;

const login = async (pin: string) => ({ 'x-token': (await app.inject({ method: 'POST', url: '/api/login', payload: { pin } })).json().token as string });
const post = (url: string, headers: Record<string, string>, payload: object) => app.inject({ method: 'POST', url, headers, payload });
const order = async (lines: object[], extra: object = {}) => Order.parse((await post('/api/orders', staff, { lines, ...extra })).json());
const audit = async () => AuditList.parse((await app.inject({ method: 'GET', url: '/api/admin/audit', headers: owner })).json());

async function start(options: Parameters<typeof buildApp>[1] = {}) {
  db = openDb(':memory:');
  seedSample(db);
  ({ app, svc } = buildApp(db, { webDist: '/nonexistent', ...options }));
  owner = await login('1234');
  staff = await login('1111');
}
afterEach(async () => { await app.close(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('manager PIN on a void', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-03-02T16:00:00Z'));
    await start();
  });

  it('is limited like sign-in: five wrong PINs lock it for 30 seconds, and each is in the audit log', async () => {
    const o = await order([{ itemId: 'cola', qty: 1 }]);
    await post(`/api/orders/${o.id}/status`, staff, { status: 'preparing' });
    const guess = (managerPin: string) => post(`/api/orders/${o.id}/void`, staff, { reason: 'guessing', managerPin });
    for (let i = 0; i < 5; i++) expect((await guess(String(5000 + i))).statusCode).toBe(403);
    const locked = await guess('5005');
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error).toMatch(/Too many wrong manager PINs/);
    // Even the right PIN has to wait, or the lock would tell a guesser nothing was lost.
    expect((await guess('1234')).statusCode).toBe(429);
    expect(svc.getOrder(o.id).status).toBe('preparing');
    expect((await audit()).filter((r) => r.type === 'void.manager_pin_refused')).toHaveLength(5);

    vi.setSystemTime(Date.now() + 31_000);
    const ok = await guess('1234');
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe('void');
  });

  it('does not get in the way of voids that need no PIN', async () => {
    for (let i = 0; i < 7; i++) {
      const o = await order([{ itemId: 'water', qty: 1 }]);
      expect((await post(`/api/orders/${o.id}/void`, staff, { reason: 'mistake' })).statusCode).toBe(200);
    }
    const o = await order([{ itemId: 'water', qty: 1 }]);
    await post(`/api/orders/${o.id}/pay`, staff, { method: 'cash' });
    expect((await post(`/api/orders/${o.id}/void`, staff, { reason: 'no pin given' })).statusCode).toBe(403);
    expect((await post(`/api/orders/${o.id}/void`, owner, { reason: 'owner needs none' })).statusCode).toBe(200);
  });
});

describe('paying the amount the cashier saw', () => {
  beforeEach(() => start());

  it('refuses a payment when the order grew on another screen, for card and for cash', async () => {
    const tab = await order([{ itemId: 'burger', qty: 1 }], { tabName: 'Ann' });
    await post(`/api/orders/${tab.id}/lines`, staff, { lines: [{ itemId: 'juice', qty: 2 }] });
    const card = await post(`/api/orders/${tab.id}/pay`, staff, { method: 'card', reference: 'T1', expectedTotalCents: 1400 });
    expect(card.statusCode).toBe(409);
    expect(card.json().error).toContain('$23.00');
    expect((await post(`/api/orders/${tab.id}/pay`, staff, { method: 'cash', tenderedCents: 5000, expectedTotalCents: 1400 })).statusCode).toBe(409);
    expect(svc.getOrder(tab.id)).toMatchObject({ paid: false, receiptNumber: null, payments: [] });
    expect(db.prepare('SELECT COUNT(*) AS n FROM payments').get()).toEqual({ n: 0 });

    const paid = await post(`/api/orders/${tab.id}/pay`, staff, { method: 'card', reference: 'T1', expectedTotalCents: 2300 });
    expect(paid.statusCode).toBe(200);
    expect(paid.json().payments[0].amountCents).toBe(2300);
  });

  it('a refused payment does not use up its retry key, and a screen that sends no total still works', async () => {
    const tab = await order([{ itemId: 'fries', qty: 1 }], { tabName: 'Bo' });
    const key = { ...staff, 'idempotency-key': `pay-${tab.id}` };
    expect((await post(`/api/orders/${tab.id}/pay`, key, { method: 'card', expectedTotalCents: 1 })).statusCode).toBe(409);
    expect((await post(`/api/orders/${tab.id}/pay`, key, { method: 'card', expectedTotalCents: 500 })).statusCode).toBe(200);
    const other = await order([{ itemId: 'fries', qty: 1 }]);
    expect((await post(`/api/orders/${other.id}/pay`, staff, { method: 'card' })).statusCode).toBe(200);
  });
});

describe('kitchen and pickup lists across midnight', () => {
  const LATE = Date.parse('2026-03-03T03:50:00Z'); // 23:50 on 2 March in Kralendijk
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(LATE);
    await start();
  });

  it('an order sent just before midnight stays on both boards after it', async () => {
    const o = await order([{ itemId: 'burger', qty: 1 }]);
    await post(`/api/orders/${o.id}/pay`, staff, { method: 'cash' });
    vi.setSystemTime(LATE + 20 * 60_000);
    expect(svc.businessDate()).toBe('2026-03-03');
    expect(svc.activeOrders().map((x) => x.id)).toEqual([o.id]);
    expect(PickupBoard.parse((await app.inject({ method: 'GET', url: '/api/pickup' })).json())).toEqual({ preparing: [o.ticketNumber], ready: [] });
    // Never bumped: it leaves the boards by itself the next afternoon instead of staying forever.
    vi.setSystemTime(LATE + 17 * 3600_000);
    expect(svc.activeOrders()).toEqual([]);
  });

  it('an older tab that orders again is a fresh kitchen ticket with only the new round', async () => {
    const served = await order([{ itemId: 'burger', qty: 1 }], { tabName: 'Served' });
    await post(`/api/orders/${served.id}/status`, staff, { status: 'collected' });
    const forgotten = await order([{ itemId: 'fries', qty: 1 }], { tabName: 'Never bumped' });
    vi.setSystemTime(LATE + 2 * 24 * 3600_000);
    expect(svc.activeOrders()).toEqual([]);

    for (const tab of [served, forgotten]) {
      const again = Order.parse((await post(`/api/orders/${tab.id}/lines`, staff, { lines: [{ itemId: 'cola', qty: 1 }] })).json());
      expect(again).toMatchObject({ status: 'sent', round: 2, kitchenRound: 2, kitchenSince: new Date(Date.now()).toISOString() });
    }
    expect(svc.activeOrders().map((x) => x.id).sort()).toEqual([served.id, forgotten.id].sort());
    // Yesterday's numbers can repeat today's; the public board shows each number once.
    const board = svc.pickupBoard();
    expect(board.preparing).toEqual([...new Set(board.preparing)]);
  });
});

describe('owner reminders and the audit trail', () => {
  beforeEach(() => start());

  it('lists who can still sign in with an example PIN, to the owner only', async () => {
    const names = async (headers: Record<string, string>) => (await app.inject({ method: 'GET', url: '/api/admin/staff/example-pins', headers })).json().staff.map((s: { name: string }) => s.name);
    expect(await names(owner)).toEqual(['Owner', 'Staff']);
    expect((await app.inject({ method: 'GET', url: '/api/admin/staff/example-pins', headers: staff })).statusCode).toBe(403);
    await app.inject({ method: 'PUT', url: '/api/admin/staff/owner', headers: owner, payload: { name: 'Owner', role: 'owner', active: true, pin: '9753' } });
    owner = await login('9753'); // changing a PIN signs that person out everywhere
    expect(await names(owner)).toEqual(['Staff']);
    await app.inject({ method: 'PUT', url: '/api/admin/staff/staff1', headers: owner, payload: { name: 'Staff', role: 'staff', active: true, pin: '8642' } });
    expect(await names(owner)).toEqual([]);
  });

  it('records printer and bookkeeping settings changes', async () => {
    await app.inject({ method: 'PUT', url: '/api/admin/printer', headers: owner, payload: { enabled: false, host: '', port: 9100, columns: 48, cutter: true, drawer: false, autoReceipt: true, autoKitchen: false } });
    await app.inject({ method: 'PUT', url: '/api/books/settings', headers: owner, payload: { pbkFolder: '' } });
    const rows = await audit();
    expect(rows.map((r) => r.type)).toEqual(expect.arrayContaining(['printer.saved', 'books.saved']));
    expect(rows.every((r) => r.staffId === 'owner')).toBe(true);
  });

  it('keeps the details of an internal fault off the screen', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.exec('DROP TABLE menu_categories');
    const res = await app.inject({ method: 'GET', url: '/api/menu', headers: staff });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Something went wrong on the till. Please try again.' });
    expect(res.body).not.toMatch(/menu_categories|no such table/);
    expect(String(logged.mock.calls[0]?.[1])).toMatch(/no such table/); // the server log still says why
    // Refusals meant for the screen are unchanged.
    expect((await app.inject({ method: 'GET', url: '/api/orders/nope', headers: staff })).json()).toEqual({ error: 'Order not found' });
    expect((await app.inject({ method: 'POST', url: '/api/login', headers: { 'content-type': 'application/json' }, payload: '{not json' })).statusCode).toBe(400);
  });
});

describe('live connection heartbeat', () => {
  it('every screen hears from the server at a steady beat and is kept while it answers', async () => {
    await start({ heartbeatMs: 25 });
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const ws = new WebSocket(`${address.replace('http', 'ws')}/ws?room=pickup`);
    const types: string[] = [];
    ws.onmessage = (m) => { types.push(ServerEventSchema.parse(JSON.parse(String(m.data))).type); };
    await new Promise((done, fail) => { ws.onopen = done; ws.onerror = () => fail(new Error('no connection')); });
    await new Promise((done) => setTimeout(done, 200));
    expect(types.filter((t) => t === 'hello').length).toBeGreaterThanOrEqual(4); // one on connecting, then one per beat
    expect(ws.readyState).toBe(WebSocket.OPEN); // it answered the pings, so the server did not drop it
    ws.close();
  });
});
