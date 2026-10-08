import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  computeTotals, formatMoney, type MenuItem, type MenuResponse, type ModifierGroup, type Order,
} from '@cactus/shared';
import { api, ApiError, browserPrintReceipt, newRequestId, printReceipt, serverPrints } from '../../lib/api';
import { MENU_CHANGED, useOrders } from '../../lib/live';
import type { CSSProperties } from 'react';
import { useLang } from '../../i18n';
import { Icon } from '../../ui/Icon';
import { haptic, MoneyPad, Stepper, toast } from '../../ui/touch';
import './pos.css';

const copy = {
  en: { menu: 'On the menu', choose: 'Choose something good', current: 'Your order', items: 'items', emptyTitle: 'A fresh start', options: 'Choose options', add: 'Add one', remove: 'Remove one', sending: 'Sending…', paying: 'Processing…', today: 'Today’s orders', required: 'Choose an option to continue', optional: 'Optional', paymentHint: 'Choose how the customer is paying', close: 'Close', loading: 'Loading menu…', sent: 'Sent to the kitchen', paid: 'Payment received', noItems: 'No items in this category', priceHint: 'Enter today’s price to continue', amountDue: 'Amount due' },
  nl: { menu: 'Op de kaart', choose: 'Kies iets lekkers', current: 'Je bestelling', items: 'items', emptyTitle: 'Een nieuw begin', options: 'Kies opties', add: 'Eén toevoegen', remove: 'Eén verwijderen', sending: 'Versturen…', paying: 'Verwerken…', today: 'Bestellingen van vandaag', required: 'Kies een optie om verder te gaan', optional: 'Optioneel', paymentHint: 'Kies hoe de klant betaalt', close: 'Sluiten', loading: 'Menu laden…', sent: 'Verstuurd naar de keuken', paid: 'Betaling ontvangen', noItems: 'Geen items in deze categorie', priceHint: 'Vul de dagprijs in om verder te gaan', amountDue: 'Te betalen' },
};

