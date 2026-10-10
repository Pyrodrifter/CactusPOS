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

/** How long a screen waits for the till. Long enough for a slow tablet, short enough that nobody stands at "Sending…". */
export const REQUEST_TIMEOUT_MS = 12_000;

/**
 * One request to the till, reply text included, with a time limit. No answer at all (stalled WiFi, server off)
 * becomes an `ApiError` with status 0 and words fit for the screen. The caller still holds its cart and its
 * request id, so sending again cannot make a second order or payment.
 */
export async function send(url: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<{ res: Response; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return { res, text: await res.text() };
  } catch {
    throw new ApiError(0, controller.signal.aborted
      ? 'The till did not answer in time. Check the connection and try again.'
      : 'Cannot reach the till. Check the connection and try again.');
  } finally { clearTimeout(timer); }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; requestId?: string } = {}): Promise<T> {
  const token = getSession()?.token;
  const { res, text } = await send(`/api${path}`, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    // Only name a content type when there is a body: the server refuses "application/json" with nothing in it,
    // which made every DELETE (menu item, category) fail.
    headers: { ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { 'x-token': token } : {}), ...(init.requestId ? { 'idempotency-key': init.requestId } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  let data: { error?: string } | null = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON (a proxy's error page): fall back to the status text */ }
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
  const { res, text } = await send(`/api/orders/${order.id}/receipt${copy ? '?copy=1' : ''}`, { headers: { 'x-token': token } });
  if (!res.ok) throw new ApiError(res.status, res.statusText);
  await printHtml(text);
}

/** A key for one intended action; reuse it when retrying that same action (see `RequestId` in shared). */
export function newRequestId(): string {
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 8)}`;
}
