import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DayReport, Order, OrderList, ZReport } from '@cactus/shared';
import { dayBooking } from '@cactus/books-bridge';
import { migrate, openDb, SCHEMA_VERSION, schemaVersion, type DB } from './db.js';
import { seedSample } from './seedData.js';
import { buildApp } from './app.js';

/**
 * A sale belongs to the day it was paid and a refund to the day the money went back (owner decision Q11,
 * 2026-10-10), whatever day the order was opened. Kralendijk is UTC-4 all year, so 16:00Z is noon there.
 */
const NOON = Date.parse('2026-03-02T16:00:00Z');
const DAY = 24 * 3600_000;
const [DAY1, DAY2, DAY3] = ['2026-03-02', '2026-03-03', '2026-03-04'];

let db: DB;
let app: ReturnType<typeof buildApp>['app'];
let svc: ReturnType<typeof buildApp>['svc'];
let reports: ReturnType<typeof buildApp>['reports'];
let owner: Record<string, string>;
let staff: Record<string, string>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOON);
  db = openDb(':memory:');
  seedSample(db);
  ({ app, svc, reports } = buildApp(db, { webDist: '/nonexistent' }));
  const login = async (pin: string) => ({ 'x-token': (await app.inject({ method: 'POST', url: '/api/login', payload: { pin } })).json().token as string });
  owner = await login('1234');
  staff = await login('1111');
});
afterEach(async () => { await app.close(); vi.useRealTimers(); });

const post = (url: string, headers: Record<string, string>, payload: object) => app.inject({ method: 'POST', url, headers, payload });
const money = (r: DayReport) => ({ sales: r.sales, tax: r.tax, tenders: r.tenders, cash: r.cashExpectedCents, refunds: r.refunds, receipts: r.receipts });

describe('the day the money moved', () => {
  it('a tab opened one day and paid the next is the next day\'s sale and cash', async () => {
    expect(svc.businessDate()).toBe(DAY1);
    const tab = Order.parse((await post('/api/orders', staff, { lines: [{ itemId: 'burger', qty: 1 }], tabName: 'Mike' })).json());
    const z1 = ZReport.parse((await post('/api/reports/day/close', owner, { date: DAY1, countedCashCents: 0 })).json());
    expect(z1.report).toMatchObject({ orders: { sold: 0, unpaid: 1 }, cashExpectedCents: 0 });

    vi.setSystemTime(NOON + DAY);
    expect(svc.businessDate()).toBe(DAY2);
    const paid = Order.parse((await post(`/api/orders/${tab.id}/pay`, staff, { method: 'cash', tenderedCents: 2000 })).json());
    expect(paid).toMatchObject({ paid: true, receiptNumber: 1, paidDate: DAY2 });

    const day2 = DayReport.parse(reports.day(DAY2));
    expect(day2.orders.sold).toBe(1);
    expect(day2.sales).toEqual({ grossCents: 1400, taxCents: 79, netCents: 1321 });
    expect(day2.tenders[0]).toEqual({ method: 'cash', count: 1, amountCents: 1400, tipCents: 0 });
    expect(day2.cashExpectedCents).toBe(1400);
    expect(day2.receipts).toEqual({ first: 1, last: 1, count: 1 });
    expect(day2.items).toEqual([{ name: 'Burger', qty: 1, grossCents: 1400 }]);
    expect(day2.hours).toEqual([{ hour: 12, orders: 1, grossCents: 1400 }]);

    // The closed day is still true: nothing was sold or taken on day 1.
    expect(money(reports.day(DAY1))).toEqual(money(z1.report));
    expect(svc.verifyLedger()).toEqual([]);
  });

  it('a refund on a later day comes off that day; the day of the sale stays as it was closed', async () => {
    const sale = Order.parse((await post('/api/orders', staff, { lines: [{ itemId: 'fries', qty: 1 }] })).json());
    await post(`/api/orders/${sale.id}/pay`, staff, { method: 'cash' });
    const z1 = ZReport.parse((await post('/api/reports/day/close', owner, { date: DAY1 })).json());
    expect(z1.report.sales.grossCents).toBe(500);

    vi.setSystemTime(NOON + 2 * DAY);
    const voided = Order.parse((await post(`/api/orders/${sale.id}/void`, owner, { reason: 'customer came back' })).json());
    expect(voided).toMatchObject({ status: 'void', paidDate: DAY1, voidDate: DAY3 });
    expect(voided.voidedAt).toBe(new Date(NOON + 2 * DAY).toISOString());

    const day3 = DayReport.parse(reports.day(DAY3));
    expect(day3.orders).toMatchObject({ sold: 0, refunded: 1 });
    expect(day3.sales).toEqual({ grossCents: -500, taxCents: -28, netCents: -472 });
    expect(day3.tax).toEqual([{ taxCategoryId: 'service_6', name: 'ABB 6%', kind: 'taxed', bps: 600, grossCents: -500, taxCents: -28, netCents: -472 }]);
    expect(day3.tenders[0]).toEqual({ method: 'cash', count: 0, amountCents: -500, tipCents: 0 });
    expect(day3.refunds).toEqual([{ method: 'cash', count: 1, amountCents: 500 }]);
    expect(day3.refundedEarlier).toEqual({ count: 1, grossCents: 500, taxCents: 28 });
    expect(day3.cashExpectedCents).toBe(-500);
    expect(day3.receipts).toEqual({ first: null, last: null, count: 0 });

    expect(money(reports.day(DAY1))).toEqual(money(z1.report));
    // The books get a balanced entry that takes the cash, the revenue and the ABB back out.
    const z3 = ZReport.parse((await post('/api/reports/day/close', owner, { date: DAY3 })).json());
    const lines = dayBooking(z3).lines.map((l) => [l.account, l.amountCents]);
    expect(lines).toEqual([['1000', -500], ['8000', 472], ['1600', 28]]);
    expect(svc.verifyLedger()).toEqual([]);
  });

  it('a sale paid and refunded on the same day still nets to nothing, on the day it happened', async () => {
    const tab = Order.parse((await post('/api/orders', staff, { lines: [{ itemId: 'cola', qty: 1 }], tabName: 'Ann' })).json());
    vi.setSystemTime(NOON + DAY);
    await post(`/api/orders/${tab.id}/pay`, staff, { method: 'card', tipCents: 100 });
    await post(`/api/orders/${tab.id}/void`, owner, { reason: 'charged twice' });
    const day2 = DayReport.parse(reports.day(DAY2));
    expect(day2.orders).toMatchObject({ sold: 0, refunded: 1 });
    expect(day2.sales.grossCents).toBe(0);
    expect(day2.tax).toEqual([]);
    expect(day2.tenders).toEqual([{ method: 'cash', count: 0, amountCents: 0, tipCents: 0 }, { method: 'card', count: 0, amountCents: 0, tipCents: 0 }]);
    expect(day2.refunds).toEqual([{ method: 'card', count: 1, amountCents: 300 }]);
    expect(day2.refundedEarlier).toBeUndefined();
    expect(day2.receipts).toEqual({ first: 1, last: 1, count: 1 }); // the receipt was issued that day
    expect(reports.day(DAY1).orders).toMatchObject({ sold: 0, refunded: 0, unpaid: 0, voidedUnpaid: 0 });
  });

  it('today\'s orders include an older tab paid today, so its receipt can be reprinted', async () => {
    const tab = Order.parse((await post('/api/orders', staff, { lines: [{ itemId: 'water', qty: 1 }], tabName: 'Old' })).json());
    vi.setSystemTime(NOON + DAY);
    const list = async () => OrderList.parse((await app.inject({ method: 'GET', url: '/api/orders?scope=today', headers: staff })).json()).map((o) => o.id);
    expect(await list()).toEqual([]);
    await post(`/api/orders/${tab.id}/pay`, staff, { method: 'cash' });
    expect(await list()).toEqual([tab.id]);
  });

  it('the recorded days cannot be rewritten, and survive a repair from the event log', async () => {
    const o = Order.parse((await post('/api/orders', staff, { lines: [{ itemId: 'cola', qty: 1 }] })).json());
    await post(`/api/orders/${o.id}/pay`, staff, { method: 'cash' });
    expect(() => db.prepare("UPDATE orders SET paid_date = '2020-01-01' WHERE id = ?").run(o.id)).toThrow(/cannot change once recorded/);
    expect(() => db.prepare('UPDATE orders SET paid_date = NULL WHERE id = ?').run(o.id)).toThrow(/cannot change once recorded/);
    expect(svc.repairOrder(o.id)).toBe(true);
    expect(db.prepare('SELECT paid_date, void_date FROM orders WHERE id = ?').get(o.id)).toEqual({ paid_date: DAY1, void_date: null });
    expect(svc.verifyLedger()).toEqual([]);
  });
});

