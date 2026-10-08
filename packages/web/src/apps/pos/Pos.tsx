import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  computeTotals, formatMoney, parseMoney, type MenuItem, type MenuResponse, type ModifierGroup, type Order,
} from '@cactus/shared';
import { api, ApiError, browserPrintReceipt, printReceipt, serverPrints } from '../../lib/api';
import { MENU_CHANGED, useOrders } from '../../lib/live';
import { useLang } from '../../i18n';
import { Icon } from '../../ui/Icon';
import './pos.css';

const copy = {
  en: { menu: 'On the menu', choose: 'Choose something good', current: 'Your order', items: 'items', emptyTitle: 'A fresh start', options: 'Choose options', add: 'Add one', remove: 'Remove one', sending: 'Sending…', paying: 'Processing…', today: 'Today’s orders', required: 'Choose an option to continue', optional: 'Optional', paymentHint: 'Choose how the customer is paying', close: 'Close', loading: 'Loading menu…', sent: 'Sent to the kitchen', paid: 'Payment received', noItems: 'No items in this category', priceHint: 'Enter today’s price to continue', amountDue: 'Amount due' },
  nl: { menu: 'Op de kaart', choose: 'Kies iets lekkers', current: 'Je bestelling', items: 'items', emptyTitle: 'Een nieuw begin', options: 'Kies opties', add: 'Eén toevoegen', remove: 'Eén verwijderen', sending: 'Versturen…', paying: 'Verwerken…', today: 'Bestellingen van vandaag', required: 'Kies een optie om verder te gaan', optional: 'Optioneel', paymentHint: 'Kies hoe de klant betaalt', close: 'Sluiten', loading: 'Menu laden…', sent: 'Verstuurd naar de keuken', paid: 'Betaling ontvangen', noItems: 'Geen items in deze categorie', priceHint: 'Vul de dagprijs in om verder te gaan', amountDue: 'Te betalen' },
};

function Sheet({ children, onCancel, busy = false, titleId, kind }: { children: ReactNode; onCancel: () => void; busy?: boolean; titleId: string; kind: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, button');
    first?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => { if (busy) ref.current?.focus(); }, [busy]);
  return <div className={`sheet-bg pos-sheet ${kind}`} onClick={() => !busy && onCancel()}>
    <div ref={ref} tabIndex={-1} className="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => {
      if (e.key === 'Escape' && !busy) onCancel();
      if (e.key !== 'Tab') return;
      const controls = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') ?? []);
      if (!controls.length) { e.preventDefault(); return; }
      const first = controls[0]; const last = controls.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }}>{children}</div>
  </div>;
}

type Menu = MenuResponse;
interface CartLine { key: string; item: MenuItem; qty: number; optionIds: string[]; note?: string; priceCents?: number }

const money = (c: number) => formatMoney(c);
const today = () => new Date().toISOString().slice(0, 10);

function lineUnit(l: CartLine): number {
  const mods = l.item.modifierGroups.flatMap((g) => g.options).filter((o) => l.optionIds.includes(o.id));
  return (l.item.openPrice ? l.priceCents ?? 0 : l.item.priceCents) + mods.reduce((s, m) => s + m.priceDeltaCents, 0);
}

