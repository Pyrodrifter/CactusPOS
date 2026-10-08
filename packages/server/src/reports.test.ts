import { beforeEach, describe, expect, it } from 'vitest';
import { DayReport, ZReport, ZReportList } from '@cactus/shared';
import { renderText, buildDayReport } from '@cactus/receipt';
import { openDb, type DB } from './db.js';
import { seedSample } from './seedData.js';
import { buildApp } from './app.js';

let db: DB;
let app: ReturnType<typeof buildApp>['app'];
let svc: ReturnType<typeof buildApp>['svc'];
let reports: ReturnType<typeof buildApp>['reports'];
let owner: Record<string, string>;
let staff: Record<string, string>;

beforeEach(async () => {
  db = openDb(':memory:');
  seedSample(db);
  ({ app, svc, reports } = buildApp(db, { webDist: '/nonexistent' }));
  const login = async (pin: string) => ({ 'x-token': (await app.inject({ method: 'POST', url: '/api/login', payload: { pin } })).json().token as string });
  owner = await login('1234');
  staff = await login('1111');
});

const order = async (lines: object[]) => (await app.inject({ method: 'POST', url: '/api/orders', headers: staff, payload: { lines } })).json().id as string;
const pay = (id: string, payload: object) => app.inject({ method: 'POST', url: `/api/orders/${id}/pay`, headers: staff, payload });

/** A small trading day with every case the report has to tell apart. */
async function tradingDay() {
  // burger 1400 + cheese 100 = 1500, cash
  await pay(await order([{ itemId: 'burger', qty: 1, modifierOptionIds: ['cheese'] }]), { method: 'cash', tenderedCents: 2000 });
  // 2 fries 1000 + cola 300 = 1300, card with a 200 tip
  await pay(await order([{ itemId: 'fries', qty: 2 }, { itemId: 'cola', qty: 1 }]), { method: 'card', tipCents: 200, reference: 'A1' });
  // fries 500 cash, then voided after payment: a cash refund
  const refunded = await order([{ itemId: 'fries', qty: 1 }]);
  await pay(refunded, { method: 'cash' });
  await app.inject({ method: 'POST', url: `/api/orders/${refunded}/void`, headers: owner, payload: { reason: 'wrong order' } });
  // sent but never paid
  await order([{ itemId: 'water', qty: 1 }]);
  // voided before payment
  const mistake = await order([{ itemId: 'salad', qty: 1 }]);
  await app.inject({ method: 'POST', url: `/api/orders/${mistake}/void`, headers: staff, payload: { reason: 'mistake' } });
}

