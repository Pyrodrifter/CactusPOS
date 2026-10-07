import { createServer, type AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { NetworkTransport, PrintQueue, type Transport } from './index.js';

const bytes = (s: string) => Uint8Array.from(Buffer.from(s));

describe('NetworkTransport', () => {
  it('delivers the bytes to a TCP printer', async () => {
    const got: Buffer[] = [];
    const server = createServer((sock) => sock.on('data', (d) => got.push(d)));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    await new NetworkTransport('127.0.0.1', port).send(bytes('hello printer'));
    await new Promise((r) => setTimeout(r, 30));
    server.close();
    expect(Buffer.concat(got).toString()).toBe('hello printer');
  });
  it('reports an unreachable printer instead of hanging', async () => {
    const server = createServer();
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    await new Promise((r) => server.close(r));
    await expect(new NetworkTransport('127.0.0.1', port, 500).send(bytes('x'))).rejects.toThrow(/Printer at 127\.0\.0\.1/);
  });
});

describe('PrintQueue', () => {
  const fast = { backoffMs: () => 1 };
  it('prints jobs in order', async () => {
    const out: string[] = [];
    const q = new PrintQueue(fast);
    q.setTransport({ send: async (d) => { out.push(Buffer.from(d).toString()); } });
    q.add('a', bytes('1')); q.add('b', bytes('2')); q.add('c', bytes('3'));
    await q.idle();
    expect(out).toEqual(['1', '2', '3']);
    expect(q.list().map((j) => j.status)).toEqual(['done', 'done', 'done']);
  });
  it('retries while the printer is off, keeps order, then succeeds', async () => {
    const out: string[] = [];
    let failures = 2;
    const t: Transport = { send: async (d) => { if (failures-- > 0) throw new Error('offline'); out.push(Buffer.from(d).toString()); } };
    const q = new PrintQueue(fast);
    q.setTransport(t);
    q.add('first', bytes('1')); q.add('second', bytes('2'));
    await q.idle();
    expect(out).toEqual(['1', '2']);
    expect(q.list().find((j) => j.label === 'first')!.attempts).toBe(3);
  });
  it('gives up after the limit, keeps the reason, and does not block later jobs', async () => {
    const out: string[] = [];
    const q = new PrintQueue({ ...fast, maxAttempts: 2 });
    q.setTransport({ send: async (d) => { const s = Buffer.from(d).toString(); if (s === 'bad') throw new Error('out of paper'); out.push(s); } });
    q.add('bad', bytes('bad')); q.add('good', bytes('good'));
    await q.idle();
    const bad = q.list().find((j) => j.label === 'bad')!;
    expect(bad).toMatchObject({ status: 'failed', attempts: 2, error: 'out of paper' });
    expect(out).toEqual(['good']);
  });
  it('failed jobs can be retried once the printer is back', async () => {
    let up = false;
    const out: string[] = [];
    const q = new PrintQueue({ ...fast, maxAttempts: 1 });
    q.setTransport({ send: async (d) => { if (!up) throw new Error('offline'); out.push(Buffer.from(d).toString()); } });
    q.add('r', bytes('receipt'));
    await q.idle();
    expect(q.list()[0]!.status).toBe('failed');
    up = true;
    q.retryFailed();
    await q.idle();
    expect(out).toEqual(['receipt']);
  });
  it('fails clearly when no printer is configured', async () => {
    const q = new PrintQueue(fast);
    q.add('x', bytes('x'));
    await q.idle();
    expect(q.list()[0]).toMatchObject({ status: 'failed', error: 'No printer is set up' });
  });
});
