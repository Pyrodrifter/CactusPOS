// Runs every browser check against a throwaway till: `npm run e2e` (which builds the screens first).
// The till gets a temporary database with the sample menu on port 3082, so nothing here touches real sales, and
// each check drives a real headless Edge or Chrome through scripts/shot.mjs. Screenshots land in .local/e2e-shots.
//
//   node e2e/run.mjs                 every check
//   node e2e/run.mjs ux08-touch      only the checks whose file name contains this
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PORT = 3082; // the checks that write orders refuse any other address
const root = resolve(import.meta.dirname, '..');
// Checks that only look come first; the ones that place orders follow.
const order = ['ux08-touch.mjs', 'ux08-checkout.mjs', 'audit-fixes.mjs'];
const wanted = process.argv.slice(2);
const checks = readdirSync(import.meta.dirname).filter((f) => f.endsWith('.mjs') && f !== 'run.mjs')
  .sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b))
  .filter((f) => !wanted.length || wanted.some((w) => f.includes(w)));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

if (!existsSync(join(root, 'packages', 'web', 'dist', 'index.html'))) { console.error('The screens are not built. Run: npm run build'); process.exit(1); }
if (!checks.length) { console.error(`No check matches ${wanted.join(', ')}`); process.exit(1); }

const up = async () => { try { return (await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } };
if (await up()) { console.error(`Port ${PORT} is already in use. Stop whatever runs there; the checks need their own till.`); process.exit(1); }

const dir = mkdtempSync(join(tmpdir(), 'cactus-e2e-'));
const env = { ...process.env, PORT: String(PORT), CACTUS_STRICT_PORT: '1', CACTUS_DB: join(dir, 'e2e.sqlite') };
delete env.CACTUS_SEED; // the checks expect the sample menu and the example PINs
let log = '';
const server = spawn(process.execPath, ['--import', 'tsx', join(root, 'packages', 'server', 'src', 'main.ts')], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.on('data', (d) => { log += d; });
server.stderr.on('data', (d) => { log += d; });
const exited = new Promise((done) => server.once('exit', done));

let failed = [];
try {
  for (let i = 0; !(await up()); i++) {
    if (server.exitCode !== null || i > 100) throw new Error(`The test till did not start.\n${log}`);
    await sleep(200);
  }
  for (const check of checks) {
    console.log(`\n=== ${check}`);
    const run = spawnSync(process.execPath, [join(root, 'scripts', 'shot.mjs'), '--base', `http://localhost:${PORT}`, '--out', join(root, '.local', 'e2e-shots'), '--scenario', join(import.meta.dirname, check)], { cwd: root, stdio: 'inherit' });
    if (run.status !== 0) failed.push(check);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  failed = failed.length ? failed : ['(setup)'];
} finally {
  server.kill();
  await Promise.race([exited, sleep(5000)]);
  for (let i = 0; i < 20 && existsSync(dir); i++) { try { rmSync(dir, { recursive: true, force: true }); } catch { await sleep(250); } }
}
console.log(failed.length ? `\nFAILED: ${failed.join(', ')}` : `\nAll ${checks.length} browser checks passed.`);
process.exit(failed.length ? 1 : 0);
