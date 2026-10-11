import { useSyncExternalStore } from 'react';

type Connection = 'checking' | 'online' | 'offline';
interface PwaState {
  connection: Connection;
  offlineReady: boolean;
  updateAvailable: boolean;
  installAvailable: boolean;
  updating: boolean;
}
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let state: PwaState = {
  connection: 'checking', offlineReady: false, updateAvailable: false,
  installAvailable: false, updating: false,
};
const listeners = new Set<() => void>();
let registration: ServiceWorkerRegistration | undefined;
let installPrompt: InstallPrompt | undefined;
let initialized = false;
let checking = false;

function publish(patch: Partial<PwaState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export function usePwa() {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => state,
  );
}

/** Probe the local server, not internet access: the truck can work without internet. */
export async function checkServer(): Promise<void> {
  if (checking) return;
  checking = true;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch('/api/health', {
      cache: 'no-store', credentials: 'omit', signal: controller.signal,
    });
    const body: unknown = response.ok ? await response.json() : null;
    const online = !!body && typeof body === 'object' && 'ok' in body && body.ok === true;
    publish({ connection: online ? 'online' : 'offline' });
  } catch { publish({ connection: 'offline' }); }
  finally { clearTimeout(timer); checking = false; }
}

export async function installApp(): Promise<void> {
  const prompt = installPrompt;
  if (!prompt) return;
  installPrompt = undefined;
  publish({ installAvailable: false });
  try { await prompt.prompt(); await prompt.userChoice; }
  catch { /* The browser can withdraw an install prompt. */ }
}

/** Called only after the operator has chosen to reload. No automatic mid-sale reloads. */
export function applyUpdate(): void {
  const worker = registration?.waiting;
  if (!worker || state.updating) return;
  publish({ updating: true });
  worker.postMessage({ type: 'ACTIVATE_UPDATE' });
  // A withdrawn worker must not leave the button permanently disabled.
  window.setTimeout(() => publish({ updating: false, updateAvailable: !!registration?.waiting }), 10000);
}

export function initializePwa(production: boolean): void {
  if (initialized) return;
  initialized = true;
  void checkServer();
  window.setInterval(() => { if (!document.hidden) void checkServer(); }, 5000);
  window.addEventListener('online', () => { void checkServer(); });
  window.addEventListener('offline', () => { void checkServer(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      void checkServer();
      void registration?.update().catch(() => {});
    }
  });

  if (!production || !window.isSecureContext || !('serviceWorker' in navigator)) return;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    // Already running as an app (the installed till's own window, or an installed PWA): the browser still fires
    // this, and installing from there would only add a second icon. Edge 155 reports "standalone" for --app= windows.
    if (['standalone', 'minimal-ui', 'fullscreen'].some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches)) return;
    installPrompt = event as InstallPrompt;
    publish({ installAvailable: true });
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = undefined;
    publish({ installAvailable: false });
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Other open screens keep running; only the operator who accepted the update reloads.
    if (state.updating) location.reload();
  });
  void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then((reg) => {
    registration = reg;
    const refresh = () => publish({ updateAvailable: !!reg.waiting, offlineReady: !!reg.active });
    refresh();
    const watch = () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', refresh);
    };
    reg.addEventListener('updatefound', watch);
    watch();
    void navigator.serviceWorker.ready.then(() => refresh());
    // An open kiosk also discovers new releases without needing a browser restart.
    window.setInterval(() => { if (!document.hidden) void reg.update().catch(() => {}); }, 60000);
  }).catch(() => { /* The app still runs when browser policy blocks offline storage. */ });
}
