import { sumCents, type CloseDayBodyT, type DayReport, type Order, type TaxBreakdownRow, type TenderTotal, type ZReport } from '@cactus/shared';
import { tx, type DB } from './db.js';
import { HttpError, type PosService } from './service.js';
import type { Staff } from './auth.js';

type Method = 'cash' | 'card';
const METHODS: Method[] = ['cash', 'card'];

interface Row { data: string; paid_date: string | null; void_date: string | null }

/**
 * Day reports are derived from the stored orders, never from the menu or today's tax rates.
 * A sale counts on the day it was paid and a refund on the day the money was handed back
 * (`orders.paid_date` / `orders.void_date`), not on the day the order was opened: a tab opened
 * yesterday and paid today is today's sale, in today's drawer.
 */
export class Reports {
  constructor(private db: DB, private pos: PosService) {}

  private select(where: string, date: string): Order[] {
    return (this.db.prepare(`SELECT data, paid_date, void_date FROM orders WHERE ${where} ORDER BY receipt_number, created_at`).all(date) as unknown as Row[])
      // The row's dates are authoritative: orders stored before the dates were recorded do not carry them in their JSON.
      .map((r) => ({ ...(JSON.parse(r.data) as Order), paidDate: r.paid_date ?? undefined, voidDate: r.void_date ?? undefined }));
  }

  day(date = this.pos.businessDate()): DayReport {
    const paidToday = this.select('paid_date = ?', date);
    const refundedToday = this.select('void_date = ? AND paid_date IS NOT NULL', date);
    const opened = this.select('business_date = ?', date);
    // Paid and handed back on the same day: net nothing, so it is in neither the sales nor the payments.
    const sold = paidToday.filter((o) => o.voidDate !== date);
    // Sold on an earlier day (and counted there), refunded today: comes off today's figures.
    const earlier = refundedToday.filter((o) => o.paidDate !== date);
    const unpaid = opened.filter((o) => !o.paid && o.status !== 'void');

    const tax = new Map<string, TaxBreakdownRow>();
    const addTax = (orders: Order[], sign: 1 | -1) => {
      for (const o of orders) {
        for (const b of o.breakdown) {
          const key = `${b.taxCategoryId}@${b.bps}`;
          const row = tax.get(key) ?? { ...b, grossCents: 0, taxCents: 0, netCents: 0 };
          row.grossCents += sign * b.grossCents; row.taxCents += sign * b.taxCents; row.netCents += sign * b.netCents;
          tax.set(key, row);
        }
      }
    };
    addTax(sold, 1);
    addTax(earlier, -1);

    const of = (orders: Order[], method: Method) => orders.flatMap((o) => o.payments).filter((p) => p.method === method);
    const tenders: TenderTotal[] = METHODS.map((method) => {
      const taken = of(sold, method), back = of(earlier, method);
      return {
        method, count: taken.length,
        amountCents: sumCents(taken.map((p) => p.amountCents)) - sumCents(back.map((p) => p.amountCents)),
        tipCents: sumCents(taken.map((p) => p.tipCents ?? 0)) - sumCents(back.map((p) => p.tipCents ?? 0)),
      };
    });
    const refunds = METHODS.map((method) => {
      const ps = of(refundedToday, method);
      return { method, count: ps.length, amountCents: sumCents(ps.map((p) => p.amountCents)) };
    }).filter((r) => r.count > 0);

    const items = new Map<string, { name: string; qty: number; grossCents: number }>();
    for (const l of sold.flatMap((o) => o.lines)) {
      const row = items.get(l.name) ?? { name: l.name, qty: 0, grossCents: 0 };
      row.qty += l.qty; row.grossCents += l.lineTotalCents;
      items.set(l.name, row);
    }
    const hourOf = new Intl.DateTimeFormat('en-GB', { timeZone: this.pos.business().timezone, hour: '2-digit', hourCycle: 'h23' });
    const hours = new Map<number, { hour: number; orders: number; grossCents: number }>();
    for (const o of sold) {
      const hour = Number(hourOf.format(new Date(o.payments[0]?.at ?? o.createdAt)));
      const row = hours.get(hour) ?? { hour, orders: 0, grossCents: 0 };
      row.orders += 1; row.grossCents += o.totalCents;
      hours.set(hour, row);
    }
    // Receipts are numbered when paid, so the day's numbers are one unbroken run.
    const numbers = paidToday.map((o) => o.receiptNumber).filter((n): n is number => n !== null).sort((a, b) => a - b);
    const backGross = sumCents(earlier.map((o) => o.totalCents)), backTax = sumCents(earlier.map((o) => o.taxCents));
    const grossCents = sumCents(sold.map((o) => o.totalCents)) - backGross;
    const taxCents = sumCents(sold.map((o) => o.taxCents)) - backTax;
    return {
      businessDate: date, generatedAt: new Date().toISOString(),
      orders: { sold: sold.length, unpaid: unpaid.length, unpaidCents: sumCents(unpaid.map((o) => o.totalCents)), voidedUnpaid: opened.filter((o) => !o.paid && o.status === 'void').length, refunded: refundedToday.length },
      sales: { grossCents, taxCents, netCents: grossCents - taxCents },
      tax: [...tax.values()].filter((row) => row.grossCents !== 0 || row.taxCents !== 0).sort((a, b) => b.bps - a.bps || a.taxCategoryId.localeCompare(b.taxCategoryId)),
      tenders,
      tipsCents: sumCents(tenders.map((t) => t.tipCents)),
      refunds,
      ...(earlier.length ? { refundedEarlier: { count: earlier.length, grossCents: backGross, taxCents: backTax } } : {}),
      // Cash in for sales, less cash handed back: both sides are already in the cash tender line.
      cashExpectedCents: tenders.find((t) => t.method === 'cash')!.amountCents,
      receipts: { first: numbers[0] ?? null, last: numbers[numbers.length - 1] ?? null, count: numbers.length },
      items: [...items.values()].sort((a, b) => b.grossCents - a.grossCents || a.name.localeCompare(b.name)),
      hours: [...hours.values()].sort((a, b) => a.hour - b.hour),
    };
  }

