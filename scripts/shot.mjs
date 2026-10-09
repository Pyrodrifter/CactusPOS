// Takes real screenshots of the running app at any screen size, using the Edge (or Chrome) already
// installed on this computer in headless mode. No dependencies: it talks to the browser over its
// debugging WebSocket. For developers and agents checking UI work; not part of the product.
//
//   node scripts/shot.mjs --base http://localhost:3000 --out shots --scenario my-scenario.mjs
//   node scripts/shot.mjs --base http://localhost:3000 --out shots --pin 1234 --size 1180x820 pos kitchen admin
//
// A scenario is a module that default-exports `async (page) => { ... }` using:
//   page.size(width, height)        viewport in CSS pixels (phone widths also switch on touch + mobile mode)
//   page.login(pin)                 signs in through the API and stores the session
//   page.goto('/pos')               navigates and waits for the app to settle
//   page.click('css selector')      or page.click({ text: 'Pay' }) to click the first button/link containing that text
//   page.type('css selector', 'x')  sets an input's value the way React expects
//   page.eval('js expression')      runs in the page, returns the JSON value
//   page.wait(ms)
//   page.shot('name')               writes <out>/<name>.png and prints its path
//   page.measure()                  { width, height, overflowX: [...], small: [...] } for touch-target checks
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const base = opt('base', 'http://localhost:3000');
const out = resolve(opt('out', 'shots'));
const scenario = opt('scenario');
const pin = opt('pin');
const [w0, h0] = opt('size', '1180x820').split('x').map(Number);
// Git Bash on Windows rewrites an argument like /pos into C:/Program Files/Git/pos; undo that, and accept "pos" too.
const paths = args.map((p) => `/${p.replace(/^[A-Za-z]:[\\/].*?[\\/]Git[\\/]/, '').replace(/^\/+/, '')}`);

const browser = [
  process.env.SHOT_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/microsoft-edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => p && existsSync(p));
if (!browser) { console.error('No Edge or Chrome found. Set SHOT_BROWSER to the browser executable.'); process.exit(1); }

mkdirSync(out, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'cactus-shot-')); // a throwaway profile: never the user's own browser data
// The sign-in flags below keep Edge from signing that throwaway profile in with the Windows user's Microsoft account.
const child = spawn(browser, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-features=msImplicitSignin', '--disable-sync', '--allow-browser-signin=false', '--disable-gpu', '--hide-scrollbars', '--mute-audio', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((done, fail) => {
  let buf = '';
  const timer = setTimeout(() => fail(new Error('The browser did not start within 20 seconds')), 20_000);
  child.stderr.on('data', (d) => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) { clearTimeout(timer); done(m[1]); } });
  child.on('exit', (c) => fail(new Error(`The browser exited early (${c})`)));
});

const ws = new WebSocket(wsUrl);
await new Promise((done, fail) => { ws.onopen = done; ws.onerror = () => fail(new Error('Could not connect to the browser')); });
let nextId = 1;
const pending = new Map();
const waiters = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { const { done, fail } = pending.get(msg.id); pending.delete(msg.id); if (msg.error) fail(new Error(msg.error.message)); else done(msg.result); }
  else if (msg.method) for (const w of [...waiters]) if (w.method === msg.method) { waiters.splice(waiters.indexOf(w), 1); w.done(msg.params); }
};
let sessionId;
const send = (method, params = {}) => new Promise((done, fail) => { const id = nextId++; pending.set(id, { done, fail }); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
const once = (method, ms = 15_000) => new Promise((done) => { const w = { method, done }; waiters.push(w); setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); done(null); } }, ms); });

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));
await send('Page.enable');
await send('Runtime.enable');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const page = {
  async size(width, height) {
    const mobile = width < 700;
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  },
  async eval(expression) {
    const r = await send('Runtime.evaluate', { expression: `(async () => (${expression}))()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`In page: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  },
  async goto(path) {
    const loaded = once('Page.loadEventFired');
    await send('Page.navigate', { url: path.startsWith('http') ? path : `${base}/${path.replace(/^\/+/, '')}` });
    await loaded;
    await sleep(700); // data fetches and entrance animations
  },
  async login(p) {
    await page.goto('/login');
    const ok = await page.eval(`fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: ${JSON.stringify(String(p))} }) }).then(async (r) => { if (!r.ok) return false; localStorage.setItem('cactus.session', JSON.stringify(await r.json())); return true; })`);
    if (!ok) throw new Error(`Login with that PIN failed at ${base}`);
  },
  async click(target) {
    const found = await page.eval(typeof target === 'string'
      ? `(() => { const e = document.querySelector(${JSON.stringify(target)}); if (!e) return false; e.click(); return true; })()`
      : `(() => { const e = [...document.querySelectorAll('button, a, [role=button], summary')].find((x) => x.getClientRects().length && x.textContent.replace(/\\s+/g, ' ').includes(${JSON.stringify(target.text)})); if (!e) return false; e.click(); return true; })()`);
    if (!found) throw new Error(`Nothing to click for ${JSON.stringify(target)}`);
    await sleep(450);
  },
  async type(selector, value) {
    const ok = await page.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), 'value').set; set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    if (!ok) throw new Error(`No input matches ${selector}`);
    await sleep(150);
  },
  wait: sleep,
  async shot(name) {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    const file = join(out, `${name.replace(/[^\w.-]+/g, '_')}.png`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    console.log(file);
    return file;
  },
  /** Touch-target audit of what is on screen now. `small` lists visible controls under 48px in either direction. */
  measure() {
    return page.eval(`(() => {
      const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.bottom > 0 && b.top < innerHeight; };
      const label = (e) => (e.getAttribute('aria-label') || e.textContent || e.className || e.tagName).toString().replace(/\\s+/g, ' ').trim().slice(0, 30);
      const scrollerX = (e) => { for (let p = e.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll') return true; } return false; };
      return {
        width: innerWidth, height: innerHeight,
        overflowX: [...document.querySelectorAll('body *')].filter((e) => vis(e) && e.getBoundingClientRect().right > innerWidth + 1 && !scrollerX(e)).slice(0, 12).map(label),
        small: [...document.querySelectorAll('button, a, input, select, summary, [role=button]')].filter(vis).map((e) => ({ e, b: e.getBoundingClientRect() }))
          .filter(({ e, b }) => e.type !== 'hidden' && (b.height < 48 || b.width < 48)).slice(0, 20).map(({ e, b }) => label(e) + ' ' + Math.round(b.width) + 'x' + Math.round(b.height)),
      };
    })()`);
  },
};

let failed = false;
try {
  await page.size(w0, h0);
  if (scenario) {
    const mod = await import(pathToFileURL(resolve(scenario)).href);
    await mod.default(page);
  } else {
    if (pin) await page.login(pin);
    for (const p of paths.length ? paths : ['/']) { await page.goto(p); await page.shot(`${p.replace(/^\//, '') || 'home'}_${w0}x${h0}`); }
  }
} catch (e) {
  failed = true;
  console.error(e instanceof Error ? e.message : e);
} finally {
  try { await send('Target.closeTarget', { targetId }); } catch { /* already gone */ }
  ws.close();
  child.kill();
  await sleep(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* the browser may still hold a file for a moment */ }
}
process.exit(failed ? 1 : 0);
