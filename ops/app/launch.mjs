#!/usr/bin/env node
// Starts CactusPOS the way an installed program starts: makes sure the server runs in the background, then opens
// the till in its own window without tabs or an address bar (the "app window" mode of Edge and Chrome).
// The desktop shortcut and the start-at-sign-in entry made by the installers in ops/ run this file.
//
//   node ops/app/launch.mjs                    server (if not yet running) + till window
//   node ops/app/launch.mjs --screen kitchen   the same, opening the kitchen screen (also: pickup, admin)
//   node ops/app/launch.mjs --kiosk            full screen without a title bar (leave with Alt+F4)
//   node ops/app/launch.mjs --server-only      server only, no window
//   node ops/app/launch.mjs --status           is it running, which addresses do tablets use, where is the data
//   node ops/app/launch.mjs --stop             stop the server this launcher started
//   node ops/app/launch.mjs --restore [file]   put a backup back (the newest one, or the file named); asks first
//   node ops/app/launch.mjs --configure --port 3000 --seed cactus-blue   write settings (add --if-new to keep existing ones)
//   --gui   show problems in a message window as well; the shortcuts pass it, because nobody sees their console
//
// Settings: config.json in the data folder. Data folder: %LOCALAPPDATA%\CactusPOS on Windows,
// ~/.local/share/cactuspos on Linux, or the folder named by CACTUS_HOME. See ops/install.md.
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir, networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DEFAULTS, appUrl, browserArgs, dataHome, findBrowser, isCactusHealth, lanUrls, nodeIsSupported,
  normalizeConfig, parseArgs, parseConfigText, splashUrl,
} from './lib.mjs';

const root = resolve(import.meta.dirname, '../..');
const home = dataHome(process.env, process.platform, homedir());
const paths = {
  config: join(home, 'config.json'),
  db: join(home, 'data', 'cactus.sqlite'),
  log: join(home, 'logs', 'server.log'),
  launcherLog: join(home, 'logs', 'launcher.log'),
  state: join(home, 'server.json'),
  profile: join(home, 'app-profile'),
  lock: join(home, 'launch.lock'),
};
const START_TIMEOUT_MS = 60_000;
// Asked for explicitly. Guessing from "is there a terminal" fails: the shortcuts run this inside a hidden console.
const GUI = process.argv.includes('--gui') && process.env.CACTUS_NO_DIALOG !== '1';
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

class LaunchError extends Error {}

function note(message) {
  try {
    mkdirSync(dirname(paths.launcherLog), { recursive: true });
    writeFileSync(paths.launcherLog, `${new Date().toISOString()} ${message}\n`, { flag: 'a' });
  } catch { /* the log is a convenience; never fail because of it */ }
}

/**
 * Shortcuts run this without a visible console, so with --gui a failure is also shown in a window.
 * Resolves when the person has closed the message. The launcher has to stay alive that long: a helper started
 * "detached" gets no console at all on Windows and PowerShell then dies before it can show anything, while a
 * normal child is closed together with this process.
 */
function showError(message) {
  console.error(message);
  note(`ERROR ${message.replaceAll('\n', ' | ')}`);
  if (!GUI) return Promise.resolve();
  const waitFor = (command, args, options = {}) => new Promise((done) => {
    try {
      const child = spawn(command, args, { stdio: 'ignore', windowsHide: true, ...options });
      child.once('error', () => done(false));
      child.once('exit', (code) => done(code === 0));
    } catch { done(false); }
  });
  if (process.platform === 'win32') {
    // The text travels in an environment variable, so nothing in it is ever read as PowerShell code.
    return waitFor('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "Add-Type -AssemblyName PresentationFramework; [void][System.Windows.MessageBox]::Show($env:CACTUS_MESSAGE, 'CactusPOS', 'OK', 'Warning')"],
    { env: { ...process.env, CACTUS_MESSAGE: message } });
  }
  if (process.platform === 'darwin') {
    return waitFor('osascript', ['-e', 'on run argv', '-e', 'display alert "CactusPOS" message (item 1 of argv)', '-e', 'end run', message]);
  }
  return waitFor('zenity', ['--error', '--title=CactusPOS', '--no-markup', `--text=${message}`])
    .then((shown) => (shown ? true : waitFor('notify-send', ['CactusPOS', message])));
}