  /**
   * Stores the day's figures as a numbered Z report. A day can be closed again (a late sale, a
   * recount): each close gets a new number and the latest one for a date is the one that counts.
   */
  close(body: CloseDayBodyT, by: Staff): ZReport {
    if (body.date > this.pos.businessDate()) throw new HttpError(400, 'That day has not happened yet');
    return tx(this.db, () => {
      const report = this.day(body.date);
      const counted = body.countedCashCents ?? null;
      const number = ((this.db.prepare('SELECT MAX(number) AS n FROM z_reports').get() as { n: number | null }).n ?? 0) + 1;
      const z: ZReport = {
        number, businessDate: body.date, closedAt: report.generatedAt, closedBy: by.id,
        countedCashCents: counted, cashDifferenceCents: counted === null ? null : counted - report.cashExpectedCents,
        note: body.note, report,
      };
      this.db.prepare('INSERT INTO z_reports(number, business_date, closed_at, closed_by, data) VALUES (?,?,?,?,?)').run(number, body.date, z.closedAt, by.id, JSON.stringify(z));
      return z;
    });
  }

  list(limit = 60): ZReport[] {
    return (this.db.prepare('SELECT data FROM z_reports ORDER BY number DESC LIMIT ?').all(limit) as { data: string }[]).map((r) => JSON.parse(r.data) as ZReport);
  }
  latestFor(date: string): ZReport | null {
    const row = this.db.prepare('SELECT data FROM z_reports WHERE business_date = ? ORDER BY number DESC LIMIT 1').get(date) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as ZReport) : null;
  }
}
