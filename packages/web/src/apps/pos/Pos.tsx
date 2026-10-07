import { useEffect, useMemo, useState } from 'react';
import {
  computeTotals, formatMoney, type MenuCategory, type MenuItem, type ModifierGroup, type Order, type TaxCategory,
} from '@cactus/shared';
import { api, ApiError, printReceipt } from '../../lib/api';
import { MENU_CHANGED, useOrders } from '../../lib/live';
import { useLang } from '../../i18n';

interface Menu { categories: MenuCategory[]; items: MenuItem[]; taxCategories: TaxCategory[] }
interface CartLine { key: string; item: MenuItem; qty: number; optionIds: string[]; note?: string }

const money = (c: number) => formatMoney(c);
const today = () => new Date().toISOString().slice(0, 10);

function lineUnit(l: CartLine): number {
  const mods = l.item.modifierGroups.flatMap((g) => g.options).filter((o) => l.optionIds.includes(o.id));
  return l.item.priceCents + mods.reduce((s, m) => s + m.priceDeltaCents, 0);
}

export function Pos() {
  const { t } = useLang();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [cat, setCat] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [note, setNote] = useState('');
  const [picking, setPicking] = useState<MenuItem | null>(null);
  const [paying, setPaying] = useState<{ order: Order } | { cartTotal: number } | null>(null);
  const [view, setView] = useState<'order' | 'orders'>('order');
  const [error, setError] = useState('');
  const { orders, online } = useOrders('today');

  useEffect(() => {
    const load = () => void api<Menu>('/menu').then((m) => {
      setMenu(m);
      setCat((c) => (m.categories.some((x) => x.id === c) ? c : m.categories[0]?.id ?? ''));
      // Drop cart lines whose item was removed or sold out while the order was being built.
      setCart((lines) => lines.flatMap((l) => {
        const item = m.items.find((i) => i.id === l.item.id);
        return item && item.available ? [{ ...l, item }] : [];
      }));
    });
    load();
    window.addEventListener(MENU_CHANGED, load);
    return () => window.removeEventListener(MENU_CHANGED, load);
  }, []);

  const totals = useMemo(() => {
    if (!menu || cart.length === 0) return null;
    return computeTotals(cart.map((l) => ({ taxCategoryId: l.item.taxCategoryId, grossCents: lineUnit(l) * l.qty })), menu.taxCategories, today());
  }, [cart, menu]);

  const add = (item: MenuItem, optionIds: string[] = []) => {
    setCart((c) => {
      const key = `${item.id}|${[...optionIds].sort().join(',')}`;
      const hit = c.find((l) => l.key === key);
      return hit ? c.map((l) => (l === hit ? { ...l, qty: l.qty + 1 } : l)) : [...c, { key, item, qty: 1, optionIds }];
    });
  };
  const tap = (item: MenuItem) => {
    if (!item.available) return;
    if (item.modifierGroups.length) setPicking(item); else add(item);
  };
  const bump = (key: string, d: number) => setCart((c) => c.map((l) => (l.key === key ? { ...l, qty: l.qty + d } : l)).filter((l) => l.qty > 0));

  const place = async (): Promise<Order | null> => {
    setError('');
    try {
      const order = await api<Order>('/orders', {
        body: { lines: cart.map((l) => ({ itemId: l.item.id, qty: l.qty, modifierOptionIds: l.optionIds, note: l.note })), note: note || undefined },
      });
      setCart([]); setNote('');
      return order;
    } catch (e) { setError(e instanceof ApiError ? e.message : String(e)); return null; }
  };

  if (!menu) return <div className="center muted">…</div>;
  const items = menu.items.filter((i) => i.categoryId === cat);

  return (
    <div className="pos">
      {!online && <div className="banner">{t('offline')}</div>}
      <div className="tabs">
        <button className={view === 'order' ? 'on' : ''} onClick={() => setView('order')}>{t('nav.order')}</button>
        <button className={view === 'orders' ? 'on' : ''} onClick={() => setView('orders')}>{t('nav.orders')} ({orders.filter((o) => o.status !== 'void' && (!o.paid || o.status !== 'collected')).length})</button>
      </div>

      {view === 'order' ? (
        <div className="pos-grid">
          <section className="menu">
            <div className="cats">
              {menu.categories.map((c) => <button key={c.id} className={c.id === cat ? 'on' : ''} onClick={() => setCat(c.id)}>{c.name}</button>)}
            </div>
            <div className="items">
              {items.map((i) => (
                <button key={i.id} className="item" disabled={!i.available} onClick={() => tap(i)}>
                  <span>{i.name}</span>
                  <b>{i.available ? money(i.priceCents) : t('soldout')}</b>
                </button>
              ))}
            </div>
          </section>

          <aside className="cart">
            {cart.length === 0 && <p className="muted center">{t('cart.empty')}</p>}
            <ul>
              {cart.map((l) => {
                const mods = l.item.modifierGroups.flatMap((g) => g.options).filter((o) => l.optionIds.includes(o.id));
                return (
                  <li key={l.key}>
                    <div className="grow">
                      <div>{l.item.name}</div>
                      {mods.length > 0 && <small className="muted">{mods.map((m) => m.name).join(', ')}</small>}
                    </div>
                    <div className="qty">
                      <button onClick={() => bump(l.key, -1)}>−</button><span>{l.qty}</span><button onClick={() => bump(l.key, 1)}>+</button>
                    </div>
                    <b className="amt">{money(lineUnit(l) * l.qty)}</b>
                  </li>
                );
              })}
            </ul>
            {cart.length > 0 && <input className="note" placeholder={t('cart.note')} value={note} onChange={(e) => setNote(e.target.value)} />}
            {error && <div className="error">{error}</div>}
            <div className="total">
              <span>{t('cart.total')} <small className="muted">{t('cart.abb')}{totals ? ` ${money(totals.taxCents)}` : ''}</small></span>
              <b>{money(totals?.totalCents ?? 0)}</b>
            </div>
            <div className="actions">
              <button className="ghost" disabled={!cart.length} onClick={() => setCart([])}>{t('cart.clear')}</button>
              <button disabled={!cart.length} onClick={() => void place()}>{t('cart.send')}</button>
              <button className="primary" disabled={!cart.length} onClick={() => totals && setPaying({ cartTotal: totals.totalCents })}>{t('cart.pay')}</button>
            </div>
          </aside>
        </div>
      ) : (
        <OrdersList orders={[...orders].reverse()} onPay={(order) => setPaying({ order })} />
      )}

      {picking && <ModifierSheet item={picking} onCancel={() => setPicking(null)} onAdd={(ids) => { add(picking, ids); setPicking(null); }} />}
      {paying && (
        <PaySheet
          total={'order' in paying ? paying.order.totalCents : paying.cartTotal}
          onCancel={() => setPaying(null)}
          onPay={async (body) => {
            const order = 'order' in paying ? paying.order : await place();
            if (!order) { setPaying(null); return; }
            const paid = await api<Order>(`/orders/${order.id}/pay`, { body });
            setPaying(null);
            void printReceipt(paid);
          }}
        />
      )}
    </div>
  );
}

