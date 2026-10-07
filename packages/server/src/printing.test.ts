import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from './db.js';
import { seedSample } from './seedData.js';
import { buildApp } from './app.js';

let db: ReturnType<typeof openDb>;
let sent: string[];
beforeEach(() => { db = openDb(':memory:'); seedSample(db); sent = []; });

const make = () => buildApp(db, {
  webDist: '/nonexistent',
  printerTransport: (s) => (s.enabled && s.host ? { send: async (d) => { sent.push(Buffer.from(d).toString('latin1')); } } : null),
});
const login = async (app: ReturnType<typeof make>['app'], pin: string) =>
  ({ 'x-token': (await app.inject({ method: 'POST', url: '/api/login', payload: { pin } })).json().token as string });
const settings = { enabled: true, host: '10.0.0.9', port: 9100, columns: 48, cutter: true, drawer: true, autoReceipt: true, autoKitchen: true };

describe('printing', () => {
  it('is off by default: nothing prints and screens are told to use the browser', async () => {
    const { app, printing } = make();
    const h = await login(app, '1111');
    const o = (await app.inject({ method: 'POST', url: '/api/orders', headers: h, payload: { lines: [{ itemId: 'fries', qty: 1 }] } })).json();
    await app.inject({ method: 'POST', url: `/api/orders/${o.id}/pay`, headers: h, payload: { method: 'cash' } });
    await printing.queue.idle();
    expect(sent).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/api/print/status', headers: h })).json().active).toBe(false);
    expect((await app.inject({ method: 'POST', url: `/api/orders/${o.id}/print`, headers: h, payload: {} })).statusCode).toBe(409);
  });

  it('only the owner can change printer settings', async () => {
    const { app } = make();
    expect((await app.inject({ method: 'PUT', url: '/api/admin/printer', headers: await login(app, '1111'), payload: settings })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: '/api/admin/printer', headers: await login(app, '1234'), payload: { ...settings, port: 0 } })).statusCode).toBe(400);
  });

  it('prints a kitchen ticket on send, a receipt with drawer kick on cash payment, and a marked copy on reprint', async () => {
    const { app, printing } = make();
    const owner = await login(app, '1234');
    const h = await login(app, '1111');
    expect((await app.inject({ method: 'PUT', url: '/api/admin/printer', headers: owner, payload: settings })).statusCode).toBe(200);

    const o = (await app.inject({ method: 'POST', url: '/api/orders', headers: h, payload: { lines: [{ itemId: 'burger', qty: 1, modifierOptionIds: ['cheese'] }] } })).json();
    await printing.queue.idle();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('ORDER #1');
    expect(sent[0]).toContain('Extra cheese');
    expect(sent[0]).not.toContain('$');

    await app.inject({ method: 'POST', url: `/api/orders/${o.id}/pay`, headers: h, payload: { method: 'cash', tenderedCents: 2000 } });
    await printing.queue.idle();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain('Receipt #1');
    expect(sent[1]).toContain('$15.00');
    expect(sent[1]).toContain('\x1bp\x00'); // drawer pulse
    expect(sent[1]).not.toContain('COPY');

    expect((await app.inject({ method: 'POST', url: `/api/orders/${o.id}/print`, headers: h, payload: { kind: 'receipt' } })).statusCode).toBe(200);
    await printing.queue.idle();
    expect(sent[2]).toContain('COPY');
    expect(sent[2]).not.toContain('\x1bp\x00');
  });

  it('card payments do not open the drawer; the test page prints', async () => {
    const { app, printing } = make();
    const owner = await login(app, '1234');
    await app.inject({ method: 'PUT', url: '/api/admin/printer', headers: owner, payload: { ...settings, autoKitchen: false } });
    const o = (await app.inject({ method: 'POST', url: '/api/orders', headers: owner, payload: { lines: [{ itemId: 'fries', qty: 1 }] } })).json();
    await app.inject({ method: 'POST', url: `/api/orders/${o.id}/pay`, headers: owner, payload: { method: 'card' } });
    expect((await app.inject({ method: 'POST', url: '/api/admin/printer/test', headers: owner, payload: {} })).statusCode).toBe(200);
    await printing.queue.idle();
    expect(sent).toHaveLength(2);
    expect(sent[0]).not.toContain('\x1bp\x00');
    expect(sent[1]).toContain('Printer test');
  });

  it('a dead printer never fails the sale', async () => {
    const { app, printing } = buildApp(db, { webDist: '/nonexistent', printerTransport: () => ({ send: async () => { throw new Error('offline'); } }) });
    const owner = await login(app, '1234');
    await app.inject({ method: 'PUT', url: '/api/admin/printer', headers: owner, payload: settings });
    const o = await app.inject({ method: 'POST', url: '/api/orders', headers: owner, payload: { lines: [{ itemId: 'fries', qty: 1 }] } });
    expect(o.statusCode).toBe(201);
    const paid = await app.inject({ method: 'POST', url: `/api/orders/${o.json().id}/pay`, headers: owner, payload: { method: 'cash' } });
    expect(paid.json().paid).toBe(true);
    printing.queue.stop();
  });
});
