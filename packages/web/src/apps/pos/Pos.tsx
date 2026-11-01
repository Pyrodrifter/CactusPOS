import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  computeTotals, formatMoney, categoryColor, isOpenTab, menuTagText, type MenuCategory, type MenuItem, type MenuResponse, type ModifierGroup, type Order, type Session,
} from '@cactus/shared';
import { api, ApiError, getSession, newRequestId, printReceipt } from '../../lib/api';
import { MENU_CHANGED, useOrders } from '../../lib/live';
import type { CSSProperties } from 'react';
import { useLang } from '../../i18n';
import { Icon } from '../../ui/Icon';
import { haptic, MoneyPad, Stepper, toast } from '../../ui/touch';
import { TabList, tabLabel } from './Tabs';
import './pos.css';
import { ServiceModeControl, useServiceMode } from './ServiceModeControl';
import { isPractice } from '../../lib/clientMode';
import { ReadyStrip } from './ReadyStrip';
import { StockView } from './Stock';
import { draftKey, emptyDraft, readDraft, saveDraft, type CartLine, type PendingSend, type SavedDraft } from './draftStore';

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
    }}>{isPractice() && <strong className="practice-sheet-label">PRACTICE / OEFENEN</strong>}{children}</div>
  </div>;
}

type Menu = MenuResponse;

// Lives above the routes, so the draft, an in-flight send and the reason a send failed survive screen changes.
// Device-local storage is scoped to staff, database instance and practice/live mode.
function useDraftState(session: Session) {
  const key = draftKey(session, location.origin, isPractice());
  const [initial] = useState(() => { try { return readDraft(localStorage, key); } catch { return null; } });
  const [cart, setCart] = useState<CartLine[]>(initial?.cart ?? []);
  const [note, setNote] = useState(initial?.note ?? '');
  const [pickupName, setPickupName] = useState(initial?.pickupName ?? '');
  const [sending, setSending] = useState(false);
  const placing = useRef(false);
  const request = useRef({ signature: '', id: newRequestId() });
  // T29: when set, the cart is a new round for this open tab instead of a new order.
  const [tab, setTab] = useState<{ id: string; label: string } | null>(initial?.tab ?? null);
  const [pendingSend, setPendingSend] = useState<PendingSend | null>(initial?.pendingSend ?? null);
  const [paymentOrderId, setPaymentOrderId] = useState<string | null>(initial?.paymentOrderId ?? null);
  const [recovered, setRecovered] = useState(!!initial);
  const [storageProblem, setStorageProblem] = useState(false);
  const snapshot = useRef<SavedDraft>(emptyDraft());
  snapshot.current = { version: 1, cart, note, pickupName, tab, pendingSend, paymentOrderId };
  const persist = (patch: Partial<SavedDraft> = {}) => {
    const value = { ...snapshot.current, ...patch };
    let ok = false;
    try { ok = saveDraft(localStorage, key, value); } catch { /* restricted browser storage */ }
    setStorageProblem(!ok); return ok;
  };
  useLayoutEffect(() => { persist(); }, [cart, note, pickupName, tab, pendingSend, paymentOrderId]);
  useEffect(() => { const flush = () => { try { saveDraft(localStorage, key, snapshot.current); } catch { /* unavailable */ } }; window.addEventListener('pagehide', flush); return () => window.removeEventListener('pagehide', flush); }, [key]);
  const [error, setError] = useState('');
  return { cart, setCart, note, setNote, pickupName, setPickupName, sending, setSending, placing, request, tab, setTab, error, setError,
    pendingSend, setPendingSend, paymentOrderId, setPaymentOrderId, recovered, setRecovered, storageProblem, persist };
}
const DraftContext = createContext<ReturnType<typeof useDraftState> | null>(null);
export function PosDraftProvider({ children, session }: { children: ReactNode; session: Session }) {
  const draft = useDraftState(session);
  return <DraftContext.Provider value={draft}>{children}</DraftContext.Provider>;
}

const catStyle = (categories: readonly MenuCategory[], id: string) => ({ '--c': categoryColor(categories, id) }) as CSSProperties;

const money = (c: number) => formatMoney(c);
const today = () => new Date().toISOString().slice(0, 10);

function lineUnit(l: CartLine): number {
  const mods = l.item.modifierGroups.flatMap((g) => g.options).filter((o) => l.optionIds.includes(o.id));
  return (l.item.openPrice ? l.priceCents ?? 0 : l.item.priceCents) + mods.reduce((s, m) => s + m.priceDeltaCents, 0);
}