function loadConfig(overrides) {
  let raw = {};
  if (existsSync(paths.config)) {
    try { raw = parseConfigText(readFileSync(paths.config, 'utf8')); } catch (e) {
      throw new LaunchError(`${e.message}\nFile: ${paths.config}\nFix the file, or delete it to go back to the standard settings.`);
    }
  }
  const { config, problems } = normalizeConfig(raw, overrides);
  if (problems.length) throw new LaunchError(`Settings problem:\n- ${problems.join('\n- ')}\nFile: ${paths.config}`);
  return { config, raw };
}

function saveConfig(config) {
  mkdirSync(home, { recursive: true });
  writeFileSync(paths.config, `${JSON.stringify(config, null, 2)}\n`);
}

/** `reached` = something answered HTTP on the port; `body` = its JSON, if any. */
async function health(port, ms = 1500) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(ms) });
    return { reached: true, body: await r.json().catch(() => null) };
  } catch {
    return { reached: false, body: null };
  }
}

function readState() {
  try { return JSON.parse(readFileSync(paths.state, 'utf8')); } catch { return null; }
}

/** Keeps one previous log; a year of daily starts must not fill the disk. */
function rotateLog() {
  mkdirSync(dirname(paths.log), { recursive: true });
  try { if (statSync(paths.log).size > 1_000_000) renameSync(paths.log, `${paths.log}.1`); } catch { /* no log yet */ }
}

function logTail(lines = 12) {
  try { return readFileSync(paths.log, 'utf8').trimEnd().split(/\r?\n/).slice(-lines).join('\n'); } catch { return ''; }
}

function startServer(config) {
  if (!nodeIsSupported(process.versions.node)) {
    throw new LaunchError(`CactusPOS needs Node.js 22.13 or newer (24 recommended). This computer runs Node.js ${process.versions.node}.\nRun the installer again; it can install the right version.`);
  }
  if (!existsSync(join(root, 'node_modules', 'tsx')) || !existsSync(join(root, 'node_modules', 'fastify'))) {
    throw new LaunchError(`CactusPOS is not installed completely (its program libraries are missing in ${root}).\nRun the installer again.`);
  }
  if (!existsSync(join(root, 'packages', 'web', 'dist', 'index.html'))) {
    throw new LaunchError(`CactusPOS is not installed completely (the screens are not built in ${root}).\nRun the installer again.`);
  }
  mkdirSync(dirname(paths.db), { recursive: true });
  rotateLog();
  const out = openSync(paths.log, 'a');
  const env = { ...process.env, PORT: String(config.port), CACTUS_STRICT_PORT: '1', CACTUS_DB: paths.db };
  if (config.seed) env.CACTUS_SEED = config.seed; else delete env.CACTUS_SEED;
  writeFileSync(out, `\n--- ${new Date().toISOString()} starting CactusPOS from ${root} on port ${config.port}\n`);
  // Detached with its own hidden console: the server keeps running after this launcher and the app window are gone.
  const child = spawn(process.execPath, ['--import', 'tsx', join(root, 'packages', 'server', 'src', 'main.ts')], {
    cwd: root, env, detached: true, windowsHide: true, stdio: ['ignore', out, out],
  });
  closeSync(out);
  const exited = { done: false, code: null };
  child.on('exit', (code) => { exited.done = true; exited.code = code; });
  child.on('error', (e) => { exited.done = true; exited.code = e.message; });
  child.unref();
  return { child, exited };
}

