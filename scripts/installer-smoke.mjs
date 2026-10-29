// Silent install/update/uninstall of the built setup, isolated from this user's till and shortcuts.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const root = resolve(import.meta.dirname, '..');
assert.equal(process.platform, 'win32', 'The installer drill needs Windows');
assert.equal(process.argv.length, 3, 'Usage: node scripts/installer-smoke.mjs <setup.exe>');
const setup = resolve(process.argv[2]);
assert.ok(existsSync(setup), 'Build the setup first');
const work = mkdtempSync(join(tmpdir(), 'cactus-installer-'));
const program = join(work, 'installed program with spaces');
const home = join(work, 'isolated data');
const shortcuts = join(work, 'isolated shortcuts');
const node = join(program, 'runtime/node/node.exe');
const launcher = join(program, 'ops/app/launch.mjs');
const env = { ...process.env, CACTUS_HOME: home };
delete env.CACTUS_DB;
delete env.CACTUS_SEED;
const exec = promisify(execFile);
const run = (file, args) => exec(file, args, { env, windowsHide: true, timeout: 120_000 });
const launch = (...args) => run(node, [launcher, ...args]);
const report = { version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version, startedAt: new Date().toISOString(), passed: false, checks: [] };
const check = (name) => { report.checks.push(name); console.log(`PASS ${name}`); };
let token, port;
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
async function call(method, path, body) {
  const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
    method, headers: { ...(token ? { 'x-token': token } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10_000),
  });
  const value = await response.json();
  assert.ok(response.ok, `${method} ${path}: ${response.status}`);
  return value;
}
async function install(language) {
  // SHORTCUTROOT is the setup's test mode: no registry uninstall entry, real shortcuts or firewall change.
  await run(setup, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', `/LANG=${language}`, `/DIR=${program}`, `/SHORTCUTROOT=${shortcuts}`, `/PORT=${port}`, `/LOG=${join(work, `setup-${language}.log`)}`]);
  for (const file of [node, launcher, join(program, 'unins000.exe'), join(home, 'config.json')]) assert.ok(existsSync(file), `Missing ${file}`);
}
try {
  const probe = createServer();
  await new Promise((done, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', done); });
  port = probe.address().port;
  await new Promise((done) => probe.close(done));
  await install('en');
  for (const file of ['Desktop/CactusPOS.lnk', 'Startup/CactusPOS.lnk', ...['CactusPOS', 'Connect a tablet or phone', 'Restore a backup', 'Manual (English)', 'Handleiding (Nederlands)'].map((name) => `Programs/CactusPOS/${name}.lnk`)]) {
    assert.ok(existsSync(join(shortcuts, file)), `Missing shortcut ${file}`);
  }
  for (const file of ['CactusPOS-Manual-English.pdf', 'CactusPOS-Handleiding-Nederlands.pdf']) assert.ok(readFileSync(join(program, 'Manual', file)).subarray(0, 4).equals(Buffer.from('%PDF')));
  await launch('--server-only');
  assert.equal((await call('GET', '/health')).version, report.version);
  const login = await call('POST', '/login', { pin: '1234' });
  token = login.token;
  assert.equal(login.business.name, 'Cactus Blue');
  const item = (await call('GET', '/menu')).items.find((i) => i.available && !i.openPrice && i.modifierGroups.every((g) => !g.required));
  const order = await call('POST', '/orders', { lines: [{ itemId: item.id, qty: 1 }], note: `Installer fixture ${randomUUID()}` });
  const paid = await call('POST', `/orders/${order.id}/pay`, { method: 'cash', tenderedCents: order.totalCents, expectedTotalCents: order.totalCents });
  assert.equal(paid.receiptNumber, 1);
  check('Fresh English install, isolated shortcuts, both PDF manuals and first cash sale');

  // Reinstall while the old server is running, then prove settings and records survive.
  await install('nl');
  await launch('--server-only');
  token = (await call('POST', '/login', { pin: '1234' })).token;
  assert.deepEqual(await call('GET', `/orders/${order.id}`), paid);
  assert.equal(JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')).port, port);
  check('Dutch reinstall stops running copy and preserves the paid order and settings');
  await launch('--stop');
  const database = join(home, 'data/cactus.sqlite');
  const before = hash(database);
  await run(join(program, 'unins000.exe'), ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART']);
  // Inno's helper finishes removing its own executable just after the parent exits.
  for (let i = 0; i < 40 && existsSync(node); i++) await pause(250);
  assert.ok(!existsSync(node), 'Uninstall must remove program runtime');
  assert.ok(!existsSync(join(shortcuts, 'Desktop/CactusPOS.lnk')), 'Uninstall must remove test Desktop shortcut');
  assert.ok(existsSync(join(home, 'config.json')), 'Uninstall must keep settings');
  assert.equal(hash(database), before, 'Uninstall must keep the sales database unchanged');
  check('Uninstall removes program/shortcuts and keeps sales database byte-for-byte');
  report.passed = true;
} catch (error) {
  report.error = error.message;
  console.error(error);
  process.exitCode = 1;
} finally {
  if (existsSync(node) && existsSync(join(home, 'config.json'))) {
    try { await launch('--stop'); } catch { /* report already identifies the failing install step */ }
  }
  report.finishedAt = new Date().toISOString();
  mkdirSync(join(root, '.local'), { recursive: true });
  const output = join(root, '.local/installer-smoke.json');
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Installer evidence: ${output}`);
  // Verify the absolute generated path before removing only this drill's disposable files.
  assert.ok(resolve(work).startsWith(`${resolve(tmpdir())}${sep}cactus-installer-`));
  rmSync(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}