export function Pos() {
  const serviceMode = useServiceMode();
  const { t, lang } = useLang();
  const c = copy[lang];
  const { cart, setCart, note, setNote, pickupName, setPickupName, sending: transmitting, setSending, placing, request, tab, setTab, error, setError,
    pendingSend, setPendingSend, paymentOrderId, setPaymentOrderId, recovered, setRecovered, storageProblem, persist } = useContext(DraftContext)!;
  const sending = transmitting || !!pendingSend || !!paymentOrderId;
  const pendingRef = useRef(pendingSend); pendingRef.current = pendingSend;
  const [recoveredOrder, setRecoveredOrder] = useState<Order | null>(null);
  const [checkingRecovery, setCheckingRecovery] = useState(false), [discarding, setDiscarding] = useState(false);
  const [naming, setNaming] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [cat, setCat] = useState('');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const [undo, setUndo] = useState<{ cart: CartLine[]; note: string; pickupName?: string } | null>(null);
  const [picking, setPicking] = useState<MenuItem | null>(null);
  const [paying, setPaying] = useState<{ order: Order } | { cartTotal: number } | null>(null);
  const [view, setView] = useState<'order' | 'tabs' | 'orders' | 'stock'>('order');
  const cartPanel = useRef<HTMLElement>(null);
  const { orders, online } = useOrders('today');
  const ui = lang === 'nl'
    ? { all: 'Alles', search: 'Zoek in het hele menu', clearSearch: 'Zoekopdracht wissen', found: 'gevonden', noResults: 'Niets gevonden', trySearch: 'Probeer een andere naam of kies een categorie.', undo: 'Herstellen', removed: 'Bestelling aangepast', clear: 'Bestelling wissen', menuHint: 'Tik op een gerecht om toe te voegen' }
    : { all: 'All items', search: 'Find anything on the menu', clearSearch: 'Clear search', found: 'found', noResults: 'Nothing on the menu matches', trySearch: 'Try another name or choose a category.', undo: 'Undo', removed: 'Order updated', clear: 'Clear order', menuHint: 'Tap something good to add it' };

  const tabUi = lang === 'nl'
    ? { tabs: 'Rekeningen', addingTo: 'Toevoegen aan', addTo: 'Toevoegen aan', addedTo: 'Toegevoegd aan', stop: 'Stoppen met toevoegen aan deze rekening', payLater: 'Later betalen' }
    : { tabs: 'Tabs', addingTo: 'Adding to', addTo: 'Add to', addedTo: 'Added to', stop: 'Stop adding to this tab', payLater: 'Pay later' };
  const openTabs = orders.filter(isOpenTab).length;

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
      if (!pendingRef.current) setCart((lines) => lines.flatMap((l) => {
        const item = m.items.find((i) => i.id === l.item.id);
        return item && item.available ? [{ ...l, item }] : recovered ? [l] : [];
      }));
    }).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    load();
    window.addEventListener(MENU_CHANGED, load);
    return () => window.removeEventListener(MENU_CHANGED, load);
  }, []);

  const received = (order: Order) => {
    request.current = { signature: '', id: newRequestId() };
    persist({ cart: [], note: '', pickupName: '', tab: null, pendingSend: null, paymentOrderId: order.id });
    setCart([]); setNote(''); setPickupName(''); setTab(null); setPendingSend(null); setPaymentOrderId(order.id); setRecoveredOrder(order); setRecovered(false); setError('');
  };
  const checkRecovery = async () => {
    setCheckingRecovery(true);
    try {
      if (pendingSend) {
        const result = await api<{ order: Order | null }>(`/request-status/${pendingSend.id}?kind=${pendingSend.kind}`);
        if (result.order) received(result.order);
      } else if (paymentOrderId) {
        const order = await api<Order>(`/orders/${paymentOrderId}`); received(order);
      }
    } catch (problem) { setError(problem instanceof Error ? problem.message : String(problem)); }
    finally { setCheckingRecovery(false); }
  };
  useEffect(() => { if (!transmitting && (pendingSend || paymentOrderId)) void checkRecovery(); }, []);
  const retrySend = async () => {
    if (!pendingSend || checkingRecovery) return;
    setCheckingRecovery(true); setError('');
    try {
      const order = await api<Order>(pendingSend.kind === 'create' ? '/orders' : `/orders/${pendingSend.orderId}/lines`, { body: JSON.parse(pendingSend.body), requestId: pendingSend.id });
      received(order);
    } catch (problem) { setError(problem instanceof Error ? problem.message : String(problem)); }
    finally { setCheckingRecovery(false); }
  };
  const dismissRecovery = () => { persist({ paymentOrderId: null }); setPaymentOrderId(null); setRecoveredOrder(null); setRecovered(false); };

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
  const place = async (reportSuccess = false, tabName?: string): Promise<Order | null> => {
    if (placing.current || !cart.length) return null;
    setUndo(null);
    placing.current = true; setSending(true);
    setError('');
    try {
      const lines = cart.map((l) => ({ itemId: l.item.id, qty: l.qty, modifierOptionIds: l.optionIds, note: l.note, priceCents: l.priceCents }));
      // T29: with a tab selected the cart becomes a new round on that order; otherwise it is a new order.
      const body = tab ? { lines } : { lines, note: note || undefined, tabName: (tabName ?? pickupName).trim() || undefined };
      const signature = JSON.stringify([tab?.id ?? '', body]);
      if (request.current.signature !== signature) request.current = { signature, id: newRequestId() };
      const pending: PendingSend = { id: request.current.id, kind: tab ? 'add' : 'create', orderId: tab?.id, body: JSON.stringify(body), intent: reportSuccess ? 'send' : 'pay' };
      persist({ pendingSend: pending }); setPendingSend(pending);
      const order = await api<Order>(tab ? `/orders/${tab.id}/lines` : '/orders', {
        body, requestId: request.current.id,
      });
      request.current = { signature: '', id: newRequestId() };
      const paymentId = !reportSuccess && !tab ? order.id : null;
      persist({ cart: [], note: '', pickupName: '', tab: null, pendingSend: null, paymentOrderId: paymentId });
      setPendingSend(null); setPaymentOrderId(paymentId); setRecovered(false);
      setCart([]); setNote(''); setPickupName('');
      if (tab) {
        const message = `${tabUi.addedTo} ${tab.label}`;
        toast(message);
        setTab(null);
      } else if (reportSuccess) {
        const message = order.serviceMode === 'counter' ? (lang === 'nl' ? 'Bestelling opgeslagen' : 'Order saved') : c.sent;
        toast(`${message} · #${order.ticketNumber}`);
      }
      return order;
    } catch (e) { setError(e instanceof ApiError ? e.message : String(e)); setNaming(false); setPaying(null); return null; }
    finally { placing.current = false; setSending(false); }
  };

  if (!menu) return <div className="pos pos-loading" role="status"><Icon name="menu" size={36} /><p>{error || c.loading}</p></div>;
  const search = query.trim().toLocaleLowerCase();
  const items = menu.items.filter((i) => search
    ? `${i.name} ${i.description ?? ''} ${menu.categories.find((category) => category.id === i.categoryId)?.name ?? ''}`.toLocaleLowerCase().includes(search)
    : !cat || i.categoryId === cat);

  return (
    <div className="pos">
      {storageProblem && <p className="notice" role="alert">{lang === 'nl' ? 'Deze browser kan de bestelling niet op dit apparaat bewaren. Sluit de app niet tijdens een bestelling.' : 'This browser cannot save the cart on this device. Keep the app open while taking an order.'}</p>}
      {recovered && !pendingSend && !paymentOrderId && <p className="notice draft-restored" role="status">{lang === 'nl' ? 'Uw onvoltooide bestelling is hersteld. Controleer de huidige prijzen voordat u verstuurt.' : 'Your unfinished cart was restored. Check current prices before sending.'}<button onClick={() => setRecovered(false)}>{lang === 'nl' ? 'Begrepen' : 'Got it'}</button></p>}
      {pendingSend && !transmitting && <section className="draft-recovery notice" role="status"><strong>{lang === 'nl' ? 'Versturen was onderbroken' : 'Sending was interrupted'}</strong><p>{lang === 'nl' ? 'De bestelling kan al zijn ontvangen. Controleer of probeer dezelfde verzending opnieuw; de kassa gebruikt dezelfde sleutel.' : 'The order may already have arrived. Check its status or retry the same send; the till keeps the original request key.'}</p><div className="actions"><button className="draft-check" disabled={checkingRecovery} onClick={() => void checkRecovery()}>{lang === 'nl' ? 'Bevestiging controleren' : 'Check confirmation'}</button><button className="primary draft-retry" disabled={checkingRecovery} onClick={() => void retrySend()}>{lang === 'nl' ? 'Dezelfde verzending herhalen' : 'Retry original send'}</button><button disabled={checkingRecovery} onClick={() => setDiscarding(true)}>{lang === 'nl' ? 'Concept wegdoen' : 'Discard draft'}</button></div></section>}
      {recoveredOrder && <section className="draft-recovery notice" role="status"><strong>{lang === 'nl' ? 'Bestelling teruggevonden' : 'Order recovered'} · #{recoveredOrder.ticketNumber}</strong><p>{recoveredOrder.paid ? (lang === 'nl' ? 'Al betaald. Breng niets opnieuw in rekening.' : 'Already paid. Do not charge again.') : (lang === 'nl' ? 'De bestelling is ontvangen, maar een betaling is niet bevestigd. Controleer de betaalautomaat voordat u een betaling vastlegt.' : 'The order was received, but payment is not confirmed. Check the card terminal before recording a payment.')}</p><div className="actions">{!recoveredOrder.paid && recoveredOrder.status !== 'void' && <button className="primary draft-resume-pay" onClick={() => setPaying({ order: recoveredOrder })}>{lang === 'nl' ? 'Betaling afronden' : 'Continue payment'}</button>}<button onClick={() => { setView('orders'); dismissRecovery(); }}>{lang === 'nl' ? 'Bestellingen bekijken' : 'View Orders'}</button><button className="draft-reviewed" onClick={dismissRecovery}>{lang === 'nl' ? 'Bestelling gecontroleerd' : 'Order checked'}</button></div></section>}
      {discarding && <Sheet titleId="discard-draft" kind="draft-discard" onCancel={() => setDiscarding(false)}><h2 id="discard-draft">{lang === 'nl' ? 'Concept wegdoen?' : 'Discard this draft?'}</h2><p>{lang === 'nl' ? 'Controleer eerst Bestellingen: een eerdere verzending kan al zijn ontvangen. Dit verwijdert alleen het concept op dit apparaat, nooit een verkoop op de server.' : 'Check Orders first: an earlier send may already have arrived. This clears only this device’s draft, never a server sale.'}</p><div className="actions"><button onClick={() => setDiscarding(false)}>{lang === 'nl' ? 'Bewaren' : 'Keep draft'}</button><button className="primary" onClick={() => { persist(emptyDraft()); setCart([]); setNote(''); setPickupName(''); setTab(null); setPendingSend(null); setPaymentOrderId(null); setRecovered(false); setDiscarding(false); }}>{lang === 'nl' ? 'Concept wegdoen' : 'Discard draft'}</button></div></Sheet>}
      {!online && <div className="banner"><Icon name="wifi-off" />{t('offline')}</div>}
      <div className="pos-toolbar"><div className="tabs">
        <button aria-pressed={view === 'order'} className={view === 'order' ? 'on' : ''} onClick={() => setView('order')}><Icon name="plus" />{t('nav.order')}</button>
        <button aria-pressed={view === 'tabs'} className={view === 'tabs' ? 'on' : ''} onClick={() => setView('tabs')}><Icon name="tabs" />{tabUi.tabs} <span className="pos-count">{openTabs}</span></button>
        <button aria-pressed={view === 'orders'} className={view === 'orders' ? 'on' : ''} onClick={() => setView('orders')}><Icon name="receipt" />{t('nav.orders')} <span className="pos-count">{orders.filter((o) => o.status !== 'void' && (!o.paid || (o.serviceMode !== 'counter' && o.status !== 'collected'))).length}</span></button>
        <button aria-pressed={view === 'stock'} className={view === 'stock' ? 'on pos-stock-tab' : 'pos-stock-tab'} onClick={() => setView('stock')}><Icon name="box" />{lang === 'nl' ? 'Voorraad' : 'Stock'}</button>
      </div>
      {view === 'order' && <><button className={`pos-search-toggle${searchOpen ? ' on' : ''}`} aria-label={ui.search} aria-expanded={searchOpen} onClick={() => { setSearchOpen(!searchOpen); if (!searchOpen) requestAnimationFrame(() => searchInput.current?.focus()); else setQuery(''); }}><Icon name="search" /></button><div className={`pos-search${searchOpen ? ' is-open' : ''}`}><Icon name="search" /><input ref={searchInput} type="search" aria-label={ui.search} placeholder={ui.search} value={query} onChange={(e) => { setQuery(e.target.value); setCat(''); }} />{query && <button aria-label={ui.clearSearch} onClick={() => setQuery('')}><Icon name="close" /></button>}</div><div className="pos-toolbar-service"><ServiceModeControl mode={serviceMode} disabled={sending || !!paying} /></div></>}
      </div>

      {view === 'order' ? (
        <div className="pos-grid">
          <section className="menu">
            <div className="cats">
              <button aria-pressed={!cat} className={!cat ? 'on pos-all' : 'pos-all'} onClick={() => { setCat(''); setQuery(''); }}><Icon name="grid" />{ui.all}</button>
              {menu.categories.map((c) => <button key={c.id} style={catStyle(menu.categories, c.id)} aria-pressed={c.id === cat} className={c.id === cat ? 'on' : ''} onClick={() => { setCat(c.id); setQuery(''); }}><i className="pos-cat-dot" />{c.name}</button>)}
            </div>
            <div className={`pos-menu-caption${search ? ' is-searching' : ''}`}><span className="pos-caption-service"><ServiceModeControl mode={serviceMode} disabled={sending || !!paying} /></span><span role="status">{items.length} {search ? ui.found : c.items}</span></div>
            <div className="items">
              {items.map((i) => (
                <button key={i.id} className="item" style={catStyle(menu.categories, i.categoryId)} disabled={!i.available || sending || !!paying} onClick={() => tap(i)}>
                  <span className="pos-item-name">{i.name}</span>
                  {cart.some((l) => l.item.id === i.id) && <span className="pos-item-count pos-count">{cart.filter((l) => l.item.id === i.id).reduce((sum, l) => sum + l.qty, 0)}</span>}
                  {i.description && <small className="pos-item-description">{i.description}</small>}
                  {!!i.tags?.length && <small className="pos-item-tags">{menuTagText(i.tags, lang)}</small>}
                  <span className="pos-item-footer"><b>{!i.available ? t('soldout') : i.openPrice ? t('pos.market') : money(i.priceCents)}</b><span className="pos-item-add"><Icon name={i.modifierGroups.length || i.openPrice ? 'more' : 'plus'} /></span></span>
                </button>
              ))}
              {!items.length && <div className="pos-no-results"><Icon name="search" size={32} /><h3>{search ? ui.noResults : c.noItems}</h3><p>{ui.trySearch}</p><button onClick={() => { setQuery(''); setCat(''); }}>{ui.all}<Icon name="arrow-right" /></button></div>}
            </div>
          </section>

          <div className="pos-side">
          <ReadyStrip orders={orders} online={online} onPay={(order) => setPaying({ order })} />
          <aside ref={cartPanel} className="cart">
            <header className="pos-cart-heading"><span><Icon name="cart" /><h2>{c.current}</h2><span className="pos-count">{cart.reduce((sum, l) => sum + l.qty, 0)}</span></span><button className="pos-clear-order" aria-label={ui.clear} disabled={!cart.length || sending || !!paying} onClick={() => { setUndo({ cart, note, pickupName }); setCart([]); setNote(''); setPickupName(''); }}><Icon name="trash" /></button></header>
            {tab && <div className="pos-tab-banner" role="status"><Icon name="staff" /><span>{tabUi.addingTo} <b>{tab.label}</b></span><button aria-label={tabUi.stop} disabled={sending} onClick={() => setTab(null)}><Icon name="close" /></button></div>}
            {undo && <div className="pos-undo" role="status"><span>{ui.removed}</span><button disabled={sending || !!paying} onClick={() => { setCart(undo.cart); setNote(undo.note); if (undo.pickupName !== undefined) setPickupName(undo.pickupName); setUndo(null); }}><Icon name="undo" />{ui.undo}</button></div>}
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
            {cart.length > 0 && !tab && <div className="pos-cart-fields">
              {serviceMode !== 'counter' && <label className="pos-note">{lang === 'nl' ? 'Naam voor afhalen' : 'Name for pickup'}<input className="pos-pickup-name" disabled={sending || !!paying} maxLength={40} autoCapitalize="words" autoComplete="off" placeholder={lang === 'nl' ? 'bijv. Mike' : 'e.g. Mike'} value={pickupName} onChange={(e) => { setPickupName(e.target.value); setUndo(null); }} /></label>}
              <label className="pos-note">{t('cart.note')}<input disabled={sending || !!paying} placeholder={t('cart.note')} value={note} onChange={(e) => { setNote(e.target.value); setUndo(null); }} /></label>
            </div>}
            {error && <div className="error" role="alert">{error}</div>}
            <div className="total">
              <span>{t('cart.total')} {menu.taxCategories.some((x) => x.kind === 'taxed') && <small className="muted">{t('cart.abb')}{totals ? ` ${money(totals.taxCents)}` : ''}</small>}</span>
              <b>{money(total)}</b>
            </div>
            <div className={`actions${tab ? ' pos-actions-tab' : ''}`}>
              {tab ? (
                <button className="primary pos-pay" disabled={!cart.length || sending} onClick={() => void place(true)}><Icon name="plus" /><span className="pos-add-label">{sending ? c.sending : `${tabUi.addTo} ${tab.label}`}</span><span className="pos-pay-amount">{money(total)}</span></button>
              ) : (<>
                <button className="pos-later-btn" disabled={!cart.length || sending || !!paying} onClick={() => setNaming(true)}><Icon name={serviceMode === 'counter' ? 'receipt' : 'send'} />{sending ? c.sending : tabUi.payLater}</button>
                <button className="primary pos-pay" disabled={!cart.length || sending || !!paying} onClick={() => setPaying({ cartTotal: total })}><Icon name="cash" />{t('cart.payNow')}<span className="pos-pay-amount">{money(total)}</span></button>
              </>)}
            </div>
          </aside>
          </div>
        </div>
      ) : view === 'stock' ? (
        <StockView orders={orders} menu={menu} />
      ) : view === 'tabs' ? (
        <TabList
          onAdd={(order) => { setTab({ id: order.id, label: tabLabel(order, lang) }); setView('order'); }}
          onPay={(order) => setPaying({ order })}
        />
      ) : (
        <OrdersList orders={[...orders].reverse()} menu={menu} onPay={(order) => setPaying({ order })} />
      )}

      {view === 'order' && cart.length > 0 && <div className="pos-mobile-bar">
        <button className="ghost" onClick={() => cartPanel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><Icon name="cart" /><span>{c.current}<b>{money(total)}</b></span><span className="pos-count">{cart.reduce((sum, l) => sum + l.qty, 0)}</span></button>
        {tab
          ? <button className="primary" disabled={sending} onClick={() => void place(true)}><Icon name="plus" /><span className="pos-add-label">{tabUi.addTo} {tab.label}</span></button>
          : <button className="primary" disabled={sending || !!paying} onClick={() => setPaying({ cartTotal: total })}><Icon name="cash" />{t('orders.pay')}</button>}
      </div>}
      {naming && <PayLaterSheet busy={sending} initialName={pickupName} onCancel={() => setNaming(false)} onSend={async (name) => { if (await place(true, name)) setNaming(false); }} />}

      {picking && <ModifierSheet item={picking} onCancel={() => setPicking(null)} onAdd={(ids, price, qty) => { add(picking, ids, price, qty); setPicking(null); }} />}
      {paying && (
        <PaySheet
          total={'order' in paying ? paying.order.totalCents : paying.cartTotal}
          onCancel={() => { setPaying(null); if (paymentOrderId) void checkRecovery(); }}
          onPay={async (body) => {
            // The amount on the sheet is what the cashier agreed with the guest (and typed into the card terminal).
            const shown = 'order' in paying ? paying.order.totalCents : paying.cartTotal;
            const order = 'order' in paying ? paying.order : await place();
            if (!order) throw new Error(t('pay.failed'));
            // Keep the created order for a payment retry; never create the cart twice.
            setPaying({ order });
            persist({ paymentOrderId: order.id }); setPaymentOrderId(order.id);
            // With a receipt printer the server prints on payment. Without one nothing prints by itself:
            // a print dialog nobody asked for blocks the till. The paid screen has a Receipt button.
            try {
              const paid = await api<Order>(`/orders/${order.id}/pay`, { body: { ...body, expectedTotalCents: shown }, requestId: `pay-${order.id}` });
              persist({ paymentOrderId: null }); setPaymentOrderId(null); setRecoveredOrder(null);
              return paid;
            } catch (e) {
              // 409: the order is no longer what this sheet shows (a round was added on another screen, or it was
              // paid there). Show it as it is now; nothing was recorded, and the cashier confirms the new amount.
              if (e instanceof ApiError && e.status === 409) {
                const current = await api<Order>(`/orders/${order.id}`).catch(() => null);
                if (current) setPaying({ order: current });
              }
              throw e;
            }
          }}
        />
      )}
    </div>
  );
}

/** "Pay later": sends the order to the kitchen unpaid. A name turns it into a tab the guest can add to. */
function PayLaterSheet({ busy, initialName, onSend, onCancel }: { busy: boolean; initialName: string; onSend: (tabName: string) => Promise<void>; onCancel: () => void }) {
  const { lang } = useLang();
  const [name, setName] = useState(initialName);
  const ui = lang === 'nl'
    ? { eyebrow: 'Naar de keuken, betalen kan straks', title: 'Later betalen', label: 'Naam voor de rekening (optioneel)', placeholder: 'bijv. Mike', hint: 'Met een naam vindt u de rekening snel terug en kan de gast later bijbestellen.', cancel: 'Annuleren', send: 'Naar de keuken sturen', open: 'Rekening openen voor', sending: 'Versturen…', close: 'Sluiten' }
    : { eyebrow: 'To the kitchen now, payment later', title: 'Pay later', label: 'Name for the tab (optional)', placeholder: 'e.g. Mike', hint: 'A name makes the tab easy to find, and the guest can order more on it later.', cancel: 'Cancel', send: 'Send to the kitchen', open: 'Open tab for', sending: 'Sending…', close: 'Close' };
  const trimmed = name.trim();
  return (
    <Sheet onCancel={onCancel} busy={busy} titleId="pos-later-title" kind="pos-later">
      <header className="pos-sheet-heading"><div><p className="pos-eyebrow">{ui.eyebrow}</p><h2 id="pos-later-title">{ui.title}</h2></div><button className="ghost pos-close" aria-label={ui.close} disabled={busy} onClick={onCancel}><Icon name="close" /></button></header>
      <label>{ui.label}
        <input value={name} maxLength={40} disabled={busy} placeholder={ui.placeholder} autoCapitalize="words" autoComplete="off" enterKeyHint="send"
          onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void onSend(trimmed); }} />
      </label>
      <p className="pos-sheet-hint">{ui.hint}</p>
      <div className="actions">
        <button className="ghost" disabled={busy} onClick={onCancel}>{ui.cancel}</button>
        <button className="primary" disabled={busy} onClick={() => void onSend(trimmed)}><Icon name={busy ? 'clock' : 'send'} />{busy ? ui.sending : trimmed ? `${ui.open} ${trimmed}` : ui.send}</button>
      </div>
    </Sheet>
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
        {!!item.tags?.length && <small className="pos-item-tags">{menuTagText(item.tags, lang)}</small>}
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
  const receiptPrinted = useRef(false);
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
      <div className="actions"><button onClick={() => { const original = !receiptPrinted.current; receiptPrinted.current = true; printReceipt(done, { original }).catch((e) => toast(e instanceof ApiError ? e.message : String(e), 'error')); }}><Icon name="printer" />{t('orders.reprint')}</button><button className="primary" autoFocus onClick={onCancel}>{t('pay.next')}<Icon name="arrow-right" /></button></div>
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

/**
 * Fixes a paid order without voiding it by hand: change quantities, take items off, add items, switch the
 * payment method. The server keeps the original on record as void and makes a replacement sale with its own
 * receipt number; this sheet only says what to give back or collect.
 */
export function CorrectSheet({ order, menu, onDone, onCancel }: { order: Order; menu: Menu; onDone: () => void; onCancel: () => void }) {
  const { t, lang } = useLang();
  const c = copy[lang];
  const ui = lang === 'nl' ? {
    eyebrow: 'Bon', title: 'Bestelling corrigeren', addItem: 'Iets toevoegen', search: 'Zoek op het menu', added: 'Toegevoegd', was: 'Was', now: 'Wordt',
    reason: 'Wat ging er mis?', reasons: ['Verkeerd artikel', 'Verkeerd aantal', 'Verkeerde betaalwijze'], save: 'Correctie opslaan', done: 'Gecorrigeerd',
    same: 'Het totaal blijft gelijk.', moved: (m: string) => `De betaalwijze wordt ${m}. Controleer de werkelijke contante en pinbetalingen voordat u geld teruggeeft of bijvraagt.`,
    back: (a: string, card: boolean) => (card ? `Stort ${a} terug op het pinapparaat.` : `Geef ${a} terug uit de lade.`),
    more: (a: string, card: boolean) => (card ? `Reken ${a} extra af op het pinapparaat.` : `Vraag ${a} extra.`),
    keeps: 'De eerste bon blijft bewaard als geannuleerd. De gecorrigeerde verkoop krijgt een nieuw bonnummer.', empty: 'Er moet minstens één artikel overblijven. Annuleer de bestelling als alles weg moet.',
    cash: 'contant', card: 'pin',
  } : {
    eyebrow: 'Receipt', title: 'Correct order', addItem: 'Add something', search: 'Search the menu', added: 'Added', was: 'Was', now: 'Becomes',
    reason: 'What went wrong?', reasons: ['Wrong item', 'Wrong quantity', 'Wrong payment method'], save: 'Save correction', done: 'Corrected',
    same: 'The total stays the same.', moved: (m: string) => `Payment method becomes ${m}. Verify actual cash and card transactions before making a refund or extra charge.`,
    back: (a: string, card: boolean) => (card ? `Refund ${a} on the card machine.` : `Give ${a} back from the drawer.`),
    more: (a: string, card: boolean) => (card ? `Charge ${a} more on the card machine.` : `Collect ${a} more.`),
    keeps: 'The first receipt stays on record as void. The corrected sale gets a new receipt number.', empty: 'At least one item has to stay. Void the order if everything has to go.',
    cash: 'cash', card: 'card',
  };
  const paidBy = order.payments.at(-1)?.method ?? 'cash';
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(order.lines.map((l) => [l.id, l.qty])));
  const [added, setAdded] = useState<CartLine[]>([]);
  const [method, setMethod] = useState<'cash' | 'card'>(paidBy);
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState<MenuItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // One key for this correction: a second tap or a retry after a lost reply cannot correct twice.
  const request = useRef(newRequestId());
  const owner = getSession()?.staff.role === 'owner';
  const count = (id: string) => qty[id] ?? 0;
  const kept = order.lines.filter((l) => count(l.id) > 0);
  const total = order.lines.reduce((sum, l) => sum + l.unitPriceCents * count(l.id), 0) + added.reduce((sum, l) => sum + lineUnit(l) * l.qty, 0);
  const diff = total - order.totalCents;
  const changed = added.length > 0 || method !== paidBy || order.lines.some((l) => count(l.id) !== l.qty);
  const nothingLeft = kept.length === 0 && added.length === 0;
  const search = query.trim().toLocaleLowerCase();
  const found = search ? menu.items.filter((i) => i.available && i.name.toLocaleLowerCase().includes(search)).slice(0, 6) : [];
  const addItem = (item: MenuItem, optionIds: string[] = [], priceCents?: number, n = 1) => {
    haptic();
    setAdded((list) => [...list, { key: `${item.id}|${Date.now()}|${list.length}`, item, qty: n, optionIds, priceCents }]);
    setQuery('');
  };
  const money$ = method !== paidBy ? ui.moved(method === 'card' ? ui.card : ui.cash) : diff === 0 ? ui.same
    : diff < 0 ? ui.back(money(-diff), method === 'card') : ui.more(money(diff), method === 'card');
  const save = async () => {
    if (busy) return;
    setBusy(true); setErr('');
    try {
      const result = await api<{ order: Order }>(`/orders/${order.id}/correct`, { requestId: request.current, body: {
        keep: kept.map((l) => ({ lineId: l.id, qty: count(l.id) })),
        add: added.map((l) => ({ itemId: l.item.id, qty: l.qty, modifierOptionIds: l.optionIds, priceCents: l.priceCents })),
        method, reason: reason.trim(), managerPin: pin || undefined, expectedTotalCents: total,
      } });
      toast(`${ui.done} · ${ui.eyebrow.toLowerCase()} #${result.order.receiptNumber}`);
      onDone();
    } catch (e) { setErr(e instanceof ApiError ? e.message : String(e)); setBusy(false); }
  };
  return <>
    <Sheet onCancel={onCancel} busy={busy} titleId="pos-correct-title" kind="pos-correct">
      <header className="pos-sheet-heading"><div><p className="pos-eyebrow">{ui.eyebrow} #{order.receiptNumber}</p><h2 id="pos-correct-title">{ui.title} #{order.ticketNumber}</h2></div><button className="ghost pos-close" aria-label={c.close} disabled={busy} onClick={onCancel}><Icon name="close" /></button></header>
      <ul className="pos-correct-lines">
        {order.lines.map((l) => (
          <li key={l.id} className={count(l.id) === 0 ? 'pos-correct-removed' : ''}>
            <div className="grow"><div className="pos-line-name">{l.name}</div>{l.modifiers.length > 0 && <small className="muted">{l.modifiers.map((m) => m.name).join(', ')}</small>}</div>
            <Stepper value={count(l.id)} onChange={(n) => setQty({ ...qty, [l.id]: n })} min={0} />
            <b className="amt">{money(l.unitPriceCents * count(l.id))}</b>
          </li>
        ))}
        {added.map((l) => (
          <li key={l.key} className="pos-correct-added">
            <div className="grow"><div className="pos-line-name">{l.item.name}</div><small className="muted">{[ui.added, ...l.item.modifierGroups.flatMap((g) => g.options).filter((o) => l.optionIds.includes(o.id)).map((m) => m.name)].join(' · ')}</small></div>
            <Stepper value={l.qty} onChange={(n) => setAdded((list) => (n === 0 ? list.filter((x) => x.key !== l.key) : list.map((x) => (x.key === l.key ? { ...x, qty: n } : x))))} min={0} />
            <b className="amt">{money(lineUnit(l) * l.qty)}</b>
          </li>
        ))}
      </ul>
      <label>{ui.addItem}<input type="search" value={query} placeholder={ui.search} disabled={busy} onChange={(e) => setQuery(e.target.value)} /></label>
      {found.length > 0 && <div className="chips pos-correct-found">{found.map((i) => <button key={i.id} disabled={busy} onClick={() => (i.modifierGroups.length || i.openPrice ? setPicking(i) : addItem(i))}><Icon name="plus" />{i.name} · {i.openPrice ? t('pos.market') : money(i.priceCents)}</button>)}</div>}
      <div className="chips pos-payment-method">
        <button disabled={busy} aria-pressed={method === 'cash'} className={method === 'cash' ? 'on' : ''} onClick={() => setMethod('cash')}><Icon name="cash" />{t('pay.cash')}</button>
        <button disabled={busy} aria-pressed={method === 'card'} className={method === 'card' ? 'on' : ''} onClick={() => setMethod('card')}><Icon name="card" />{t('pay.card')}</button>
      </div>
      <div className="pos-correct-sum"><div><span>{ui.was}</span><b>{money(order.totalCents)}</b></div><div><span>{ui.now}</span><b>{money(total)}</b></div></div>
      <p className="notice pos-correct-money" role="status">{nothingLeft ? ui.empty : money$}</p>
      <label>{ui.reason}<input value={reason} maxLength={200} disabled={busy} onChange={(e) => setReason(e.target.value)} /></label>
      <div className="chips">{ui.reasons.map((r) => <button key={r} disabled={busy} aria-pressed={reason === r} className={reason === r ? 'on' : ''} onClick={() => setReason(r)}>{r}</button>)}</div>
      {!owner && <label>{t('orders.pin')}<input disabled={busy} inputMode="numeric" type="password" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} /></label>}
      {err && <div className="error" role="alert">{err}</div>}
      <p className="pos-sheet-hint">{ui.keeps}</p>
      <div className="actions">
        <button className="ghost" disabled={busy} onClick={onCancel}>{t('pay.cancel')}</button>
        <button className="primary" disabled={busy || !changed || nothingLeft || reason.trim().length < 2} onClick={() => void save()}><Icon name={busy ? 'clock' : 'check'} />{busy ? c.paying : ui.save}</button>
      </div>
    </Sheet>
    {picking && <ModifierSheet item={picking} onCancel={() => setPicking(null)} onAdd={(ids, price, n) => { addItem(picking, ids, price, n); setPicking(null); }} />}
  </>;
}

