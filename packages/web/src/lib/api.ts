import type { Order, Session } from '@cactus/shared';
import { printHtml } from './print';

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

export async function api<T>(path: string, init: { method?: string; body?: unknown; requestId?: string } = {}): Promise<T> {
  const token = getSession()?.token;
  const res = await fetch(`/api${path}`, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    // Only name a content type when there is a body: the server refuses "application/json" with nothing in it,
    // which made every DELETE (menu item, category) fail.
    headers: { ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { 'x-token': token } : {}), ...(init.requestId ? { 'idempotency-key': init.requestId } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (res.status === 401 && path !== '/login') { setSession(null); location.assign('/login'); }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? res.statusText);
  return data as T;
}

/**
 * Print a receipt: on the receipt printer when one is set up, otherwise through the browser's print dialog.
 * With a receipt printer the first copy prints by itself on payment, so this is always a copy there.
 * Without one nothing prints by itself: pass `original` for the first print, so it is not marked as a copy.
 */
export async function printReceipt(order: Order, opts: { original?: boolean } = {}): Promise<void> {
  try {
    const st = await api<{ active: boolean }>('/print/status');
    if (st.active) { await api(`/orders/${order.id}/print`, { body: { kind: 'receipt' } }); return; }
  } catch { /* fall through to the browser */ }
  await browserPrintReceipt(order, !opts.original);
}

/** True when the server prints receipts itself, so the screen should not also open a print dialog. */
export async function serverPrints(): Promise<boolean> {
  try { return (await api<{ active: boolean }>('/print/status')).active; } catch { return false; }
}

/** Print the server-rendered receipt with the browser's print dialog, inside this page (see `printHtml`). */
export async function browserPrintReceipt(order: Order, copy = false): Promise<void> {
  const token = getSession()?.token ?? '';
  const res = await fetch(`/api/orders/${order.id}/receipt${copy ? '?copy=1' : ''}`, { headers: { 'x-token': token } });
  if (!res.ok) throw new ApiError(res.status, res.statusText);
  await printHtml(await res.text());
}

/** A key for one intended action; reuse it when retrying that same action (see `RequestId` in shared). */
export function newRequestId(): string {
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 8)}`;
}
