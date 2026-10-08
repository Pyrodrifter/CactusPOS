import { beforeEach, describe, expect, it } from 'vitest';
import { kitchenLines, Order, OrderList, ServerEventSchema } from '@cactus/shared';
import { buildKitchenTicket, buildReceipt, renderText } from '@cactus/receipt';
import { openDb, type DB } from './db.js';
import { seedSample } from './seedData.js';
import { buildApp } from './app.js';

let db: DB;
let app: ReturnType<typeof buildApp>['app'];
let svc: ReturnType<typeof buildApp>['svc'];
let reports: ReturnType<typeof buildApp>['reports'];
let printing: ReturnType<typeof buildApp>['printing'];
let sent: string[];
let staff: Record<string, string>;
let owner: Record<string, string>;

beforeEach(async () => {
  db = openDb(':memory:');
  seedSample(db);
  sent = [];
  ({ app, svc, reports, printing } = buildApp(db, { webDist: '/nonexistent', printerTransport: (s) => (s.enabled ? { send: async (d) => { sent.push(Buffer.from(d).toString('latin1')); } } : null) }));
  const login = async (pin: string) => ({ 'x-token': (await app.inject({ method: 'POST', url: '/api/login', payload: { pin } })).json().token as string });
  staff = await login('1111');
  owner = await login('1234');
});

const post = (url: string, payload: object, headers = staff) => app.inject({ method: 'POST', url, headers, payload });
const open = async (lines: object[], tabName?: string) => Order.parse((await post('/api/orders', { lines, tabName })).json());
const add = async (id: string, lines: object[], headers = staff) => post(`/api/orders/${id}/lines`, { lines }, headers);
const status = (id: string, s: string) => post(`/api/orders/${id}/status`, { status: s });