export function Pos() {
  const { t, lang } = useLang();
  const c = copy[lang];
  const [menu, setMenu] = useState<Menu | null>(null);
  const [cat, setCat] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [note, setNote] = useState('');
  const [picking, setPicking] = useState<MenuItem | null>(null);
  const [paying, setPaying] = useState<{ order: Order } | { cartTotal: number } | null>(null);
  const [view, setView] = useState<'order' | 'orders'>('order');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const placing = useRef(false);
  const [success, setSuccess] = useState('');
  const cartPanel = useRef<HTMLElement>(null);
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
    }).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    load();
    window.addEventListener(MENU_CHANGED, load);
    return () => window.removeEventListener(MENU_CHANGED, load);
  }, []);

  const totals = useMemo(() => {
    if (!menu || cart.length === 0) return null;
    return computeTotals(cart.map((l) => ({ taxCategoryId: l.item.taxCategoryId, grossCents: lineUnit(l) * l.qty })), menu.taxCategories, today());
  }, [cart, menu]);

  const add = (item: MenuItem, optionIds: string[] = [], priceCents?: number) => {
    setCart((c) => {
      const key = `${item.id}|${[...optionIds].sort().join(',')}|${priceCents ?? ''}`;
      const hit = c.find((l) => l.key === key);
      return hit ? c.map((l) => (l === hit ? { ...l, qty: l.qty + 1 } : l)) : [...c, { key, item, qty: 1, optionIds, priceCents }];
    });
  };
  const tap = (item: MenuItem) => {
    if (!item.available) return;
    if (item.modifierGroups.length || item.openPrice) setPicking(item); else add(item);
  };
  const bump = (key: string, d: number) => setCart((c) => c.map((l) => (l.key === key ? { ...l, qty: l.qty + d } : l)).filter((l) => l.qty > 0));

  const place = async (): Promise<Order | null> => {
    if (placing.current || !cart.length) return null;
    placing.current = true; setSending(true); setSuccess('');
    setError('');
    try {
      const order = await api<Order>('/orders', {
        body: { lines: cart.map((l) => ({ itemId: l.item.id, qty: l.qty, modifierOptionIds: l.optionIds, note: l.note, priceCents: l.priceCents })), note: note || undefined },
      });
      setCart([]); setNote('');
      setSuccess(`${c.sent} · #${order.ticketNumber}`);
      return order;
    } catch (e) { setError(e instanceof ApiError ? e.message : String(e)); return null; }
    finally { placing.current = false; setSending(false); }
  };

  if (!menu) return <div className="pos pos-loading" role="status"><Icon name="menu" size={36} /><p>{error || c.loading}</p></div>;
  const items = menu.items.filter((i) => i.categoryId === cat);

  return (
    <div className="pos">
      {!online && <div className="banner"><Icon name="wifi-off" />{t('offline')}</div>}
      <div className="tabs">
        <button aria-pressed={view === 'order'} className={view === 'order' ? 'on' : ''} onClick={() => setView('order')}><Icon name="plus" />{t('nav.order')}</button>
        <button aria-pressed={view === 'orders'} className={view === 'orders' ? 'on' : ''} onClick={() => setView('orders')}><Icon name="receipt" />{t('nav.orders')} <span className="pos-count">{orders.filter((o) => o.status !== 'void' && (!o.paid || o.status !== 'collected')).length}</span></button>
      </div>
      {success && <div className="pos-success" role="status"><Icon name="check" />{success}<button aria-label={c.close} onClick={() => setSuccess('')}><Icon name="close" /></button></div>}

      {view === 'order' ? (
        <div className="pos-grid">
          <section className="menu">
            <div className="pos-section-heading"><div><p className="pos-eyebrow">{c.menu}</p><h1>{c.choose}</h1></div><span className="pos-menu-icon"><Icon name="leaf" size={28} /></span></div>
            <div className="cats">
              {menu.categories.map((c) => <button key={c.id} aria-pressed={c.id === cat} className={c.id === cat ? 'on' : ''} onClick={() => setCat(c.id)}>{c.name}</button>)}
            </div>
            <div className="items">
              {items.map((i) => (
                <button key={i.id} className="item" disabled={!i.available || sending || !!paying} onClick={() => tap(i)}>
                  <span className="pos-item-name">{i.name}</span>
                  {i.description && <small className="pos-item-description">{i.description}</small>}
                  <span className="pos-item-footer"><b>{!i.available ? t('soldout') : i.openPrice ? t('pos.market') : money(i.priceCents)}</b><span className="pos-item-add"><Icon name={i.modifierGroups.length || i.openPrice ? 'more' : 'plus'} /></span></span>
                </button>
              ))}
              {!items.length && <p className="muted">{c.noItems}</p>}
            </div>
          </section>

          <aside ref={cartPanel} className="cart">
            <header className="pos-cart-heading"><span><Icon name="cart" /><h2>{c.current}</h2></span><span className="pos-count">{cart.reduce((sum, l) => sum + l.qty, 0)}</span></header>
            {cart.length === 0 && <div className="pos-cart-empty"><span><Icon name="cart" size={38} /></span><h3>{c.emptyTitle}</h3><p>{t('cart.empty')}</p></div>}
            <ul>
              {cart.map((l) => {
                const mods = l.item.modifierGroups.flatMap((g) => g.options).filter((o) => l.optionIds.includes(o.id));
                return (
                  <li key={l.key}>
                    <div className="grow">
                      <div className="pos-line-name">{l.item.name}</div>
                      {mods.length > 0 && <small className="muted">{mods.map((m) => m.name).join(', ')}</small>}
                    </div>
                    <div className="qty">
                      <button disabled={sending || !!paying} aria-label={`${c.remove}: ${l.item.name}`} onClick={() => bump(l.key, -1)}><Icon name="minus" /></button><span>{l.qty}</span><button disabled={sending || !!paying} aria-label={`${c.add}: ${l.item.name}`} onClick={() => bump(l.key, 1)}><Icon name="plus" /></button>
                    </div>
                    <b className="amt">{money(lineUnit(l) * l.qty)}</b>
                  </li>
                );
              })}
            </ul>
            {cart.length > 0 && <label className="pos-note">{t('cart.note')}<input disabled={sending || !!paying} placeholder={t('cart.note')} value={note} onChange={(e) => setNote(e.target.value)} /></label>}
            {error && <div className="error" role="alert">{error}</div>}
            <div className="total">
              <span>{t('cart.total')} <small className="muted">{t('cart.abb')}{totals ? ` ${money(totals.taxCents)}` : ''}</small></span>
              <b>{money(totals?.totalCents ?? 0)}</b>
            </div>
            <div className="actions">
              <button className="ghost pos-clear" disabled={!cart.length || sending || !!paying} onClick={() => setCart([])}><Icon name="trash" />{t('cart.clear')}</button>
              <button disabled={!cart.length || sending || !!paying} onClick={() => void place()}><Icon name="send" />{sending ? c.sending : t('cart.send')}</button>
              <button className="primary pos-pay" disabled={!cart.length || sending || !!paying} onClick={() => totals && setPaying({ cartTotal: totals.totalCents })}><Icon name="cash" />{t('cart.pay')}</button>
            </div>
          </aside>
        </div>
      ) : (
        <OrdersList orders={[...orders].reverse()} onPay={(order) => setPaying({ order })} />
      )}

      {view === 'order' && cart.length > 0 && <div className="pos-mobile-bar">
        <button className="ghost" onClick={() => cartPanel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><Icon name="cart" /><span>{c.current}<b>{money(totals?.totalCents ?? 0)}</b></span><span className="pos-count">{cart.reduce((sum, l) => sum + l.qty, 0)}</span></button>
        <button className="primary" disabled={sending || !!paying} onClick={() => totals && setPaying({ cartTotal: totals.totalCents })}><Icon name="cash" />{t('orders.pay')}</button>
      </div>}

      {picking && <ModifierSheet item={picking} onCancel={() => setPicking(null)} onAdd={(ids, price) => { add(picking, ids, price); setPicking(null); }} />}
      {paying && (
        <PaySheet
          total={'order' in paying ? paying.order.totalCents : paying.cartTotal}
          onCancel={() => setPaying(null)}
          onPay={async (body) => {
            const order = 'order' in paying ? paying.order : await place();
            if (!order) { setPaying(null); return; }
            // Keep the created order for a payment retry; never create the cart twice.
            setPaying({ order });
            const paid = await api<Order>(`/orders/${order.id}/pay`, { body });
            setPaying(null);
            setSuccess(`${c.paid} · #${paid.ticketNumber}`);
            // With a receipt printer the server already printed it on payment.
            if (!(await serverPrints())) void browserPrintReceipt(paid);
          }}
        />
      )}
    </div>
  );
}