describe('upgrading a database from before the money dates', () => {
  it('reads the day of payment and of the void from what was already recorded', () => {
    const old = openDb(':memory:', { migrateTo: 4 });
    expect(schemaVersion(old)).toBe(4);
    const order = {
      id: 'a', ticketNumber: 1, receiptNumber: 1, status: 'void', paid: true, lines: [], source: 'pos', totalCents: 500, taxCents: 28, breakdown: [],
      payments: [{ id: 'p1', method: 'cash', amountCents: 500, tipCents: 0, at: '2026-03-02T15:00:00.000Z' }],
      createdAt: '2026-03-01T15:00:00.000Z', updatedAt: '2026-03-04T02:30:00.000Z', createdBy: 'owner',
    };
    old.prepare('INSERT INTO orders(id, ticket_number, receipt_number, business_date, data, created_at) VALUES (?,?,?,?,?,?)').run('a', 1, 1, '2026-03-01', JSON.stringify(order), order.createdAt);
    old.prepare('INSERT INTO payments(id, order_id, receipt_number, method, amount_cents, staff_id, at) VALUES (?,?,?,?,?,?,?)').run('p1', 'a', 1, 'cash', 500, 'owner', '2026-03-02T15:00:00.000Z');
    // Voided at 02:30 UTC on the 4th, which is still the evening of the 3rd on Bonaire.
    old.prepare('INSERT INTO order_events(order_id, type, payload, staff_id, at) VALUES (?,?,?,?,?)').run('a', 'order.void', '{}', 'owner', '2026-03-04T02:30:00.000Z');
    const open = { ...order, id: 'b', ticketNumber: 2, receiptNumber: null, status: 'sent', paid: false, payments: [] };
    old.prepare('INSERT INTO orders(id, ticket_number, receipt_number, business_date, data, created_at) VALUES (?,?,?,?,?,?)').run('b', 2, null, '2026-03-01', JSON.stringify(open), open.createdAt);

    migrate(old);
    expect(schemaVersion(old)).toBe(SCHEMA_VERSION);
    const rows = old.prepare('SELECT id, paid_date, void_date FROM orders ORDER BY id').all();
    expect(rows).toEqual([{ id: 'a', paid_date: '2026-03-02', void_date: '2026-03-03' }, { id: 'b', paid_date: null, void_date: null }]);
    old.close();
  });
});
