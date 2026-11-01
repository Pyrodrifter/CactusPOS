import { randomUUID } from 'node:crypto';
import { StockItem, type Order, type StockList, type StockRow } from '@cactus/shared';
import { tx, type DB } from './db.js';
import { HttpError, type PosService, type Staff } from './service.js';

/**
 * Stock counts. Every change is a row in the append-only `stock_moves`, so a count is always the sum of its moves.
 * Sales never write here: what was sold is read from today's orders, so a void or a correction puts itself right,
 * and nothing in the order path depends on stock.
 */
export class Stock {
  constructor(private db: DB, private svc: PosService) {}

  private items(): StockItem[] {
    return (this.db.prepare('SELECT data FROM stock_items').all() as { data: string }[]).map((r) => JSON.parse(r.data) as StockItem);
  }
  private item(id: string): StockItem {
    const row = this.db.prepare('SELECT data FROM stock_items WHERE id = ? AND archived_at IS NULL').get(id) as { data: string } | undefined;
    if (!row) throw new HttpError(404, 'Stock item not found');
    return JSON.parse(row.data) as StockItem;
  }

  /** What was sold today, per menu item. */
  private soldToday(date: string): Map<string, number> {
    const sold = new Map<string, number>();
    const rows = this.db.prepare('SELECT data FROM orders WHERE business_date = ?').all(date) as { data: string }[];
    for (const r of rows) {
      const order = JSON.parse(r.data) as Order;
      if (order.status === 'void') continue;
      for (const l of order.lines) sold.set(l.itemId, (sold.get(l.itemId) ?? 0) + l.qty);
    }
    return sold;
  }

  private qty(item: StockItem, date: string): number {
    const row = item.kind === 'prepared'
      ? this.db.prepare('SELECT COALESCE(SUM(delta), 0) AS n FROM stock_moves WHERE item_id = ? AND business_date = ?').get(item.id, date)
      : this.db.prepare('SELECT COALESCE(SUM(delta), 0) AS n FROM stock_moves WHERE item_id = ?').get(item.id);
    return (row as { n: number }).n;
  }

  list(): StockList {
    const date = this.svc.businessDate();
    const sold = this.soldToday(date);
    const live = new Set((this.db.prepare('SELECT id FROM stock_items WHERE archived_at IS NULL').all() as { id: string }[]).map((r) => r.id));
    const items: StockRow[] = this.items().filter((i) => live.has(i.id)).map((item) => {
      const qty = this.qty(item, date);
      const count = item.kind === 'prepared' ? item.menuItemIds.reduce((sum, id) => sum + (sold.get(id) ?? 0), 0) : 0;
      return { ...item, qty, sold: count, left: qty - count };
    });
    return { date, items: items.sort((a, b) => a.name.localeCompare(b.name)) };
  }

  save(input: StockItem): StockList {
    const item = StockItem.parse({ ...input, menuItemIds: input.kind === 'prepared' ? input.menuItemIds : [] });
    this.db.prepare('INSERT INTO stock_items(id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, archived_at = NULL').run(item.id, JSON.stringify(item));
    return this.list();
  }

  /** Takes an item off the list. Its moves stay. */
  remove(id: string): StockList {
    this.item(id);
    this.db.prepare('UPDATE stock_items SET archived_at = ? WHERE id = ?').run(new Date().toISOString(), id);
    return this.list();
  }

  adjust(id: string, delta: number, staff: Staff): StockList {
    tx(this.db, () => {
      const item = this.item(id);
      const date = this.svc.businessDate();
      if (this.qty(item, date) + delta < 0) throw new HttpError(409, `${item.name} cannot go below zero`);
      this.db.prepare('INSERT INTO stock_moves(id, item_id, business_date, delta, staff_id, at) VALUES (?,?,?,?,?,?)')
        .run(randomUUID(), id, date, delta, staff.id, new Date().toISOString());
    });
    return this.list();
  }
}
