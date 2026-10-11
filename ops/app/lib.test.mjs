import { describe, expect, it } from 'vitest';
import {
  DEFAULTS, addressesText, appUrl, browserArgs, browserCandidates, dataHome, findBrowser, isCactusHealth, lanUrls,
  nodeIsSupported, normalizeConfig, parseArgs, parseConfigText, splashUrl,
} from './lib.mjs';

describe('dataHome', () => {
  it('keeps data outside the program folder, per platform', () => {
    expect(dataHome({ LOCALAPPDATA: 'C:\\Users\\T\\AppData\\Local' }, 'win32', 'C:\\Users\\T')).toBe('C:\\Users\\T\\AppData\\Local\\CactusPOS');
    expect(dataHome({}, 'win32', 'C:\\Users\\T')).toBe('C:\\Users\\T\\AppData\\Local\\CactusPOS');
    expect(dataHome({}, 'linux', '/home/t')).toBe('/home/t/.local/share/cactuspos');
    expect(dataHome({ XDG_DATA_HOME: '/data' }, 'linux', '/home/t')).toBe('/data/cactuspos');
    expect(dataHome({}, 'darwin', '/Users/t')).toBe('/Users/t/Library/Application Support/CactusPOS');
  });
  it('CACTUS_HOME wins', () => {
    expect(dataHome({ CACTUS_HOME: 'D:\\pos', LOCALAPPDATA: 'x' }, 'win32', 'y')).toBe('D:\\pos');
  });
});

describe('settings', () => {
  it('reads a file saved with a byte order mark, and an empty file', () => {
    expect(parseConfigText(`${String.fromCharCode(0xfeff)}{ "port": 3100 }`)).toEqual({ port: 3100 });
    expect(parseConfigText('  ')).toEqual({});
  });
  it('rejects text that is not one JSON object', () => {
    expect(() => parseConfigText('{ port: 3000 }')).toThrow(/not valid JSON/);
    expect(() => parseConfigText('[1]')).toThrow(/one JSON object/);
  });
  it('fills in defaults and lets the command line win', () => {
    expect(normalizeConfig({}, {})).toEqual({ config: { ...DEFAULTS }, problems: [] });
    const { config, problems } = normalizeConfig({ port: 3100, seed: 'cactus-blue', kiosk: true }, { screen: 'kitchen', kiosk: false });
    expect(problems).toEqual([]);
    expect(config).toMatchObject({ port: 3100, seed: 'cactus-blue', screen: 'kitchen', kiosk: false });
  });
  it('reports bad values and falls back to the default for each', () => {
    const { config, problems } = normalizeConfig({ port: '80a', seed: '../secret', screen: 'bar', kiosk: 'yes', browser: 5 });
    expect(config).toEqual({ ...DEFAULTS });
    expect(problems).toHaveLength(5);
  });
  it('accepts a port given as text, because the command line is text', () => {
    expect(normalizeConfig({}, { port: '3055' }).config.port).toBe(3055);
    expect(normalizeConfig({ port: 0 }).problems).toHaveLength(1);
    expect(normalizeConfig({ port: 70000 }).problems).toHaveLength(1);
  });
});

describe('parseArgs', () => {
  it('opens the till by default', () => {
    expect(parseArgs([])).toMatchObject({ command: 'open', overrides: {}, errors: [] });
  });
  it('reads commands and overrides', () => {
    expect(parseArgs(['--server-only']).command).toBe('server');
    expect(parseArgs(['--stop']).command).toBe('stop');
    expect(parseArgs(['--addresses', '--gui'])).toMatchObject({ command: 'addresses', gui: true, errors: [] });
    expect(parseArgs(['--status', '--json'])).toMatchObject({ command: 'status', json: true });
    expect(parseArgs(['--screen', 'kitchen', '--kiosk', '--port', '3100']).overrides).toEqual({ screen: 'kitchen', kiosk: true, port: 3100 });
    expect(parseArgs(['--configure', '--if-new', '--seed', 'cactus-blue'])).toMatchObject({ command: 'configure', ifNew: true, overrides: { seed: 'cactus-blue' } });
    expect(parseArgs(['--gui', '--screen', 'kitchen'])).toMatchObject({ command: 'open', gui: true, overrides: { screen: 'kitchen' } });
    expect(parseArgs([]).gui).toBe(false);
    expect(parseArgs(['--restore'])).toMatchObject({ command: 'restore', file: '', yes: false, errors: [] });
    expect(parseArgs(['--restore', 'E:\\pos\\cactus-20261010-130509.sqlite', '--yes'])).toMatchObject({ command: 'restore', file: 'E:\\pos\\cactus-20261010-130509.sqlite', yes: true });
    expect(parseArgs(['--restore', '--yes'])).toMatchObject({ command: 'restore', file: '', yes: true });
  });
  it('reports what it does not understand instead of guessing', () => {
    expect(parseArgs(['--screeen', 'pos']).errors).toEqual(['Unknown option --screeen', 'Unknown option pos']);
    expect(parseArgs(['--screen']).errors).toEqual(['--screen needs a value']);
    expect(parseArgs(['--port', '--kiosk'])).toMatchObject({ errors: ['--port needs a value'], overrides: { kiosk: true } });
  });
});

describe('isCactusHealth', () => {
  it('recognises this server, and older builds by shape', () => {
    expect(isCactusHealth({ ok: true, app: 'cactuspos', business: 'X', time: 't' })).toBe(true);
    expect(isCactusHealth({ ok: true, business: 'Cactus Blue', time: '2026-10-09T12:00:00.000Z' })).toBe(true);
  });
  it('does not mistake another program for it', () => {
    expect(isCactusHealth(null)).toBe(false);
    expect(isCactusHealth({ ok: true })).toBe(false);
    expect(isCactusHealth({ ok: true, app: 'other', business: 'X', time: 't' })).toBe(false);
    expect(isCactusHealth({ status: 'up' })).toBe(false);
  });
});

