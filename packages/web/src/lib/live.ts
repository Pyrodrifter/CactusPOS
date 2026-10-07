import { useEffect, useRef, useState } from 'react';
import { ServerEventSchema, type Order, type ServerEvent } from '@cactus/shared';
import { api, getSession } from './api';

/** Parses a socket message; anything that is not a known, well-formed event is ignored. */
function readEvent(data: unknown): ServerEvent | null {
  try {
    const r = ServerEventSchema.safeParse(JSON.parse(String(data)));
    if (!r.success) console.warn('Ignored malformed server event', r.error.issues[0]);
    return r.success ? r.data : null;
  } catch { return null; }
}

/** Fired on window when the owner edits the menu or an item is marked sold out. */
export const MENU_CHANGED = 'cactus:menu-changed';

/** Live list of today's active orders: initial fetch + WebSocket updates + auto-reconnect. */
export function useOrders(scope: 'active' | 'today' = 'active') {
  const [orders, setOrders] = useState<Map<string, Order>>(new Map());
  const [online, setOnline] = useState(false);
  const [newIds, setNewIds] = useState<string[]>([]);
  const known = useRef<Set<string>>(new Set());

  useEffect(() => {
    let ws: WebSocket | null = null;
    let timer: number | undefined;
    let closed = false;
    let attempt = 0;

    const load = async () => {
      try {
        const list = await api<Order[]>(`/orders?scope=${scope}`);
        setOrders(new Map(list.map((o) => [o.id, o])));
        list.forEach((o) => known.current.add(o.id));
      } catch { /* retried on reconnect */ }
    };
    const connect = () => {
      const token = getSession()?.token;
      if (!token || closed) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws?token=${token}`);
      ws.onopen = () => {
        attempt = 0; setOnline(true); void load();
        // A failed initial menu fetch also recovers when the local server returns.
        window.dispatchEvent(new Event(MENU_CHANGED));
      };
      ws.onmessage = (m) => {
        const ev = readEvent(m.data);
        if (!ev) return;
        if (ev.type === 'menu.changed') window.dispatchEvent(new Event(MENU_CHANGED));
        if (ev.type === 'order.changed') {
          const o = ev.order;
          setOrders((prev) => new Map(prev).set(o.id, o));
          if (!known.current.has(o.id)) { known.current.add(o.id); setNewIds((p) => [...p, o.id]); }
        }
      };
      ws.onclose = () => {
        setOnline(false);
        if (!closed) timer = window.setTimeout(connect, Math.min(1000 * 2 ** attempt++, 8000));
      };
    };
    void load();
    connect();
    return () => { closed = true; clearTimeout(timer); ws?.close(); };
  }, [scope]);

  return { orders: [...orders.values()].sort((a, b) => a.ticketNumber - b.ticketNumber), online, newIds, clearNew: () => setNewIds([]) };
}

export function usePickup() {
  const [board, setBoard] = useState<{ preparing: number[]; ready: number[] }>({ preparing: [], ready: [] });
  const [online, setOnline] = useState(false);
  useEffect(() => {
    let ws: WebSocket | null = null;
    let timer: number | undefined;
    let closed = false;
    let attempt = 0;
    const connect = () => {
      if (closed) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws?room=pickup`);
      ws.onopen = () => { attempt = 0; setOnline(true); };
      ws.onmessage = (m) => {
        const ev = readEvent(m.data);
        if (ev?.type === 'pickup.changed') setBoard({ preparing: ev.preparing, ready: ev.ready });
      };
      ws.onclose = () => { setOnline(false); if (!closed) timer = window.setTimeout(connect, Math.min(1000 * 2 ** attempt++, 8000)); };
    };
    connect();
    return () => { closed = true; clearTimeout(timer); ws?.close(); };
  }, []);
  return { board, online };
}

export function useNow(ms = 15000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

let ctx: AudioContext | null = null;
export function beep(): void {
  try {
    ctx ??= new AudioContext();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880; g.gain.value = 0.15;
    o.start(); o.stop(ctx.currentTime + 0.25);
  } catch { /* audio blocked until first tap */ }
}
