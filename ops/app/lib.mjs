// Pure helpers for the CactusPOS launcher (ops/app/launch.mjs). No side effects here, so they are unit tested.
import { posix, win32 } from 'node:path';

/** Screens the app window can open on. */
export const SCREENS = Object.freeze({ pos: '/pos', kitchen: '/kitchen', pickup: '/pickup', admin: '/admin' });

export const DEFAULTS = Object.freeze({
  port: 3000,          // tablets bookmark this, so it never moves on its own
  seed: '',            // menu loaded into an EMPTY database: a file name from seed/ without .json; '' = the sample menu
  screen: 'pos',       // what the app window shows
  kiosk: false,        // true = full screen without a title bar (leave with Alt+F4)
  silentPrint: false,  // true = browser printing goes straight to the default printer, no dialog
  browser: '',         // full path of the browser to use; '' = find Edge or Chrome
});

/**
 * Where the database, settings, logs and the app window's browser profile live.
 * Never inside the program folder, so replacing the program during an update cannot remove sales.
 */
export function dataHome(env, platform, home) {
  if (env.CACTUS_HOME) return env.CACTUS_HOME;
  if (platform === 'win32') return win32.join(env.LOCALAPPDATA || win32.join(home, 'AppData', 'Local'), 'CactusPOS');
  if (platform === 'darwin') return posix.join(home, 'Library', 'Application Support', 'CactusPOS');
  return posix.join(env.XDG_DATA_HOME || posix.join(home, '.local', 'share'), 'cactuspos');
}

/** Reads settings text (possibly saved by Notepad with a byte order mark). Throws with a plain message when it is not JSON. */
export function parseConfigText(text) {
  const clean = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).trim();
  if (!clean) return {};
  let value;
  try { value = JSON.parse(clean); } catch { throw new Error('The settings file is not valid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The settings file must contain one JSON object.');
  return value;
}

/** Defaults, then the settings file, then command line overrides. Returns the usable settings and what was wrong. */
export function normalizeConfig(raw = {}, overrides = {}) {
  const merged = { ...DEFAULTS, ...raw, ...overrides };
  const problems = [];
  const config = { ...DEFAULTS };
  const port = Number(merged.port);
  if (Number.isInteger(port) && port >= 1 && port <= 65535) config.port = port;
  else problems.push(`port must be a whole number from 1 to 65535 (got ${JSON.stringify(merged.port)})`);
  if (typeof merged.seed === 'string' && /^[a-z0-9][a-z0-9-]*$|^$/.test(merged.seed)) config.seed = merged.seed;
  else problems.push('seed must be a file name from seed/ without .json (small letters, digits and dashes)');
  if (Object.hasOwn(SCREENS, merged.screen)) config.screen = merged.screen;
  else problems.push(`screen must be one of ${Object.keys(SCREENS).join(', ')}`);
  for (const key of ['kiosk', 'silentPrint']) {
    if (typeof merged[key] === 'boolean') config[key] = merged[key];
    else problems.push(`${key} must be true or false`);
  }
  if (typeof merged.browser === 'string') config.browser = merged.browser;
  else problems.push('browser must be a path in quotes, or ""');
  return { config, problems };
}

/** Command line of the launcher. */
export function parseArgs(argv) {
  const out = { command: 'open', overrides: {}, json: false, ifNew: false, gui: false, help: false, file: '', yes: false, errors: [] };
  const commands = { '--server-only': 'server', '--stop': 'stop', '--status': 'status', '--configure': 'configure' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) { out.errors.push(`${a} needs a value`); i--; return undefined; }
      return v;
    };
    if (Object.hasOwn(commands, a)) out.command = commands[a];
    else if (a === '--screen') { const v = value(); if (v !== undefined) out.overrides.screen = v; }
    else if (a === '--port') { const v = value(); if (v !== undefined) out.overrides.port = Number(v); }
    else if (a === '--seed') { const v = value(); if (v !== undefined) out.overrides.seed = v; }
    else if (a === '--kiosk') out.overrides.kiosk = true;
    else if (a === '--window') out.overrides.kiosk = false;
    // --restore [file]: the file is optional (the newest backup is used), so it is only taken when it is not another option.
    else if (a === '--restore') { out.command = 'restore'; if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) out.file = argv[++i]; }
    else if (a === '--yes') out.yes = true;
    else if (a === '--json') out.json = true;
    else if (a === '--gui') out.gui = true;
    else if (a === '--if-new') out.ifNew = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else out.errors.push(`Unknown option ${a}`);
  }
  return out;
}

