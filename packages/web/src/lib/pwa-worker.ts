/** Self-contained worker entry point; the production build injects its asset inventory. */
export interface PwaWorkerConfig {
  version: string;
  assets: string[];
  shell: string;
}

interface LifetimeEvent { waitUntil(work: Promise<unknown>): void }
interface WorkerFetchEvent extends LifetimeEvent {
  request: Request;
  respondWith(response: Promise<Response>): void;
}
interface WorkerMessageEvent extends LifetimeEvent { data: unknown }
export interface PwaWorkerScope {
  location: { origin: string };
  caches: CacheStorage;
  fetch(request: Request): Promise<Response>;
  clients: {
    matchAll(options: { includeUncontrolled: boolean; type: 'window' }): Promise<unknown[]>;
    claim(): Promise<void>;
  };
  skipWaiting(): Promise<void>;
  addEventListener(type: 'install' | 'activate', listener: (event: LifetimeEvent) => void): void;
  addEventListener(type: 'fetch', listener: (event: WorkerFetchEvent) => void): void;
  addEventListener(type: 'message', listener: (event: WorkerMessageEvent) => void): void;
}

export function installPwaWorker(scope: PwaWorkerScope, config: PwaWorkerConfig): void {
  const prefix = 'cactuspos-app-';
  const cacheName = `${prefix}${config.version}`;
  const approved = new Set(config.assets.map((path) => new URL(path, scope.location.origin).href));
  const shellUrl = new URL(config.shell, scope.location.origin).href;

  scope.addEventListener('install', (event) => {
    // No skipWaiting here: open tills keep their current worker until an explicit update.
    event.waitUntil(scope.caches.open(cacheName).then((cache) => cache.addAll(
      [...approved].map((url) => new Request(url, { credentials: 'omit', cache: 'reload' })),
    )));
  });

  scope.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
      // A tab may still run the previous bundle after a colleague approves an update.
      // Retain its precached chunks until there are no windows left on this origin.
      const windows = await scope.clients.matchAll({ includeUncontrolled: true, type: 'window' });
      if (windows.length === 0) {
        const names = await scope.caches.keys();
        await Promise.all(names.filter((name) => name.startsWith(prefix) && name !== cacheName)
          .map((name) => scope.caches.delete(name)));
      }
      await scope.clients.claim();
    })());
  });

  scope.addEventListener('message', (event) => {
    if (typeof event.data === 'object' && event.data !== null
      && 'type' in event.data && event.data.type === 'ACTIVATE_UPDATE') {
      event.waitUntil(scope.skipWaiting());
    }
  });

  async function cachedStatic(request: Request): Promise<Response | undefined> {
    const current = await scope.caches.open(cacheName);
    const response = await current.match(request);
    if (response) return response;
    // Only exact entries previously precached by this app are eligible, never other caches.
    const names = await scope.caches.keys();
    for (const name of names.filter((item) => item.startsWith(prefix) && item !== cacheName)) {
      const previous = await scope.caches.open(name);
      const oldResponse = await previous.match(request);
      if (oldResponse) return oldResponse;
    }
    return undefined;
  }

  async function navigation(request: Request): Promise<Response> {
    try {
      const response = await scope.fetch(request);
      if (response.status < 500) return response;
      return (await (await scope.caches.open(cacheName)).match(shellUrl)) ?? response;
    } catch (error) {
      const shell = await (await scope.caches.open(cacheName)).match(shellUrl);
      if (shell) return shell;
      throw error;
    }
  }

  scope.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);
    // Check this before navigation: typing /api/... into the address bar is still API traffic.
    if (request.method !== 'GET' || url.origin !== scope.location.origin
      || /^\/(api|ws)(\/|$)/i.test(url.pathname)
      || request.headers.has('authorization') || request.headers.has('range')) return;

    if (request.mode === 'navigate') {
      event.respondWith(navigation(request));
    } else if (!url.search && (approved.has(url.href) || url.pathname.startsWith('/assets/'))) {
      event.respondWith(cachedStatic(request).then((response) => response ?? scope.fetch(request)));
    }
    // No runtime writes, page caching, sync handlers, queues, or transaction replay.
  });
}
