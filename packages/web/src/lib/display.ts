import { useSyncExternalStore } from 'react';

/** Dispatch this on `window` to pause touch for the 20-second wipe, as Screen tools > Clean the screen does.
    The staff shell listens; the kitchen keeps a Wipe button in view for greasy hands. */
export const CLEAN_SCREEN_EVENT = 'cactus:clean-screen';
/** Dispatch this on `window` to open Screen tools; a kitchen locked to its screen has no top bar to open it from. */
export const SCREEN_TOOLS_EVENT = 'cactus:screen-tools';

/**
 * Settings that belong to this device, not to the business: this tablet is the kitchen screen, this one uses
 * the one-tap kitchen. Kept in the browser's storage, so they survive a restart and a new sign-in.
 */
export interface DevicePrefs {
  /** The device stays on the kitchen screen: it opens there, and the other screens and the top bar are hidden. */
  kitchenLock: boolean;
  /** `quick`: one grid of tickets, one tap marks ready. `steps`: three columns, New -> Preparing -> Ready. */
  kitchenFlow: 'quick' | 'steps';
}
const PREF_EVENT = 'cactus:device-pref';
const prefKey = (name: keyof DevicePrefs) => `cactus.display.${name}`;

export function readDevicePrefs(): DevicePrefs {
  let lock: string | null = null;
  let flow: string | null = null;
  try { lock = localStorage.getItem(prefKey('kitchenLock')); flow = localStorage.getItem(prefKey('kitchenFlow')); } catch { /* storage is optional */ }
  return { kitchenLock: lock === 'true', kitchenFlow: flow === 'steps' ? 'steps' : 'quick' };
}

export function setDevicePref<K extends keyof DevicePrefs>(name: K, value: DevicePrefs[K]): void {
  try { localStorage.setItem(prefKey(name), String(value)); } catch { /* still applies until the page reloads */ }
  memory = { ...readDevicePrefs(), [name]: value };
  window.dispatchEvent(new Event(PREF_EVENT));
}

let memory: DevicePrefs | null = null;
function snapshot(): DevicePrefs {
  const next = memory ?? readDevicePrefs();
  // The same object while nothing changed, as useSyncExternalStore requires.
  if (!memory || memory.kitchenLock !== next.kitchenLock || memory.kitchenFlow !== next.kitchenFlow) memory = next;
  return memory;
}
function subscribe(changed: () => void): () => void {
  const fromOtherTab = (e: StorageEvent) => { if (e.key?.startsWith('cactus.display.')) { memory = readDevicePrefs(); changed(); } };
  window.addEventListener(PREF_EVENT, changed);
  window.addEventListener('storage', fromOtherTab);
  return () => { window.removeEventListener(PREF_EVENT, changed); window.removeEventListener('storage', fromOtherTab); };
}

/** This device's settings, updated everywhere at once when one changes. */
export function useDevicePrefs(): DevicePrefs {
  return useSyncExternalStore(subscribe, snapshot);
}

/** Keep a screen lock only while this screen is visible; never retry a rejected permission in a loop. */
export function keepScreenAwake(onState: (active: boolean) => void): () => void {
  let disposed = false;
  let pending = false;
  let lock: WakeLockSentinel | undefined;
  const acquire = async () => {
    if (disposed || pending || lock || document.hidden || !navigator.wakeLock) return;
    pending = true;
    try {
      const next = await navigator.wakeLock.request('screen');
      if (disposed || document.hidden) { await next.release(); return; }
      lock = next;
      onState(true);
      next.addEventListener('release', () => {
        if (lock === next) { lock = undefined; if (!disposed) onState(false); }
      }, { once: true });
    } catch { if (!disposed) onState(false); }
    finally { pending = false; }
  };
  const visibility = () => {
    if (document.hidden) {
      const previous = lock;
      lock = undefined;
      onState(false);
      void previous?.release().catch(() => {});
    } else void acquire();
  };
  document.addEventListener('visibilitychange', visibility);
  void acquire();
  return () => {
    disposed = true;
    document.removeEventListener('visibilitychange', visibility);
    void lock?.release().catch(() => {});
  };
}