/** Is the answer of `GET /api/health` from CactusPOS? Servers older than the `app` field are recognised by their shape. */
export function isCactusHealth(body) {
  if (!body || typeof body !== 'object' || body.ok !== true) return false;
  return body.app === 'cactuspos' || (body.app === undefined && typeof body.business === 'string' && typeof body.time === 'string');
}

/** Always `localhost`: the sign-in is remembered per address, so the app window must not alternate between names. */
export const appUrl = (port, screen) => `http://localhost:${port}${SCREENS[screen] ?? SCREENS.pos}`;

/** The waiting page shown while the server starts; it moves on to the app by itself. */
export function splashUrl(fileUrl, port, screen, logPath) {
  const q = new URLSearchParams({ port: String(port), path: SCREENS[screen] ?? SCREENS.pos, log: logPath });
  return `${fileUrl}?${q}`;
}

/** Browsers that have an "app window" mode (Chromium family), best first. `exists(path)` is injected for tests. */
export function browserCandidates(platform, env) {
  if (platform === 'win32') {
    const roots = [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean);
    const apps = ['Microsoft\\Edge\\Application\\msedge.exe', 'Google\\Chrome\\Application\\chrome.exe', 'Chromium\\Application\\chrome.exe', 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'];
    return apps.flatMap((app) => roots.map((root) => win32.join(root, app)));
  }
  if (platform === 'darwin') {
    return ['Google Chrome', 'Microsoft Edge', 'Chromium', 'Brave Browser'].map((n) => `/Applications/${n}.app/Contents/MacOS/${n}`);
  }
  const names = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'microsoft-edge', 'microsoft-edge-stable', 'brave-browser'];
  const dirs = [...(env.PATH || '').split(':').filter(Boolean), '/snap/bin', '/usr/bin', '/usr/local/bin'];
  return names.flatMap((name) => [...new Set(dirs)].map((dir) => posix.join(dir, name)));
}

export function findBrowser({ platform, env, exists, configured = '' }) {
  if (configured) return exists(configured) ? configured : null;
  return browserCandidates(platform, env).find((p) => exists(p)) ?? null;
}

/**
 * Flags for a window that looks like an installed program: no tabs, no address bar, its own profile.
 *
 * The three sign-in flags matter on Windows. Without them Edge signs a brand new profile in with the Microsoft
 * account of the Windows user, starts syncing that person's favourites, passwords and extensions into the till's
 * profile, shows a sync notice over the till and opens their start pages in a second window (seen with Edge 154
 * on Windows 11, 2026-10-09). With them the profile stays local and only the till window opens. Chrome ignores
 * the Edge feature name and honours the other two.
 */
export function browserArgs({ url, profileDir, kiosk = false, silentPrint = false }) {
  return [
    `--app=${url}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-session-crashed-bubble',
    '--disable-features=msImplicitSignin,Translate',
    '--disable-sync',
    '--allow-browser-signin=false',
    kiosk ? '--kiosk' : '--start-maximized',
    ...(silentPrint ? ['--kiosk-printing'] : []),
  ];
}

/** Addresses other devices on the same network can use. */
export function lanUrls(interfaces, port) {
  return Object.values(interfaces).flat()
    .filter((n) => n && (n.family === 'IPv4' || n.family === 4) && !n.internal && !n.address.startsWith('169.254.'))
    .map((n) => `http://${n.address}:${port}`);
}

/** Node versions the server supports (see "engines" in package.json): 22.13+ within 22, or 24 and newer. */
export function nodeIsSupported(version) {
  const [major, minor] = String(version).replace(/^v/, '').split('.').map(Number);
  if (!Number.isInteger(major) || !Number.isInteger(minor)) return false;
  return (major === 22 && minor >= 13) || major >= 24;
}
