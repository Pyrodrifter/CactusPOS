import type { ZReport } from '@cactus/shared';
import { dayBooking, latestPerDay, type AccountMap, DEFAULT_ACCOUNTS } from './journal.js';

/**
 * CSV exports any bookkeeping program or accountant can take: plain columns, amounts as
 * decimal numbers with a dot, dates as YYYY-MM-DD, UTF-8 with a BOM so Excel reads accents.
 */
const BOM = String.fromCharCode(0xfeff);
const amount = (cents: number) => `${cents < 0 ? '-' : ''}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, '0')}`;

/** Quotes a cell when needed and stops spreadsheet programs from running text as a formula. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const row = (cells: (string | number | null | undefined)[]) => cells.map(csvCell).join(',');

/** One row per day: the figures an accountant asks for first. */
export function daysCsv(reports: readonly ZReport[]): string {
  const days = latestPerDay(reports);
  // Columns for every tax rate that occurs in the range, so the sheet stays rectangular.
  const rates = [...new Set(days.flatMap((z) => z.report.tax.filter((t) => t.kind === 'taxed').map((t) => t.bps)))].sort((a, b) => a - b);
  const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;
  const head = [
    'date', 'z_report', 'closed_at', 'orders', 'first_receipt', 'last_receipt', 'sales_incl_abb', 'sales_net', 'abb_total',
    ...rates.flatMap((b) => [`net_${pct(b)}`, `abb_${pct(b)}`]),
    'exempt', 'outside_scope', 'cash', 'card', 'tips', 'refunds', 'cash_counted', 'cash_over_short', 'note',
  ];
  const lines = days.map((z) => {
    const r = z.report;
    const sum = (kind: string, field: 'grossCents') => r.tax.filter((t) => t.kind === kind).reduce((s, t) => s + t[field], 0);
    const tender = (m: string) => r.tenders.find((t) => t.method === m)?.amountCents ?? 0;
    return row([
      z.businessDate, z.number, z.closedAt, r.orders.sold, r.receipts.first, r.receipts.last,
      amount(r.sales.grossCents), amount(r.sales.netCents), amount(r.sales.taxCents),
      ...rates.flatMap((b) => {
        const rows = r.tax.filter((t) => t.kind === 'taxed' && t.bps === b);
        return [amount(rows.reduce((s, t) => s + t.netCents, 0)), amount(rows.reduce((s, t) => s + t.taxCents, 0))];
      }),
      amount(sum('exempt', 'grossCents')), amount(sum('outside_scope', 'grossCents')),
      amount(tender('cash')), amount(tender('card')), amount(r.tipsCents),
      amount(r.refunds.reduce((s, x) => s + x.amountCents, 0)),
      z.countedCashCents === null ? '' : amount(z.countedCashCents),
      z.cashDifferenceCents === null ? '' : amount(z.cashDifferenceCents),
      z.note ?? '',
    ]);
  });
  return `${BOM}${[row(head), ...lines].join('\r\n')}\r\n`;
}

/** Double-entry lines, one balanced booking per day, with separate debit and credit columns. */
export function journalCsv(reports: readonly ZReport[], accounts: AccountMap = DEFAULT_ACCOUNTS, source?: string): string {
  const head = ['date', 'reference', 'account', 'debit', 'credit', 'description', 'memo'];
  const lines = latestPerDay(reports).flatMap((z) => {
    const b = dayBooking(z, accounts, source);
    return b.lines.map((l) => row([b.date, b.reference, l.account, l.amountCents > 0 ? amount(l.amountCents) : '', l.amountCents < 0 ? amount(-l.amountCents) : '', l.description, b.memo]));
  });
  return `${BOM}${[row(head), ...lines].join('\r\n')}\r\n`;
}
