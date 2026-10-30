import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CashMovement, DayReview, MAX_CENTS, ZReport, type CashMovementBody } from '@cactus/shared';
import { buildDayReport, renderText } from '@cactus/receipt';
import { openDb } from './db.js';
import { seedSample } from './seedData.js';
import { buildApp } from './app.js';
import { reportRevision } from './reports.js';

let db: ReturnType<typeof openDb>, ctx: ReturnType<typeof buildApp>, owner: string, staff: string;
beforeEach(async () => {
  db = openDb(':memory:'); seedSample(db); ctx = buildApp(db, { practiceDbPath: ':memory:' });
  const login = async (pin: string) => (await ctx.app.inject({ method: 'POST', url: '/api/login', payload: { pin } })).json().token as string;
  owner = await login('1234'); staff = await login('1111');
});
afterEach(async () => { await ctx.app.close(); db.close(); });
const call = (method: 'GET' | 'POST', path: string, payload?: object, key?: string, token = owner) => ctx.app.inject({ method, url: `/api${path}`, payload,
  headers: { 'x-token': token, ...(key ? { 'idempotency-key': key } : {}) } });
const cash = (direction: 'in' | 'out', amountCents: number, reason: string, key: string = crypto.randomUUID(), extra: Partial<CashMovementBody> = {}) => call('POST', '/cash/movements', { direction, amountCents, reason, ...extra }, key);
const view = async () => DayReview.parse((await call('GET', '/reports/day')).json());
const sale = async () => {
  const order = (await call('POST', '/orders', { lines: [{ itemId: 'burger', qty: 2 }] })).json();
  return (await call('POST', `/orders/${order.id}/pay`, { method: 'cash', tenderedCents: 2800 })).json();
};

