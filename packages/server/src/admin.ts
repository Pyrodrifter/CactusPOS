import { randomUUID } from 'node:crypto';
import type { AuditRow, Business, MenuCategory, MenuItem, StaffInputT, StaffRow, TaxCategory } from '@cactus/shared';
import { setKv, tx, type DB } from './db.js';
import { hashPin, type Auth, type Staff } from './auth.js';
import { HttpError, type PosService } from './service.js';

/** Owner-only changes to menu, business details, staff and tax setup. Every change is written to the audit log. */
export class AdminService {
  constructor(private db: DB, private pos: PosService, private auth: Auth) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, payload TEXT NOT NULL, staff_id TEXT NOT NULL, at TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS audit_log_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;`);
  }

  private log(type: string, payload: unknown, by: Staff): void {
    this.db.prepare('INSERT INTO audit_log(type, payload, staff_id, at) VALUES (?,?,?,?)').run(type, JSON.stringify(payload), by.id, new Date().toISOString());
  }

  /* ----- menu ----- */
  upsertCategory(c: MenuCategory, by: Staff): MenuCategory {
    return tx(this.db, () => {
      this.db.prepare('INSERT INTO menu_categories(id, name, sort) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, sort = excluded.sort').run(c.id, c.name, c.sort);
      this.log('menu.category.saved', c, by);
      return c;
    });
  }
  deleteCategory(id: string, by: Staff): void {
    tx(this.db, () => {
      if (this.pos.menu().items.some((i) => i.categoryId === id)) throw new HttpError(409, 'Move or remove the items in this category first');
      this.db.prepare('DELETE FROM menu_categories WHERE id = ?').run(id);
      this.log('menu.category.deleted', { id }, by);
    });
  }
  upsertItem(item: MenuItem, by: Staff): MenuItem {
    return tx(this.db, () => {
      const menu = this.pos.menu();
      if (!menu.categories.some((c) => c.id === item.categoryId)) throw new HttpError(400, 'Unknown category');
      if (!menu.taxCategories.some((t) => t.id === item.taxCategoryId)) throw new HttpError(400, 'Unknown tax category');
      const optionIds = item.modifierGroups.flatMap((g) => g.options.map((o) => o.id));
      if (new Set(optionIds).size !== optionIds.length) throw new HttpError(400, 'Option ids must be unique within an item');
      for (const g of item.modifierGroups) {
        if (g.options.length === 0) throw new HttpError(400, `Option group "${g.name}" has no options`);
      }
      // Cheapest possible sale: every discount that can be picked together. Checking options one by one
      // misses two groups that each take off more than half the price.
      if (!item.openPrice) {
        const lowest = item.modifierGroups.reduce((sum, g) => {
          const cuts = g.options.map((o) => o.priceDeltaCents).filter((d) => d < 0);
          return sum + (g.multi ? cuts.reduce((a, b) => a + b, 0) : Math.min(0, ...cuts));
        }, item.priceCents);
        if (lowest < 0) throw new HttpError(400, 'Discount options could take this item below a price of zero');
      }
      this.db.prepare('INSERT INTO menu_items(id, data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data = excluded.data').run(item.id, JSON.stringify(item));
      this.log('menu.item.saved', item, by);
      return item;
    });
  }
  /** Past orders keep their own copy of name and price, so removing an item never rewrites history. */
  deleteItem(id: string, by: Staff): void {
    tx(this.db, () => {
      this.db.prepare('DELETE FROM menu_items WHERE id = ?').run(id);
      this.log('menu.item.deleted', { id }, by);
    });
  }
  /** Any staff member may mark an item sold out during service. */
  setAvailable(id: string, available: boolean, by: Staff): MenuItem {
    return tx(this.db, () => {
      const row = this.db.prepare('SELECT data FROM menu_items WHERE id = ?').get(id) as { data: string } | undefined;
      if (!row) throw new HttpError(404, 'Item not found');
      const item = { ...(JSON.parse(row.data) as MenuItem), available };
      this.db.prepare('UPDATE menu_items SET data = ? WHERE id = ?').run(JSON.stringify(item), id);
      this.log('menu.item.available', { id, available }, by);
      return item;
    });
  }

  /* ----- business ----- */
  setBusiness(b: Business, by: Staff): Business {
    try { new Intl.DateTimeFormat('en', { timeZone: b.timezone }); } catch { throw new HttpError(400, `Unknown timezone ${b.timezone}`); }
    try { new Intl.NumberFormat('en', { style: 'currency', currency: b.currency }); } catch { throw new HttpError(400, `Unknown currency ${b.currency}`); }
    return tx(this.db, () => { setKv(this.db, 'business', b); this.log('business.saved', b, by); return b; });
  }

  /* ----- tax ----- */
  upsertTax(cat: TaxCategory, by: Staff): TaxCategory {
    if (cat.kind === 'taxed' && cat.rates.length === 0) throw new HttpError(400, 'A taxed category needs at least one rate');
    if (cat.kind !== 'taxed' && !cat.reason) throw new HttpError(400, 'Exempt and outside-scope categories need the legal ground');
    return tx(this.db, () => {
      this.db.prepare('INSERT INTO tax_categories(id, data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data = excluded.data').run(cat.id, JSON.stringify(cat));
      this.log('tax.saved', cat, by);
      return cat;
    });
  }

  /* ----- staff ----- */
  listStaff(): StaffRow[] {
    return (this.db.prepare('SELECT id, name, role, active FROM staff ORDER BY name').all() as unknown as { id: string; name: string; role: 'owner' | 'staff'; active: number }[])
      .map((r) => ({ ...r, active: !!r.active }));
  }
  /** id = undefined creates a new staff member. PINs are never returned or logged. */
  saveStaff(id: string | undefined, input: StaffInputT, by: Staff): StaffRow {
    return tx(this.db, () => {
      const all = this.listStaff();
      const current = id ? all.find((s) => s.id === id) : undefined;
      if (id && !current) throw new HttpError(404, 'Staff member not found');
      if (!current && !input.pin) throw new HttpError(400, 'A new staff member needs a PIN');
      if (input.pin) {
        const owner = this.auth.findByPin(input.pin);
        if (owner && owner.id !== id) throw new HttpError(409, 'That PIN is already in use');
      }
      const ownersAfter = all.filter((s) => s.id !== id && s.active && s.role === 'owner').length + (input.active && input.role === 'owner' ? 1 : 0);
      if (ownersAfter === 0) throw new HttpError(409, 'There must be at least one active owner');
      const sid = id ?? randomUUID();
      if (current) {
        this.db.prepare('UPDATE staff SET name = ?, role = ?, active = ? WHERE id = ?').run(input.name, input.role, input.active ? 1 : 0, sid);
        if (input.pin) { this.db.prepare('UPDATE staff SET pin = ? WHERE id = ?').run(hashPin(input.pin), sid); this.auth.logoutStaff(sid); }
      } else {
        this.db.prepare('INSERT INTO staff(id, name, pin, role, active) VALUES (?,?,?,?,?)').run(sid, input.name, hashPin(input.pin!), input.role, input.active ? 1 : 0);
      }
      this.log('staff.saved', { id: sid, name: input.name, role: input.role, active: input.active, pinChanged: !!input.pin }, by);
      return { id: sid, name: input.name, role: input.role, active: input.active };
    });
  }

  auditLog(limit = 200): AuditRow[] {
    return (this.db.prepare('SELECT seq, type, payload, staff_id, at FROM audit_log ORDER BY seq DESC LIMIT ?').all(limit) as { seq: number; type: string; payload: string; staff_id: string; at: string }[])
      .map((r) => ({ seq: r.seq, type: r.type, payload: JSON.parse(r.payload), staffId: r.staff_id, at: r.at }));
  }
}