async function waitForServer(config, started) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const h = await health(config.port, 1000);
    if (h.reached && isCactusHealth(h.body)) {
      writeFileSync(paths.state, `${JSON.stringify({ pid: started.child.pid, port: config.port, startedAt: h.body.startedAt ?? null, root }, null, 2)}\n`);
      note(`server up on port ${config.port}, pid ${started.child.pid}`);
      return h.body;
    }
    if (started.exited.done) {
      throw new LaunchError(`CactusPOS could not start.\n\n${logTail() || `No details were written. Exit code: ${started.exited.code}`}\n\nFull log: ${paths.log}`);
    }
    await sleep(300);
  }
  throw new LaunchError(`CactusPOS did not answer within ${START_TIMEOUT_MS / 1000} seconds.\n\n${logTail()}\n\nFull log: ${paths.log}`);
}

function openWindow(config, url) {
  mkdirSync(paths.profile, { recursive: true });
  const browser = findBrowser({ platform: process.platform, env: process.env, exists: existsSync, configured: config.browser });
  const quiet = { detached: true, stdio: 'ignore' };
  if (browser) {
    return new Promise((done, fail) => {
      const child = spawn(browser, browserArgs({ url, profileDir: paths.profile, kiosk: config.kiosk, silentPrint: config.silentPrint }), quiet);
      child.once('spawn', () => { child.unref(); note(`window ${url} with ${browser}`); done(); });
      child.once('error', (e) => fail(new LaunchError(`The app window could not be opened with ${browser}.\n${e.message}`)));
    });
  }
  if (config.browser) throw new LaunchError(`The browser named in the settings does not exist:\n${config.browser}\nFile: ${paths.config}`);
  // No Edge or Chrome: the default browser still works, only with its tabs and address bar around the till.
  note(`no app-mode browser found; opening ${url} in the default browser`);
  if (process.platform === 'win32') spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], quiet).on('error', () => {}).unref();
  else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], quiet).on('error', () => {}).unref();
  return Promise.resolve();
}

/** A double-click that lands twice must not open two windows. */
function recentlyLaunched() {
  try {
    if (Date.now() - statSync(paths.lock).mtimeMs < 4000) return true;
  } catch { /* first launch */ }
  mkdirSync(home, { recursive: true });
  try { writeFileSync(paths.lock, ''); utimesSync(paths.lock, new Date(), new Date()); } catch { /* not fatal */ }
  return false;
}

async function open(config, withWindow) {
  if (withWindow && recentlyLaunched()) return 0;
  const before = await health(config.port);
  if (before.reached && !isCactusHealth(before.body)) {
    throw new LaunchError(`Port ${config.port} on this computer is used by another program, so CactusPOS cannot start there.\nClose that program, or choose another port in ${paths.config} (tablets must then use the new address).`);
  }
  if (before.reached) {
    if (withWindow) await openWindow(config, appUrl(config.port, config.screen));
    else console.log(`CactusPOS is already running on port ${config.port}.`);
    return 0;
  }
  const started = startServer(config);
  // The server needs a few seconds. Show a window at once so nobody clicks the icon five times.
  if (withWindow) await openWindow(config, splashUrl(pathToFileURL(join(root, 'ops', 'app', 'starting.html')).href, config.port, config.screen, paths.log));
  await waitForServer(config, started);
  if (!withWindow) console.log(`CactusPOS started on port ${config.port}.`);
  return 0;
}

