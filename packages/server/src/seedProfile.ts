import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { BONAIRE_DEFAULT_TAX, BusinessSchema, MenuCategory, MenuItem, ModifierGroup } from '@cactus/shared';
import { setKv, tx, type DB } from './db.js';
import { DEFAULT_BUSINESS } from './service.js';

/**
 * A seed profile is one business's starting menu and details, kept as data in `seed/<name>.json`
 * so nothing about a particular business lives in code. Option groups are defined once and
 * referenced by key from items.
 */
const Profile = z.object({
  business: BusinessSchema.partial().default({}),
  categories: z.array(MenuCategory),
  optionGroups: z.record(z.string(), ModifierGroup).default({}),
  items: z.array(MenuItem.omit({ modifierGroups: true, taxCategoryId: true }).extend({
    taxCategoryId: z.string().default('service_6'),
    groups: z.array(z.string()).default([]),
  })),
});

export const SEED_DIR = resolve(import.meta.dirname, '../../../seed');

export function loadProfile(name: string): z.infer<typeof Profile> {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`Bad profile name: ${name}`);
  const file = resolve(SEED_DIR, `${name}.json`);
  if (!existsSync(file)) throw new Error(`No seed profile at ${file}`);
  return Profile.parse(JSON.parse(readFileSync(file, 'utf8')));
}

/**
 * Replaces the menu and business details with the profile. Staff, tax setup and all orders are
 * left alone (orders carry their own copy of names and prices). Returns the number of items loaded.
 */
export function applyProfile(db: DB, name: string): number {
  const p = loadProfile(name);
  const items = p.items.map(({ groups, ...rest }) => MenuItem.parse({
    ...rest,
    modifierGroups: groups.map((g) => {
      const group = p.optionGroups[g];
      if (!group) throw new Error(`Item ${rest.id} uses unknown option group "${g}"`);
      return group;
    }),
  }));
  for (const i of items) {
    if (!p.categories.some((c) => c.id === i.categoryId)) throw new Error(`Item ${i.id} uses unknown category ${i.categoryId}`);
    const ids = i.modifierGroups.flatMap((g) => g.options.map((o) => o.id));
    if (new Set(ids).size !== ids.length) throw new Error(`Item ${i.id} has duplicate option ids`);
  }
  tx(db, () => {
    for (const t of BONAIRE_DEFAULT_TAX) db.prepare('INSERT OR IGNORE INTO tax_categories(id, data) VALUES (?, ?)').run(t.id, JSON.stringify(t));
    db.exec('DELETE FROM menu_items; DELETE FROM menu_categories;');
    for (const c of p.categories) db.prepare('INSERT INTO menu_categories(id, name, sort) VALUES (?,?,?)').run(c.id, c.name, c.sort);
    for (const i of items) db.prepare('INSERT INTO menu_items(id, data) VALUES (?, ?)').run(i.id, JSON.stringify(i));
    setKv(db, 'business', { ...DEFAULT_BUSINESS, ...p.business });
  });
  return items.length;
}
