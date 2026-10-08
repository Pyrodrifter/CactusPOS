import { randomUUID } from 'node:crypto';
import {
  computeTotals, sumCents, type TaxCategory, type Order, type OrderLine, type OrderLineInput, type MenuItem, type MenuCategory,
  type AddLinesBodyT, type CreateOrderBodyT, type PayBodyT, type Business, type MenuResponse, type PickupBoard,
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
  menu(): MenuResponse {
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
  /** Every unpaid, non-void order, whatever day it was started: the tab list. Oldest first. */
  openTabs(): Order[] {
    const rows = this.db.prepare('SELECT data FROM orders WHERE receipt_number IS NULL ORDER BY created_at').all() as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as Order).filter((o) => !o.paid && o.status !== 'void');
  }
  todaysOrders(): Order[] {
    const rows = this.db.prepare('SELECT data FROM orders WHERE business_date = ? ORDER BY ticket_number DESC').all(this.businessDate()) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data));
  }

  /**
   * Writes the current order and appends an event. Every event carries the complete order as it
   * stood, with its own copy of names, prices, tax and payments, so the sale can be rebuilt from
   * the event log alone, whatever later happens to the menu, the rates or the `orders` row.
   */
  private save(order: Order, type: string, payload: Record<string, unknown>, staff: Staff, date: string, isNew = false) {
    const now = new Date().toISOString();
    order.updatedAt = now;
    const data = JSON.stringify(order);
    if (isNew) {
      this.db.prepare('INSERT INTO orders(id, ticket_number, receipt_number, business_date, data, created_at) VALUES (?,?,?,?,?,?)')
        .run(order.id, order.ticketNumber, order.receiptNumber, date, data, order.createdAt);
    } else {
      this.db.prepare('UPDATE orders SET receipt_number = ?, data = ? WHERE id = ?').run(order.receiptNumber, data, order.id);
    }
    this.db.prepare('INSERT INTO order_events(order_id, type, payload, staff_id, at) VALUES (?,?,?,?,?)')
      .run(order.id, type, JSON.stringify({ ...payload, order }), staff.id, now);
  }

  /** The order a repeated request already produced, if any. */
  private replayed(kind: 'create' | 'pay' | 'add', requestId: string | undefined): Order | null {
    if (!requestId) return null;
    const row = this.db.prepare('SELECT order_id FROM requests WHERE key = ?').get(`${kind}:${requestId}`) as { order_id: string } | undefined;
    return row ? this.getOrder(row.order_id) : null;
  }
  private remember(kind: 'create' | 'pay' | 'add', requestId: string | undefined, orderId: string): void {
    if (requestId) this.db.prepare('INSERT INTO requests(key, kind, order_id, at) VALUES (?,?,?,?)').run(`${kind}:${requestId}`, kind, orderId, new Date().toISOString());
  }

  /** The order as recorded by its latest event: the authoritative copy if the `orders` row is ever in doubt. */
  orderFromEvents(id: string): Order | null {
    const rows = this.db.prepare('SELECT payload FROM order_events WHERE order_id = ? ORDER BY seq DESC').all(id) as { payload: string }[];
    for (const r of rows) {
      const snapshot = (JSON.parse(r.payload) as { order?: Order }).order;
      if (snapshot) return snapshot;
    }
    return null; // only events written before snapshots were recorded
  }

  /**
   * Cross-checks the three records of every sale: the current order row, the event log and the
   * payments table. Returns one line per disagreement; an empty list means the ledger is consistent.
   */
  verifyLedger(): string[] {
    const problems: string[] = [];
    const orders = this.db.prepare('SELECT id, receipt_number, data FROM orders').all() as { id: string; receipt_number: number | null; data: string }[];
    for (const row of orders) {
      const order = JSON.parse(row.data) as Order;
      const snapshot = this.orderFromEvents(row.id);
      if (snapshot && JSON.stringify(snapshot) !== row.data) problems.push(`order ${row.id}: current record differs from its last event`);
      const paid = this.db.prepare('SELECT id, amount_cents FROM payments WHERE order_id = ? ORDER BY at').all(row.id) as { id: string; amount_cents: number }[];
      if (paid.length !== order.payments.length || paid.some((p) => !order.payments.some((x) => x.id === p.id && x.amountCents === p.amount_cents))) {
        problems.push(`order ${row.id}: payments on the order do not match the payments table`);
      }
      if ((row.receipt_number ?? null) !== order.receiptNumber) problems.push(`order ${row.id}: receipt number mismatch`);
    }
    const max = (this.db.prepare('SELECT MAX(receipt_number) AS m, COUNT(receipt_number) AS n FROM orders').get() as { m: number | null; n: number });
    if ((max.m ?? 0) !== max.n) problems.push(`receipt numbers have a gap: highest is ${max.m ?? 0} but ${max.n} were issued`);
    return problems;
  }

  /** Restores an order row from its last event. Returns false when no snapshot exists. */
  repairOrder(id: string): boolean {
    const snapshot = this.orderFromEvents(id);
    if (!snapshot) return false;
    tx(this.db, () => { this.db.prepare('UPDATE orders SET receipt_number = ?, data = ? WHERE id = ?').run(snapshot.receiptNumber, JSON.stringify(snapshot), id); });
    return true;
  }

  /** Prices a set of requested lines against the menu as it is now. Throws HttpError for anything not sellable. */
  private buildLines(inputs: OrderLineInput[], menu: MenuResponse, round: number): OrderLine[] {
    return inputs.map((l) => {
      const item = menu.items.find((i) => i.id === l.itemId);
      if (!item) throw new HttpError(400, `Unknown item ${l.itemId}`);
      if (!item.available) throw new HttpError(409, `${item.name} is sold out`);
      // The same option twice would add its price twice while still passing the "only one" check.
      if (new Set(l.modifierOptionIds).size !== l.modifierOptionIds.length) throw new HttpError(400, `An option was chosen twice for ${item.name}`);
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
      // Discounting options can add up to more than the item costs; a sale is never negative.
      if (unit < 0) throw new HttpError(400, `The options chosen make ${item.name} cost less than nothing`);
      return {
        id: randomUUID(), itemId: item.id, name: item.name, qty: l.qty, unitPriceCents: unit,
        modifiers: mods, note: l.note, taxCategoryId: item.taxCategoryId, station: item.station,
        lineTotalCents: unit * l.qty, round,
      };
    });
  }

  /**
   * Adds the totals of new lines to an order. Lines already on the order are never re-priced or
   * re-taxed: only the new ones are computed, then the receipt figures are summed.
   */
  private addTotals(order: Pick<Order, 'totalCents' | 'taxCents' | 'breakdown'>, lines: OrderLine[], menu: MenuResponse, date: string): void {
    const totals = computeTotals(lines.map((l) => ({ taxCategoryId: l.taxCategoryId, grossCents: l.lineTotalCents })), menu.taxCategories, date);
    // Per-line ABB is stored with the order so receipts and the books never have to recompute it.
    lines.forEach((l, i) => { l.taxCents = totals.lines[i]!.taxCents; });
    for (const row of totals.breakdown) {
      const same = order.breakdown.find((x) => x.taxCategoryId === row.taxCategoryId && x.bps === row.bps);
      if (same) { same.grossCents += row.grossCents; same.taxCents += row.taxCents; same.netCents += row.netCents; }
      else order.breakdown.push(row);
    }
    order.totalCents = sumCents([order.totalCents, totals.totalCents]);
    order.taxCents = sumCents([order.taxCents, totals.taxCents]);
  }

  createOrder(body: CreateOrderBodyT, staff: Staff, requestId?: string): Order {
    const before = this.replayed('create', requestId);
    if (before) return before;
    const menu = this.menu();
    const date = this.businessDate();
    const lines = this.buildLines(body.lines, menu, 1);
    const figures = { totalCents: 0, taxCents: 0, breakdown: [] as Order['breakdown'] };
    this.addTotals(figures, lines, menu, date);
    return tx(this.db, () => {
      const again = this.replayed('create', requestId); // another writer may have finished the same request meanwhile
      if (again) return again;
      const now = new Date().toISOString();
      const order: Order = {
        id: randomUUID(), ticketNumber: nextCounter(this.db, `ticket:${date}`), receiptNumber: null,
        status: 'sent', paid: false, lines, payments: [], note: body.note, source: body.source,
        totalCents: figures.totalCents, taxCents: figures.taxCents, breakdown: figures.breakdown,
        tabName: body.tabName, round: 1, kitchenRound: 1, kitchenSince: now,
        createdAt: now, updatedAt: now, createdBy: staff.id,
      };
      this.save(order, 'order.created', { request: body.lines }, staff, date, true);
      this.remember('create', requestId, order.id);
      return order;
    });
  }

  /**
   * Adds a round of items to an open tab. The kitchen gets the new round; what was already made
   * is not sent again. Earlier lines keep the price and tax they were sold at.
   */
  addLines(id: string, body: AddLinesBodyT, staff: Staff, requestId?: string): Order {
    return tx(this.db, () => {
      const before = this.replayed('add', requestId);
      if (before) {
        if (before.id !== id) throw new HttpError(409, 'This request was already used for another order');
        return before;
      }
      const order = this.getOrder(id);
      if (order.status === 'void') throw new HttpError(409, 'Order is void');
      if (order.paid) throw new HttpError(409, 'This order is already paid. Start a new order instead.');
      const round = (order.round ?? 1) + 1;
      const menu = this.menu();
      const lines = this.buildLines(body.lines, menu, round);
      this.addTotals(order, lines, menu, this.rowDate(id));
      order.lines.push(...lines);
      order.round = round;
      // If the kitchen had finished everything so far, this round is a fresh ticket for them.
      // If they are still on an earlier round, the new lines simply join the ticket they have.
      if (order.status === 'ready' || order.status === 'collected') {
        order.kitchenRound = round;
        order.kitchenSince = new Date().toISOString();
        order.status = 'sent';
      } else {
        order.kitchenRound = order.kitchenRound ?? 1;
      }
      this.save(order, 'order.lines_added', { request: body.lines, round }, staff, this.rowDate(id));
      this.remember('add', requestId, order.id);
      return order;
    });
  }

  setTabName(id: string, tabName: string, staff: Staff): Order {
    return tx(this.db, () => {
      const order = this.getOrder(id);
      if (order.status === 'void') throw new HttpError(409, 'Order is void');
      order.tabName = tabName || undefined;
      this.save(order, 'order.tab_named', { tabName }, staff, this.rowDate(id));
      return order;
    });
  }

  pay(id: string, body: PayBodyT, staff: Staff, requestId?: string): Order {
    return tx(this.db, () => {
      const before = this.replayed('pay', requestId);
      if (before) {
        if (before.id !== id) throw new HttpError(409, 'This request was already used for another order');
        return before;
      }
      const order = this.getOrder(id);
      if (order.status === 'void') throw new HttpError(409, 'Order is void');
      if (order.paid) throw new HttpError(409, 'Order already paid');
      let tendered: number | undefined, change: number | undefined;
      if (body.method === 'cash') {
        tendered = body.tenderedCents ?? order.totalCents;
        if (tendered < order.totalCents) throw new HttpError(400, 'Cash tendered is less than the total');
        change = tendered - order.totalCents;
      }
      const payment = {
        id: randomUUID(), method: body.method, amountCents: order.totalCents, tenderedCents: tendered,
        changeCents: change, reference: body.reference, tipCents: body.tipCents, at: new Date().toISOString(),
      };
      order.payments.push(payment);
      order.paid = true;
      order.receiptNumber = nextCounter(this.db, 'receipt');
      // The payments table is the protected record of money taken; the order keeps a copy for display.
      this.db.prepare('INSERT INTO payments(id, order_id, receipt_number, method, amount_cents, tendered_cents, change_cents, tip_cents, reference, staff_id, at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .run(payment.id, order.id, order.receiptNumber, payment.method, payment.amountCents, tendered ?? null, change ?? null, payment.tipCents, payment.reference ?? null, staff.id, payment.at);
      this.save(order, 'order.paid', { payment, receiptNumber: order.receiptNumber }, staff, this.rowDate(id));
      this.remember('pay', requestId, order.id);
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
  pickupBoard(): PickupBoard {
    const active = this.activeOrders().filter((o) => o.status === 'sent' || o.status === 'preparing' || o.status === 'ready');
    return {
      preparing: active.filter((o) => o.status !== 'ready').map((o) => o.ticketNumber),
      ready: active.filter((o) => o.status === 'ready').map((o) => o.ticketNumber),
    };
  }
}
