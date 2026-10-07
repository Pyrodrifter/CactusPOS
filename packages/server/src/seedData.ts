import { BONAIRE_DEFAULT_TAX, type MenuItem } from '@cactus/shared';
import { setKv, tx, type DB } from './db.js';
import { hashPin } from './auth.js';

/** SAMPLE data only. Replace with Cactus Blue's real menu in /admin once available. */
const CATEGORIES = [
  { id: 'mains', name: 'Mains', sort: 1 },
  { id: 'sides', name: 'Sides', sort: 2 },
  { id: 'drinks', name: 'Drinks', sort: 3 },
];

const spice = { id: 'spice', name: 'Spice', required: false, multi: false, options: [
  { id: 'mild', name: 'Mild', priceDeltaCents: 0 }, { id: 'hot', name: 'Hot', priceDeltaCents: 0 }] };
const extras = { id: 'extras', name: 'Extras', required: false, multi: true, options: [
  { id: 'cheese', name: 'Extra cheese', priceDeltaCents: 100 }, { id: 'bacon', name: 'Bacon', priceDeltaCents: 200 }] };

const mk = (id: string, categoryId: string, name: string, priceCents: number, extra: Partial<MenuItem> = {}): MenuItem => ({
  id, categoryId, name, priceCents, taxCategoryId: 'service_6', station: 'kitchen', available: true, modifierGroups: [], ...extra,
});

const ITEMS: MenuItem[] = [
  mk('burger', 'mains', 'Burger', 1400, { modifierGroups: [extras] }),
  mk('wrap', 'mains', 'Chicken Wrap', 1200, { modifierGroups: [spice] }),
  mk('bowl', 'mains', 'Rice Bowl', 1300, { modifierGroups: [spice, extras] }),
  mk('fries', 'sides', 'Fries', 500),
  mk('salad', 'sides', 'Side Salad', 600),
  mk('cola', 'drinks', 'Cola', 300, { station: 'bar' }),
  mk('water', 'drinks', 'Water', 200, { station: 'bar' }),
  mk('juice', 'drinks', 'Fresh Juice', 450, { station: 'bar' }),
];

export function seedSample(db: DB, opts: { ownerPin?: string; staffPin?: string } = {}): void {
  tx(db, () => {
    setKv(db, 'business', { name: 'Cactus Blue', crib: '', address: 'Kralendijk, Bonaire', timezone: 'America/Kralendijk' });
    for (const t of BONAIRE_DEFAULT_TAX) db.prepare('INSERT OR REPLACE INTO tax_categories(id, data) VALUES (?, ?)').run(t.id, JSON.stringify(t));
    for (const c of CATEGORIES) db.prepare('INSERT OR REPLACE INTO menu_categories(id, name, sort) VALUES (?,?,?)').run(c.id, c.name, c.sort);
    for (const i of ITEMS) db.prepare('INSERT OR REPLACE INTO menu_items(id, data) VALUES (?, ?)').run(i.id, JSON.stringify(i));
    db.prepare('INSERT OR IGNORE INTO staff(id, name, pin, role) VALUES (?,?,?,?)').run('owner', 'Owner', hashPin(opts.ownerPin ?? '1234'), 'owner');
    db.prepare('INSERT OR IGNORE INTO staff(id, name, pin, role) VALUES (?,?,?,?)').run('staff1', 'Staff', hashPin(opts.staffPin ?? '1111'), 'staff');
  });
}