function ModifierSheet({ item, onAdd, onCancel }: { item: MenuItem; onAdd: (ids: string[]) => void; onCancel: () => void }) {
  const { t } = useLang();
  const [sel, setSel] = useState<string[]>([]);
  const toggle = (g: ModifierGroup, id: string) => setSel((s) => {
    if (s.includes(id)) return s.filter((x) => x !== id);
    const others = g.multi ? s : s.filter((x) => !g.options.some((o) => o.id === x));
    return [...others, id];
  });
  const missing = item.modifierGroups.some((g) => g.required && !g.options.some((o) => sel.includes(o.id)));
  return (
    <div className="sheet-bg" onClick={onCancel}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>{item.name}</h2>
        {item.modifierGroups.map((g) => (
          <div key={g.id} className="group">
            <h3>{g.name}{g.required && <small> · {t('mods.required')}</small>}</h3>
            <div className="chips">
              {g.options.map((o) => (
                <button key={o.id} className={sel.includes(o.id) ? 'on' : ''} onClick={() => toggle(g, o.id)}>
                  {o.name}{o.priceDeltaCents ? ` +${money(o.priceDeltaCents)}` : ''}
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="actions">
          <button className="ghost" onClick={onCancel}>{t('pay.cancel')}</button>
          <button className="primary" disabled={missing} onClick={() => onAdd(sel)}>{t('mods.add')}</button>
        </div>
      </div>
    </div>
  );
}

function PaySheet({ total, onPay, onCancel }: {
  total: number; onCancel: () => void;
  onPay: (b: { method: 'cash' | 'card'; tenderedCents?: number; reference?: string; tipCents: number }) => Promise<void>;
}) {
  const { t } = useLang();
  const [method, setMethod] = useState<'cash' | 'card'>('cash');
  const [tendered, setTendered] = useState(total);
  const [ref, setRef] = useState('');
  const [tip, setTip] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const quick = [...new Set([total, ...[5, 10, 20, 50, 100].map((n) => n * 100).filter((n) => n >= total)])].slice(0, 5);
  const confirm = async () => {
    setBusy(true); setErr('');
    try { await onPay({ method, tenderedCents: method === 'cash' ? tendered : undefined, reference: ref || undefined, tipCents: tip }); }
    catch (e) { setErr(e instanceof ApiError ? e.message : String(e)); setBusy(false); }
  };
  return (
    <div className="sheet-bg" onClick={onCancel}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>{t('pay.title')} · {money(total)}</h2>
        <div className="chips">
          <button className={method === 'cash' ? 'on' : ''} onClick={() => setMethod('cash')}>{t('pay.cash')}</button>
          <button className={method === 'card' ? 'on' : ''} onClick={() => setMethod('card')}>{t('pay.card')}</button>
        </div>
        {method === 'cash' ? (
          <>
            <h3>{t('pay.tendered')}</h3>
            <div className="chips">
              {quick.map((q) => <button key={q} className={tendered === q ? 'on' : ''} onClick={() => setTendered(q)}>{q === total ? t('pay.exact') : money(q)}</button>)}
            </div>
            <div className="change">{t('pay.change')}: <b>{money(Math.max(0, tendered - total))}</b></div>
          </>
        ) : (
          <>
            <input placeholder={t('pay.ref')} value={ref} onChange={(e) => setRef(e.target.value)} />
            <h3>{t('pay.tip')}</h3>
            <div className="chips">
              {[0, 100, 200, 500].map((n) => <button key={n} className={tip === n ? 'on' : ''} onClick={() => setTip(n)}>{money(n)}</button>)}
            </div>
          </>
        )}
        {err && <div className="error">{err}</div>}
        <div className="actions">
          <button className="ghost" onClick={onCancel}>{t('pay.cancel')}</button>
          <button className="primary" disabled={busy || (method === 'cash' && tendered < total)} onClick={() => void confirm()}>{t('pay.confirm')}</button>
        </div>
      </div>
    </div>
  );
}

function OrdersList({ orders, onPay }: { orders: Order[]; onPay: (o: Order) => void }) {
  const { t } = useLang();
  const [voiding, setVoiding] = useState<Order | null>(null);
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const doVoid = async () => {
    if (!voiding) return;
    try { await api(`/orders/${voiding.id}/void`, { body: { reason, managerPin: pin || undefined } }); setVoiding(null); setReason(''); setPin(''); setErr(''); }
    catch (e) { setErr(e instanceof ApiError ? e.message : String(e)); }
  };
  if (!orders.length) return <p className="muted center">{t('orders.empty')}</p>;
  return (
    <>
      <ul className="orders">
        {orders.map((o) => (
          <li key={o.id} className={o.status === 'void' ? 'void' : ''}>
            <div className="num">#{o.ticketNumber}</div>
            <div className="grow">
              <div>{o.lines.map((l) => `${l.qty}× ${l.name}`).join(', ')}</div>
              <small className="muted">{t(`st.${o.status}` as 'st.sent')} · {o.paid ? t('orders.paid') : o.status === 'void' ? t('orders.void') : t('orders.unpaid')}</small>
            </div>
            <b>{money(o.totalCents)}</b>
            <div className="row-actions">
              {!o.paid && o.status !== 'void' && <button className="primary" onClick={() => onPay(o)}>{t('orders.pay')}</button>}
              {o.paid && <button onClick={() => void printReceipt(o)}>{t('orders.reprint')}</button>}
              {o.status !== 'void' && <button className="ghost" onClick={() => setVoiding(o)}>{t('orders.voidBtn')}</button>}
            </div>
          </li>
        ))}
      </ul>
      {voiding && (
        <div className="sheet-bg" onClick={() => setVoiding(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h2>{t('orders.voidBtn')} #{voiding.ticketNumber}</h2>
            <input placeholder={t('orders.reason')} value={reason} onChange={(e) => setReason(e.target.value)} />
            <input placeholder={t('orders.pin')} inputMode="numeric" type="password" value={pin} onChange={(e) => setPin(e.target.value)} />
            {err && <div className="error">{err}</div>}
            <div className="actions">
              <button className="ghost" onClick={() => setVoiding(null)}>{t('pay.cancel')}</button>
              <button className="primary" disabled={reason.length < 2} onClick={() => void doVoid()}>{t('orders.voidBtn')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
