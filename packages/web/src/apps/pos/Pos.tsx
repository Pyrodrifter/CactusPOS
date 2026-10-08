import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  computeTotals, formatMoney, type MenuItem, type MenuResponse, type ModifierGroup, type Order,
} from '@cactus/shared';
import { api, ApiError, browserPrintReceipt, printReceipt, serverPrints } from '../../lib/api';
import { MENU_CHANGED, useOrders } from '../../lib/live';
import { useLang } from '../../i18n';
import { haptic, Icon, MoneyPad, Sheet, Stepper, toast } from '../../ui/touch';

type Menu = MenuResponse;
interface CartLine { key: string; item: MenuItem; qty: number; optionIds: string[]; note?: string; priceCents?: number }

const money = (c: number) => formatMoney(c);
const today = () => new Date().toISOString().slice(0, 10);
const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : String(e));

/** One colour per category, so the grid can be read at a glance. */
const CAT_COLORS = ['#19a7c0', '#f08a24', '#e0438c', '#58b548', '#3d7dfd', '#a56bf0', '#e6b422'];
const catStyle = (index: number) => ({ '--c': CAT_COLORS[index % CAT_COLORS.length] }) as CSSProperties;

function optionsOf(item: MenuItem, ids: string[]) {
  return item.modifierGroups.flatMap((g) => g.options).filter((o) => ids.includes(o.id));
}
function lineUnit(l: CartLine): number {
  return (l.item.openPrice ? l.priceCents ?? 0 : l.item.priceCents) + optionsOf(l.item, l.optionIds).reduce((s, m) => s + m.priceDeltaCents, 0);
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
  const [cartOpen, setCartOpen] = useState(false);
  const [busy, setBusy] = useState(false);
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
    try {
      return computeTotals(cart.map((l) => ({ taxCategoryId: l.item.taxCategoryId, grossCents: lineUnit(l) * l.qty })), menu.taxCategories, today());
    } catch { return null; } // the server is the authority and reports tax setup problems on send
  }, [cart, menu]);
  const count = cart.reduce((s, l) => s + l.qty, 0);
  const total = totals?.totalCents ?? cart.reduce((s, l) => s + lineUnit(l) * l.qty, 0);
  const inCart = (itemId: string) => cart.filter((l) => l.item.id === itemId).reduce((s, l) => s + l.qty, 0);

  const add = (item: MenuItem, optionIds: string[] = [], priceCents?: number, qty = 1) => {
    haptic();
    setCart((c) => {
      const key = `${item.id}|${[...optionIds].sort().join(',')}|${priceCents ?? ''}`;
      const hit = c.find((l) => l.key === key);
      return hit ? c.map((l) => (l === hit ? { ...l, qty: Math.min(99, l.qty + qty) } : l)) : [...c, { key, item, qty, optionIds, priceCents }];
    });
  };
  const tap = (item: MenuItem) => {
    if (!item.available) return;
    if (item.modifierGroups.length || item.openPrice) setPicking(item); else add(item);
  };
  const setQty = (key: string, qty: number) => setCart((c) => c.map((l) => (l.key === key ? { ...l, qty } : l)).filter((l) => l.qty > 0));

  const place = async (): Promise<Order | null> => {
    setError('');
    try {
      const order = await api<Order>('/orders', {
        body: { lines: cart.map((l) => ({ itemId: l.item.id, qty: l.qty, modifierOptionIds: l.optionIds, note: l.note, priceCents: l.priceCents })), note: note || undefined },
      });
      setCart([]); setNote(''); setCartOpen(false);
      return order;
    } catch (e) { setError(errMsg(e)); toast(errMsg(e), 'error'); return null; }
  };
  const send = async () => {
    setBusy(true);
    const order = await place();
    setBusy(false);
    if (order) toast(`${t('toast.sent')} #${order.ticketNumber}`);
  };

  if (!menu) return <div className="center muted">…</div>;
  const catIndex = (id: string) => Math.max(0, menu.categories.findIndex((c) => c.id === id));
  const items = menu.items.filter((i) => i.categoryId === cat);
  const openCount = orders.filter((o) => o.status !== 'void' && (!o.paid || o.status !== 'collected')).length;

  return (
    <div className="pos">
      {!online && <div className="banner">{t('offline')}</div>}
      <div className="seg">
        <button className={view === 'order' ? 'on' : ''} onClick={() => setView('order')}>{t('nav.order')}</button>
        <button className={view === 'orders' ? 'on' : ''} onClick={() => setView('orders')}>
          {t('nav.orders')}{openCount > 0 && <span className="badge">{openCount}</span>}
        </button>
      </div>

      {view === 'order' ? (
        <div className="pos-grid">
          <section className="menu">
            <div className="cats" role="tablist">
              {menu.categories.map((c, i) => (
                <button key={c.id} role="tab" aria-selected={c.id === cat} style={catStyle(i)} className={c.id === cat ? 'on' : ''} onClick={() => setCat(c.id)}>
                  <i className="dot" />{c.name}
                </button>
              ))}
            </div>
            <div className="items">
              {items.map((i) => {
                const n = inCart(i.id);
                return (
                  <button key={i.id} className={`item${n ? ' has' : ''}`} style={catStyle(catIndex(i.categoryId))} disabled={!i.available} onClick={() => tap(i)}>
                    {n > 0 && <span className="item-qty" key={n}>{n}</span>}
                    <span className="item-name">{i.name}</span>
                    <b className="item-price">{!i.available ? t('soldout') : i.openPrice ? t('pos.market') : money(i.priceCents)}</b>
                  </button>
                );
              })}
            </div>
          </section>

          <aside className={`cart${cartOpen ? ' open' : ''}`}>
            <header className="cart-head">
              <h2>{t('cart.title')}{count > 0 && <span className="badge">{count}</span>}</h2>
              <button className="icon-btn cart-close" aria-label="Close" onClick={() => setCartOpen(false)}><Icon.close /></button>
            </header>
            {cart.length === 0 && <div className="cart-empty"><Icon.cart /><p>{t('cart.empty')}</p></div>}
            <ul>
              {cart.map((l) => {
                const mods = optionsOf(l.item, l.optionIds);
                return (
                  <li key={l.key}>
                    <div className="grow">
                      <div className="line-name">{l.item.name}</div>
                      {mods.length > 0 && <small className="muted">{mods.map((m) => m.name).join(', ')}</small>}
                      <div className="line-price">{money(lineUnit(l) * l.qty)}</div>
                    </div>
                    <Stepper value={l.qty} onChange={(q) => setQty(l.key, q)} />
                  </li>
                );
              })}
            </ul>
            <footer className="cart-foot">
              {cart.length > 0 && <input className="note" placeholder={t('cart.note')} value={note} onChange={(e) => setNote(e.target.value)} />}
              {error && <div className="error">{error}</div>}
              <div className="total">
                <span>{t('cart.total')}<small className="muted"> {t('cart.abb')}{totals ? ` ${money(totals.taxCents)}` : ''}</small></span>
                <b className="money">{money(total)}</b>
              </div>
              <button className="primary xl" disabled={!cart.length || busy} onClick={() => setPaying({ cartTotal: total })}>
                {t('cart.payNow')} <span className="money">{money(total)}</span>
              </button>
              <div className="actions">
                <button className="ghost" disabled={!cart.length || busy} onClick={() => { setCart([]); setNote(''); }}>{t('cart.clear')}</button>
                <button disabled={!cart.length || busy} onClick={() => void send()}>{t('cart.sendOnly')}</button>
              </div>
            </footer>
          </aside>

          <button className="cart-bar" disabled={!cart.length} onClick={() => setCartOpen(true)}>
            <span className="cart-bar-count"><Icon.cart />{count > 0 && <span className="badge" key={count}>{count}</span>}</span>
            <span className="grow">{cart.length ? t('cart.view') : t('cart.empty')}</span>
            <b className="money">{money(total)}</b>
            <Icon.chevron />
          </button>
        </div>
      ) : (
        <OrdersList orders={[...orders].reverse()} onPay={(order) => setPaying({ order })} />
      )}

      {picking && <ModifierSheet item={picking} onCancel={() => setPicking(null)} onAdd={(ids, price, qty) => { add(picking, ids, price, qty); setPicking(null); }} />}
      {paying && (
        <PaySheet
          total={'order' in paying ? paying.order.totalCents : paying.cartTotal}
          onClose={() => setPaying(null)}
          onPay={async (body) => {
            const order = 'order' in paying ? paying.order : await place();
            if (!order) throw new Error(t('pay.failed'));
            const paid = await api<Order>(`/orders/${order.id}/pay`, { body });
            // With a receipt printer the server already printed it on payment.
            if (!(await serverPrints())) void browserPrintReceipt(paid);
            return paid;
          }}
        />
      )}
    </div>
  );
}

