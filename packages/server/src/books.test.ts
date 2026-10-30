import { beforeEach, describe, expect, it } from 'vitest';
import type { ZReport } from '@cactus/shared';
import { csvCell, dayBooking, daysCsv, DEFAULT_ACCOUNTS, journalCsv, latestPerDay } from '@cactus/books-bridge';
import { openDb, type DB } from './db.js';
import { seedSample } from './seedData.js';
import { buildApp } from './app.js';

const BOM = new RegExp(`^${String.fromCharCode(0xfeff)}`);
let db: DB;
let app: ReturnType<typeof buildApp>['app'];
let svc: ReturnType<typeof buildApp>['svc'];
let owner: Record<string, string>;
let staff: Record<string, string>;

beforeEach(async () => {
  db = openDb(':memory:');
  seedSample(db);
  ({ app, svc } = buildApp(db, { webDist: '/nonexistent' }));
  const login = async (pin: string) => ({ 'x-token': (await app.inject({ method: 'POST', url: '/api/login', payload: { pin } })).json().token as string });
  owner = await login('1234');
  staff = await login('1111');
});

const sell = async (lines: object[], pay: object) => {
  const id = (await app.inject({ method: 'POST', url: '/api/orders', headers: staff, payload: { lines } })).json().id as string;
  await app.inject({ method: 'POST', url: `/api/orders/${id}/pay`, headers: staff, payload: pay });
  return id;
};
const close = async (extra: object = {}) =>
  (await app.inject({ method: 'POST', url: '/api/reports/day/close', headers: owner, payload: { date: svc.businessDate(), ...extra } })).json() as ZReport;

/** burger+cheese 1500 cash; 2 fries + cola 1300 card with 200 tip. Gross 2800, ABB 159, net 2641. */
async function day() {
  await sell([{ itemId: 'burger', qty: 1, modifierOptionIds: ['cheese'] }], { method: 'cash', tenderedCents: 2000 });
  await sell([{ itemId: 'fries', qty: 2 }, { itemId: 'cola', qty: 1 }], { method: 'card', tipCents: 200 });
}

describe('day booking', () => {
  it('is balanced double entry with tax, tips and cash difference in the right accounts', async () => {
    await day();
    const z = await close({ countedCashCents: 1450 });
    const b = dayBooking(z, DEFAULT_ACCOUNTS, 'CactusBlue');
    expect(b.lines.reduce((s, l) => s + l.amountCents, 0)).toBe(0);
    const total = (account: string) => b.lines.filter((l) => l.account === account).reduce((s, l) => s + l.amountCents, 0);
    expect(total('1000')).toBe(1500 - 50);   // cash sales, less 50 short
    expect(total('1100')).toBe(1300 + 200);  // card sales plus the card tip
    expect(total('8000')).toBe(-2641);       // revenue net of ABB
    expect(total('1600')).toBe(-159);        // ABB payable
    expect(total('1800')).toBe(-200);        // tips owed to staff, not revenue
    expect(total('4550')).toBe(50);          // cash short is a cost
    expect(b).toMatchObject({ date: z.businessDate, reference: 'cactusblue-z1' });
    expect(b.memo).toContain('Z report #1');
  });

  it('exempt and outside-scope sales go to their own revenue accounts with no ABB', async () => {
    const item = JSON.parse((db.prepare("SELECT data FROM menu_items WHERE id = 'water'").get() as { data: string }).data);
    db.prepare("UPDATE menu_items SET data = ? WHERE id = 'water'").run(JSON.stringify({ ...item, taxCategoryId: 'outside_scope' }));
    await sell([{ itemId: 'water', qty: 1 }, { itemId: 'fries', qty: 1 }], { method: 'cash' });
    const b = dayBooking(await close());
    const total = (account: string) => b.lines.filter((l) => l.account === account).reduce((s, l) => s + l.amountCents, 0);
    expect(total('8100')).toBe(-200);
    expect(total('8000')).toBe(-(500 - 28));
    expect(total('1600')).toBe(-28);
    expect(b.lines.reduce((s, l) => s + l.amountCents, 0)).toBe(0);
  });

  it('a day closed twice is represented once, by its latest close', async () => {
    await day();
    const first = await close();
    await sell([{ itemId: 'juice', qty: 1 }], { method: 'cash' });
    const second = await close();
    expect(latestPerDay([first, second]).map((x) => x.number)).toEqual([2]);
  });

  it('rejects an unusable account code', async () => {
    await day();
    const z = await close();
    expect(() => dayBooking(z, { ...DEFAULT_ACCOUNTS, cash: 'cash account!' })).toThrow(/not a usable account code/);
  });
});

describe('CSV export', () => {
  it('escapes cells and defuses spreadsheet formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell(-5)).toBe('-5'); // numbers are left alone
    expect(csvCell(null)).toBe('');
  });

  it('daily file: one row per day with the figures, owner only', async () => {
    await day();
    await close({ countedCashCents: 1500, note: 'all good, thanks' });
    expect((await app.inject({ method: 'GET', url: '/api/books/days.csv', headers: staff })).statusCode).toBe(403);
    const res = await app.inject({ method: 'GET', url: '/api/books/days.csv', headers: owner });
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');
    const [head, row, ...rest] = res.body.replace(BOM, '').trim().split('\r\n');
    expect(rest).toEqual([]);
    const cells = Object.fromEntries(head!.split(',').map((h, i) => [h, row!.split(',')[i]]));
    expect(cells).toMatchObject({
      date: svc.businessDate(), z_report: '1', orders: '2', first_receipt: '1', last_receipt: '2',
      sales_incl_abb: '28.00', sales_net: '26.41', abb_total: '1.59', 'net_6%': '26.41', 'abb_6%': '1.59',
      exempt: '0.00', outside_scope: '0.00', cash: '15.00', card: '13.00', tips: '2.00', refunds: '0.00', cash_counted: '15.00', cash_over_short: '0.00',
    });
    expect(row).toContain('"all good, thanks"');
  });

  it('journal file: debits equal credits, and a date range filters', async () => {
    await day();
    const z = await close();
    const text = journalCsv([z]).replace(BOM, '').trim().split('\r\n').slice(1).map((l) => l.split(','));
    const debit = text.reduce((s, c) => s + Math.round(Number(c[3] || 0) * 100), 0);
    const credit = text.reduce((s, c) => s + Math.round(Number(c[4] || 0) * 100), 0);
    expect(debit).toBe(credit);
    expect(debit).toBe(2800 + 200);
    expect(daysCsv([z]).split('\r\n')).toHaveLength(3); // header, one day, trailing newline
    const none = await app.inject({ method: 'GET', url: '/api/books/journal.csv?from=2020-01-01&to=2020-01-31', headers: owner });
    expect(none.body.replace(BOM, '').trim().split('\r\n')).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: '/api/books/journal.csv?from=yesterday', headers: owner })).statusCode).toBe(400);
  });
});