function ModifierSheet({ item, onAdd, onCancel }: { item: MenuItem; onAdd: (ids: string[], priceCents?: number) => void; onCancel: () => void }) {
  const { t, lang } = useLang();
  const c = copy[lang];
  const [sel, setSel] = useState<string[]>([]);
  const [price, setPrice] = useState('');
  const typed = parseMoney(price);
  const priceMissing = item.openPrice && !typed;
  const toggle = (g: ModifierGroup, id: string) => setSel((s) => {
    if (s.includes(id)) return s.filter((x) => x !== id);
    const others = g.multi ? s : s.filter((x) => !g.options.some((o) => o.id === x));
    return [...others, id];
  });
  const missing = item.modifierGroups.some((g) => g.required && !g.options.some((o) => sel.includes(o.id)));
  return (
    <Sheet onCancel={onCancel} titleId="pos-modifier-title" kind="pos-modifier">
        <header className="pos-sheet-heading"><div><p className="pos-eyebrow">{c.options}</p><h2 id="pos-modifier-title">{item.name}</h2></div><button className="ghost pos-close" aria-label={c.close} onClick={onCancel}><Icon name="close" /></button></header>
        {item.description && <small className="muted">{item.description}</small>}
        {item.openPrice && (
          <label>{t('pos.enterPrice')}
            <input inputMode="decimal" autoFocus placeholder="0.00" value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
        )}
        {item.modifierGroups.map((g) => (
          <div key={g.id} className="group">
            <h3>{g.name}<small className={g.required ? 'pos-required' : ''}>{g.required ? t('mods.required') : c.optional}</small></h3>
            <div className="chips">
              {g.options.map((o) => (
                <button key={o.id} aria-pressed={sel.includes(o.id)} className={sel.includes(o.id) ? 'on' : ''} onClick={() => toggle(g, o.id)}>
                  <span>{o.name}{o.priceDeltaCents ? ` +${money(o.priceDeltaCents)}` : ''}</span>{sel.includes(o.id) && <Icon name="check" />}
                </button>
              ))}
            </div>
          </div>
        ))}
        {(missing || priceMissing) && <p className="pos-sheet-hint">{priceMissing ? c.priceHint : c.required}</p>}
        <div className="actions">
          <button className="ghost" onClick={onCancel}>{t('pay.cancel')}</button>
          <button className="primary" disabled={missing || priceMissing} onClick={() => onAdd(sel, item.openPrice ? typed ?? undefined : undefined)}><Icon name="plus" />{t('mods.add')}</button>
        </div>
    </Sheet>
  );
}

