import { z } from 'zod';
import type { Business, DayReport, Order, ZReport } from '@cactus/shared';
import { NetworkTransport, PrintQueue, type PrintJob, type Transport } from '@cactus/printer';
import { buildDayReport, buildKitchenTicket, buildReceipt, buildTestPage, drawerKick, renderEscPos, type Block } from '@cactus/receipt';
import { getKv, setKv, type DB } from './db.js';

export const PrinterSettings = z.object({
  /** Off = receipts open in the browser's print dialog instead. */
  enabled: z.boolean().default(false),
  host: z.string().max(100).default(''),
  port: z.number().int().min(1).max(65535).default(9100),
  /** 48 = 80mm paper, 32 = 58mm. */
  columns: z.union([z.literal(32), z.literal(42), z.literal(48)]).default(48),
  cutter: z.boolean().default(true),
  /** A cash drawer is plugged into the printer. */
  drawer: z.boolean().default(false),
  /** Print the customer receipt automatically when an order is paid. */
  autoReceipt: z.boolean().default(true),
  /** Print a kitchen ticket automatically when an order is sent. */
  autoKitchen: z.boolean().default(false),
});
export type PrinterSettings = z.infer<typeof PrinterSettings>;

export class Printing {
  readonly queue: PrintQueue;
  constructor(private db: DB, private business: () => Business, makeTransport?: (s: PrinterSettings) => Transport | null) {
    this.queue = new PrintQueue();
    this.makeTransport = makeTransport ?? ((s) => (s.enabled && s.host ? new NetworkTransport(s.host, s.port) : null));
    this.queue.setTransport(this.makeTransport(this.settings()));
  }
  private makeTransport: (s: PrinterSettings) => Transport | null;

  settings(): PrinterSettings { return PrinterSettings.parse(getKv(this.db, 'printer', {})); }
  save(s: PrinterSettings): PrinterSettings {
    setKv(this.db, 'printer', s);
    this.queue.setTransport(this.makeTransport(s));
    return s;
  }
  get active(): boolean { const s = this.settings(); return s.enabled && !!s.host; }

  private print(label: string, blocks: Block[]): PrintJob {
    const s = this.settings();
    return this.queue.add(label, renderEscPos(blocks, { columns: s.columns, cutter: s.cutter }));
  }
  receipt(o: Order, opts: { copy?: boolean; openDrawer?: boolean } = {}): PrintJob {
    return this.print(`Receipt #${o.receiptNumber ?? '-'}`, buildReceipt(o, this.business(), opts));
  }
  kitchen(o: Order): PrintJob { return this.print(`Kitchen #${o.ticketNumber}`, buildKitchenTicket(o, this.business())); }
  test(): PrintJob { return this.print('Test page', buildTestPage(this.business())); }
  dayReport(r: DayReport | ZReport): PrintJob { return this.print('report' in r ? `Z report #${r.number}` : 'X report', buildDayReport(r, this.business())); }
  openDrawer(): PrintJob { return this.queue.add('Open drawer', drawerKick()); }

  /** Called after a sale is paid. Opens the drawer for cash even if receipts are not auto-printed. */
  onPaid(o: Order): void {
    if (!this.active) return;
    const s = this.settings();
    const cash = s.drawer && o.payments.some((p) => p.method === 'cash');
    if (s.autoReceipt) this.receipt(o, { openDrawer: cash });
    else if (cash) this.openDrawer();
  }
  onSent(o: Order): void {
    if (this.active && this.settings().autoKitchen) this.kitchen(o);
  }
}
