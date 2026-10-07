import { randomUUID } from 'node:crypto';
import {
  computeTotals, type TaxCategory, type Order, type OrderLine, type MenuItem, type MenuCategory,
  type CreateOrderBodyT, type PayBodyT, type Business,
} from '@cactus/shared';
import { Auth, type Staff } from './auth.js';
import { getKv, nextCounter, tx, type DB } from './db.js';

export type { Business, Staff };
export const DEFAULT_BUSINESS: Business = {
  name: 'Cactus Blue', crib: '', address: 'Bonaire', phone: '',
  timezone: 'America/Kralendijk', currency: 'USD', locale: 'en', receiptFooter: 'Thank you! / Dank u wel!',
};

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export class PosService {
  readonly auth: Auth;
  constructor(private db: DB) { this.auth = new Auth(db); }

  business(): Business { return { ...DEFAULT_BUSINESS, ...getKv<Partial<Business>>(this.db, 'business', {}) }; }

  /** Local business date (YYYY-MM-DD) in the business timezone. */
  businessDate(now = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: this.business().timezone }).format(now);
  }

  taxCategories(): TaxCategory[] {
    return (this.db.prepare('SELECT data FROM tax_categories').all() as { data: string }[]).map((r) => JSON.parse(r.data));
  }
  menu(): { categories: MenuCategory[]; items: MenuItem[]; taxCategories: TaxCategory[] } {
    const categories = this.db.prepare('SELECT id, name, sort FROM menu_categories ORDER BY sort, name').all() as unknown as MenuCategory[];
    const items = (this.db.prepare('SELECT data FROM menu_items').all() as { data: string }[]).map((r) => JSON.parse(r.data) as MenuItem);
    return { categories, items, taxCategories: this.taxCategories() };
  }

  private isManagerPin(pin?: string): boolean {
    return !!pin && this.auth.findByPin(pin)?.role === 'owner';
  }

  getOrder(id: string): Order {
    const row = this.db.prepare('SELECT data FROM orders WHERE id = ?').get(id) as { data: string } | undefined;
    if (!row) throw new HttpError(404, 'Order not found');
    return JSON.parse(row.data);
  }
  /** Orders still needing attention today (not collected, not void) or unpaid. */
  activeOrders(): Order[] {
    const rows = this.db.prepare('SELECT data FROM orders WHERE business_date = ? ORDER BY ticket_number').all(this.businessDate()) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as Order).filter((o) => o.status !== 'void' && (o.status !== 'collected' || !o.paid));
  }
  todaysOrders(): Order[] {
    const rows = this.db.prepare('SELECT data FROM orders WHERE business_date = ? ORDER BY ticket_number DESC').all(this.businessDate()) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data));
  }

  private save(order: Order, type: string, payload: unknown, staff: Staff, date: string) {
    const now = new Date().toISOString();
    order.updatedAt = now;
    this.db.prepare(
      `INSERT INTO orders(id, ticket_number, receipt_number, business_date, data, created_at) VALUES (?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET receipt_number = excluded.receipt_number, data = excluded.data`,
    ).run(order.id, order.ticketNumber, order.receiptNumber, date, JSON.stringify(order), order.createdAt);
    this.db.prepare('INSERT INTO order_events(order_id, type, payload, staff_id, at) VALUES (?,?,?,?,?)')
      .run(order.id, type, JSON.stringify(payload), staff.id, now);
  }

  createOrder(body: CreateOrderBodyT, staff: Staff): Order {
    const menu = this.menu();
    const date = this.businessDate();
    const lines: OrderLine[] = body.lines.map((l) => {
      const item = menu.items.find((i) => i.id === l.itemId);
      if (!item) throw new HttpError(400, `Unknown item ${l.itemId}`);
      if (!item.available) throw new HttpError(409, `${item.name} is sold out`);
      const mods = l.modifierOptionIds.map((oid) => {
        for (const g of item.modifierGroups) {
          const o = g.options.find((x) => x.id === oid);
          if (o) return o;
        }
        throw new HttpError(400, `Unknown modifier ${oid}`);
      });
      for (const g of item.modifierGroups) {
        const picked = g.options.filter((o) => l.modifierOptionIds.includes(o.id)).length;
        if (g.required && picked === 0) throw new HttpError(400, `${g.name} is required for ${item.name}`);
        if (!g.multi && picked > 1) throw new HttpError(400, `Only one ${g.name} allowed`);
      }
      if (item.openPrice && !l.priceCents) throw new HttpError(400, `Enter the price for ${item.name}`);
      const base = item.openPrice ? l.priceCents! : item.priceCents;
      const unit = base + mods.reduce((s, m) => s + m.priceDeltaCents, 0);
      return {
        id: randomUUID(), itemId: item.id, name: item.name, qty: l.qty, unitPriceCents: unit,
        modifiers: mods, note: l.note, taxCategoryId: item.taxCategoryId, station: item.station,
        lineTotalCents: unit * l.qty,
      };
    });
    const totals = computeTotals(lines.map((l) => ({ taxCategoryId: l.taxCategoryId, grossCents: l.lineTotalCents })), menu.taxCategories, date);
    return tx(this.db, () => {
      const now = new Date().toISOString();
      const order: Order = {
        id: randomUUID(), ticketNumber: nextCounter(this.db, `ticket:${date}`), receiptNumber: null,
        status: 'sent', paid: false, lines, payments: [], note: body.note, source: body.source,
        totalCents: totals.totalCents, taxCents: totals.taxCents, breakdown: totals.breakdown,
        createdAt: now, updatedAt: now, createdBy: staff.id,
      };
      this.save(order, 'order.created', { lines: body.lines }, staff, date);
      return order;
    });
  }

  pay(id: string, body: PayBodyT, staff: Staff): Order {
    return tx(this.db, () => {
      const order = this.getOrder(id);
      if (order.status === 'void') throw new HttpError(409, 'Order is void');
      if (order.paid) throw new HttpError(409, 'Order already paid');
      let tendered: number | undefined, change: number | undefined;
      if (body.method === 'cash') {
        tendered = body.tenderedCents ?? order.totalCents;
        if (tendered < order.totalCents) throw new HttpError(400, 'Cash tendered is less than the total');
        change = tendered - order.totalCents;
      }
      order.payments.push({
        id: randomUUID(), method: body.method, amountCents: order.totalCents, tenderedCents: tendered,
        changeCents: change, reference: body.reference, tipCents: body.tipCents, at: new Date().toISOString(),
      });
      order.paid = true;
      order.receiptNumber = nextCounter(this.db, 'receipt');
      this.save(order, 'order.paid', { method: body.method, tendered, change, tip: body.tipCents }, staff, this.rowDate(id));
      return order;
    });
  }

  setStatus(id: string, status: 'preparing' | 'ready' | 'collected', staff: Staff): Order {
    return tx(this.db, () => {
      const order = this.getOrder(id);
      if (order.status === 'void') throw new HttpError(409, 'Order is void');
      order.status = status;
      this.save(order, 'order.status', { status }, staff, this.rowDate(id));
      return order;
    });
  }

  voidOrder(id: string, reason: string, managerPin: string | undefined, staff: Staff): Order {
    return tx(this.db, () => {
      const order = this.getOrder(id);
      if (order.status === 'void') throw new HttpError(409, 'Already void');
      if ((order.paid || order.status !== 'sent') && staff.role !== 'owner' && !this.isManagerPin(managerPin)) {
        throw new HttpError(403, 'Manager PIN required');
      }
      order.status = 'void';
      order.voidReason = reason;
      this.save(order, 'order.void', { reason }, staff, this.rowDate(id));
      return order;
    });
  }

  private rowDate(id: string): string {
    return (this.db.prepare('SELECT business_date FROM orders WHERE id = ?').get(id) as { business_date: string }).business_date;
  }

  /** What the public pickup board may see: numbers and states only. */
  pickupBoard() {
    const active = this.activeOrders().filter((o) => o.status === 'sent' || o.status === 'preparing' || o.status === 'ready');
    return {
      preparing: active.filter((o) => o.status !== 'ready').map((o) => o.ticketNumber),
      ready: active.filter((o) => o.status === 'ready').map((o) => o.ticketNumber),
    };
  }
}
