import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { build, transformWithEsbuild } from 'vite';
import type { PwaWorkerScope } from './pwa-worker';
import { pwaBuild } from './pwa-build';

const origin = 'https://pos.test';
const cacheName = 'cactuspos-app-test';
const assets = ['/index.html', '/assets/app-123.js', '/assets/styles-123.css', '/manifest.webmanifest'];
let workerCode: string;

beforeAll(async () => {
  const source = await readFile(new URL('./pwa-worker.ts', import.meta.url), 'utf8');
  const result = await transformWithEsbuild(
    `${source}\ninstallPwaWorker(self, ${JSON.stringify({ version: 'test', assets, shell: '/index.html' })});`,
    'sw.ts', { loader: 'ts', format: 'iife', target: 'es2022' },
  );
  workerCode = result.code;
});

function harness(code = workerCode) {
  type TestEvent = {
    request?: Request;
    data?: unknown;
    respondWith: (work: Promise<Response>) => void;
    waitUntil: (work: Promise<unknown>) => void;
  };
  const listeners = new Map<string, (event: TestEvent) => void>();
  const storage = new Map<string, Map<string, Response>>();
  const precacheRequests: Request[] = [];
  const fetch = vi.fn(async (_request: Request) => new Response('network'));
  const windows: unknown[] = [];
  const skipWaiting = vi.fn(async () => undefined);
  const claim = vi.fn(async () => undefined);
  function entries(name: string) {
    if (!storage.has(name)) storage.set(name, new Map());
    return storage.get(name)!;
  }
  const caches = {
    open: vi.fn(async (name: string) => ({
      match: async (request: Request | string) => entries(name).get(
        typeof request === 'string' ? new URL(request, origin).href : request.url,
      )?.clone(),
      addAll: async (requests: Request[]) => {
        precacheRequests.push(...requests);
        for (const request of requests) entries(name).set(request.url, new Response(`precache:${new URL(request.url).pathname}`));
      },
    })),
    keys: vi.fn(async () => [...storage.keys()]),
    delete: vi.fn(async (name: string) => storage.delete(name)),
  };
  const scope = {
    location: { origin }, caches, fetch, skipWaiting,
    clients: { matchAll: vi.fn(async () => windows), claim },
    addEventListener: (type: string, listener: (event: TestEvent) => void) => listeners.set(type, listener),
  };
  runInNewContext(code, { self: scope as unknown as PwaWorkerScope, Request, Response, URL });
  async function dispatch(type: string, extra: { request?: Request; data?: unknown } = {}) {
    const work: Promise<unknown>[] = [];
    let response: Promise<Response> | undefined;
    listeners.get(type)!({
      ...extra,
      waitUntil: (promise) => work.push(promise),
      respondWith: (promise) => { response = promise; },
    });
    await Promise.all(work);
    return response;
  }
  function seed(name: string, path: string, text: string) {
    entries(name).set(new URL(path, origin).href, new Response(text));
  }
  function request(path: string, init: RequestInit = {}, navigate = false): Request {
    const req = new Request(new URL(path, origin), init);
    if (navigate) Object.defineProperty(req, 'mode', { value: 'navigate' });
    return req;
  }
  async function load(path: string, init: RequestInit = {}, navigate = false) {
    return dispatch('fetch', { request: request(path, init, navigate) });
  }
  return { dispatch, load, seed, fetch, storage, caches, precacheRequests, windows, skipWaiting, claim };
}

