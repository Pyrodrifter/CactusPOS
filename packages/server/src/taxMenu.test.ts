import { beforeEach, describe, expect, it } from 'vitest';
import type { MenuResponse } from '@cactus/shared';
import { openDb, type DB } from './db.js';
import { seedSample } from './seedData.js';
import { buildApp } from './app.js';

let db: DB;
let app: ReturnType<typeof buildApp>['app'];
let owner: Record<string, string>;
let staff: Record<string, string>;

const start = async () => {
  ({ app } = buildApp(db, { webDist: '/nonexistent' }));
  const login = async (pin: string) => ({ 'x-token': (await app.inject({ method: 'POST', url: '/api/login', payload: { pin } })).json().token as string });
  owner = await login('1234');
  staff = await login('1111');
};
beforeEach(async () => { db = openDb(':memory:'); seedSample(db); await start(); });

const menu = async () => (await app.inject({ method: 'GET', url: '/api/menu', headers: staff })).json() as MenuResponse;

describe('one tax category for the whole menu (TAX03)', () => {
  it('8% is no longer a default category', async () => {
    expect((await menu()).taxCategories.map((c) => c.id)).not.toContain('goods_8');
  });
  it('applies a category to every item at once, owner only', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/admin/tax/exempt/apply-to-menu', headers: staff })).statusCode).toBe(403);
    const res = await app.inject({ method: 'POST', url: '/api/admin/tax/exempt/apply-to-menu', headers: owner });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toBeGreaterThan(0);
    expect((await menu()).items.every((i) => i.taxCategoryId === 'exempt')).toBe(true);
    expect((await app.inject({ method: 'POST', url: '/api/admin/tax/nope/apply-to-menu', headers: owner })).statusCode).toBe(404);
  });
  it('removes only a category that nothing uses or was sold under', async () => {
    expect((await app.inject({ method: 'DELETE', url: '/api/admin/tax/service_6', headers: owner })).statusCode).toBe(409);
    expect((await app.inject({ method: 'DELETE', url: '/api/admin/tax/outside_scope', headers: owner })).statusCode).toBe(200);
    expect((await menu()).taxCategories.map((c) => c.id)).not.toContain('outside_scope');
  });
  it('clears an unused 8% category from an older till once, and keeps one that was sold under', async () => {
    const eight = JSON.stringify({ id: 'goods_8', name: 'ABB 8%', kind: 'taxed', rates: [{ validFrom: '2011-01-01', bps: 800 }] });
    db = openDb(':memory:'); seedSample(db);
    db.prepare('INSERT INTO tax_categories(id, data) VALUES (?, ?)').run('goods_8', eight);
    await start();
    expect((await menu()).taxCategories.map((c) => c.id)).not.toContain('goods_8');

    db = openDb(':memory:'); seedSample(db);
    db.prepare('INSERT INTO tax_categories(id, data) VALUES (?, ?)').run('goods_8', eight);
    db.prepare("INSERT INTO orders(id, ticket_number, receipt_number, business_date, data, created_at) VALUES ('old', 1, 1, '2026-01-01', ?, '2026-01-01T00:00:00Z')")
      .run(JSON.stringify({ lines: [{ taxCategoryId: 'goods_8' }] }));
    await start();
    expect((await app.inject({ method: 'GET', url: '/api/admin/tax', headers: owner })).json().categories.map((c: { id: string }) => c.id)).toContain('goods_8');
  });
});