describe('tabs', () => {
  it('a guest opens a tab, orders twice more and pays once: one total, one receipt, three kitchen rounds', async () => {
    const tab = await open([{ itemId: 'burger', qty: 1, modifierOptionIds: ['cheese'] }], 'Mike');   // 1500
    expect(tab).toMatchObject({ tabName: 'Mike', round: 1, kitchenRound: 1, paid: false, totalCents: 1500, taxCents: 85 });
    expect(tab.lines[0]!.round).toBe(1);

    // Round 2 while the kitchen has not finished round 1: joins the same ticket.
    const r2 = Order.parse((await add(tab.id, [{ itemId: 'cola', qty: 2 }])).json());            // +600
    expect(r2).toMatchObject({ round: 2, kitchenRound: 1, status: 'sent', totalCents: 2100, ticketNumber: tab.ticketNumber });
    expect(kitchenLines(r2).map((l) => l.name)).toEqual(['Burger', 'Cola']);

    // Kitchen finishes and the guest collects; round 3 is then a fresh ticket with only the new item.
    await status(tab.id, 'ready');
    await status(tab.id, 'collected');
    const r3 = Order.parse((await add(tab.id, [{ itemId: 'fries', qty: 1 }])).json());           // +500
    expect(r3).toMatchObject({ round: 3, kitchenRound: 3, status: 'sent', totalCents: 2600 });
    expect(kitchenLines(r3).map((l) => l.name)).toEqual(['Fries']);
    expect(r3.lines.map((l) => [l.name, l.round])).toEqual([['Burger', 1], ['Cola', 2], ['Fries', 3]]);
    // per-line ABB adds up to the receipt ABB: 1500 -> 85, 600 -> 34, 500 -> 28
    expect(r3.lines.map((l) => l.taxCents)).toEqual([85, 34, 28]);
    expect(r3.taxCents).toBe(147);
    expect(r3.breakdown).toEqual([{ taxCategoryId: 'service_6', name: 'ABB 6%', kind: 'taxed', bps: 600, grossCents: 2600, taxCents: 147, netCents: 2453 }]);
    expect((await app.inject({ method: 'GET', url: '/api/pickup' })).json()).toEqual({ preparing: [tab.ticketNumber], ready: [] });

    const paid = Order.parse((await post(`/api/orders/${tab.id}/pay`, { method: 'cash', tenderedCents: 3000 })).json());
    expect(paid).toMatchObject({ paid: true, receiptNumber: 1, totalCents: 2600 });
    expect(paid.payments).toHaveLength(1);
    expect(paid.payments[0]).toMatchObject({ amountCents: 2600, changeCents: 400 });
    expect(db.prepare('SELECT COUNT(*) AS n, SUM(amount_cents) AS total FROM payments').get()).toEqual({ n: 1, total: 2600 });
    expect(svc.verifyLedger()).toEqual([]);

    // The day report counts it as one sale of 2600.
    expect(reports.day()).toMatchObject({ orders: { sold: 1, unpaid: 0 }, sales: { grossCents: 2600, taxCents: 147 } });
    // One receipt lists everything and names the tab.
    const receipt = renderText(buildReceipt(paid, svc.business()));
    for (const must of ['Tab: Mike', '1 x Burger', '2 x Cola', '1 x Fries', '$26.00', 'Receipt #1']) expect(receipt).toContain(must);
  });

  it('nothing can be added once a tab is paid or void', async () => {
    const tab = await open([{ itemId: 'fries', qty: 1 }], 'Ana');
    await post(`/api/orders/${tab.id}/pay`, { method: 'cash' });
    const late = await add(tab.id, [{ itemId: 'cola', qty: 1 }]);
    expect(late.statusCode).toBe(409);
    expect(late.json().error).toMatch(/already paid/);
    const other = await open([{ itemId: 'fries', qty: 1 }]);
    await post(`/api/orders/${other.id}/void`, { reason: 'left' });
    expect((await add(other.id, [{ itemId: 'cola', qty: 1 }])).statusCode).toBe(409);
    expect((await add('no-such-order', [{ itemId: 'cola', qty: 1 }])).statusCode).toBe(404);
    expect((await add(tab.id, [])).statusCode).toBe(400);
  });

  it('earlier rounds keep the price they were sold at when the menu changes', async () => {
    const tab = await open([{ itemId: 'fries', qty: 1 }], 'Jo');                                   // 500
    const item = { categoryId: 'sides', name: 'Fries', priceCents: 700, taxCategoryId: 'service_6', station: 'kitchen', available: true, modifierGroups: [] };
    expect((await app.inject({ method: 'PUT', url: '/api/admin/menu/items/fries', headers: owner, payload: item })).statusCode).toBe(200);
    const after = Order.parse((await add(tab.id, [{ itemId: 'fries', qty: 1 }])).json());
    expect(after.lines.map((l) => l.unitPriceCents)).toEqual([500, 700]);
    expect(after.totalCents).toBe(1200);
    // a sold-out or unknown item is refused and leaves the tab untouched
    await post('/api/menu/items/cola/available', { available: false });
    expect((await add(tab.id, [{ itemId: 'cola', qty: 1 }])).statusCode).toBe(409);
    expect((await add(tab.id, [{ itemId: 'nope', qty: 1 }])).statusCode).toBe(400);
    expect(svc.getOrder(tab.id).lines).toHaveLength(2);
    expect(svc.getOrder(tab.id).round).toBe(2);
  });

  it('adding the same round twice (double tap, lost reply) adds it once', async () => {
    const tab = await open([{ itemId: 'fries', qty: 1 }], 'Sam');
    const key = { ...staff, 'idempotency-key': 'round-abcdef-0001' };
    const first = await add(tab.id, [{ itemId: 'cola', qty: 1 }], key);
    const again = await add(tab.id, [{ itemId: 'cola', qty: 1 }], key);
    expect(first.statusCode).toBe(200);
    expect(again.json().lines).toHaveLength(2);
    expect(svc.getOrder(tab.id)).toMatchObject({ totalCents: 800, round: 2 });
    const other = await open([{ itemId: 'fries', qty: 1 }]);
    expect((await add(other.id, [{ itemId: 'cola', qty: 1 }], key)).statusCode).toBe(409); // a key belongs to one tab
  });

  it('a round added while the kitchen is cooking stays on that ticket; nothing is lost from it', async () => {
    const tab = await open([{ itemId: 'burger', qty: 1, modifierOptionIds: [] }]);
    await status(tab.id, 'preparing');
    const more = Order.parse((await add(tab.id, [{ itemId: 'fries', qty: 1 }])).json());
    expect(more).toMatchObject({ status: 'preparing', kitchenRound: 1, round: 2 });
    expect(kitchenLines(more).map((l) => [l.name, l.round])).toEqual([['Burger', 1], ['Fries', 2]]);
  });

  it('tab list: every unpaid order, including one left from an earlier day; names can be set and cleared', async () => {
    const named = await open([{ itemId: 'fries', qty: 1 }], 'Table by the palm');
    const plain = await open([{ itemId: 'cola', qty: 1 }]);
    const paid = await open([{ itemId: 'cola', qty: 1 }]);
    await post(`/api/orders/${paid.id}/pay`, { method: 'cash' });
    const gone = await open([{ itemId: 'cola', qty: 1 }]);
    await post(`/api/orders/${gone.id}/void`, { reason: 'changed mind' });
    // A tab somebody forgot yesterday.
    const old = { ...named, id: 'old-tab', ticketNumber: 9, tabName: 'Yesterday', createdAt: '2026-01-01T15:00:00.000Z', updatedAt: '2026-01-01T15:00:00.000Z' };
    db.prepare('INSERT INTO orders(id, ticket_number, receipt_number, business_date, data, created_at) VALUES (?,?,?,?,?,?)').run(old.id, 9, null, '2026-01-01', JSON.stringify(old), old.createdAt);

    const tabs = OrderList.parse((await app.inject({ method: 'GET', url: '/api/orders?scope=open', headers: staff })).json());
    expect(tabs.map((t) => t.tabName ?? `#${t.ticketNumber}`)).toEqual(['Yesterday', 'Table by the palm', `#${plain.ticketNumber}`]);
    // yesterday's tab can still be added to and paid
    expect((await add('old-tab', [{ itemId: 'fries', qty: 1 }])).statusCode).toBe(200);
    expect((await post('/api/orders/old-tab/pay', { method: 'card' })).json().paid).toBe(true);

    const renamed = Order.parse((await post(`/api/orders/${plain.id}/tab`, { tabName: '  Kim  ' })).json());
    expect(renamed.tabName).toBe('Kim');
    expect(Order.parse((await post(`/api/orders/${plain.id}/tab`, { tabName: '' })).json()).tabName).toBeUndefined();
    expect((await post(`/api/orders/${plain.id}/tab`, { tabName: 'x'.repeat(41) })).statusCode).toBe(400);
    expect((await post('/api/orders', { lines: [{ itemId: 'fries', qty: 1 }], tabName: '   ' })).statusCode).toBe(400);
  });

  it('events, live updates and the kitchen printer follow each round', async () => {
    await app.inject({ method: 'PUT', url: '/api/admin/printer', headers: owner, payload: { enabled: true, host: 'p', port: 9100, columns: 48, cutter: true, drawer: false, autoReceipt: false, autoKitchen: true } });
    const tab = await open([{ itemId: 'burger', qty: 1, modifierOptionIds: ['cheese'] }], 'Mike');
    await status(tab.id, 'ready');
    const r2 = Order.parse((await add(tab.id, [{ itemId: 'fries', qty: 2 }])).json());
    await printing.queue.idle();
    expect(sent).toHaveLength(2);
    expect(sent[0]).toContain('Burger');
    expect(sent[1]).toContain('Mike');
    expect(sent[1]).toContain('ADDED TO THIS ORDER');
    expect(sent[1]).toContain('2 x Fries');
    expect(sent[1]).not.toContain('Burger'); // the kitchen is not told to make round 1 again
    expect(renderText(buildKitchenTicket(r2, svc.business()))).toContain('1 x Burger'); // the full ticket still can be printed

    const types = (db.prepare('SELECT type FROM order_events WHERE order_id = ? ORDER BY seq').all(tab.id) as { type: string }[]).map((e) => e.type);
    expect(types).toEqual(['order.created', 'order.status', 'order.lines_added']);
    expect(svc.orderFromEvents(tab.id)).toEqual(svc.getOrder(tab.id));
    expect(ServerEventSchema.safeParse({ type: 'order.changed', order: r2 }).success).toBe(true);
    expect(svc.verifyLedger()).toEqual([]);
    printing.queue.stop();
  });

  it('orders stored before tabs existed still work as tabs', async () => {
    const legacy = await open([{ itemId: 'fries', qty: 1 }]);
    const stripped = { ...legacy, lines: legacy.lines.map(({ round: _r, ...l }) => l) } as Record<string, unknown>;
    delete stripped.round; delete stripped.kitchenRound; delete stripped.tabName;
    db.prepare('UPDATE orders SET data = ? WHERE id = ?').run(JSON.stringify(stripped), legacy.id);
    expect(kitchenLines(Order.parse(svc.getOrder(legacy.id)))).toHaveLength(1);
    const after = Order.parse((await add(legacy.id, [{ itemId: 'cola', qty: 1 }])).json());
    expect(after).toMatchObject({ round: 2, kitchenRound: 1, totalCents: 800 });
    expect(after.lines.map((l) => l.round ?? 1)).toEqual([1, 2]);
  });
});