async function stop(config) {
  const state = readState();
  const port = state?.port ?? config.port;
  const h = await health(port);
  if (!h.reached || !isCactusHealth(h.body)) {
    rmSync(paths.state, { force: true });
    console.log('CactusPOS is not running.');
    return 0;
  }
  if (!state || !state.startedAt || state.startedAt !== h.body.startedAt) {
    console.error(`A CactusPOS server is running on port ${port}, but this launcher did not start it (for example start.bat or "npm start" in a terminal).\nStop it where it was started.`);
    return 2;
  }
  try { process.kill(state.pid); } catch (e) {
    if (e.code !== 'ESRCH') { console.error(`Could not stop the server (process ${state.pid}): ${e.message}`); return 1; }
  }
  for (let i = 0; i < 40; i++) {
    if (!(await health(port, 500)).reached) {
      rmSync(paths.state, { force: true });
      note(`server stopped, pid ${state.pid}`);
      console.log('CactusPOS stopped.');
      return 0;
    }
    await sleep(250);
  }
  console.error('The server did not stop.');
  return 1;
}

async function status(config, json) {
  const h = await health(config.port);
  const running = h.reached && isCactusHealth(h.body);
  const info = {
    running,
    portBusyWithOtherProgram: h.reached && !running,
    port: config.port,
    version: running ? h.body.version ?? null : null,
    business: running ? h.body.business : null,
    thisComputer: appUrl(config.port, config.screen),
    otherDevices: lanUrls(networkInterfaces(), config.port),
    home, program: root, settings: paths.config, database: paths.db, log: paths.log,
    startedByThisLauncher: running && readState()?.startedAt === h.body.startedAt,
  };
  if (json) { console.log(JSON.stringify(info, null, 2)); return 0; }
  console.log(running ? `CactusPOS is running${info.business ? ` for ${info.business}` : ''}.` : info.portBusyWithOtherProgram ? `Port ${config.port} is used by another program.` : 'CactusPOS is not running.');
  console.log(`  This computer:   ${info.thisComputer}`);
  for (const url of info.otherDevices) console.log(`  Phones, tablets: ${url}/kitchen   ${url}/pos   ${url}/pickup`);
  if (!info.otherDevices.length) console.log('  Phones, tablets: this computer is not connected to a network');
  console.log(`  Sales database:  ${info.database}`);
  console.log(`  Settings:        ${info.settings}`);
  console.log(`  Log:             ${info.log}`);
  console.log(`  Program:         ${info.program}`);
  return 0;
}

function configure(args) {
  const existed = existsSync(paths.config);
  if (existed && args.ifNew) {
    const { config } = loadConfig({});
    if (args.json) console.log(JSON.stringify({ ...config, home, created: false }, null, 2));
    return 0;
  }
  const raw = existed ? loadConfig({}).raw : {};
  const { config, problems } = normalizeConfig(raw, args.overrides);
  if (problems.length) throw new LaunchError(`Settings problem:\n- ${problems.join('\n- ')}`);
  if (config.seed && !existsSync(join(root, 'seed', `${config.seed}.json`))) {
    throw new LaunchError(`There is no menu file seed/${config.seed}.json in ${root}.`);
  }
  // Keep keys this version does not know: a newer or older launcher may have written them.
  saveConfig({ ...raw, ...config });
  if (args.json) console.log(JSON.stringify({ ...config, home, created: !existed }, null, 2));
  else console.log(`Settings written to ${paths.config}`);
  return 0;
}

async function confirmed(question) {
  if (!process.stdin.isTTY) throw new LaunchError('Nobody is here to answer, so nothing was changed. Add --yes to restore without being asked.');
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return /^(y|yes|j|ja)$/i.test((await rl.question(question)).trim()); } finally { rl.close(); }
}

