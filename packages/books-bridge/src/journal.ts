import type { ZReport } from '@cactus/shared';

/**
 * Turns a closed day (Z report) into one balanced double-entry booking.
 * The journal CSV is made from it. One summarised entry per day, never one per sale.
 */

/** Ledger account codes. Defaults use Dutch decimal numbering; the owner can change them for their bookkeeper. */
export interface AccountMap {
  cash: string;
  /** Where card takings land until the bank pays them out. */
  card: string;
  abbPayable: string;
  /** Tips collected on behalf of staff: owed to them, not revenue. */
  tips: string;
  /** Cash counted differing from cash expected. */
  overShort: string;
  /** Revenue account per POS tax category id. */
  revenueByCategory: Record<string, string>;
  /** Fallbacks by kind when a category has no entry above. */
  revenueTaxed: string;
  revenueExempt: string;
  revenueOutsideScope: string;
}

export const DEFAULT_ACCOUNTS: AccountMap = {
  cash: '1000',
  card: '1100',
  abbPayable: '1600',
  tips: '1800',
  overShort: '4550',
  revenueByCategory: { service_6: '8000', goods_8: '8200', exempt: '8300', outside_scope: '8100' },
  revenueTaxed: '8000',
  revenueExempt: '8300',
  revenueOutsideScope: '8100',
};

export interface BookLine {
  account: string;
  /** Positive is a debit, negative is a credit. */
  amountCents: number;
  description: string;
}
export interface DayBooking {
  date: string;
  memo: string;
  /** Stable reference for this booking: lets an import be recognised if it is offered twice. */
  reference: string;
  lines: BookLine[];
}

export class BookingError extends Error {}

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;

export function dayBooking(z: ZReport, accounts: AccountMap = DEFAULT_ACCOUNTS, source = 'CactusPOS'): DayBooking {
  const r = z.report;
  const lines: BookLine[] = [];
  const add = (account: string, amountCents: number, description: string) => {
    if (!/^[0-9A-Za-z.-]{1,20}$/.test(account)) throw new BookingError(`"${account}" is not a usable account code`);
    if (amountCents !== 0) lines.push({ account, amountCents, description });
  };

  // Money in (debits).
  for (const t of r.tenders) {
    const account = t.method === 'cash' ? accounts.cash : accounts.card;
    add(account, t.amountCents, `${t.method === 'cash' ? 'Cash' : 'Card'} sales (${t.count})`);
    if (t.tipCents) add(account, t.tipCents, `Tips received by ${t.method}`);
  }
  // Revenue and tax (credits).
  for (const row of r.tax) {
    const account = accounts.revenueByCategory[row.taxCategoryId]
      ?? (row.kind === 'taxed' ? accounts.revenueTaxed : row.kind === 'exempt' ? accounts.revenueExempt : accounts.revenueOutsideScope);
    if (row.kind === 'taxed') {
      add(account, -row.netCents, `Sales ${row.name} (net)`);
      add(accounts.abbPayable, -row.taxCents, `ABB ${pct(row.bps)} on ${row.name}`);
    } else {
      add(account, -row.grossCents, `Sales ${row.name}`);
    }
  }
  if (r.tipsCents) add(accounts.tips, -r.tipsCents, 'Tips owed to staff');
  // Counted cash differing from expected: short is a cost, over is a gain.
  if (z.cashDifferenceCents) {
    add(accounts.cash, z.cashDifferenceCents, z.cashDifferenceCents < 0 ? 'Cash short' : 'Cash over');
    add(accounts.overShort, -z.cashDifferenceCents, z.cashDifferenceCents < 0 ? 'Cash short' : 'Cash over');
  }

  const off = lines.reduce((s, l) => s + l.amountCents, 0);
  if (off !== 0) throw new BookingError(`Z report #${z.number} does not balance (off by ${off} cents)`);
  const receipts = r.receipts.first !== null ? `, receipts #${r.receipts.first}-#${r.receipts.last}` : '';
  return {
    date: z.businessDate,
    memo: `${source} daily sales ${z.businessDate} (Z report #${z.number}${receipts})`,
    reference: `${source.toLowerCase()}-z${z.number}`,
    lines,
  };
}

/** Keeps only the latest Z report per business date: a day closed again replaces its earlier close. */
export function latestPerDay(reports: readonly ZReport[]): ZReport[] {
  const byDate = new Map<string, ZReport>();
  for (const z of reports) {
    const seen = byDate.get(z.businessDate);
    if (!seen || z.number > seen.number) byDate.set(z.businessDate, z);
  }
  return [...byDate.values()].sort((a, b) => a.businessDate.localeCompare(b.businessDate));
}
