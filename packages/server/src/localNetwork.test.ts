import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { LocalNetworkSettings } from '@cactus/shared';
import { openDb } from './db.js';
import { seedSample } from './seedData.js';
import { buildApp } from './app.js';
import { lanAddresses, nameConflict, startHttpAlias, startLocalNetwork } from './localNetwork.js';

vi.mock('node:os', () => ({ networkInterfaces: () => ({}) })); // tests never advertise on the operator's WiFi
const cleanups: Array<() => Promise<unknown> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); cleanups.length = 0; });
const stop = (server: Server) => new Promise<void>((done) => server.close(() => done()));
const portOf = (server: Server) => (server.address() as AddressInfo).port;

describe('installed local address', () => {
  it('uses a configurable single-label .local name and an optional HTTP alias', () => {
    expect(LocalNetworkSettings.parse({})).toEqual({ enabled: true, hostname: 'cactus.local', port: 80 });
    expect(LocalNetworkSettings.parse({ hostname: 'another-shop.local', port: 0 }).port).toBe(0);
    for (const hostname of ['cactus.example', 'two.names.local', '-bad.local', 'bad-.local', 'bad.local/pos']) {
      expect(LocalNetworkSettings.safeParse({ hostname }).success).toBe(false);
    }
  });
  it('selects physical private LAN interfaces and rejects names already owned elsewhere', () => {
    const nic = (address: string, internal = false) => ({ address, family: 'IPv4', internal }) as import('node:os').NetworkInterfaceInfo;
    expect(lanAddresses({ WiFi: [nic('192.168.8.10')], Ethernet: [nic('10.0.0.9')], VPN: [nic('10.7.0.1')], Loopback: [nic('127.0.0.1', true)], Public: [nic('203.0.113.5')] })).toEqual(['192.168.8.10', '10.0.0.9']);
    expect(nameConflict({ answers: [{ name: 'CACTUS.local.', type: 'A', ttl: 60, data: '192.168.8.20' }] }, 'cactus.local', ['192.168.8.10'])).toBe('192.168.8.20');
    expect(nameConflict({ answers: [{ name: 'cactus.local', type: 'A', ttl: 0, data: '192.168.8.20' }] }, 'cactus.local', ['192.168.8.10'])).toBeUndefined();
    expect(nameConflict({ answers: [{ name: 'cactus.local', type: 'A', ttl: 60, data: '192.168.8.10' }] }, 'cactus.local', ['192.168.8.10'])).toBeUndefined();
    expect(nameConflict({ answers: [{ name: 'cactus.local', type: 'AAAA', ttl: 60, data: 'fe80::1234' }] }, 'cactus.local', ['192.168.8.10'])).toBe('fe80::1234');
  });
  it('forwards real API requests, retry keys and live WebSocket events without redirecting the origin', async () => {
    const db = openDb(':memory:'); seedSample(db);
    const { app } = buildApp(db);
    cleanups.push(() => db.close()); cleanups.push(() => app.close());
    await app.listen({ port: 0, host: '127.0.0.1' });
    const primary = portOf(app.server);
    const alias = await startHttpAlias(primary, 0); cleanups.push(() => stop(alias));
    const base = `http://127.0.0.1:${portOf(alias)}`;
    expect((await fetch(`${base}/api/health`).then((r) => r.json()) as { app: string }).app).toBe('cactuspos');
    const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"pin":"1234"}' }).then((r) => r.json()) as { token: string };
    const socket = new WebSocket(`${base.replace('http:', 'ws:')}/ws?token=${login.token}`);
    cleanups.push(() => socket.close());
    const changed = new Promise<{ type: string }>((done, reject) => { socket.addEventListener('error', reject); socket.addEventListener('message', (message) => { const event = JSON.parse(String(message.data)) as { type: string }; if (event.type === 'order.changed') done(event); }); });
    await new Promise<void>((done, reject) => { socket.addEventListener('open', () => done(), { once: true }); socket.addEventListener('error', reject, { once: true }); });
    const send = () => fetch(`${base}/api/orders`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': login.token, 'idempotency-key': 'local-alias-test-1' }, body: '{"lines":[{"itemId":"burger","qty":1}]}' });
    const first = await send().then((r) => r.json()) as { id: string };
    expect((await send().then((r) => r.json()) as { id: string }).id).toBe(first.id);
    expect((await changed).type).toBe('order.changed');
    expect(await fetch(`${base}/api/orders`, { headers: { 'x-token': login.token } }).then((r) => r.json())).toHaveLength(1);
  });
  it('keeps the primary listener available when the friendly port is occupied', async () => {
    const primary = createServer((_req, res) => res.end('healthy'));
    await new Promise<void>((done) => primary.listen(0, '127.0.0.1', done)); cleanups.push(() => stop(primary));
    const blocked = createServer();
    await new Promise<void>((done) => blocked.listen(0, '0.0.0.0', done)); cleanups.push(() => stop(blocked));
    const lan = await startLocalNetwork({ port: portOf(blocked) }, portOf(primary)); cleanups.push(() => lan.stop());
    expect(lan.status.aliasPort).toBeNull();
    expect(lan.status.problems.join(' ')).toContain('unavailable');
    expect(await fetch(`http://127.0.0.1:${portOf(primary)}`).then((r) => r.text())).toBe('healthy');
  });
});