describe('drawer cash and settlement', () => {
  it('requires owner, positive integer cents, reason and retry key', async () => {
    expect((await call('POST', '/cash/movements', { direction: 'in', amountCents: 1000, reason: 'float' })).statusCode).toBe(400);
    expect((await call('POST', '/cash/movements', { direction: 'in', amountCents: 1000, reason: 'float' }, 'cash-role-test', staff)).statusCode).toBe(403);
    expect((await call('GET', '/cash/movements', undefined, undefined, staff)).statusCode).toBe(403);
    for (const amount of [0, -1, 1.5, MAX_CENTS + 1]) expect((await cash('in', amount, 'float')).statusCode).toBe(400);
    expect((await cash('in', 100, '   ')).statusCode).toBe(400);
  });
  it('keeps sales/tax unchanged, counts float and withdrawals, and freezes the whole drawer at settlement', async () => {
    await sale(); const before = await view();
    await cash('in', 10000, 'Opening float'); await cash('out', 2500, 'Cash to bank');
    const reviewed = await view();
    expect(reviewed.report.sales).toEqual(before.report.sales);
    expect(reviewed.report.drawer).toMatchObject({ cashInCents: 10000, cashOutCents: 2500, expectedCents: 10300 });
    const z = ZReport.parse((await call('POST', '/reports/day/close', { date: reviewed.today, countedCashCents: 10300, cashCountBasis: 'drawer', expectedRevision: reviewed.revision })).json());
    expect(z.cashDifferenceCents).toBe(0); expect(z.cashCountBasis).toBe('drawer'); expect(z.report.drawer?.movements).toHaveLength(2);
    await cash('out', 100, 'Late withdrawal');
    expect((await view()).changedSinceClose).toBe(true);
    expect((await call('GET', '/reports/z')).json()[0].report.drawer.expectedCents).toBe(10300);
    const text = renderText(buildDayReport(z, ctx.svc.business()));
    expect(text).toContain('Opening float'); expect(text).toContain('Cash to bank'); expect(text).toContain('Counted (whole drawer)');
  });
  it('deduplicates a lost reply, exposes read-only status and refuses changed bodies', async () => {
    const key = 'cash-lost-reply-1';
    const first = CashMovement.parse((await cash('in', 10000, 'Opening float', key)).json());
    expect((await cash('in', 10000, 'Opening float', key)).json().id).toBe(first.id);
    expect((await cash('in', 20000, 'Opening float', key)).statusCode).toBe(409);
    expect((await call('GET', `/cash/movements/request/${key}`)).json().movement.id).toBe(first.id);
    expect((await call('GET', '/cash/movements/request/missing-key')).json()).toEqual({ movement: null });
    expect((await view()).report.drawer?.movements).toHaveLength(1);
  });
  it('reverses once by appending and protects all unique keys against replacement', async () => {
    const entry = CashMovement.parse((await cash('out', 500, 'Wrong withdrawal', 'cash-original-1')).json());
    expect((await cash('in', 400, 'Wrong amount', 'cash-reverse-bad', { reverses: entry.id })).statusCode).toBe(409);
    const reversal = CashMovement.parse((await cash('in', 500, 'Entry was wrong', 'cash-reversal-1', { reverses: entry.id })).json());
    expect((await cash('in', 500, 'Again', 'cash-reversal-2', { reverses: entry.id })).statusCode).toBe(409);
    expect((await cash('out', 500, 'Reverse reverse', 'cash-reversal-3', { reverses: reversal.id })).statusCode).toBe(409);
    expect((await view()).report.drawer).toMatchObject({ expectedCents: 0, cashInCents: 500, cashOutCents: 500 });
    expect(() => db.exec('DELETE FROM cash_movements')).toThrow(/append-only/);
    expect(() => db.exec("UPDATE cash_movements SET data='{}'")).toThrow(/append-only/);
    expect(() => db.prepare('INSERT OR REPLACE INTO cash_movements(id,request_key,business_date,data) VALUES(?,?,?,?)').run('new-id', 'cash-original-1', entry.businessDate, '{}')).toThrow(/append-only/);
    expect((await call('GET', '/cash/movements')).json()).toHaveLength(2);
  });
  it('refuses stale settlement after payment-method corrections even when the sale total is unchanged', async () => {
    const order = await sale(); const before = await view();
    const corrected = await call('POST', `/orders/${order.id}/correct`, { keep: order.lines.map((line: { id: string; qty: number }) => ({ lineId: line.id, qty: line.qty })), add: [], method: 'card', reason: 'Paid by card', expectedTotalCents: 2800 }, 'cash-correct-card');
    expect(corrected.statusCode).toBe(200);
    const after = await view(); expect(after.report.sales.grossCents).toBe(before.report.sales.grossCents); expect(after.revision).not.toBe(before.revision);
    expect((await call('POST', '/reports/day/close', { date: before.today, cashCountBasis: 'drawer', expectedRevision: before.revision, countedCashCents: 0 })).statusCode).toBe(409);
    expect((await call('GET', '/reports/z')).json()).toEqual([]);
    expect((await call('GET', `/reports/day/orders?date=${before.today}`)).json()).toHaveLength(2);
  });
  it('retains legacy sales-only counts and ignores generation time in revisions', async () => {
    await sale(); await cash('in', 10000, 'Float');
    const r = await view();
    const z = ZReport.parse((await call('POST', '/reports/day/close', { date: r.today, countedCashCents: 2800 })).json());
    expect(z.cashCountBasis).toBe('sales'); expect(z.cashDifferenceCents).toBe(0);
    expect(reportRevision({ ...r.report, generatedAt: new Date(0).toISOString() })).toBe(r.revision);
    const empty = { ...r.report, drawer: { cashInCents: 0, cashOutCents: 0, expectedCents: r.report.cashExpectedCents, movements: [] } };
    const legacy = { ...r.report }; delete legacy.drawer;
    expect(reportRevision(empty)).toBe(reportRevision(legacy));
  });
  it('rolls overflow back and keeps practice cash isolated', async () => {
    await cash('in', MAX_CENTS, 'Maximum');
    expect((await cash('in', 1, 'Too much')).statusCode).toBe(400);
    expect((await view()).report.drawer?.movements).toHaveLength(1);
    const launch = (await call('POST', '/practice/start', {})).json();
    const sample = await call('POST', '/practice/cash/movements', { direction: 'in', amountCents: 5000, reason: 'Practice float' }, 'practice-cash-1', launch.session.token);
    expect(sample.statusCode).toBe(201);
    expect((await call('GET', '/practice/reports/day', undefined, undefined, launch.session.token)).json().report.drawer.expectedCents).toBe(5000);
    expect((await view()).report.drawer?.expectedCents).toBe(MAX_CENTS);
  });
});