function Sheet({ children, onCancel, busy = false, dismissable = true, titleId, kind }: { children: ReactNode; onCancel: () => void; busy?: boolean; dismissable?: boolean; titleId: string; kind: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, button');
    first?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => { if (busy) ref.current?.focus(); }, [busy]);
  return <div className={`sheet-bg pos-sheet ${kind}`} onClick={() => !busy && dismissable && onCancel()}>
    <div ref={ref} tabIndex={-1} className="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => {
      if (e.key === 'Escape' && !busy && dismissable) onCancel();
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

// Lives above the routes, so both the draft and an in-flight send survive screen changes.
// Reload/sign-out clears it. The request identity survives a lost reply and a return to the till.
function useDraftState() {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const placing = useRef(false);
  const request = useRef({ signature: '', id: newRequestId() });
  return { cart, setCart, note, setNote, sending, setSending, placing, request };
}
const DraftContext = createContext<ReturnType<typeof useDraftState> | null>(null);
export function PosDraftProvider({ children }: { children: ReactNode }) {
  const draft = useDraftState();
  return <DraftContext.Provider value={draft}>{children}</DraftContext.Provider>;
}

/** One colour per category (the palette of a hand-painted menu board), so the grid reads at a glance. */
const CAT_COLORS = ['#0e93ab', '#e2741a', '#d63384', '#3f9a3a', '#3567e0', '#8a56d8'];
const catStyle = (index: number) => ({ '--c': CAT_COLORS[Math.max(0, index) % CAT_COLORS.length] }) as CSSProperties;

const money = (c: number) => formatMoney(c);
const today = () => new Date().toISOString().slice(0, 10);

function lineUnit(l: CartLine): number {
  const mods = l.item.modifierGroups.flatMap((g) => g.options).filter((o) => l.optionIds.includes(o.id));
  return (l.item.openPrice ? l.priceCents ?? 0 : l.item.priceCents) + mods.reduce((s, m) => s + m.priceDeltaCents, 0);
}

export function Pos() {
  const { t, lang } = useLang();
  const c = copy[lang];
  const { cart, setCart, note, setNote, sending, setSending, placing, request } = useContext(DraftContext)!;
  const [menu, setMenu] = useState<Menu | null>(null);
  const [cat, setCat] = useState('');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const [undo, setUndo] = useState<{ cart: CartLine[]; note: string } | null>(null);
  const [picking, setPicking] = useState<MenuItem | null>(null);
  const [paying, setPaying] = useState<{ order: Order } | { cartTotal: number } | null>(null);
  const [view, setView] = useState<'order' | 'orders'>('order');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const cartPanel = useRef<HTMLElement>(null);
  const { orders, online } = useOrders('today');
  const ui = lang === 'nl'
    ? { all: 'Alles', search: 'Zoek in het hele menu', clearSearch: 'Zoekopdracht wissen', found: 'gevonden', noResults: 'Niets gevonden', trySearch: 'Probeer een andere naam of kies een categorie.', undo: 'Herstellen', removed: 'Bestelling aangepast', clear: 'Bestelling wissen', menuHint: 'Tik op een gerecht om toe te voegen' }
    : { all: 'All items', search: 'Find anything on the menu', clearSearch: 'Clear search', found: 'found', noResults: 'Nothing on the menu matches', trySearch: 'Try another name or choose a category.', undo: 'Undo', removed: 'Order updated', clear: 'Clear order', menuHint: 'Tap something good to add it' };

  useEffect(() => {
    if (!undo) return;
    const timeout = setTimeout(() => setUndo(null), 8000);
    return () => clearTimeout(timeout);
  }, [undo]);

  useEffect(() => {
    const load = () => void api<Menu>('/menu').then((m) => {
      setMenu(m);
      setCat((c) => (m.categories.some((x) => x.id === c) ? c : ''));
      setUndo(null);
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
    try {
      return computeTotals(cart.map((l) => ({ taxCategoryId: l.item.taxCategoryId, grossCents: lineUnit(l) * l.qty })), menu.taxCategories, today());
    } catch { return null; } // The server reports invalid tax setup on send.

  }, [cart, menu]);
  const total = totals?.totalCents ?? cart.reduce((sum, l) => sum + lineUnit(l) * l.qty, 0);

  const add = (item: MenuItem, optionIds: string[] = [], priceCents?: number, qty = 1) => {
    haptic();
    setUndo(null);
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
  const bump = (key: string, d: number) => {
    haptic(6);
    setUndo(d < 0 && cart.find((line) => line.key === key)?.qty === 1 ? { cart, note } : null);
    setCart((c) => c.map((l) => (l.key === key ? { ...l, qty: Math.min(99, l.qty + d) } : l)).filter((l) => l.qty > 0));
  };

  // One key per cart: tapping Send again after a lost reply returns the same order instead of making a second one.
  const place = async (reportSuccess = false): Promise<Order | null> => {
    if (placing.current || !cart.length) return null;
    setUndo(null);
    placing.current = true; setSending(true); setSuccess('');
    setError('');
    try {
      const body = { lines: cart.map((l) => ({ itemId: l.item.id, qty: l.qty, modifierOptionIds: l.optionIds, note: l.note, priceCents: l.priceCents })), note: note || undefined };
      const signature = JSON.stringify(body);
      if (request.current.signature !== signature) request.current = { signature, id: newRequestId() };
      const order = await api<Order>('/orders', {
        body, requestId: request.current.id,
      });
      request.current = { signature: '', id: newRequestId() };
      setCart([]); setNote('');
      if (reportSuccess) {
        setSuccess(`${c.sent} · #${order.ticketNumber}`);
        toast(`${c.sent} · #${order.ticketNumber}`);
      }
      return order;
    } catch (e) { setError(e instanceof ApiError ? e.message : String(e)); return null; }
    finally { placing.current = false; setSending(false); }
  };

  if (!menu) return <div className="pos pos-loading" role="status"><Icon name="menu" size={36} /><p>{error || c.loading}</p></div>;
  const search = query.trim().toLocaleLowerCase();
  const items = menu.items.filter((i) => search
    ? `${i.name} ${i.description ?? ''} ${menu.categories.find((category) => category.id === i.categoryId)?.name ?? ''}`.toLocaleLowerCase().includes(search)
    : !cat || i.categoryId === cat);

  return (
    <div className="pos">
      {!online && <div className="banner"><Icon name="wifi-off" />{t('offline')}</div>}
      <div className="pos-toolbar"><div className="tabs">
        <button aria-pressed={view === 'order'} className={view === 'order' ? 'on' : ''} onClick={() => setView('order')}><Icon name="plus" />{t('nav.order')}</button>
        <button aria-pressed={view === 'orders'} className={view === 'orders' ? 'on' : ''} onClick={() => setView('orders')}><Icon name="receipt" />{t('nav.orders')} <span className="pos-count">{orders.filter((o) => o.status !== 'void' && (!o.paid || o.status !== 'collected')).length}</span></button>
      </div>
      {view === 'order' && <><button className={`pos-search-toggle${searchOpen ? ' on' : ''}`} aria-label={ui.search} aria-expanded={searchOpen} onClick={() => { setSearchOpen(!searchOpen); if (!searchOpen) requestAnimationFrame(() => searchInput.current?.focus()); else setQuery(''); }}><Icon name="search" /></button><div className={`pos-search${searchOpen ? ' is-open' : ''}`}><Icon name="search" /><input ref={searchInput} type="search" aria-label={ui.search} placeholder={ui.search} value={query} onChange={(e) => { setQuery(e.target.value); setCat(''); }} />{query && <button aria-label={ui.clearSearch} onClick={() => setQuery('')}><Icon name="close" /></button>}</div></>}
      </div>
      {success && <div className="pos-success" role="status"><Icon name="check" />{success}<button aria-label={c.close} onClick={() => setSuccess('')}><Icon name="close" /></button></div>}

      {view === 'order' ? (
        <div className="pos-grid">
          <section className="menu">
            <div className="cats">
              <button aria-pressed={!cat} className={!cat ? 'on pos-all' : 'pos-all'} onClick={() => { setCat(''); setQuery(''); }}><Icon name="menu" />{ui.all}</button>
              {menu.categories.map((c, index) => <button key={c.id} style={catStyle(index)} aria-pressed={c.id === cat} className={c.id === cat ? 'on' : ''} onClick={() => { setCat(c.id); setQuery(''); }}><i className="pos-cat-dot" />{c.name}</button>)}
            </div>
            <div className="pos-menu-caption"><span>{search ? `“${query.trim()}”` : ui.menuHint}</span><span role="status">{items.length} {search ? ui.found : c.items}</span></div>
            <div className="items">
              {items.map((i) => (
                <button key={i.id} className="item" style={catStyle(menu.categories.findIndex((x) => x.id === i.categoryId))} disabled={!i.available || sending || !!paying} onClick={() => tap(i)}>
                  <span className="pos-item-name">{i.name}</span>
                  {cart.some((l) => l.item.id === i.id) && <span className="pos-item-count pos-count">{cart.filter((l) => l.item.id === i.id).reduce((sum, l) => sum + l.qty, 0)}</span>}
                  {i.description && <small className="pos-item-description">{i.description}</small>}
                  <span className="pos-item-footer"><b>{!i.available ? t('soldout') : i.openPrice ? t('pos.market') : money(i.priceCents)}</b><span className="pos-item-add"><Icon name={i.modifierGroups.length || i.openPrice ? 'more' : 'plus'} /></span></span>
                </button>
              ))}
              {!items.length && <div className="pos-no-results"><Icon name="search" size={32} /><h3>{search ? ui.noResults : c.noItems}</h3><p>{ui.trySearch}</p><button onClick={() => { setQuery(''); setCat(''); }}>{ui.all}<Icon name="arrow-right" /></button></div>}
            </div>
          </section>

          <aside ref={cartPanel} className="cart">
            <header className="pos-cart-heading"><span><Icon name="cart" /><h2>{c.current}</h2><span className="pos-count">{cart.reduce((sum, l) => sum + l.qty, 0)}</span></span><button className="pos-clear-order" aria-label={ui.clear} disabled={!cart.length || sending || !!paying} onClick={() => { setUndo({ cart, note }); setCart([]); setNote(''); }}><Icon name="trash" /></button></header>
            {undo && <div className="pos-undo" role="status"><span>{ui.removed}</span><button disabled={sending || !!paying} onClick={() => { setCart(undo.cart); setNote(undo.note); setUndo(null); }}><Icon name="undo" />{ui.undo}</button></div>}
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
                      <button disabled={sending || !!paying} aria-label={`${c.remove}: ${l.item.name}`} onClick={() => bump(l.key, -1)}><Icon name="minus" /></button><span>{l.qty}</span><button disabled={sending || !!paying || l.qty >= 99} aria-label={`${c.add}: ${l.item.name}`} onClick={() => bump(l.key, 1)}><Icon name="plus" /></button>
                    </div>
                    <b className="amt">{money(lineUnit(l) * l.qty)}</b>
                  </li>
                );
              })}
            </ul>
            {cart.length > 0 && <label className="pos-note">{t('cart.note')}<input disabled={sending || !!paying} placeholder={t('cart.note')} value={note} onChange={(e) => { setNote(e.target.value); setUndo(null); }} /></label>}
            {error && <div className="error" role="alert">{error}</div>}
            <div className="total">
              <span>{t('cart.total')} <small className="muted">{t('cart.abb')}{totals ? ` ${money(totals.taxCents)}` : ''}</small></span>
              <b>{money(total)}</b>
            </div>
            <div className="actions">
              <button disabled={!cart.length || sending || !!paying} onClick={() => void place(true)}><Icon name="send" />{sending ? c.sending : t('cart.send')}</button>
              <button className="primary pos-pay" disabled={!cart.length || sending || !!paying} onClick={() => setPaying({ cartTotal: total })}><Icon name="cash" />{t('cart.payNow')}<span className="pos-pay-amount">{money(total)}</span></button>
            </div>
          </aside>
        </div>
      ) : (
        <OrdersList orders={[...orders].reverse()} onPay={(order) => setPaying({ order })} />
      )}

      {view === 'order' && cart.length > 0 && <div className="pos-mobile-bar">
        <button className="ghost" onClick={() => cartPanel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><Icon name="cart" /><span>{c.current}<b>{money(total)}</b></span><span className="pos-count">{cart.reduce((sum, l) => sum + l.qty, 0)}</span></button>
        <button className="primary" disabled={sending || !!paying} onClick={() => setPaying({ cartTotal: total })}><Icon name="cash" />{t('orders.pay')}</button>
      </div>}

      {picking && <ModifierSheet item={picking} onCancel={() => setPicking(null)} onAdd={(ids, price, qty) => { add(picking, ids, price, qty); setPicking(null); }} />}
      {paying && (
        <PaySheet
          total={'order' in paying ? paying.order.totalCents : paying.cartTotal}
          onCancel={() => setPaying(null)}
          onPay={async (body) => {
            const order = 'order' in paying ? paying.order : await place();
            if (!order) throw new Error(t('pay.failed'));
            // Keep the created order for a payment retry; never create the cart twice.
            setPaying({ order });
            const paid = await api<Order>(`/orders/${order.id}/pay`, { body, requestId: `pay-${order.id}` });
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
  const { t, lang } = useLang();
  const c = copy[lang];
  const [sel, setSel] = useState<string[]>([]);
  const [price, setPrice] = useState(0);
  const [qty, setQty] = useState(1);
  const priceMissing = item.openPrice && price <= 0;
  const unit = (item.openPrice ? price : item.priceCents) + item.modifierGroups.flatMap((g) => g.options).filter((o) => sel.includes(o.id)).reduce((sum, o) => sum + o.priceDeltaCents, 0);
  const toggle = (g: ModifierGroup, id: string) => { haptic(6); setSel((s) => {
    if (s.includes(id)) return s.filter((x) => x !== id);
    const others = g.multi ? s : s.filter((x) => !g.options.some((o) => o.id === x));
    return [...others, id];
  }); };
  const missing = item.modifierGroups.some((g) => g.required && !g.options.some((o) => sel.includes(o.id)));
  return (
    <Sheet onCancel={onCancel} titleId="pos-modifier-title" kind="pos-modifier">
        <header className="pos-sheet-heading"><div><p className="pos-eyebrow">{c.options}</p><h2 id="pos-modifier-title">{item.name}</h2></div><button className="ghost pos-close" aria-label={c.close} onClick={onCancel}><Icon name="close" /></button></header>
        {item.description && <small className="muted">{item.description}</small>}
        {item.openPrice && (
          <div className="pos-price-entry"><h3>{t('pos.enterPrice')}</h3><div className="amount" aria-live="polite">{money(price)}</div><MoneyPad cents={price} onChange={setPrice} max={1_000_000} /></div>
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
        <div className="pos-modifier-quantity"><span>{lang === 'nl' ? 'Aantal' : 'Quantity'}</span><Stepper value={qty} onChange={setQty} min={1} /></div>
        <div className="actions">
          <button className="ghost" onClick={onCancel}>{t('pay.cancel')}</button>
          <button className="primary" disabled={missing || priceMissing} onClick={() => onAdd(sel, item.openPrice ? price : undefined, qty)}><Icon name="plus" />{t('mods.add')} · {money(unit * qty)}</button>
        </div>
    </Sheet>
  );
}

function PaySheet({ total, onPay, onCancel }: {
  total: number; onCancel: () => void;
  onPay: (b: { method: 'cash' | 'card'; tenderedCents?: number; reference?: string; tipCents: number }) => Promise<Order>;
}) {
  const { t, lang } = useLang();
  const c = copy[lang];
  const [method, setMethod] = useState<'cash' | 'card'>('cash');
  const [tendered, setTendered] = useState(0);
  const [ref, setRef] = useState('');
  const [tip, setTip] = useState(0);
  const [busy, setBusy] = useState(false);
  const paying = useRef(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<Order | null>(null);
  const given = tendered || total;
  const quick = [...new Set([total, ...[5, 10, 20, 50, 100].map((n) => n * 100).filter((n) => n >= total)])].slice(0, 5);
  const confirm = async () => {
    if (paying.current) return;
    paying.current = true;
    setBusy(true); setErr('');
    try { const paid = await onPay({ method, tenderedCents: method === 'cash' ? given : undefined, reference: ref || undefined, tipCents: method === 'card' ? tip : 0 }); haptic(30); setDone(paid); }
    catch (e) { setErr(e instanceof ApiError ? e.message : String(e)); setBusy(false); }
    finally { paying.current = false; }
  };
  if (done) {
    const payment = done.payments.at(-1);
    return <Sheet onCancel={onCancel} dismissable={false} titleId="pos-paid-title" kind="pos-payment pos-paid">
      <div className="pos-paid-confirmation" role="status"><span className="paid-mark"><Icon name="check" size={38} /></span><h2 id="pos-paid-title">{t('pay.paid')} · #{done.ticketNumber}</h2>
        <p className="muted">{payment?.method === 'cash' ? t('pay.change') : c.paid}</p><strong className="amount big">{money(payment?.method === 'cash' ? payment.changeCents ?? 0 : done.totalCents + (payment?.tipCents ?? 0))}</strong>
      </div>
      <div className="actions"><button onClick={() => void printReceipt(done)}><Icon name="printer" />{t('orders.reprint')}</button><button className="primary" autoFocus onClick={onCancel}>{t('pay.next')}<Icon name="arrow-right" /></button></div>
    </Sheet>;
  }
  return (
    <Sheet onCancel={onCancel} busy={busy} titleId="pos-pay-title" kind="pos-payment">
        <header className="pos-sheet-heading"><div><p className="pos-eyebrow">{c.amountDue}</p><h2 id="pos-pay-title">{t('pay.title')}</h2></div><strong className="pos-payment-total">{money(total)}</strong></header>
        <div className="chips pos-payment-method">
          <button disabled={busy} aria-pressed={method === 'cash'} className={method === 'cash' ? 'on' : ''} onClick={() => setMethod('cash')}><Icon name="cash" />{t('pay.cash')}</button>
          <button disabled={busy} aria-pressed={method === 'card'} className={method === 'card' ? 'on' : ''} onClick={() => setMethod('card')}><Icon name="card" />{t('pay.card')}</button>
        </div>
        {method === 'cash' ? (
          <>
            <div className="pos-pay-cols">
            <div className="pos-pay-side">
            <div className="pos-pay-amounts">
              <div><span>{t('pay.tendered')}</span><strong className="amount" aria-live="polite">{money(given)}</strong></div>
              <div className={`pos-pay-change${given < total ? ' pos-short' : ''}`} aria-live="polite"><span>{given < total ? (lang === 'nl' ? 'Nog te betalen' : 'Still due') : t('pay.change')}</span><strong className="amount">{money(Math.abs(given - total))}</strong></div>
            </div>
            <div className="chips pos-quick">
              {quick.map((q) => <button disabled={busy} key={q} aria-pressed={(q === total ? tendered === 0 : tendered === q)} className={(q === total ? tendered === 0 : tendered === q) ? 'on' : ''} onClick={() => { haptic(6); setTendered(q === total ? 0 : q); }}>{q === total ? t('pay.exact') : money(q).replace('.00', '')}</button>)}
            </div>
            </div>
            {!busy && <MoneyPad cents={tendered} onChange={setTendered} />}
            </div>
          </>
        ) : (
          <>
            <p className="notice">{t('pay.cardHint')}</p>
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
          <button className="primary" disabled={busy || (method === 'cash' && given < total)} onClick={() => void confirm()}><Icon name={busy ? 'clock' : 'check'} />{busy ? c.paying : t('pay.confirm')} · {money(total + (method === 'card' ? tip : 0))}</button>
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
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const toPay = orders.filter((o) => !o.paid && o.status !== 'void');
  // Nothing left to pay: show everything rather than an empty list.
  const shown = filter === 'open' && toPay.length ? toPay : orders;
  const clock = (iso: string) => new Date(iso).toLocaleTimeString(lang === 'nl' ? 'nl-NL' : 'en-US', { hour: '2-digit', minute: '2-digit' });
  if (!orders.length) return <div className="pos-orders-empty"><Icon name="receipt" size={40} /><h2>{c.today}</h2><p>{t('orders.empty')}</p></div>;
  return (
    <>
      <div className="pos-orders-filter" role="group" aria-label={t('nav.orders')}>
        <button aria-pressed={shown === toPay} className={shown === toPay ? 'on' : ''} disabled={!toPay.length} onClick={() => setFilter('open')}>{lang === 'nl' ? 'Te betalen' : 'To pay'}<span className="pos-count">{toPay.length}</span></button>
        <button aria-pressed={shown === orders} className={shown === orders ? 'on' : ''} onClick={() => setFilter('all')}>{lang === 'nl' ? 'Alles vandaag' : 'All today'}<span className="pos-count">{orders.length}</span></button>
      </div>
      <ul className="orders">
        {shown.map((o) => (
          <li key={o.id} className={o.status === 'void' ? 'void' : ''}>
            <div className="num">#{o.ticketNumber}<small>{clock(o.createdAt)}</small></div>
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
