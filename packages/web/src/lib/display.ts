/** Dispatch this on `window` to pause touch for the 20-second wipe, as Screen tools > Clean the screen does.
    The staff shell listens; the kitchen keeps a Wipe button in view for greasy hands. */
export const CLEAN_SCREEN_EVENT = 'cactus:clean-screen';

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
