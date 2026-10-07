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

/**
 * Reprint a receipt: on the receipt printer when one is set up, otherwise through the browser.
 * (The first copy prints by itself when the order is paid.)
 */
export async function printReceipt(order: Order): Promise<void> {
  try {
    const st = await api<{ active: boolean }>('/print/status');
    if (st.active) { await api(`/orders/${order.id}/print`, { body: { kind: 'receipt' } }); return; }
  } catch { /* fall through to the browser */ }
  await browserPrintReceipt(order, true);
}

/** True when the server prints receipts itself, so the screen should not also open a print dialog. */
export async function serverPrints(): Promise<boolean> {
  try { return (await api<{ active: boolean }>('/print/status')).active; } catch { return false; }
}

/** Open the server-rendered receipt in a window and trigger the browser's print dialog. */
export async function browserPrintReceipt(order: Order, copy = false): Promise<void> {
  const token = getSession()?.token ?? '';
  const res = await fetch(`/api/orders/${order.id}/receipt${copy ? '?copy=1' : ''}`, { headers: { 'x-token': token } });
  const html = await res.text();
  const w = window.open('', '_blank', 'width=360,height=640');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 250);
}
