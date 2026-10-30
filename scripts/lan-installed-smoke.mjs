// Exercises the installed launcher with isolated data, a unique .local name and real HTTP/WS/mDNS sockets.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import multicastDns from 'multicast-dns';
import WebSocket from 'ws';

const root = resolve(import.meta.dirname, '..');
const home = mkdtempSync(join(tmpdir(), 'cactus-lan-check-'));
const env = { ...process.env, CACTUS_HOME: home };
delete env.CACTUS_DISABLE_LAN; delete env.CACTUS_DB; delete env.CACTUS_SEED;
const exec = promisify(execFile);
const launch = (...args) => exec(process.execPath, [join(root, 'ops/app/launch.mjs'), ...args], { cwd: root, env, windowsHide: true, timeout: 30_000 });
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const freePort = async () => {
  const probe = createServer();
  await new Promise((done, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', done); });
  const port = probe.address().port;
  await new Promise((done) => probe.close(done)); return port;
};
let dns, socket;
const report = { passed: false, checks: [] };
try {
  const port = await freePort(), alias = await freePort(), hostname = `cactus-check-${process.pid}.local`;
  await launch('--configure', '--port', String(port), '--hostname', hostname, '--lan-port', String(alias));
  await launch('--server-only');
  let state;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (existsSync(join(home, 'lan.json'))) state = JSON.parse(readFileSync(join(home, 'lan.json'), 'utf8'));
    if (state?.advertised || (state?.problems.length && attempt > 15)) break;
    await pause(100);
  }
  assert.equal(state.aliasPort, alias);
  const base = `http://127.0.0.1:${alias}`;
  assert.equal((await fetch(`${base}/api/health`).then((r) => r.json())).app, 'cactuspos');
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"pin":"1234"}' }).then((r) => r.json());
  const changed = new Promise((done, reject) => {
    socket = new WebSocket(`ws://127.0.0.1:${alias}/ws?token=${login.token}`);
    socket.on('error', reject); socket.on('message', (data) => { if (JSON.parse(String(data)).type === 'order.changed') done(); });
  });
  await new Promise((done, reject) => { socket.once('open', done); socket.once('error', reject); });
  const options = { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': login.token, 'idempotency-key': 'lan-check-create-1' }, body: '{"lines":[{"itemId":"burger","qty":1}]}' };
  const first = await fetch(`${base}/api/orders`, options).then((r) => r.json());
  assert.equal((await fetch(`${base}/api/orders`, options).then((r) => r.json())).id, first.id);
  await Promise.race([changed, pause(5000).then(() => { throw new Error('No live update through alias'); })]);
  report.checks.push('Installed launcher, HTTP alias, login, create retry and live WS update passed');
  if (state.addresses.length) {
    assert.equal(state.advertised, true, state.problems.join('; '));
    dns = multicastDns({ interface: state.addresses[0], bind: '0.0.0.0' });
    await new Promise((done, reject) => {
      const timer = setTimeout(() => reject(new Error('No mDNS service response on the LAN')), 5000);
      dns.on('error', (error) => { clearTimeout(timer); reject(error); });
      dns.on('response', (packet) => {
        const records = [...packet.answers ?? [], ...packet.additionals ?? []];
        if (records.some((record) => record.name === hostname && record.type === 'A' && state.addresses.includes(record.data)) &&
            records.some((record) => record.type === 'SRV' && record.data.target === hostname && record.data.port === alias)) { clearTimeout(timer); done(); }
      });
      dns.query({ questions: [{ name: hostname, type: 'A' }, { name: '_cactuspos._tcp.local', type: 'PTR' }] });
    });
    const status = JSON.parse((await launch('--status', '--json')).stdout);
    assert.equal(status.friendlyUrl, `http://${hostname}:${alias}`);
    report.checks.push('Real multicast A and DNS-SD SRV responses and launcher friendly URL passed');
  } else report.checks.push('No eligible LAN interface on build computer: physical mDNS drill still required');
  // `npm start` launches main.ts directly. It must load the same LAN defaults/config without launcher env.
  socket.terminate(); dns?.destroy(); dns = undefined;
  await launch('--stop');
  const directEnv = { ...env, PORT: String(port), CACTUS_STRICT_PORT: '1' };
  delete directEnv.CACTUS_LAN_SETTINGS; delete directEnv.CACTUS_LAN_STATUS_FILE;
  const direct = spawn(process.execPath, ['--import', 'tsx', join(root, 'packages/server/src/main.ts')], { cwd: root, env: directEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let directLog = '';
  direct.stdout.on('data', (chunk) => { directLog += chunk; }); direct.stderr.on('data', (chunk) => { directLog += chunk; });
  const exited = new Promise((done) => direct.once('exit', done));
  try {
    let directStatus;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (existsSync(join(home, 'lan.json'))) directStatus = JSON.parse(readFileSync(join(home, 'lan.json'), 'utf8'));
      if (directStatus?.pid === direct.pid && directStatus.aliasPort === alias && (!state.addresses.length || directStatus.advertised)) break;
      assert.equal(direct.exitCode, null, directLog); await pause(100);
    }
    assert.equal(directStatus?.pid, direct.pid, directLog);
    assert.equal(directStatus.hostname, hostname); assert.equal(directStatus.aliasPort, alias);
    if (state.addresses.length) assert.equal(directStatus.advertised, true, directLog);
    assert.equal((await fetch(`${base}/api/health`).then((r) => r.json())).app, 'cactuspos');
    report.checks.push('Direct production/npm-start server loads saved LAN config and serves the HTTP alias without launcher environment');
  } finally { direct.kill(); await Promise.race([exited, pause(5000)]); }
  report.passed = true;
} catch (error) { report.error = error.message; console.error(error); process.exitCode = 1; }
finally {
  socket?.terminate(); dns?.destroy();
  try { await launch('--stop'); } catch { process.exitCode = 1; report.passed = false; }
  writeFileSync(join(root, '.local/lan-installed-smoke.json'), JSON.stringify(report, null, 2));
  assert.ok(resolve(home).startsWith(`${resolve(tmpdir())}${sep}cactus-lan-check-`));
  rmSync(home, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  console.log(JSON.stringify(report, null, 2));
}
