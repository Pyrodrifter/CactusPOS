// Builds the user manual as PDF files from docs/manual/manual.<language>.html, with the Edge or Chrome that is
// already on this computer (headless). No dependencies.
//
//   node scripts/make-manual.mjs                 -> dist/manual/CactusPOS-Manual-English.pdf and
//                                                   dist/manual/CactusPOS-Handleiding-Nederlands.pdf
//   node scripts/make-manual.mjs --out <folder>  -> the same two files in that folder (make-redist uses this)
//   node scripts/make-manual.mjs --shots         -> first take the pictures in docs/manual/img again
//   node scripts/make-manual.mjs --shots-only    -> retake pictures without regenerating release PDFs
//
// --shots builds nothing itself: run `npm run build` first. It starts a throwaway till (temporary data, the Cactus
// Blue menu, port 3061), runs docs/manual/shots.mjs against it once per language and stops it again. Retake the
// pictures when the screens change, look at them, and commit them.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const out = resolve(outIndex >= 0 ? args[outIndex + 1] : join(root, 'dist', 'manual'));
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const fail = (message) => { console.error(`\n${message}`); process.exit(1); };

/** File names without spaces: GitHub turns spaces in release files into dots. */
const MANUALS = [
  { lang: 'en', source: 'manual.en.html', file: 'CactusPOS-Manual-English.pdf' },
  { lang: 'nl', source: 'manual.nl.html', file: 'CactusPOS-Handleiding-Nederlands.pdf' },
];

const browser = [
  process.env.SHOT_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/microsoft-edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((path) => path && existsSync(path));
if (!browser) fail('No Edge or Chrome found to print the manual with. Set SHOT_BROWSER to the browser executable.');

async function removeFolder(dir) {
  for (let i = 0; i < 20 && existsSync(dir); i++) { try { rmSync(dir, { recursive: true, force: true }); } catch { await sleep(250); } }
}

async function takePictures() {
  const PORT = 3061;
  if (!existsSync(join(root, 'packages', 'web', 'dist', 'index.html'))) fail('The screens are not built. Run: npm run build');
  const up = async () => { try { return (await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } };
  if (await up()) fail(`Port ${PORT} is already in use. Stop whatever runs there; the pictures need their own till.`);
  const dir = mkdtempSync(join(tmpdir(), 'cactus-manual-'));
  const env = { ...process.env, PORT: String(PORT), CACTUS_STRICT_PORT: '1', CACTUS_HOME: dir, CACTUS_DB: join(dir, 'manual.sqlite'), CACTUS_SEED: 'cactus-blue' };
  let log = '';
  const server = spawn(process.execPath, ['--import', 'tsx', join(root, 'packages', 'server', 'src', 'main.ts')], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (d) => { log += d; });
  server.stderr.on('data', (d) => { log += d; });
  const exited = new Promise((done) => server.once('exit', done));
  let ok = true;
  try {
    for (let i = 0; !(await up()); i++) {
      if (server.exitCode !== null || i > 100) throw new Error(`The throwaway till did not start.\n${log}`);
      await sleep(200);
    }
    for (const { lang } of MANUALS) {
      console.log(`\n== Pictures (${lang})`);
      const run = spawnSync(process.execPath, [join(root, 'scripts', 'shot.mjs'), '--base', `http://localhost:${PORT}`, '--out', join(root, 'docs', 'manual', 'img'), '--scenario', join(root, 'docs', 'manual', 'shots.mjs')],
        { cwd: root, stdio: 'inherit', env: { ...process.env, MANUAL_LANG: lang } });
      if (run.status !== 0) { ok = false; break; }
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    ok = false;
  } finally {
    server.kill();
    await Promise.race([exited, sleep(5000)]);
    await removeFolder(dir);
  }
  if (!ok) fail('Taking the pictures failed.');
}

/** Prints one page to PDF. The browser gets a throwaway profile and is kept from signing in to any account. */
async function printPdf(source, target) {
  const profile = mkdtempSync(join(tmpdir(), 'cactus-manual-pdf-'));
  rmSync(target, { force: true });
  const url = `${pathToFileURL(source).href}?version=${encodeURIComponent(version)}`;
  const child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-features=msImplicitSignin,Translate', '--disable-sync', '--allow-browser-signin=false',
    `--user-data-dir=${profile}`, '--no-pdf-header-footer', '--virtual-time-budget=5000', `--print-to-pdf=${target}`, url], { stdio: 'ignore' });
  const exited = new Promise((done) => { child.once('exit', done); child.once('error', done); });
  try {
    // On Windows the process that was started can hand over and exit early, so the file itself is watched.
    let size = -1;
    for (let i = 0; i < 240; i++) {
      await sleep(250);
      const now = existsSync(target) ? statSync(target).size : -1;
      if (now > 0 && now === size) return;
      size = now;
    }
    throw new Error(`The browser did not write ${target}.`);
  } finally {
    await Promise.race([exited, sleep(4000)]);
    try { child.kill(); } catch { /* already gone */ }
    await removeFolder(profile);
  }
}

if (args.includes('--shots') || args.includes('--shots-only')) await takePictures();
if (args.includes('--shots-only')) process.exit(0);

mkdirSync(out, { recursive: true });
for (const manual of MANUALS) {
  const source = join(root, 'docs', 'manual', manual.source);
  if (!existsSync(source)) fail(`${source} is missing.`);
  // A picture that is named but not there would leave a hole in the printed manual without anyone noticing.
  const missing = [...readFileSync(source, 'utf8').matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]).filter((src) => !existsSync(join(root, 'docs', 'manual', src)));
  if (missing.length) fail(`${manual.source} names pictures that do not exist: ${missing.join(', ')}\nRun: node scripts/make-manual.mjs --shots`);
  const target = join(out, manual.file);
  await printPdf(source, target);
  console.log(`Manual: ${target}  (${Math.round(statSync(target).size / 1000)} kB)`);
}