function ModifierSheet({ item, onAdd, onCancel }: { item: MenuItem; onAdd: (ids: string[], priceCents: number | undefined, qty: number) => void; onCancel: () => void }) {
  const { t } = useLang();
  const [sel, setSel] = useState<string[]>([]);
  const [price, setPrice] = useState(0);
  const [qty, setQty] = useState(1);
  const toggle = (g: ModifierGroup, id: string) => {
    haptic(6);
    setSel((s) => {
      if (s.includes(id)) return s.filter((x) => x !== id);
      const others = g.multi ? s : s.filter((x) => !g.options.some((o) => o.id === x));
      return [...others, id];
    });
  };
  const missing = item.modifierGroups.some((g) => g.required && !g.options.some((o) => sel.includes(o.id)));
  const priceMissing = item.openPrice && price <= 0;
  const unit = (item.openPrice ? price : item.priceCents) + optionsOf(item, sel).reduce((s, o) => s + o.priceDeltaCents, 0);
  return (
    <Sheet title={item.name} onClose={onCancel}>
      {item.description && <p className="muted sheet-sub">{item.description}</p>}
      <div className="sheet-body">
        {item.openPrice && (
          <div className="group">
            <h3>{t('pos.enterPrice')}</h3>
            <div className={`amount${price ? '' : ' empty'}`}>{money(price)}</div>
            <MoneyPad cents={price} onChange={setPrice} max={1_000_000} />
          </div>
        )}
        {item.modifierGroups.map((g) => (
          <div key={g.id} className="group">
            <h3>{g.name}{g.required && <span className="tag warn">{t('mods.required')}</span>}</h3>
            <div className="chips">
              {g.options.map((o) => {
                const on = sel.includes(o.id);
                return (
                  <button key={o.id} className={on ? 'on' : ''} aria-pressed={on} onClick={() => toggle(g, o.id)}>
                    {on && <Icon.check />}{o.name}{o.priceDeltaCents ? <small> +{money(o.priceDeltaCents)}</small> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="sheet-foot">
        <Stepper value={qty} onChange={setQty} min={1} />
        <button className="primary xl grow" disabled={missing || priceMissing} onClick={() => onAdd(sel, item.openPrice ? price : undefined, qty)}>
          {t('mods.add')} <span className="money">{money(unit * qty)}</span>
        </button>
      </div>
    </Sheet>
  );
}

function PaySheet({ total, onPay, onClose }: {
  total: number; onClose: () => void;
  onPay: (b: { method: 'cash' | 'card'; tenderedCents?: number; reference?: string; tipCents: number }) => Promise<Order>;
}) {
  const { t } = useLang();
  const [method, setMethod] = useState<'cash' | 'card'>('cash');
  const [tendered, setTendered] = useState(0);
  const [ref, setRef] = useState('');
  const [tip, setTip] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<Order | null>(null);

  // Whole-dollar notes a customer is likely to hand over for this total.
  const quick = [...new Set([5, 10, 20, 50, 100].map((n) => n * 100).filter((n) => n >= total))].slice(0, 3);
  const given = tendered || total; // nothing typed = exact amount
  const change = Math.max(0, given - total);
  const short = method === 'cash' && tendered > 0 && tendered < total;

  const confirm = async () => {
    setBusy(true); setErr('');
    try {
      const paid = await onPay({ method, tenderedCents: method === 'cash' ? given : undefined, reference: ref || undefined, tipCents: method === 'card' ? tip : 0 });
      haptic(30);
      setDone(paid);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };

  if (done) {
    const p = done.payments[0];
    return (
      <Sheet onClose={onClose} dismissable={false}>
        <div className="paid">
          <div className="paid-check"><Icon.check /></div>
          <h2>{t('pay.paid')} · #{done.ticketNumber}</h2>
          {p?.method === 'cash' ? (
            <>
              <p className="muted">{t('pay.change')}</p>
              <div className="amount big">{money(p.changeCents ?? 0)}</div>
            </>
          ) : <div className="amount">{money(done.totalCents + (p?.tipCents ?? 0))}</div>}
        </div>
        <div className="sheet-foot">
          <button onClick={() => void printReceipt(done)}><Icon.receipt />{t('orders.reprint')}</button>
          <button className="primary xl grow" autoFocus onClick={onClose}>{t('pay.next')}</button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title={<>{t('pay.title')} <span className="money">{money(total)}</span></>} onClose={onClose}>
      <div className="sheet-body">
        <div className="seg big">
          <button className={method === 'cash' ? 'on' : ''} onClick={() => setMethod('cash')}><Icon.cash />{t('pay.cash')}</button>
          <button className={method === 'card' ? 'on' : ''} onClick={() => setMethod('card')}><Icon.card />{t('pay.card')}</button>
        </div>
        {method === 'cash' ? (
          <>
            <div className="pay-row">
              <div>
                <small className="muted">{t('pay.tendered')}</small>
                <div className={`amount${tendered ? '' : ' empty'}`}>{money(given)}</div>
              </div>
              <div className="right">
                <small className="muted">{t('pay.change')}</small>
                <div className={`amount ${short ? 'bad' : 'good'}`}>{short ? `−${money(total - tendered)}` : money(change)}</div>
              </div>
            </div>
            <div className="chips even">
              <button className={!tendered ? 'on' : ''} onClick={() => setTendered(0)}>{t('pay.exact')}</button>
              {quick.map((q) => <button key={q} className={tendered === q ? 'on' : ''} onClick={() => { haptic(6); setTendered(q); }}>{money(q).replace('.00', '')}</button>)}
            </div>
            <MoneyPad cents={tendered} onChange={setTendered} />
          </>
        ) : (
          <>
            <p className="notice">{t('pay.cardHint')}</p>
            <div className="group">
              <h3>{t('pay.tip')}</h3>
              <div className="chips even">
                {[0, 100, 200, 500].map((n) => <button key={n} className={tip === n ? 'on' : ''} onClick={() => setTip(n)}>{n ? money(n).replace('.00', '') : t('pay.noTip')}</button>)}
              </div>
            </div>
            <input placeholder={t('pay.ref')} value={ref} onChange={(e) => setRef(e.target.value)} />
          </>
        )}
        {err && <div className="error">{err}</div>}
      </div>
      <div className="sheet-foot">
        <button className="primary xl grow" disabled={busy || short} onClick={() => void confirm()}>
          {t('pay.confirm')} <span className="money">{money(total + (method === 'card' ? tip : 0))}</span>
        </button>
      </div>
    </Sheet>
  );
}

function OrdersList({ orders, onPay }: { orders: Order[]; onPay: (o: Order) => void }) {
  const { t } = useLang();
  const [voiding, setVoiding] = useState<Order | null>(null);
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const close = () => { setVoiding(null); setReason(''); setPin(''); setErr(''); };
  const doVoid = async () => {
    if (!voiding) return;
    try {
      await api(`/orders/${voiding.id}/void`, { body: { reason, managerPin: pin || undefined } });
      toast(`#${voiding.ticketNumber} ${t('orders.void')}`);
      close();
    } catch (e) { setErr(errMsg(e)); }
  };
  if (!orders.length) return <div className="cart-empty tall"><Icon.receipt /><p>{t('orders.empty')}</p></div>;
  return (
    <>
      <ul className="orders">
        {orders.map((o) => (
          <li key={o.id} className={o.status === 'void' ? 'void' : ''}>
            <div className="num">#{o.ticketNumber}</div>
            <div className="grow">
              <div className="line-name">{o.lines.map((l) => `${l.qty}× ${l.name}`).join(', ')}</div>
              <div className="pills">
                <span className={`pill st-${o.status}`}>{t(`st.${o.status}`)}</span>
                {o.status !== 'void' && <span className={`pill ${o.paid ? 'paid' : 'unpaid'}`}>{o.paid ? t('orders.paid') : t('orders.unpaid')}</span>}
              </div>
            </div>
            <b className="money">{money(o.totalCents)}</b>
            <div className="row-actions">
              {!o.paid && o.status !== 'void' && <button className="primary" onClick={() => onPay(o)}>{t('orders.pay')}</button>}
              {o.paid && <button onClick={() => { void printReceipt(o); toast(t('orders.reprint')); }}><Icon.receipt />{t('orders.reprint')}</button>}
              {o.status !== 'void' && <button className="ghost danger" onClick={() => setVoiding(o)}>{t('orders.voidBtn')}</button>}
            </div>
          </li>
        ))}
      </ul>
      {voiding && (
        <Sheet title={`${t('orders.voidBtn')} #${voiding.ticketNumber}`} onClose={close}>
          <div className="sheet-body">
            <input placeholder={t('orders.reason')} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
            <input placeholder={t('orders.pin')} inputMode="numeric" type="password" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} />
            {err && <div className="error">{err}</div>}
          </div>
          <div className="sheet-foot">
            <button className="ghost" onClick={close}>{t('pay.cancel')}</button>
            <button className="primary danger-fill grow" disabled={reason.length < 2} onClick={() => void doVoid()}>{t('orders.voidBtn')}</button>
          </div>
        </Sheet>
      )}
    </>
  );
}
