import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PracticeLaunch, ServiceReadiness } from '@cactus/shared';
import { openDb } from './db.js';
import { seedSample } from './seedData.js';
import { buildApp } from './app.js';

let db: ReturnType<typeof openDb>, ctx: ReturnType<typeof buildApp>, token: string;
const networkPrint = vi.fn();
beforeEach(async () => {
  db = openDb(':memory:'); seedSample(db);
  ctx = buildApp(db, { practiceDbPath: ':memory:', printerTransport: () => ({ send: networkPrint }), printerProbe: async () => false });
  token = (await ctx.app.inject({ method: 'POST', url: '/api/login', payload: { pin: '1234' } })).json().token as string;
  networkPrint.mockClear();
});
afterEach(async () => { await ctx.app.close(); db.close(); });
const call = (method: 'GET' | 'POST' | 'PUT', path: string, auth = token, payload?: object) =>
  ctx.app.inject({ method, url: `/api${path}`, headers: { 'x-token': auth }, payload });
const create = async (prefix = '', auth = token) => (await call('POST', `${prefix}/orders`, auth, { lines: [{ itemId: 'burger', qty: 1 }] })).json();

describe('practice isolation and opening checks', () => {
  it('copies setup without live sales, keeps sessions separate and does not consume live receipt numbers', async () => {
    const live = await create();
    await call('POST', `/orders/${live.id}/pay`, token, { method: 'cash', tenderedCents: 1400 });
    const launched = PracticeLaunch.parse((await call('POST', '/practice/start')).json());
    const practiceToken = launched.session.token;
    expect(launched.session.mode).toBe('practice');
    expect(launched.session.instanceId).not.toBe((await call('GET', '/health')).json().instanceId);
    expect((await call('GET', '/practice/orders?scope=today', practiceToken)).json()).toEqual([]);
    expect((await call('GET', '/practice/menu', practiceToken)).json()).toEqual((await call('GET', '/menu')).json());
    expect((await call('GET', '/practice/orders', token)).statusCode).toBe(401);
    expect((await call('GET', '/orders', practiceToken)).statusCode).toBe(401);
    const sample = await create('/practice', practiceToken);
    const paid = (await call('POST', `/practice/orders/${sample.id}/pay`, practiceToken, { method: 'cash', tenderedCents: 1400 })).json();
    expect(paid.receiptNumber).toBe(1);
    const receipt = await call('GET', `/practice/orders/${sample.id}/receipt`, practiceToken);
    expect(receipt.body).toContain('PRACTICE / OEFENEN');
    const anotherLive = await create();
    expect((await call('POST', `/orders/${anotherLive.id}/pay`, token, { method: 'cash', tenderedCents: 1400 })).json().receiptNumber).toBe(2);
    expect((await call('GET', '/orders?scope=today')).json()).toHaveLength(2);
    expect((await call('GET', '/practice/orders?scope=today', practiceToken)).json()).toHaveLength(1);
    expect((await call('GET', '/reports/day')).json().report.sales.grossCents).toBe(2800);
    expect((await call('GET', '/practice/reports/day', practiceToken)).json().report.sales.grossCents).toBe(1400);
  });
  it('hard-disables practice printers, drawer, bookkeeping writes/exports and external backup settings', async () => {
    const sampleToken = PracticeLaunch.parse((await call('POST', '/practice/start')).json()).session.token;
    for (const [method, path, body] of [
      ['PUT', '/admin/printer', { enabled: true, host: '192.168.1.99' }],
      ['POST', '/print/drawer', {}], ['POST', '/books/pbk/post', {}], ['GET', '/books/journal.csv', undefined],
      ['PUT', '/books/settings', {}], ['PUT', '/admin/backups/settings', { folder: 'C:/live-backups' }],
    ] as const) expect((await call(method, `/practice${path}`, sampleToken, body)).statusCode).toBe(409);
    expect((await call('GET', '/practice/print/status', sampleToken)).json().active).toBe(false);
    expect(networkPrint).not.toHaveBeenCalled();
  });
  it('does not grant a practice session without authentication', async () => {
    expect((await call('POST', '/practice/start', '')).statusCode).toBe(401);
  });
  it('keeps live and practice kitchen connections and order events separate', async () => {
    const practiceToken = PracticeLaunch.parse((await call('POST', '/practice/start')).json()).session.token;
    const address = await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    const messages: string[][] = [[], []];
    const sockets = [new WebSocket(`${address.replace('http:', 'ws:')}/ws?token=${token}&screen=kitchen`),
      new WebSocket(`${address.replace('http:', 'ws:')}/practice/ws?token=${practiceToken}&screen=kitchen`)];
    try {
      await Promise.all(sockets.map((socket, index) => new Promise<void>((done, reject) => {
        socket.addEventListener('error', reject);
        socket.addEventListener('message', (event) => {
          const data = JSON.parse(String(event.data)) as { type: string; order?: { id: string } };
          if (data.type === 'hello') done();
          if (data.order) messages[index]!.push(data.order.id);
        });
      })));
      const live = await create(); const sample = await create('/practice', practiceToken);
      await vi.waitFor(() => { expect(messages[0]).toEqual([live.id]); expect(messages[1]).toEqual([sample.id]); });
      for (const [prefix, auth] of [['', token], ['/practice', practiceToken]]) {
        const checks = ServiceReadiness.parse((await call('GET', `${prefix}/admin/readiness`, auth)).json()).checks;
        expect(checks.find((check) => check.id === 'kitchen')).toMatchObject({ code: 'kitchen-online', count: 1 });
      }
    } finally { for (const socket of sockets) socket.close(); }
  });
  it('reports actual setup gaps and does not claim printer paper was tested or create a print job', async () => {
    ctx.printing.save({ enabled: true, host: '192.168.1.99', port: 9100, columns: 48, cutter: true, drawer: false, autoReceipt: true, autoKitchen: false });
    const result = ServiceReadiness.parse((await call('GET', '/admin/readiness')).json());
    expect(result.checks.find((check) => check.id === 'printer')).toMatchObject({ state: 'warn', code: 'printer-unreachable' });
    expect(result.checks.find((check) => check.id === 'backup')).toMatchObject({ state: 'warn', code: 'backup-missing' });
    expect(result.checks.find((check) => check.id === 'business')).toMatchObject({ state: 'warn', code: 'business-incomplete' });
    expect(result.checks.find((check) => check.id === 'pins')).toMatchObject({ state: 'warn', count: 2 });
    expect(networkPrint).not.toHaveBeenCalled();
    const staff = (await call('POST', '/login', '', { pin: '1111' })).json().token as string;
    expect((await call('GET', '/admin/readiness', staff)).statusCode).toBe(403);
  });
  it('resolves a retried send without creating another order', async () => {
    expect((await call('GET', '/request-status/recovery-key-1?kind=create')).json()).toEqual({ order: null });
    const response = await ctx.app.inject({ method: 'POST', url: '/api/orders', headers: { 'x-token': token, 'idempotency-key': 'recovery-key-1' }, payload: { lines: [{ itemId: 'juice', qty: 1 }] } });
    const lookup = (await call('GET', '/request-status/recovery-key-1?kind=create')).json();
    expect(lookup.order.id).toBe(response.json().id);
    expect((await call('GET', '/orders?scope=today')).json()).toHaveLength(1);
    expect((await call('GET', '/request-status/recovery-key-1?kind=pay')).statusCode).toBe(400);
  });
});