function PaySheet({ total, onPay, onCancel }: {
  total: number; onCancel: () => void;
  onPay: (b: { method: 'cash' | 'card'; tenderedCents?: number; reference?: string; tipCents: number }) => Promise<void>;
}) {
  const { t, lang } = useLang();
  const c = copy[lang];
  const [method, setMethod] = useState<'cash' | 'card'>('cash');
  const [tendered, setTendered] = useState(total);
  const [ref, setRef] = useState('');
  const [tip, setTip] = useState(0);
  const [busy, setBusy] = useState(false);
  const paying = useRef(false);
  const [err, setErr] = useState('');
  const quick = [...new Set([total, ...[5, 10, 20, 50, 100].map((n) => n * 100).filter((n) => n >= total)])].slice(0, 5);
  const confirm = async () => {
    if (paying.current) return;
    paying.current = true;
    setBusy(true); setErr('');
    try { await onPay({ method, tenderedCents: method === 'cash' ? tendered : undefined, reference: ref || undefined, tipCents: tip }); }
    catch (e) { setErr(e instanceof ApiError ? e.message : String(e)); setBusy(false); }
    finally { paying.current = false; }
  };
  return (
    <Sheet onCancel={onCancel} busy={busy} titleId="pos-pay-title" kind="pos-payment">
        <header className="pos-sheet-heading"><div><p className="pos-eyebrow">{c.amountDue}</p><h2 id="pos-pay-title">{t('pay.title')}</h2></div><strong className="pos-payment-total">{money(total)}</strong></header>
        <p className="pos-sheet-hint">{c.paymentHint}</p>
        <div className="chips pos-payment-method">
          <button disabled={busy} aria-pressed={method === 'cash'} className={method === 'cash' ? 'on' : ''} onClick={() => setMethod('cash')}><Icon name="cash" />{t('pay.cash')}</button>
          <button disabled={busy} aria-pressed={method === 'card'} className={method === 'card' ? 'on' : ''} onClick={() => setMethod('card')}><Icon name="card" />{t('pay.card')}</button>
        </div>
        {method === 'cash' ? (
          <>
            <h3>{t('pay.tendered')}</h3>
            <div className="chips">
              {quick.map((q) => <button disabled={busy} key={q} aria-pressed={tendered === q} className={tendered === q ? 'on' : ''} onClick={() => setTendered(q)}>{q === total ? t('pay.exact') : money(q)}</button>)}
            </div>
            <div className="change"><span>{t('pay.change')}</span><b>{money(Math.max(0, tendered - total))}</b></div>
          </>
        ) : (
          <>
            <label>{t('pay.ref')}<input disabled={busy} placeholder={t('pay.ref')} value={ref} onChange={(e) => setRef(e.target.value)} /></label>
            <h3>{t('pay.tip')}</h3>
            <div className="chips">
              {[0, 100, 200, 500].map((n) => <button disabled={busy} key={n} aria-pressed={tip === n} className={tip === n ? 'on' : ''} onClick={() => setTip(n)}>{money(n)}</button>)}
            </div>
          </>
        )}
        {err && <div className="error" role="alert">{err}</div>}
        <div className="actions">
          <button className="ghost" disabled={busy} onClick={onCancel}>{t('pay.cancel')}</button>
          <button className="primary" disabled={busy || (method === 'cash' && tendered < total)} onClick={() => void confirm()}><Icon name={busy ? 'clock' : 'check'} />{busy ? c.paying : t('pay.confirm')}</button>
        </div>
    </Sheet>
  );
}

