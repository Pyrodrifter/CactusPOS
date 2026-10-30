import { beforeEach, describe, expect, it } from 'vitest';
import type { Order } from '@cactus/shared';
import { openDb } from './db.js';
import { seedSample } from './seedData.js';
import { buildApp } from './app.js';

let app: ReturnType<typeof buildApp>['app'];
let owner: Record<string, string>;
let staff: Record<string, string>;

beforeEach(async () => {
  const db = openDb(':memory:');
  seedSample(db);
  ({ app } = buildApp(db, { webDist: '/nonexistent' }));
  const login = async (pin: string) => ({ 'x-token': (await app.inject({ method: 'POST', url: '/api/login', payload: { pin } })).json().token as string });
  owner = await login('1234');
  staff = await login('1111');
});

const sell = async () => (await app.inject({ method: 'POST', url: '/api/orders', headers: staff, payload: { lines: [{ itemId: 'burger', qty: 1 }] } })).json() as Order;
const setAbb = (payload: object, headers = owner) => app.inject({ method: 'PUT', url: '/api/admin/tax-exemption', headers, payload });

describe('switching ABB off for the whole business', () => {
  it('records new sales as exempt with the same total; earlier sales keep their ABB', async () => {
    const before = await sell();
    expect(before).toMatchObject({ totalCents: 1400, taxCents: 79 });

    expect((await setAbb({ charged: false, reason: 'Food truck exemption' })).statusCode).toBe(200);
    const after = await sell();
    expect(after).toMatchObject({ totalCents: 1400, taxCents: 0 });
    expect(after.breakdown).toEqual([expect.objectContaining({ kind: 'exempt', bps: 0, grossCents: 1400, taxCents: 0 })]);
    expect((await app.inject({ method: 'GET', url: `/api/orders/${before.id}`, headers: staff })).json()).toMatchObject({ taxCents: 79 });

    // The counter and the menu see exempt categories; Admin > Tax still sees the real setup.
    const menu = (await app.inject({ method: 'GET', url: '/api/menu', headers: staff })).json();
    expect(menu.taxCategories.every((c: { kind: string }) => c.kind === 'exempt')).toBe(true);
    const setup = (await app.inject({ method: 'GET', url: '/api/admin/tax', headers: owner })).json();
    expect(setup.exemption).toEqual({ charged: false, reason: 'Food truck exemption' });
    expect(setup.categories.find((c: { id: string }) => c.id === 'service_6').kind).toBe('taxed');

    expect((await setAbb({ charged: true, reason: '' })).statusCode).toBe(200);
    expect(await sell()).toMatchObject({ taxCents: 79 });
  });

  it('needs a reason, and only the owner can change it', async () => {
    expect((await setAbb({ charged: false, reason: ' ' })).statusCode).toBe(400);
    expect((await setAbb({ charged: false, reason: 'Food truck exemption' }, staff)).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/admin/tax', headers: staff })).statusCode).toBe(403);
    expect((await sell()).taxCents).toBe(79);
  });
});