function OrdersList({ orders, menu, onPay }: { orders: Order[]; menu: Menu; onPay: (o: Order) => void }) {
  const [correcting, setCorrecting] = useState<Order | null>(null);
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
              <div>{o.tabName && <b className="pos-order-tab">{o.tabName} · </b>}{o.lines.map((l) => `${l.qty}× ${l.name}`).join(', ')}</div>
              <div className="pos-order-status"><span className={`pos-status ${o.status}`}><Icon name={o.status === 'ready' || o.status === 'collected' ? 'check' : o.status === 'void' ? 'close' : 'clock'} size={16} />{o.serviceMode === 'counter' && o.status !== 'void' ? (lang === 'nl' ? 'Balieservice' : 'Counter service') : t(`st.${o.status}` as 'st.sent')}</span><span className={`pos-status ${o.paid ? 'paid' : 'unpaid'}`}>{o.paid ? t('orders.paid') : o.status === 'void' ? t('orders.void') : t('orders.unpaid')}</span>{o.correctedBy && <span className="pos-status">{lang === 'nl' ? 'Gecorrigeerd: bon' : 'Corrected: receipt'} #{o.correctedBy.receiptNumber}</span>}{o.corrects && <span className="pos-status">{lang === 'nl' ? 'Vervangt bon' : 'Replaces receipt'} #{o.corrects.receiptNumber}</span>}</div>
            </div>
            <b>{money(o.totalCents)}</b>
            <div className="row-actions">
              {!o.paid && o.status !== 'void' && <button className="primary" onClick={() => onPay(o)}><Icon name="cash" />{t('orders.pay')}</button>}
              {o.paid && <button onClick={() => void printReceipt(o)}><Icon name="printer" />{t('orders.reprint')}</button>}
              {o.paid && o.status !== 'void' && <button className="pos-correct-btn" onClick={() => setCorrecting(o)}><Icon name="edit" />{lang === 'nl' ? 'Corrigeren' : 'Correct'}</button>}
              {o.status !== 'void' && <button className="ghost" onClick={() => setVoiding(o)}><Icon name="close" />{t('orders.voidBtn')}</button>}
            </div>
          </li>
        ))}
      </ul>
      {correcting && <CorrectSheet order={correcting} menu={menu} onCancel={() => setCorrecting(null)} onDone={() => setCorrecting(null)} />}
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
