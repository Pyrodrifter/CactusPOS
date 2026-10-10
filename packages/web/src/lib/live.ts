import { useEffect, useRef, useState } from 'react';
import { ServerEventSchema, type Order, type ServerEvent } from '@cactus/shared';
import { api, getSession } from './api';
import { openLive } from './liveSocket';

/** Parses a socket message; anything that is not a known, well-formed event is ignored. */
function readEvent(data: unknown): ServerEvent | null {
  try {
    const r = ServerEventSchema.safeParse(JSON.parse(String(data)));
    if (!r.success) console.warn('Ignored malformed server event', r.error.issues[0]);
    return r.success ? r.data : null;
  } catch { return null; }
}

const socketUrl = (query: string) => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?${query}`;

/** Fired on window when the owner edits the menu or an item is marked sold out. */
export const MENU_CHANGED = 'cactus:menu-changed';
export const SERVICE_MODE_CHANGED = 'cactus:service-mode-changed';

/**
 * Live list of orders: initial fetch + WebSocket updates + auto-reconnect (see `openLive` for how a dead
 * connection is noticed). `active` is the kitchen's work and `today` is everything that happened today;
 * `open` is every unpaid order from any day (tabs).
 * Updates for orders outside the scope still arrive, so callers filter what they show.
 */
export function useOrders(scope: 'active' | 'today' | 'open' = 'active') {
  const [orders, setOrders] = useState<Map<string, Order>>(new Map());
  const [online, setOnline] = useState(false);
  const [newIds, setNewIds] = useState<string[]>([]);
  const known = useRef<Set<string>>(new Set());

  useEffect(() => {
    const load = async () => {
      try {
        const list = await api<Order[]>(`/orders?scope=${scope}`);
        setOrders(new Map(list.map((o) => [o.id, o])));
        list.forEach((o) => known.current.add(o.id));
      } catch { /* retried on reconnect */ }
    };
    void load();
    return openLive({
      url: () => { const token = getSession()?.token; return token ? socketUrl(`token=${token}`) : null; },
      onState: setOnline,
      onOpen: () => {
        void load();
        // A failed initial menu fetch also recovers when the local server returns.
        window.dispatchEvent(new Event(MENU_CHANGED));
      },
      onMessage: (data) => {
        const ev = readEvent(data);
        if (!ev) return;
        if (ev.type === 'menu.changed') window.dispatchEvent(new Event(MENU_CHANGED));
        if (ev.type === 'service-mode.changed') window.dispatchEvent(new Event(SERVICE_MODE_CHANGED));
        if (ev.type === 'order.changed') {
          const o = ev.order;
          if (scope === 'active' && o.serviceMode === 'counter') {
            setOrders((previous) => { const next = new Map(previous); next.delete(o.id); return next; });
            return;
          }
          setOrders((prev) => new Map(prev).set(o.id, o));
          if (!known.current.has(o.id)) { known.current.add(o.id); setNewIds((p) => [...p, o.id]); }
        }
      },
    });
  }, [scope]);

  return { orders: [...orders.values()].sort((a, b) => a.ticketNumber - b.ticketNumber), online, newIds, clearNew: () => setNewIds([]) };
}

export function usePickup() {
  const [board, setBoard] = useState<{ preparing: number[]; ready: number[] }>({ preparing: [], ready: [] });
  const [online, setOnline] = useState(false);
  useEffect(() => openLive({
    url: () => socketUrl('room=pickup'),
    onState: setOnline,
    onOpen: () => { /* the server sends the board as soon as a pickup screen connects */ },
    onMessage: (data) => {
      const ev = readEvent(data);
      if (ev?.type === 'pickup.changed') setBoard({ preparing: ev.preparing, ready: ev.ready });
    },
  }), []);
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