function OrdersList({ orders, onPay }: { orders: Order[]; onPay: (o: Order) => void }) {
  const { t, lang } = useLang();
  const c = copy[lang];
  const [voiding, setVoiding] = useState<Order | null>(null);
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const voidPending = useRef(false);
  const doVoid = async () => {
    if (!voiding || voidPending.current) return;
    voidPending.current = true; setBusy(true);
    try { await api(`/orders/${voiding.id}/void`, { body: { reason, managerPin: pin || undefined } }); setVoiding(null); setReason(''); setPin(''); setErr(''); }
    catch (e) { setErr(e instanceof ApiError ? e.message : String(e)); }
    finally { voidPending.current = false; setBusy(false); }
  };
  if (!orders.length) return <div className="pos-orders-empty"><Icon name="receipt" size={40} /><h2>{c.today}</h2><p>{t('orders.empty')}</p></div>;
  return (
    <>
      <div className="pos-orders-heading"><p className="pos-eyebrow">{c.today}</p><h1>{t('nav.orders')} <span className="pos-count">{orders.length}</span></h1></div>
      <ul className="orders">
        {orders.map((o) => (
          <li key={o.id} className={o.status === 'void' ? 'void' : ''}>
            <div className="num">#{o.ticketNumber}</div>
            <div className="grow">
              <div>{o.lines.map((l) => `${l.qty}× ${l.name}`).join(', ')}</div>
              <div className="pos-order-status"><span className={`pos-status ${o.status}`}><Icon name={o.status === 'ready' || o.status === 'collected' ? 'check' : o.status === 'void' ? 'close' : 'clock'} size={16} />{t(`st.${o.status}` as 'st.sent')}</span><span className={`pos-status ${o.paid ? 'paid' : 'unpaid'}`}>{o.paid ? t('orders.paid') : o.status === 'void' ? t('orders.void') : t('orders.unpaid')}</span></div>
            </div>
            <b>{money(o.totalCents)}</b>
            <div className="row-actions">
              {!o.paid && o.status !== 'void' && <button className="primary" onClick={() => onPay(o)}><Icon name="cash" />{t('orders.pay')}</button>}
              {o.paid && <button onClick={() => void printReceipt(o)}><Icon name="printer" />{t('orders.reprint')}</button>}
              {o.status !== 'void' && <button className="ghost" onClick={() => setVoiding(o)}><Icon name="close" />{t('orders.voidBtn')}</button>}
            </div>
          </li>
        ))}
      </ul>
      {voiding && (
        <Sheet onCancel={() => setVoiding(null)} busy={busy} titleId="pos-void-title" kind="pos-void">
            <h2 id="pos-void-title">{t('orders.voidBtn')} #{voiding.ticketNumber}</h2>
            <label>{t('orders.reason')}<input disabled={busy} placeholder={t('orders.reason')} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
            <label>{t('orders.pin')}<input disabled={busy} placeholder={t('orders.pin')} inputMode="numeric" type="password" value={pin} onChange={(e) => setPin(e.target.value)} /></label>
            {err && <div className="error" role="alert">{err}</div>}
            <div className="actions">
              <button className="ghost" disabled={busy} onClick={() => setVoiding(null)}>{t('pay.cancel')}</button>
              <button className="primary" disabled={busy || reason.length < 2} onClick={() => void doVoid()}><Icon name={busy ? 'clock' : 'close'} />{busy ? c.paying : t('orders.voidBtn')}</button>
            </div>
        </Sheet>
      )}
    </>
  );
}
