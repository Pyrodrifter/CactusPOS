// Exercises the installed launcher and real HTTP/WS/SQLite paths using disposable data only.
// --program <folder> copies a built package away from the checkout and uses its bundled Node.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import WebSocket from 'ws';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === '--program'), 'Usage: node scripts/release-smoke.mjs [--program <package folder>]');
const work = mkdtempSync(join(tmpdir(), 'cactus-release-'));
const report = { version: null, packaged: args.length > 0, startedAt: new Date().toISOString(), checks: [], passed: false };
const sockets = [];
const homes = [join(work, 'tryout home'), join(work, 'restored home')];
const activeHomes = new Set();
let program = root, node = process.execPath, port, token, printer;
let printerBytes = 0;
const exec = promisify(execFile);
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const check = (name) => { report.checks.push(name); console.log(`PASS ${name}`); };
const insideWork = (path) => assert.ok(resolve(path).startsWith(`${resolve(work)}${sep}`), `Outside disposable folder: ${path}`);
async function freePort() {
  const server = createServer();
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const chosen = server.address().port;
  await new Promise((done) => server.close(done));
  return chosen;
}
async function launch(home, ...options) {
  insideWork(home);
  const env = { ...process.env, CACTUS_HOME: home };
  delete env.CACTUS_DB;
  delete env.CACTUS_SEED;
  const result = await exec(node, [join(program, 'ops/app/launch.mjs'), ...options], {
    cwd: program, env, windowsHide: true, timeout: 45_000,
  });
  if (options.includes('--server-only')) activeHomes.add(home);
  if (options.includes('--stop')) activeHomes.delete(home);
  return result.stdout;
}
async function call(method, path, body, key) {
  const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
    method, headers: { ...(token ? { 'x-token': token } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...(key ? { 'idempotency-key': key } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15_000),
  });
  const value = await response.json();
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(value)}`);
  return value;
}
async function login() { token = (await call('POST', '/login', { pin: '1234' })).token; assert.ok(token); }
async function until(predicate, message) {
  const deadline = Date.now() + 10_000;
  while (!predicate() && Date.now() < deadline) await pause(50);
  assert.ok(predicate(), message);
}
try {
  if (args.length) {
    const source = resolve(args[1]);
    assert.ok(existsSync(join(source, 'runtime/node/node.exe')), 'Build the Windows package first');
    program = join(work, 'relocated program with spaces');
    insideWork(program);
    cpSync(source, program, { recursive: true, dereference: true });
    node = join(program, 'runtime/node/node.exe');
  }
  port = await freePort();
  await launch(homes[0], '--configure', '--port', String(port), '--seed', 'cactus-blue');
  await launch(homes[0], '--server-only');
  const health = await call('GET', '/health');
  report.version = health.version;
  assert.equal(health.app, 'cactuspos');
  assert.equal(health.business, 'Cactus Blue');
  const screen = await fetch(`http://127.0.0.1:${port}/pos`);
  assert.match(await screen.text(), /<script[^>]+src="\/assets\//);
  check('Cactus Blue seed and production screens start through installed launcher');
  await login();
  const menu = await call('GET', '/menu');
  const item = menu.items.find((i) => i.available && !i.openPrice && i.priceCents > 0 && i.modifierGroups.every((g) => !g.required));
  assert.ok(item, 'Seed has a fixed-price item without required modifiers');
  await call('PUT', '/service-mode', { mode: 'board' });

  // A TCP printer double verifies the packaged transport. Paper/cutter/drawer still need a truck test.
  printer = createServer((socket) => { socket.on('data', (bytes) => { printerBytes += bytes.length; }); socket.on('error', () => {}); });
  await new Promise((done, reject) => { printer.once('error', reject); printer.listen(0, '127.0.0.1', done); });
  await call('PUT', '/admin/printer', { enabled: true, host: '127.0.0.1', port: printer.address().port, autoReceipt: true });
  const seen = Array.from({ length: 8 }, () => new Set());
  await Promise.all(seen.map((ids) => new Promise((done, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
    sockets.push(ws);
    const timer = setTimeout(() => reject(new Error('Live screen did not connect')), 10_000);
    ws.on('error', reject);
    ws.on('message', (data) => {
      const event = JSON.parse(String(data));
      if (event.type === 'hello') { clearTimeout(timer); done(); }
      if (event.type === 'order.changed') ids.add(event.order.id);
    });
  })));
  const sales = await Promise.all(Array.from({ length: 32 }, async (_, i) => {
    const createKey = randomUUID(), payKey = randomUUID();
    const body = { lines: [{ itemId: item.id, qty: 1 }] };
    const order = await call('POST', '/orders', body, createKey);
    assert.equal((await call('POST', '/orders', body, createKey)).id, order.id);
    assert.equal(order.totalCents, item.priceCents);
    const payment = { method: i % 2 ? 'card' : 'cash', expectedTotalCents: order.totalCents, ...(i % 2 ? { tipCents: 100, reference: `fixture-${i}` } : { tenderedCents: order.totalCents + 1000 }) };
    const paid = await call('POST', `/orders/${order.id}/pay`, payment, payKey);
    const repeat = await call('POST', `/orders/${order.id}/pay`, payment, payKey);
    assert.deepEqual(repeat, paid);
    assert.equal(paid.payments.length, 1);
    if (!(i % 2)) assert.equal(paid.payments[0].changeCents, 1000);
    return { paid, createKey, body, payment, payKey };
  }));
  assert.deepEqual(sales.map((s) => s.paid.receiptNumber).sort((a, b) => a - b), Array.from({ length: 32 }, (_, i) => i + 1));
  await until(() => seen.every((ids) => ids.size === 32), 'All eight live screens must receive every order');
  await until(() => printerBytes > 0, 'Automatic receipts must reach the TCP printer');
  check('32 concurrent cash/card sales, eight live screens, retry deduplication, gapless receipts and TCP printing');

  const first = sales[0].paid;
  await call('POST', `/orders/${first.id}/status`, { status: 'ready' });
  assert.ok((await call('GET', '/pickup')).ready.includes(first.ticketNumber));
  await call('POST', `/orders/${first.id}/status`, { status: 'collected' });
  assert.ok(!(await call('GET', '/pickup')).ready.includes(first.ticketNumber));
  const day = await call('GET', '/reports/day');
  assert.equal(day.report.sales.grossCents, 32 * item.priceCents);
  assert.equal(day.report.cashExpectedCents, 16 * item.priceCents);
  assert.equal(day.report.tipsCents, 1600);
  assert.equal(day.report.receipts.count, 32);
  check('Kitchen ready/collect updates pickup; daily sales, cash and card tips reconcile');

  const secondary = join(work, 'external backup');
  mkdirSync(secondary);
  await call('PUT', '/admin/backups/settings', { folder: secondary });
  const backup = await call('POST', '/admin/backups/run');
  assert.equal(backup.last.orders, 32);
  assert.equal(backup.last.copied, true);
  const before = await call('GET', '/orders?scope=today');
  const receipt = async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/orders/${first.id}/receipt`, { headers: { 'x-token': token } });
    assert.ok(response.ok);
    return response.text();
  };
  const html = await receipt();
  // A forced termination exercises recovery of committed WAL data, as after a laptop crash.
  const state = JSON.parse(readFileSync(join(homes[0], 'server.json'), 'utf8'));
  assert.equal(resolve(state.root), resolve(program));
  sockets.forEach((ws) => ws.terminate());
  process.kill(state.pid, 'SIGKILL');
  await until(() => sockets.every((ws) => ws.readyState === WebSocket.CLOSED), 'Live sockets should disconnect');
  await pause(400);
  await launch(homes[0], '--server-only');
  await login();
  assert.deepEqual(await call('GET', '/orders?scope=today'), before);
  assert.equal(await receipt(), html);
  const retry = sales[0];
  assert.equal((await call('POST', '/orders', retry.body, retry.createKey)).id, first.id);
  assert.equal((await call('POST', `/orders/${first.id}/pay`, retry.payment, retry.payKey)).receiptNumber, first.receiptNumber);
  check('Forced server termination preserves all sales, receipt contents and retry keys');
  await launch(homes[0], '--stop');

  await launch(homes[1], '--configure', '--port', String(port), '--seed', 'cactus-blue');
  const backupFile = join(secondary, backup.last.name);
  insideWork(backupFile);
  await launch(homes[1], '--restore', backupFile, '--yes');
  await launch(homes[1], '--server-only');
  await login();
  assert.deepEqual(await call('GET', '/orders?scope=today'), before);
  assert.equal(await receipt(), html);
  // Avoid the printer double during closing; restored printer settings are checked separately.
  assert.equal((await call('GET', '/admin/printer')).host, '127.0.0.1');
  await call('PUT', '/admin/printer', { enabled: false });
  const extra = await call('POST', '/orders', retry.body, randomUUID());
  const extraPaid = await call('POST', `/orders/${extra.id}/pay`, { method: 'cash', tenderedCents: extra.totalCents, expectedTotalCents: extra.totalCents }, randomUUID());
  assert.equal(extraPaid.receiptNumber, 33);
  const closed = await call('POST', '/reports/day/close', { date: day.today, countedCashCents: 17 * item.priceCents });
  assert.equal(closed.cashDifferenceCents, 0);
  assert.equal(closed.report.sales.grossCents, 33 * item.priceCents);
  assert.equal((await call('GET', '/admin/backups')).last.orders, 33);
  check('External backup restores into fresh data folder; receipts continue at 33 and day close balances');
  report.passed = true;
} catch (error) {
  report.error = error.message;
  console.error(error);
  process.exitCode = 1;
} finally {
  sockets.forEach((ws) => ws.terminate());
  for (const home of activeHomes) {
    if (existsSync(join(home, 'config.json'))) {
      try { await launch(home, '--stop'); } catch (error) { report.passed = false; process.exitCode = 1; console.error(`Cleanup: ${error.message}`); }
    }
  }
  if (printer) await new Promise((done) => printer.close(done));
  report.finishedAt = new Date().toISOString();
  const out = join(root, '.local', report.packaged ? 'release-smoke-package.json' : 'release-smoke-source.json');
  mkdirSync(join(root, '.local'), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Release evidence: ${out}`);
  // work is the absolute directory returned by mkdtemp; never remove caller-supplied program/data paths.
  assert.equal(resolve(work).startsWith(`${resolve(tmpdir())}${sep}cactus-release-`), true);
  rmSync(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}