describe('addresses', () => {
  it('uses localhost for the app window', () => {
    expect(appUrl(3000, 'pos')).toBe('http://localhost:3000/pos');
    expect(appUrl(3100, 'kitchen')).toBe('http://localhost:3100/kitchen');
    expect(appUrl(3000, 'nope')).toBe('http://localhost:3000/pos');
  });
  it('passes port, path and log to the waiting page', () => {
    const url = new URL(splashUrl('file:///C:/app/ops/app/starting.html', 3100, 'kitchen', 'C:\\Users\\T\\logs\\server.log'));
    expect(url.pathname).toBe('/C:/app/ops/app/starting.html');
    expect(Object.fromEntries(url.searchParams)).toEqual({ port: '3100', path: '/kitchen', log: 'C:\\Users\\T\\logs\\server.log' });
  });
  it('lists LAN addresses for tablets, without loopback and self-assigned ones', () => {
    const interfaces = {
      lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
      wifi: [{ family: 'IPv4', internal: false, address: '192.168.1.20' }, { family: 'IPv6', internal: false, address: 'fe80::1' }],
      dead: [{ family: 'IPv4', internal: false, address: '169.254.10.2' }],
      odd: undefined,
    };
    expect(lanUrls(interfaces, 3000)).toEqual(['http://192.168.1.20:3000']);
  });
});

describe('browser', () => {
  const env = { 'ProgramFiles(x86)': 'C:\\Program Files (x86)', ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\T\\AppData\\Local' };
  it('prefers Edge on Windows, then Chrome', () => {
    const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
    const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    expect(findBrowser({ platform: 'win32', env, exists: (p) => p === edge || p === chrome })).toBe(edge);
    expect(findBrowser({ platform: 'win32', env, exists: (p) => p === chrome })).toBe(chrome);
    expect(findBrowser({ platform: 'win32', env, exists: () => false })).toBeNull();
  });
  it('searches PATH on Linux', () => {
    expect(browserCandidates('linux', { PATH: '/opt/bin:/usr/bin' })).toContain('/opt/bin/chromium');
    expect(findBrowser({ platform: 'linux', env: { PATH: '/usr/bin' }, exists: (p) => p === '/usr/bin/google-chrome' })).toBe('/usr/bin/google-chrome');
  });
  it('a configured browser is used as given, and never silently replaced', () => {
    expect(findBrowser({ platform: 'win32', env, exists: () => true, configured: 'D:\\b.exe' })).toBe('D:\\b.exe');
    expect(findBrowser({ platform: 'win32', env, exists: (p) => p !== 'D:\\b.exe', configured: 'D:\\b.exe' })).toBeNull();
  });
  it('opens an app window with its own profile', () => {
    const args = browserArgs({ url: 'http://localhost:3000/pos', profileDir: 'C:\\data\\app-profile' });
    expect(args[0]).toBe('--app=http://localhost:3000/pos');
    expect(args).toContain('--user-data-dir=C:\\data\\app-profile');
    expect(args).toContain('--start-maximized');
    expect(args).not.toContain('--kiosk');
    expect(args).not.toContain('--kiosk-printing');
  });
  it('never lets the browser sign the till profile in to a personal account', () => {
    const args = browserArgs({ url: 'u', profileDir: 'p' });
    expect(args).toContain('--disable-sync');
    expect(args).toContain('--allow-browser-signin=false');
    expect(args.find((a) => a.startsWith('--disable-features='))).toContain('msImplicitSignin');
  });
  it('kiosk and silent printing are opt-in', () => {
    const args = browserArgs({ url: 'u', profileDir: 'p', kiosk: true, silentPrint: true });
    expect(args).toContain('--kiosk');
    expect(args).toContain('--kiosk-printing');
    expect(args).not.toContain('--start-maximized');
  });
});

describe('nodeIsSupported', () => {
  it('matches the engines range in package.json', () => {
    expect(nodeIsSupported('v24.16.0')).toBe(true);
    expect(nodeIsSupported('22.13.0')).toBe(true);
    expect(nodeIsSupported('26.1.0')).toBe(true);
    expect(nodeIsSupported('22.12.0')).toBe(false);
    expect(nodeIsSupported('23.5.0')).toBe(false);
    expect(nodeIsSupported('20.18.0')).toBe(false);
    expect(nodeIsSupported('')).toBe(false);
  });
});

describe('addressesText', () => {
  it('gives the address to type for each screen', () => {
    const text = addressesText({ urls: ['http://192.168.1.20:3000'], running: true });
    expect(text).toContain('http://192.168.1.20:3000/kitchen');
    expect(text).toContain('http://192.168.1.20:3000/pos');
    expect(text).toContain('http://192.168.1.20:3000/pickup');
    expect(text).toContain('CactusPOS is running.');
    expect(text).not.toContain('Try this one first');
  });
  it('says which to try first when the computer has several addresses', () => {
    const text = addressesText({ urls: ['http://192.168.1.20:3000', 'http://172.20.0.1:3000'], running: true });
    expect(text.indexOf('Try this one first')).toBeLessThan(text.indexOf('192.168.1.20'));
    expect(text.indexOf('If that does not open')).toBeLessThan(text.indexOf('172.20.0.1'));
  });
  it('says so when the till is not running, or the computer has no network', () => {
    expect(addressesText({ urls: ['http://10.0.0.5:3000'], running: false })).toContain('NOT running');
    const none = addressesText({ urls: [], running: true });
    expect(none).toContain('not connected to a network');
    expect(none).not.toContain('http://');
  });
});