describe('production service worker executed in its own scope', () => {
  it('precaches only the injected static assets without credentials and waits for approval', async () => {
    const worker = harness();
    await worker.dispatch('install');
    expect(worker.precacheRequests.map((item) => new URL(item.url).pathname)).toEqual(assets);
    expect(worker.precacheRequests.every((item) => item.credentials === 'omit' && item.cache === 'reload')).toBe(true);
    expect(worker.skipWaiting).not.toHaveBeenCalled();
  });

  it('activates only the supported update message', async () => {
    const worker = harness();
    for (const data of [null, 'ACTIVATE_UPDATE', {}, { type: 'REPLAY_PAYMENTS' }]) {
      await worker.dispatch('message', { data });
    }
    expect(worker.skipWaiting).not.toHaveBeenCalled();
    await worker.dispatch('message', { data: { type: 'ACTIVATE_UPDATE' } });
    expect(worker.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it('serves the shell for offline deep links and server failures', async () => {
    const worker = harness();
    await worker.dispatch('install');
    worker.fetch.mockRejectedValueOnce(new TypeError('offline'));
    expect(await (await worker.load('/pos/order/123', {}, true))!.text()).toBe('precache:/index.html');
    worker.fetch.mockResolvedValueOnce(new Response('server down', { status: 503 }));
    expect(await (await worker.load('/kitchen', {}, true))!.text()).toBe('precache:/index.html');
  });

  it('returns online navigation and 4xx responses without saving page or query data', async () => {
    const worker = harness();
    await worker.dispatch('install');
    worker.fetch.mockResolvedValueOnce(new Response('private page'));
    expect(await (await worker.load('/pos?staff=123', {}, true))!.text()).toBe('private page');
    worker.fetch.mockResolvedValueOnce(new Response('denied', { status: 403 }));
    expect((await worker.load('/admin', {}, true))!.status).toBe(403);
    expect([...worker.storage.get(cacheName)!.keys()]).toEqual(assets.map((path) => origin + path));
  });

  it.each([
    ['/api/orders', {}, false], ['/api/orders', {}, true], ['/api', {}, true],
    ['/ws', {}, false], ['/ws/events', {}, true],
    ['/api/practice/orders', {}, true], ['/practice/ws', {}, true],
    ['/api/payments', { method: 'POST', body: 'cash' }, false],
    ['/pos', { method: 'POST', body: 'sale' }, true],
    ['/assets/app-123.js', { method: 'HEAD' }, false],
    ['/assets/app-123.js', { method: 'PUT', body: 'no' }, false],
    ['/assets/app-123.js', { method: 'DELETE' }, false],
    ['/assets/app-123.js', { headers: { Authorization: 'Bearer private' } }, false],
    ['/pos', { headers: { Authorization: 'Bearer private' } }, true],
    ['/assets/app-123.js', { headers: { Range: 'bytes=0-10' } }, false],
    ['https://external.test/assets/app-123.js', {}, false],
    ['/private-report.json', {}, false], ['/manifest.webmanifest?staff=1', {}, false],
  ] satisfies [string, RequestInit, boolean][])('leaves %s %j navigation=%s network-only', async (path, init, navigate) => {
    const worker = harness();
    await worker.dispatch('install');
    const before = worker.caches.open.mock.calls.length;
    expect(await worker.load(path, init, navigate)).toBeUndefined();
    expect(worker.caches.open.mock.calls.length).toBe(before);
    expect(worker.fetch).not.toHaveBeenCalled();
    expect(worker.storage.size).toBe(1);
  });

  it('serves precached build assets and does not cache unexpected assets', async () => {
    const worker = harness();
    await worker.dispatch('install');
    expect(await (await worker.load('/assets/app-123.js'))!.text()).toBe('precache:/assets/app-123.js');
    expect(worker.fetch).not.toHaveBeenCalled();
    expect(await (await worker.load('/assets/private.json'))!.text()).toBe('network');
    expect(worker.storage.get(cacheName)!.has(origin + '/assets/private.json')).toBe(false);
  });

  it('retains old chunks while windows are open and can serve them after an approved update', async () => {
    const worker = harness();
    await worker.dispatch('install');
    worker.seed('cactuspos-app-older', '/assets/old-chunk.js', 'old module');
    worker.seed('unrelated-app', '/assets/secret.js', 'unrelated data');
    worker.windows.push({ url: origin + '/pos' });
    await worker.dispatch('activate');
    expect(worker.caches.delete).not.toHaveBeenCalled();
    expect(await (await worker.load('/assets/old-chunk.js'))!.text()).toBe('old module');
    expect(await (await worker.load('/assets/secret.js'))!.text()).toBe('network');
    expect(worker.claim).toHaveBeenCalledTimes(1);
  });

  it('cleans only app-owned obsolete caches when no windows remain', async () => {
    const worker = harness();
    await worker.dispatch('install');
    worker.seed('cactuspos-app-older', '/assets/old-chunk.js', 'old');
    worker.seed('unrelated-app', '/private.json', 'private');
    await worker.dispatch('activate');
    expect([...worker.storage.keys()]).toEqual([cacheName, 'unrelated-app']);
    expect(worker.caches.delete).toHaveBeenCalledExactlyOnceWith('cactuspos-app-older');
  });
});

describe('production PWA build', () => {
  it('injects every generated chunk and static icon, and versions changes to public assets', async () => {
    const fixtureRoot = await mkdtemp(resolve(tmpdir(), 'cactuspos-pwa-build-'));
    try {
      await mkdir(resolve(fixtureRoot, 'src/lib'), { recursive: true });
      await cp(new URL('./pwa-worker.ts', import.meta.url), resolve(fixtureRoot, 'src/lib/pwa-worker.ts'));
      await cp(new URL('../../public', import.meta.url), resolve(fixtureRoot, 'public'), { recursive: true });
      await writeFile(resolve(fixtureRoot, 'index.html'), '<!doctype html><script type="module" src="/src/main.ts"></script>');
      await writeFile(resolve(fixtureRoot, 'src/main.ts'), "import './style.css'; globalThis.loadExtra = () => import('./lazy.ts');");
      await writeFile(resolve(fixtureRoot, 'src/lazy.ts'), 'export const extra = 1;');
      await writeFile(resolve(fixtureRoot, 'src/style.css'), 'body { color: green; }');
      async function compile() {
        const output = await build({
          root: fixtureRoot, configFile: false, logLevel: 'silent', plugins: [pwaBuild()],
          build: { write: false },
        });
        if (Array.isArray(output) || !('output' in output)) throw new Error('Expected a single build output.');
        const worker = output.output.find((item) => item.fileName === 'sw.js');
        if (!worker || worker.type !== 'asset') throw new Error('Expected the emitted worker.');
        const scope = harness(String(worker.source));
        await scope.dispatch('install');
        return { scope, output: output.output };
      }
      const first = await compile();
      const precachedPaths = first.scope.precacheRequests.map((request) => new URL(request.url).pathname);
      const generated = first.output.filter((item) => item.fileName !== 'sw.js').map((item) => `/${item.fileName}`);
      expect(generated.some((path) => /lazy-.*\.js$/.test(path))).toBe(true);
      expect(precachedPaths).toEqual(expect.arrayContaining(generated));
      expect(precachedPaths).toEqual(expect.arrayContaining([
        '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png',
        '/icons/maskable-192.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png',
      ]));
      expect(first.scope.skipWaiting).not.toHaveBeenCalled();
      const same = await compile();
      expect([...same.scope.storage.keys()]).toEqual([...first.scope.storage.keys()]);
      await writeFile(resolve(fixtureRoot, 'public/manifest.webmanifest'), '{"name":"Changed app"}');
      const changed = await compile();
      expect([...changed.scope.storage.keys()]).not.toEqual([...first.scope.storage.keys()]);
    } finally {
      // Only the absolute directory returned by mkdtemp belongs to this test.
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });
});
