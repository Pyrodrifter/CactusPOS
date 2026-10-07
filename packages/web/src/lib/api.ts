import type { Order, Session } from '@cactus/shared';

export type { Session };
const KEY = 'cactus.session';

export function getSession(): Session | null {
  try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; }
}
export function setSession(s: Session | null): void {
  try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch { /* private mode */ }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = getSession()?.token;
  const res = await fetch(`/api${path}`, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(token ? { 'x-token': token } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (res.status === 401 && path !== '/login') { setSession(null); location.assign('/login'); }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? res.statusText);
  return data as T;
}

/** Open the server-rendered receipt in a window and trigger print. */
export async function printReceipt(order: Order): Promise<void> {
  const token = getSession()?.token ?? '';
  const res = await fetch(`/api/orders/${order.id}/receipt`, { headers: { 'x-token': token } });
  const html = await res.text();
  const w = window.open('', '_blank', 'width=360,height=640');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 250);
}
