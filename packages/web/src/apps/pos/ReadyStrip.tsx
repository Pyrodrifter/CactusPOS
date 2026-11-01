import { useEffect, useRef, useState } from 'react';
import type { Order } from '@cactus/shared';
import { api, ApiError } from '../../lib/api';
import { useLang } from '../../i18n';
import { Icon } from '../../ui/Icon';
import { haptic, toast } from '../../ui/touch';

const copy = {
  en: { title: 'Ready for pickup', picked: 'Picked up', pay: 'Pay', unpaid: 'Not paid', done: (n: string) => `${n} picked up`, undo: 'Undo' },
  nl: { title: 'Klaar om af te halen', picked: 'Opgehaald', pay: 'Betalen', unpaid: 'Niet betaald', done: (n: string) => `${n} opgehaald`, undo: 'Herstellen' },
};

/** How long Undo stays up after a pickup is confirmed; the same as the kitchen's. */
const UNDO_MS = 8000;

/**
 * The orders waiting at the window, right above the cart where the cashier already looks, so a pickup is confirmed
 * without leaving the Order screen. Takes no room while nothing is ready. An unpaid order can be handed over and stays on the Tabs list.
 */
export function ReadyStrip({ orders, online, onPay }: { orders: Order[]; online: boolean; onPay: (order: Order) => void }) {
  const { lang } = useLang();
  const c = copy[lang];
  const ready = orders.filter((o) => o.status === 'ready' && o.serviceMode !== 'counter');
  const [undo, setUndo] = useState<{ id: string; label: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const moving = useRef(false);
  useEffect(() => {
    if (!undo) return;
    const timeout = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(timeout);
  }, [undo]);
  const move = async (id: string, status: 'collected' | 'ready') => {
    if (moving.current) return false;
    moving.current = true; setBusy(id);
    try { await api(`/orders/${id}/status`, { body: { status } }); return true; }
    catch (e) { toast(e instanceof ApiError ? e.message : String(e), 'error'); return false; }
    finally { moving.current = false; setBusy(null); }
  };
  if (!ready.length && !undo) return null;
  return (
    <section className="pos-ready" aria-label={c.title}>
      {ready.length > 0 && <h2><Icon name="pickup" /><span>{c.title}</span><span className="pos-count">{ready.length}</span></h2>}
      <ul>
        {ready.map((o) => {
          const label = o.tabName ?? `#${o.ticketNumber}`;
          return (
            <li key={o.id}>
              <div className="pos-ready-text">
                <b>{label}</b>
                <small>{o.tabName ? `#${o.ticketNumber} · ` : ''}{o.lines.map((l) => `${l.qty}× ${l.name}`).join(', ')}</small>
                {!o.paid && <small className="pos-ready-unpaid">{c.unpaid}</small>}
              </div>
              {!o.paid && <button className="pos-ready-pay" aria-label={`${c.pay}: ${label}`} onClick={() => onPay(o)}><Icon name="cash" /><span>{c.pay}</span></button>}
              <button className="primary pos-ready-done" disabled={!online || busy === o.id} onClick={() => { haptic(15); void move(o.id, 'collected').then((ok) => { if (ok) setUndo({ id: o.id, label }); }); }}><Icon name="check" />{c.picked}</button>
            </li>
          );
        })}
      </ul>
      {undo && <div className="pos-ready-undo" role="status"><span>{c.done(undo.label)}</span><button disabled={!online} onClick={() => { void move(undo.id, 'ready').then((ok) => { if (ok) setUndo(null); }); }}><Icon name="undo" />{c.undo}</button></div>}
    </section>
  );
}