describe('day report', () => {
  it('an empty day is all zeros', () => {
    const r = DayReport.parse(reports.day());
    expect(r).toMatchObject({ orders: { sold: 0, unpaid: 0, refunded: 0 }, sales: { grossCents: 0, taxCents: 0, netCents: 0 }, cashExpectedCents: 0, items: [], tax: [] });
    expect(r.receipts).toEqual({ first: null, last: null, count: 0 });
  });

  it('separates sales, refunds, unpaid and voided orders, and adds up', async () => {
    await tradingDay();
    const r = DayReport.parse(reports.day());
    expect(r.orders).toEqual({ sold: 2, unpaid: 1, unpaidCents: 200, voidedUnpaid: 1, refunded: 1 });
    // 1500 + 1300; ABB per line: 1500 -> 85, 1000 -> 57, 300 -> 17
    expect(r.sales).toEqual({ grossCents: 2800, taxCents: 159, netCents: 2641 });
    expect(r.tax).toEqual([{ taxCategoryId: 'service_6', name: 'ABB 6%', kind: 'taxed', bps: 600, grossCents: 2800, taxCents: 159, netCents: 2641 }]);
    expect(r.tenders).toEqual([
      { method: 'cash', count: 1, amountCents: 1500, tipCents: 0 },
      { method: 'card', count: 1, amountCents: 1300, tipCents: 200 },
    ]);
    expect(r.tipsCents).toBe(200);
    expect(r.refunds).toEqual([{ method: 'cash', count: 1, amountCents: 500 }]);
    // drawer: 1500 cash sale + 500 taken and handed back = 1500 expected
    expect(r.cashExpectedCents).toBe(1500);
    expect(r.receipts).toEqual({ first: 1, last: 3, count: 3 }); // the refunded sale keeps its receipt number
    expect(r.items).toEqual([
      { name: 'Burger', qty: 1, grossCents: 1500 },
      { name: 'Fries', qty: 2, grossCents: 1000 },
      { name: 'Cola', qty: 1, grossCents: 300 },
    ]);
    // internal consistency
    expect(r.tenders.reduce((s, t) => s + t.amountCents, 0)).toBe(r.sales.grossCents);
    expect(r.tax.reduce((s, t) => s + t.grossCents, 0)).toBe(r.sales.grossCents);
    expect(r.tax.reduce((s, t) => s + t.taxCents, 0)).toBe(r.sales.taxCents);
    expect(r.items.reduce((s, i) => s + i.grossCents, 0)).toBe(r.sales.grossCents);
    expect(r.hours.reduce((s, h) => s + h.grossCents, 0)).toBe(r.sales.grossCents);
    expect(r.hours.reduce((s, h) => s + h.orders, 0)).toBe(2);
  });

  it('reconciles with the payments table and the event log', async () => {
    await tradingDay();
    const r = reports.day();
    const paid = db.prepare("SELECT method, SUM(amount_cents) AS amount, SUM(tip_cents) AS tips, COUNT(*) AS n FROM payments GROUP BY method").all() as { method: string; amount: number; tips: number; n: number }[];
    for (const t of r.tenders) {
      const row = paid.find((p) => p.method === t.method)!;
      const back = r.refunds.find((x) => x.method === t.method);
      expect(row.amount).toBe(t.amountCents + (back?.amountCents ?? 0)); // money in = sales + what was later refunded
      expect(row.n).toBe(t.count + (back?.count ?? 0));
    }
    const soldFromEvents = (db.prepare("SELECT DISTINCT order_id FROM order_events WHERE type = 'order.paid'").all() as { order_id: string }[])
      .map((e) => svc.orderFromEvents(e.order_id)!).filter((o) => o.status !== 'void');
    expect(soldFromEvents.reduce((s, o) => s + o.totalCents, 0)).toBe(r.sales.grossCents);
    expect(soldFromEvents.reduce((s, o) => s + o.taxCents, 0)).toBe(r.sales.taxCents);
    expect(svc.verifyLedger()).toEqual([]);
  });

  it('does not change when the menu or tax rates change afterwards', async () => {
    await tradingDay();
    const before = reports.day();
    db.prepare("UPDATE tax_categories SET data = json_set(data, '$.rates[0].bps', 900) WHERE id = 'service_6'").run();
    db.exec('DELETE FROM menu_items');
    const after = reports.day();
    expect({ ...after, generatedAt: '' }).toEqual({ ...before, generatedAt: '' });
  });

  it('other days stay out of it', async () => {
    await tradingDay();
    expect(reports.day('2020-01-01').sales.grossCents).toBe(0);
    const res = await app.inject({ method: 'GET', url: '/api/reports/day?date=2020-01-01', headers: owner });
    expect(res.json().report.orders.sold).toBe(0);
    expect((await app.inject({ method: 'GET', url: '/api/reports/day?date=nonsense', headers: owner })).statusCode).toBe(400);
  });
});

