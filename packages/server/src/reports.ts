import { sumCents, type CloseDayBodyT, type DayReport, type Order, type TaxBreakdownRow, type TenderTotal, type ZReport } from '@cactus/shared';
import { tx, type DB } from './db.js';
import { HttpError, type PosService } from './service.js';
import type { Staff } from './auth.js';

type Method = 'cash' | 'card';
const METHODS: Method[] = ['cash', 'card'];

/** Day reports are derived from the stored orders, never from the menu or today's tax rates. */
export class Reports {
  constructor(private db: DB, private pos: PosService) {}

  private ordersOn(date: string): Order[] {
    return (this.db.prepare('SELECT data FROM orders WHERE business_date = ? ORDER BY ticket_number').all(date) as { data: string }[]).map((r) => JSON.parse(r.data) as Order);
  }

  day(date = this.pos.businessDate()): DayReport {
    const orders = this.ordersOn(date);
    const sold = orders.filter((o) => o.paid && o.status !== 'void');
    const refunded = orders.filter((o) => o.paid && o.status === 'void');
    const unpaid = orders.filter((o) => !o.paid && o.status !== 'void');

    const tax = new Map<string, TaxBreakdownRow>();
    for (const o of sold) {
      for (const b of o.breakdown) {
        const key = `${b.taxCategoryId}@${b.bps}`;
        const row = tax.get(key) ?? { ...b, grossCents: 0, taxCents: 0, netCents: 0 };
        row.grossCents += b.grossCents; row.taxCents += b.taxCents; row.netCents += b.netCents;
        tax.set(key, row);
      }
    }
    const tenders: TenderTotal[] = METHODS.map((method) => {
      const ps = sold.flatMap((o) => o.payments).filter((p) => p.method === method);
      return { method, count: ps.length, amountCents: sumCents(ps.map((p) => p.amountCents)), tipCents: sumCents(ps.map((p) => p.tipCents ?? 0)) };
    });
    const refunds = METHODS.map((method) => {
      const ps = refunded.flatMap((o) => o.payments).filter((p) => p.method === method);
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
      const hour = Number(hourOf.format(new Date(o.createdAt)));
      const row = hours.get(hour) ?? { hour, orders: 0, grossCents: 0 };
      row.orders += 1; row.grossCents += o.totalCents;
      hours.set(hour, row);
    }
    const numbers = sold.concat(refunded).map((o) => o.receiptNumber).filter((n): n is number => n !== null).sort((a, b) => a - b);
    const grossCents = sumCents(sold.map((o) => o.totalCents));
    const taxCents = sumCents(sold.map((o) => o.taxCents));
    // Tenders already leave out refunded sales (taken in, handed back: net nothing), so the drawer
    // should hold exactly the cash from the sales that stand.
    const cash = tenders.find((t) => t.method === 'cash')!.amountCents;
    return {
      businessDate: date, generatedAt: new Date().toISOString(),
      orders: { sold: sold.length, unpaid: unpaid.length, unpaidCents: sumCents(unpaid.map((o) => o.totalCents)), voidedUnpaid: orders.filter((o) => !o.paid && o.status === 'void').length, refunded: refunded.length },
      sales: { grossCents, taxCents, netCents: grossCents - taxCents },
      tax: [...tax.values()].sort((a, b) => b.bps - a.bps || a.taxCategoryId.localeCompare(b.taxCategoryId)),
      tenders,
      tipsCents: sumCents(tenders.map((t) => t.tipCents)),
      refunds,
      cashExpectedCents: cash,
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
