import { describe, expect, it, beforeEach } from 'vitest';
import { openDb } from './db.js';
import { PosService, type Staff } from './service.js';
import { seedSample } from './seedData.js';
import { buildApp } from './app.js';
import { applyProfile } from './seedProfile.js';
import { HealthResponse, LoginResponse, MenuResponse, Order, OrderList, PickupBoard, ServerEventSchema, ErrorResponse } from '@cactus/shared';

const staff: Staff = { id: 'staff1', name: 'Staff', role: 'staff' };
let svc: PosService;
let db: ReturnType<typeof openDb>;
beforeEach(() => { db = openDb(':memory:'); seedSample(db); svc = new PosService(db); });

const burger = (qty = 1, mods: string[] = []) => ({ lines: [{ itemId: 'burger', qty, modifierOptionIds: mods }], source: 'pos' as const });

describe('orders', () => {
  it('prices with modifiers and extracts ABB from the inclusive total', () => {
    const o = svc.createOrder(burger(2, ['cheese']), staff);
    expect(o.totalCents).toBe((1400 + 100) * 2);
    expect(o.taxCents).toBe(170); // 3000 * 6/106 = 169.81
    expect(o.lines[0]!.taxCents).toBe(170);
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

describe('admin', () => {
  const login = async (app: ReturnType<typeof buildApp>['app'], pin: string) =>
    ({ 'x-token': (await app.inject({ method: 'POST', url: '/api/login', payload: { pin } })).json().token as string });

  it('PINs are stored hashed and sessions survive a restart', async () => {
    const pins = (db.prepare('SELECT pin FROM staff').all() as { pin: string }[]).map((r) => r.pin);
    expect(pins.every((p) => p.startsWith('s1:'))).toBe(true);
    const a = buildApp(db, { webDist: '/nonexistent' }).app;
    const h = await login(a, '1111');
    const b = buildApp(db, { webDist: '/nonexistent' }).app;
    expect((await b.inject({ method: 'GET', url: '/api/menu', headers: h })).statusCode).toBe(200);
  });

  it('upgrades plain PINs from older databases', () => {
    db.prepare("INSERT INTO staff(id, name, pin, role) VALUES ('old','Old','7777','staff')").run();
    expect(new PosService(db).auth.findByPin('7777')?.id).toBe('old');
  });

  it('staff cannot use admin routes; owner can edit the menu and prices apply to new orders', async () => {
    const { app } = buildApp(db, { webDist: '/nonexistent' });
    const staffH = await login(app, '1111');
    const ownerH = await login(app, '1234');
    const item = { categoryId: 'sides', name: 'Onion Rings', priceCents: 650, taxCategoryId: 'service_6', station: 'kitchen', available: true, modifierGroups: [] };
    expect((await app.inject({ method: 'PUT', url: '/api/admin/menu/items/rings', headers: staffH, payload: item })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: '/api/admin/menu/items/rings', headers: ownerH, payload: item })).statusCode).toBe(200);
    const o = await app.inject({ method: 'POST', url: '/api/orders', headers: staffH, payload: { lines: [{ itemId: 'rings', qty: 2 }] } });
    expect(o.json().totalCents).toBe(1300);
    expect((await app.inject({ method: 'PUT', url: '/api/admin/menu/items/bad', headers: ownerH, payload: { ...item, taxCategoryId: 'nope' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: '/api/admin/menu/categories/sides', headers: ownerH })).statusCode).toBe(409);
    // any staff member may mark an item sold out
    expect((await app.inject({ method: 'POST', url: '/api/menu/items/rings/available', headers: staffH, payload: { available: false } })).json().available).toBe(false);
    expect((await app.inject({ method: 'GET', url: '/api/admin/audit', headers: ownerH })).json().length).toBeGreaterThanOrEqual(2);
  });

  it('staff management: unique PINs, last owner protected, deactivation ends sessions', async () => {
    const { app } = buildApp(db, { webDist: '/nonexistent' });
    const ownerH = await login(app, '1234');
    const staffH = await login(app, '1111');
    const put = (id: string, payload: object) => app.inject({ method: 'PUT', url: `/api/admin/staff/${id}`, headers: ownerH, payload });
    expect((await app.inject({ method: 'POST', url: '/api/admin/staff', headers: ownerH, payload: { name: 'Mom', role: 'staff', pin: '1111' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/api/admin/staff', headers: ownerH, payload: { name: 'Mom', role: 'staff', pin: '2468' } })).statusCode).toBe(201);
    expect((await put('owner', { name: 'Owner', role: 'staff', active: true })).statusCode).toBe(409);
    expect((await put('staff1', { name: 'Staff', role: 'staff', active: false })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/menu', headers: staffH })).statusCode).toBe(401);
    expect(JSON.stringify((await app.inject({ method: 'GET', url: '/api/admin/staff', headers: ownerH })).json())).not.toContain('s1:');
  });

  it('business details show on the receipt and bad timezones are rejected', async () => {
    const { app } = buildApp(db, { webDist: '/nonexistent' });
    const h = await login(app, '1234');
    const biz = { name: 'Kas di Kuminda', crib: '123456789', address: 'Rincon', phone: '', timezone: 'America/Kralendijk', currency: 'USD', locale: 'nl', receiptFooter: 'Danki!' };
    expect((await app.inject({ method: 'PUT', url: '/api/admin/business', headers: h, payload: biz })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PUT', url: '/api/admin/business', headers: h, payload: { ...biz, timezone: 'Mars/Phobos' } })).statusCode).toBe(400);
    const o = (await app.inject({ method: 'POST', url: '/api/orders', headers: h, payload: { lines: [{ itemId: 'fries', qty: 1 }] } })).json();
    const html = (await app.inject({ method: 'GET', url: `/api/orders/${o.id}/receipt`, headers: h })).body;
    expect(html).toContain('Kas di Kuminda');
    expect(html).toContain('CRIB 123456789');
  });

  it('locks out after repeated wrong PINs', async () => {
    const { app } = buildApp(db, { webDist: '/nonexistent' });
    for (let i = 0; i < 5; i++) await app.inject({ method: 'POST', url: '/api/login', payload: { pin: '0000' } });
    expect((await app.inject({ method: 'POST', url: '/api/login', payload: { pin: '1111' } })).statusCode).toBe(429);
  });
});

describe('seed profile + market price', () => {
  it('loads the Cactus Blue menu board', () => {
    expect(applyProfile(db, 'cactus-blue')).toBe(15);
    const menu = svc.menu();
    expect(menu.items.find((i) => i.id === 'cactus_double')!.priceCents).toBe(1975);
    expect(menu.categories.map((c) => c.name)).toEqual(['Beefburgers', 'Lion Fish', 'Wraps', 'Chips', 'Drinks']);
    expect(svc.business().address).toContain('Donkey Beach');
    // Kiteburger + extra bacon + beef patty
    const o = svc.createOrder({ lines: [{ itemId: 'kiteburger', qty: 1, modifierOptionIds: ['x_bacon', 'x_patty'] }], source: 'pos' }, staff);
    expect(o.totalCents).toBe(1600 + 100 + 500);
    // required choice
    expect(() => svc.createOrder({ lines: [{ itemId: 'soda', qty: 1, modifierOptionIds: [] }], source: 'pos' }, staff)).toThrow(/required/);
  });
  it('market-price items need a price typed at the counter', () => {
    applyProfile(db, 'cactus-blue');
    expect(() => svc.createOrder({ lines: [{ itemId: 'lionfish_burger', qty: 1, modifierOptionIds: [] }], source: 'pos' }, staff)).toThrow(/Enter the price/);
    const o = svc.createOrder({ lines: [{ itemId: 'lionfish_burger', qty: 2, modifierOptionIds: ['x_cheese'], priceCents: 2200 }], source: 'pos' }, staff);
    expect(o.totalCents).toBe((2200 + 100) * 2);
    // a typed price is ignored for normal items
    const n = svc.createOrder({ lines: [{ itemId: 'chips', qty: 1, modifierOptionIds: ['c_lays'], priceCents: 1 }], source: 'pos' }, staff);
    expect(n.totalCents).toBe(200);
  });
  it('rejects unknown profile names', () => {
    expect(() => applyProfile(db, '../etc')).toThrow(/Bad profile name/);
  });
});

describe('wire contracts: real responses satisfy the shared schemas', () => {
  it('login, menu, orders, pickup, health, errors', async () => {
    applyProfile(db, 'cactus-blue');
    const { app } = buildApp(db, { webDist: '/nonexistent' });
    const loginRes = (await app.inject({ method: 'POST', url: '/api/login', payload: { pin: '1111' } })).json();
    const session = LoginResponse.parse(loginRes);
    const h = { 'x-token': session.token };
    MenuResponse.parse((await app.inject({ method: 'GET', url: '/api/menu', headers: h })).json());
    const created = Order.parse((await app.inject({ method: 'POST', url: '/api/orders', headers: h, payload: { lines: [
      { itemId: 'cactus_double', qty: 1, modifierOptionIds: ['x_bacon'] },
      { itemId: 'soda', qty: 2, modifierOptionIds: ['d_coke'] },
    ] } })).json());
    // per-line ABB adds up to the receipt ABB (same rounding as the books)
    expect(created.lines.map((l) => l.taxCents)).toEqual([117, 31]); // 2075 and 550 at 6%
    expect(created.taxCents).toBe(148);
    expect(created.totalCents).toBe(2625);
    Order.parse((await app.inject({ method: 'POST', url: `/api/orders/${created.id}/pay`, headers: h, payload: { method: 'cash', tenderedCents: 3000 } })).json());
    expect(OrderList.parse((await app.inject({ method: 'GET', url: '/api/orders?scope=today', headers: h })).json())).toHaveLength(1);
    PickupBoard.parse((await app.inject({ method: 'GET', url: '/api/pickup' })).json());
    HealthResponse.parse((await app.inject({ method: 'GET', url: '/api/health' })).json());
    const bad = await app.inject({ method: 'GET', url: '/api/orders?scope=everything', headers: h });
    expect(bad.statusCode).toBe(400);
    ErrorResponse.parse(bad.json());
    ErrorResponse.parse((await app.inject({ method: 'GET', url: '/api/menu' })).json());
  });
  it('event schema accepts what the server sends and rejects junk', () => {
    const o = svc.createOrder(burger(), staff);
    expect(ServerEventSchema.safeParse({ type: 'order.changed', order: o }).success).toBe(true);
    expect(ServerEventSchema.safeParse({ type: 'pickup.changed', ...svc.pickupBoard() }).success).toBe(true);
    expect(ServerEventSchema.safeParse({ type: 'hello', serverTime: new Date().toISOString() }).success).toBe(true);
    expect(ServerEventSchema.safeParse({ type: 'order.changed', order: { ...o, totalCents: 12.5 } }).success).toBe(false);
    expect(ServerEventSchema.safeParse({ type: 'nope' }).success).toBe(false);
  });
  it('a sale the tax setup cannot price is refused, not sold untaxed', async () => {
    const future = { id: 'service_6', name: 'ABB 6%', kind: 'taxed', rates: [{ validFrom: '2999-01-01', bps: 600 }] };
    db.prepare("UPDATE tax_categories SET data = ? WHERE id = 'service_6'").run(JSON.stringify(future));
    const { app } = buildApp(db, { webDist: '/nonexistent' });
    const h = { 'x-token': (await app.inject({ method: 'POST', url: '/api/login', payload: { pin: '1111' } })).json().token };
    const res = await app.inject({ method: 'POST', url: '/api/orders', headers: h, payload: { lines: [{ itemId: 'fries', qty: 1 }] } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/Tax setup problem/);
  });
});