describe('closing the day', () => {
  it('only the owner can see or close; a close stores a numbered Z report with over/short', async () => {
    await tradingDay();
    const date = svc.businessDate();
    expect((await app.inject({ method: 'GET', url: '/api/reports/day', headers: staff })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/reports/day/close', headers: staff, payload: { date } })).statusCode).toBe(403);
    const live = await app.inject({ method: 'GET', url: '/api/reports/day', headers: owner });
    expect(live.json()).toMatchObject({ closed: null, today: date });
    const closed = await app.inject({ method: 'POST', url: '/api/reports/day/close', headers: owner, payload: { date, countedCashCents: 1450, note: 'short one coffee' } });
    expect(closed.statusCode).toBe(201);
    const z = ZReport.parse(closed.json());
    expect(z).toMatchObject({ number: 1, businessDate: date, closedBy: 'owner', countedCashCents: 1450, cashDifferenceCents: -50, note: 'short one coffee' });
    expect(z.report.sales.grossCents).toBe(2800);
    expect((await app.inject({ method: 'GET', url: '/api/reports/day', headers: owner })).json().closed.number).toBe(1);
  });

  it('a late sale can be closed again: new number, latest counts, nothing overwritten', async () => {
    await tradingDay();
    const date = svc.businessDate();
    await app.inject({ method: 'POST', url: '/api/reports/day/close', headers: owner, payload: { date } });
    await pay(await order([{ itemId: 'juice', qty: 1 }]), { method: 'cash' });
    const again = ZReport.parse((await app.inject({ method: 'POST', url: '/api/reports/day/close', headers: owner, payload: { date } })).json());
    expect(again.number).toBe(2);
    expect(again.cashDifferenceCents).toBeNull();
    expect(again.report.sales.grossCents).toBe(2800 + 450);
    const list = ZReportList.parse((await app.inject({ method: 'GET', url: '/api/reports/z', headers: owner })).json());
    expect(list.map((x) => [x.number, x.report.sales.grossCents])).toEqual([[2, 3250], [1, 2800]]);
    expect(reports.latestFor(date)!.number).toBe(2);
  });

  it('Z reports cannot be edited, deleted or replaced, and a future day cannot be closed', async () => {
    const date = svc.businessDate();
    await app.inject({ method: 'POST', url: '/api/reports/day/close', headers: owner, payload: { date } });
    expect(() => db.exec("UPDATE z_reports SET data = '{}'")).toThrow(/append-only/);
    expect(() => db.exec('DELETE FROM z_reports')).toThrow(/append-only/);
    expect(() => db.prepare('INSERT OR REPLACE INTO z_reports(number, business_date, closed_at, closed_by, data) VALUES (1,?,?,?,?)').run(date, 'x', 'x', '{}')).toThrow(/append-only/);
    expect((await app.inject({ method: 'POST', url: '/api/reports/day/close', headers: owner, payload: { date: '2999-01-01' } })).statusCode).toBe(400);
  });

  it('prints: text layout carries the figures, and the printer gets the Z report once closed', async () => {
    const sent: string[] = [];
    const printed = buildApp(db, { webDist: '/nonexistent', printerTransport: (s) => (s.enabled ? { send: async (d) => { sent.push(Buffer.from(d).toString('latin1')); } } : null) });
    await tradingDay();
    const date = svc.businessDate();
    const text = renderText(buildDayReport(reports.day(), svc.business()), 48);
    for (const must of ['X REPORT (not closed)', 'Total incl. ABB', '$28.00', 'ABB 6% over $26.41', '$1.59', 'Cash (1)', '$15.00', 'Card (1)', '$13.00', 'Tips', '$2.00', 'REFUNDS', '-$5.00', 'Unpaid open orders (1)', 'Expected from sales', '1 x Burger', '2 x Fries']) expect(text).toContain(must);
    expect(text.split('\n').every((l) => l.length <= 48)).toBe(true);
    expect(renderText(buildDayReport(reports.day(), { ...svc.business(), locale: 'nl' }), 32)).toContain('X-RAPPORT');

    expect((await printed.app.inject({ method: 'POST', url: '/api/reports/day/print', headers: owner, payload: {} })).statusCode).toBe(409);
    await printed.app.inject({ method: 'PUT', url: '/api/admin/printer', headers: owner, payload: { enabled: true, host: 'p', port: 9100, columns: 48, cutter: true, drawer: false, autoReceipt: false, autoKitchen: false } });
    await printed.app.inject({ method: 'POST', url: '/api/reports/day/close', headers: owner, payload: { date, countedCashCents: 1500 } });
    expect((await printed.app.inject({ method: 'POST', url: '/api/reports/day/print', headers: owner, payload: { date } })).statusCode).toBe(200);
    await printed.printing.queue.idle();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('Z REPORT #1');
    expect(sent[0]).toContain('Over / short');
    const html = await printed.app.inject({ method: 'GET', url: `/api/reports/day/print.html?date=${date}`, headers: owner });
    expect(html.body).toContain('Z REPORT #1');
    printed.printing.queue.stop();
  });
});