/** Puts a backup in place of the database. What it replaces is moved aside, never deleted. */
async function restore(config, args) {
  const { inspectDatabase, listBackups, restoreBackup } = await import('./restore.mjs');
  const backups = join(dirname(paths.db), 'backups');
  const file = args.file ? resolve(args.file) : listBackups(backups)[0]?.path;
  if (!file) throw new LaunchError(`There is no backup in ${backups}.\nTo use a backup kept somewhere else (a USB stick): drag that file onto "Restore CactusPOS backup.bat", or run --restore <file>`);
  const say = (d) => `${d.orders} order${d.orders === 1 ? '' : 's'}, last receipt #${d.lastReceipt}${d.lastChange ? `, last change ${new Date(d.lastChange).toLocaleString()}` : ''}`;
  let backup;
  try { backup = await inspectDatabase(file); } catch (e) { throw new LaunchError(e.message); }
  let current = null;
  if (existsSync(paths.db)) { try { current = await inspectDatabase(paths.db); } catch { /* unreadable: all the more reason to restore */ } }

  // The server holds the database open; only the copy this launcher started can be stopped from here.
  const h = await health(config.port);
  const running = h.reached && isCactusHealth(h.body);
  if (running && readState()?.startedAt !== h.body.startedAt) {
    throw new LaunchError(`CactusPOS is running on port ${config.port}, but this launcher did not start it (start.bat or "npm start").\nStop it where it was started, then restore again. Nothing was changed.`);
  }

  console.log(`Backup to put back:   ${file}`);
  console.log(`                      ${say(backup)}`);
  console.log(`On this computer now: ${current ? say(current) : existsSync(paths.db) ? 'a database that cannot be read' : 'no database yet'}`);
  if (current && current.orders > backup.orders) {
    console.log(`\n!! The backup is OLDER: ${current.orders - backup.orders} order(s) made since then would no longer be in the till.`);
  }
  if (existsSync(paths.db)) console.log(`\nThe data on this computer now is kept, in a folder named replaced-... inside ${dirname(paths.db)}`);
  if (!args.yes && !(await confirmed('\nPut this backup back? Type yes and press Enter: '))) { console.log('Nothing was changed.'); return 0; }

  if (running && (await stop(config)) !== 0) throw new LaunchError('CactusPOS could not be stopped, so nothing was changed.');
  let done;
  try { done = restoreBackup({ dbPath: paths.db, backupFile: file }); } catch (e) { throw new LaunchError(`The backup could not be put back: ${e.message}`); }
  note(`restored ${file}${done.aside ? `, previous data in ${done.aside}` : ''}`);
  console.log(`\nDone. CactusPOS now has ${say(backup)}.`);
  if (done.aside) console.log(`The data it replaced is in ${done.aside}`);
  if (running) {
    await waitForServer(config, startServer(config));
    console.log('CactusPOS is running again. Reload the screens that are open.');
  } else console.log('Start CactusPOS as usual.');
  return 0;
}

const HELP = `CactusPOS launcher
  (no option)        start the server if needed and open the till window
  --screen NAME      open pos, kitchen, pickup or admin
  --kiosk            full screen without a title bar (leave with Alt+F4); --window undoes a kiosk setting
  --server-only      start the server, no window
  --status [--json]  running or not, addresses for tablets, where the data is
  --stop             stop the server this launcher started
  --restore [FILE]   put a backup back: the newest one, or FILE; asks first (--yes skips the question)
  --configure        write settings: --port N, --seed NAME, --screen NAME, --kiosk; --if-new keeps an existing file
  --gui              also show problems in a message window (the shortcuts use this)
Settings file: ${paths.config}
Standard settings: ${JSON.stringify(DEFAULTS)}`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(HELP); return 0; }
  if (args.errors.length) throw new LaunchError(`${args.errors.join('\n')}\n\n${HELP}`);
  if (args.command === 'configure') return configure(args);
  const { config } = loadConfig(args.overrides);
  if (args.command === 'status') return status(config, args.json);
  if (args.command === 'stop') return stop(config);
  if (args.command === 'restore') return restore(config, args);
  return open(config, args.command === 'open');
}

try {
  process.exitCode = await main();
} catch (e) {
  process.exitCode = 1;
  if (!(e instanceof LaunchError)) note(`CRASH ${e?.stack ?? e}`);
  await showError(e instanceof LaunchError ? e.message : `CactusPOS launcher failed unexpectedly: ${e?.message ?? e}\nDetails: ${paths.launcherLog}`);
  process.exitCode = 1;
}
