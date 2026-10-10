/**
 * The live connection to the till, with the part a browser does not do by itself: noticing that it died.
 *
 * A WebSocket that loses its other end without a goodbye (the laptop restarted while a tablet slept, a gap in
 * the WiFi) stays "open" for as long as nobody sends anything, and the screens only listen. The kitchen would
 * go on showing "Live updates" and no new tickets. So the server says `hello` every 15 seconds, and a
 * connection that has been silent for `quietMs` is dropped here and opened again; `onOpen` then reloads what
 * the screen shows.
 */
export const QUIET_MS = 40_000;

interface SocketLike {
  readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  close(): void;
}

export interface LiveOptions {
  /** Where to connect. Null = not now (nobody is signed in); asked again on every attempt. */
  url: () => string | null;
  onMessage(data: unknown): void;
  /** Connected, the first time and after every reconnect: reload anything that may have been missed. */
  onOpen(): void;
  onState(online: boolean): void;
  quietMs?: number;
  /** For tests. */
  createSocket?: (url: string) => SocketLike;
}

/** Opens the connection and keeps it alive until the returned function is called. */
export function openLive(options: LiveOptions): () => void {
  const quietMs = options.quietMs ?? QUIET_MS;
  const create = options.createSocket ?? ((url: string) => new WebSocket(url) as unknown as SocketLike);
  let socket: SocketLike | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let attempt = 0;
  /** When this connection last gave a sign of life (or was started). */
  let heard = 0;

  // Stop listening first: a dead connection may fire `close` much later, or never.
  const drop = () => {
    const old = socket;
    socket = null;
    if (!old) return;
    old.onopen = old.onmessage = old.onclose = null;
    try { old.close(); } catch { /* already gone */ }
  };
  const connect = () => {
    if (closed) return;
    const url = options.url();
    if (!url) return;
    const current = create(url);
    socket = current;
    heard = Date.now();
    current.onopen = () => { attempt = 0; heard = Date.now(); options.onState(true); options.onOpen(); };
    current.onmessage = (event) => { heard = Date.now(); options.onMessage(event.data); };
    current.onclose = () => {
      if (socket !== current) return;
      socket = null;
      options.onState(false);
      if (!closed) retry = setTimeout(connect, Math.min(1000 * 2 ** attempt++, 8000));
    };
  };
  const watch = setInterval(() => {
    if (!socket || Date.now() - heard <= quietMs) return;
    drop();
    options.onState(false);
    clearTimeout(retry);
    connect();
  }, 5000);

  connect();
  return () => { closed = true; clearTimeout(retry); clearInterval(watch); drop(); };
}
