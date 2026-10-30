import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent, type RefObject } from 'react';
import { kitchenLines, type Order } from '@cactus/shared';
import { api } from '../../lib/api';
import { beep, useNow, useOrders } from '../../lib/live';
import { CLEAN_SCREEN_EVENT, SCREEN_TOOLS_EVENT, useDevicePrefs } from '../../lib/display';
import { useLang } from '../../i18n';
import { Icon, type IconName } from '../../ui/Icon';
import { haptic } from '../../ui/touch';
import './kitchen.css';

const copy = {
  en: {
    subtitle: 'Every ticket, at a glance', live: 'Live updates', reconnect: 'Reconnecting',
    active: 'active tickets', emptyHint: 'New orders will appear here automatically.',
    sentEmpty: 'No new tickets', preparingEmpty: 'Nothing cooking yet', readyEmpty: 'Nothing waiting for pickup',
    start: 'Start preparing', ready: 'Mark ready', recall: 'Recall', collected: 'Collected',
    saving: 'Updating…', failed: 'Could not update this ticket. Check its status before trying again.',
    offline: 'Showing the last received tickets. Actions resume when the connection returns.',
    elapsed: 'minutes since ordered',
    undo: 'Undo', undoFailed: 'Not undone, try again', show: 'Show tickets',
    added: 'Added', round: 'Round',
    wipe: 'Wipe screen', wipeHint: 'Pauses touch for 20 seconds so you can wipe the screen',
    quickReady: 'Ready', toMake: 'to make', nothingToMake: 'Nothing to make right now', readyLabel: 'Ready', readyHint: 'tap when picked up',
    tools: 'Screen tools',
  },
  nl: {
    subtitle: 'Elke bon in één oogopslag', live: 'Live updates', reconnect: 'Verbinding herstellen',
    active: 'actieve bonnen', emptyHint: 'Nieuwe bestellingen verschijnen hier automatisch.',
    sentEmpty: 'Geen nieuwe bonnen', preparingEmpty: 'Nog niets in bereiding', readyEmpty: 'Niets klaar om af te halen',
    start: 'Start bereiding', ready: 'Markeer klaar', recall: 'Terug', collected: 'Opgehaald',
    saving: 'Bijwerken…', failed: 'Deze bon kon niet worden bijgewerkt. Controleer de status voordat u opnieuw probeert.',
    offline: 'De laatst ontvangen bonnen blijven zichtbaar. Acties hervatten zodra de verbinding terug is.',
    elapsed: 'minuten sinds besteld',
    undo: 'Ongedaan maken', undoFailed: 'Niet gelukt, probeer opnieuw', show: 'Bonnen tonen',
    added: 'Toegevoegd', round: 'Ronde',
    wipe: 'Scherm afnemen', wipeHint: 'Pauzeert aanrakingen 20 seconden zodat je het scherm kunt afnemen',
    quickReady: 'Klaar', toMake: 'te maken', nothingToMake: 'Nu niets te maken', readyLabel: 'Klaar', readyHint: 'tik als opgehaald',
    tools: 'Schermopties',
  },
};

/** The statuses the status API accepts. */
type Step = 'preparing' | 'ready' | 'collected';
/** The three columns of the board. */
type Column = 'sent' | 'preparing' | 'ready';
/** The latest move that can be taken back: a ticket marked ready (back to preparing) or collected (back to ready). */
interface Undo { key: number; id: string; ticketNumber: number; to: 'ready' | 'collected'; failed: boolean }

/** How long the Undo control stays up after a ticket is marked ready or collected. */
const UNDO_MS = 8000;
/** After tickets move, ticket taps are ignored this long, so a double tap cannot hit the ticket that slid under the finger. */
const SETTLE_MS = 350;
/** A tap is short and stays put. A thumb resting on the screen to steady the tablet, or a greasy finger that
    smears across a ticket, is held longer or travels further, and does not move the ticket on. */
const TAP_MAX_MS = 700;
const TAP_MAX_MOVE = 16;

/** Follows one press on a ticket and says whether it was a deliberate tap. Keyboard presses always are. */
function useDeliberateTap() {
  const press = useRef<{ x: number; y: number; at: number; far: boolean } | null>(null);
  const handlers = {
    onPointerDown: (e: PointerEvent) => { press.current = { x: e.clientX, y: e.clientY, at: e.timeStamp, far: false }; },
    onPointerMove: (e: PointerEvent) => {
      const p = press.current;
      if (p && !p.far && Math.hypot(e.clientX - p.x, e.clientY - p.y) > TAP_MAX_MOVE) p.far = true;
    },
    onPointerCancel: () => { press.current = null; },
  };
  const deliberate = (e: MouseEvent) => {
    const p = press.current;
    press.current = null;
    if (e.detail === 0) return true; // Enter or Space on a focused button
    return !!p && !p.far && e.timeStamp - p.at <= TAP_MAX_MS;
  };
  return { handlers, deliberate };
}

/** The shared icon set has no "undo" yet (see the UX07 kitchen handoff). */
function UndoIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  );
}

/** Moves one order to its next status, once at a time, and only while connected and the board stands still. */
function useStep(o: Order, online: boolean, settled: () => boolean, onMoved: (o: Order, to: Step) => void) {
  const [pending, setPending] = useState<Order['status'] | null>(null);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  // Keep actions locked until the live projection confirms a successful update.
  useEffect(() => { if (pending === o.status) setPending(null); }, [o.status, pending]);
  async function go(status: Step) {
    if (inFlight.current || pending || !online || !settled()) return;
    haptic(15);
    inFlight.current = true;
    setPending(status);
    setFailed(false);
    try { await api(`/orders/${o.id}/status`, { body: { status } }); onMoved(o, status); }
    catch { setFailed(true); setPending(null); }
    finally { inFlight.current = false; }
  }
  return { pending, failed, go, disabled: pending !== null || !online };
}

/** Ticket columns on the one-tap board: as many as fit at this width, so the board never shows an empty column. */
const QUICK_COL_MIN = 300;
const QUICK_GAP = 14;
function useColumnCount(grid: RefObject<HTMLDivElement | null>, active: boolean): number {
  const [count, setCount] = useState(1);
  useLayoutEffect(() => {
    const el = grid.current;
    if (!active || !el) return;
    const measure = () => setCount(Math.max(1, Math.floor((el.clientWidth + QUICK_GAP) / (QUICK_COL_MIN + QUICK_GAP))));
    measure();
    if (typeof ResizeObserver === 'undefined') { window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure); }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [grid, active]);
  return count;
}

/** "No tomato", "Geen ui": something to leave off. */
const isExclusion = (name: string) => /^(no|geen|without|zonder)\s/i.test(name);

/**
 * Splits a line's options the way a cook reads them: a free choice (which sauce, which drink) belongs with the
 * item's name; paid extras are what to add; "No ..." is what to leave off, in red, last.
 */
function splitOptions(mods: Order['lines'][number]['modifiers']) {
  const choices = mods.filter((m) => !isExclusion(m.name) && m.priceDeltaCents === 0);
  const extras = mods.filter((m) => !isExclusion(m.name) && m.priceDeltaCents !== 0);
  const without = mods.filter((m) => isExclusion(m.name));
  return { choices, extras, without };
}

/** When the kitchen started on this order; a tab that orders again starts a new clock for that round. */
const kitchenSince = (o: Order) => Date.parse(o.kitchenSince ?? o.createdAt);

/** One-tap kitchen: an order that is ready, shown only by its number (and the tab's name). A tap: picked up. */
function ReadyChip({ o, online, settled, onMoved }: {
  o: Order; online: boolean; settled: () => boolean; onMoved: (o: Order, to: Step) => void;
}) {
  const { t, lang } = useLang();
  const c = copy[lang];
  const step = useStep(o, online, settled, onMoved);
  const tap = useDeliberateTap();
  return (
    <button type="button" className="kitchen-ready-chip" disabled={step.disabled} aria-busy={step.pending !== null}
      aria-label={`${c.collected}: ${t('ticket')} ${o.ticketNumber}${o.tabName ? `, ${o.tabName}` : ''}`}
      {...tap.handlers} onClick={(e) => { if (tap.deliberate(e)) void step.go('collected'); }}>
      <b>#{o.ticketNumber}</b>
      {o.tabName && <span className="kitchen-ready-name">{o.tabName}</span>}
      {step.failed && <Icon name="warning" size={20} />}
    </button>
  );
}

function Ticket({ o, now, online, settled, onMoved, quick }: {
  o: Order; now: number; online: boolean; settled: () => boolean; onMoved: (o: Order, to: Step) => void; quick: boolean;
}) {
  const { t, lang } = useLang();
  const c = copy[lang];
  const { pending, failed, go: setStatus, disabled } = useStep(o, online, settled, onMoved);
  const tap = useDeliberateTap();
  // A tab that orders again is a new ticket for the kitchen: its clock starts when that round arrived.
  const since = kitchenSince(o);
  const mins = Math.max(0, Math.floor((now - since) / 60000));
  const late = mins >= 10 && o.status !== 'ready';
  const warm = mins >= 5 && !late && o.status !== 'ready';
  const fresh = o.status === 'sent' && now - since < 20_000;
  // Only what still has to be made. Earlier rounds of a tab were already handed over.
  const firstRound = o.kitchenRound ?? 1;
  const lines = kitchenLines(o);
  // New and preparing tickets have one obvious next step, so the whole ticket is the button: in the one-tap
  // kitchen that step is Ready, in three steps it is Start, then Ready.
  // Ready tickets are not: Collected takes the ticket off the board, so it keeps explicit buttons only.
  const forward: Step | null = o.status === 'sent' ? (quick ? 'ready' : 'preparing') : o.status === 'preparing' ? 'ready' : null;
  const press = (status: Step) => (e: MouseEvent) => { e.stopPropagation(); if (tap.deliberate(e)) void setStatus(status); };
  return (
    <article
      className={`ticket${late ? ' late' : warm ? ' warm' : ''}${fresh ? ' ticket-fresh' : ''}${o.status === 'ready' ? ' ticket-ready' : ''}${forward && !disabled ? ' ticket-tappable' : ''}`}
      aria-label={`${t('ticket')} ${o.ticketNumber}`} aria-description={o.paid ? t('orders.paid') : t('orders.unpaid')} aria-busy={pending !== null}
      {...tap.handlers} onClick={forward ? (e) => { if (tap.deliberate(e)) void setStatus(forward); } : undefined}>
      {/* The band says which order and how long it has waited; its colour turns amber, then red, as it waits. */}
      <header className="ticket-heading">
        <div className="ticket-number"><b>#{o.ticketNumber}</b></div>
        <div className="ticket-who">
          {o.tabName && <span className="ticket-tab">{o.tabName}</span>}
          {firstRound > 1 && <span className="ticket-round">{c.round} {firstRound}</span>}
        </div>
        <span className="ticket-age" aria-label={`${mins} ${c.elapsed}`}><Icon name="clock" size={20} />{mins} min</span>
      </header>
      {o.note && <p className="ticket-note"><Icon name="warning" size={22} /><span>{o.note}</span></p>}
      <ul className="ticket-lines">
        {lines.map((l) => {
          const { choices, extras, without } = splitOptions(l.modifiers);
          return (
            <li key={l.id} className={(l.round ?? 1) > firstRound ? 'ticket-line-added' : undefined}>
              <b className={`ticket-quantity${l.qty > 1 ? ' ticket-quantity-many' : ''}`}>{l.qty}×</b>
              <div className="ticket-item">
                <strong>{l.name}{choices.length > 0 && <span className="ticket-choice"> · {choices.map((m) => m.name).join(', ')}</span>}</strong>
                {(l.round ?? 1) > firstRound && <span className="ticket-added"><Icon name="plus" size={16} />{c.added}</span>}
                {extras.length > 0 && <div className="ticket-extras">{extras.map((m) => <span key={m.id}>+ {m.name}</span>)}</div>}
                {without.length > 0 && <div className="ticket-without">{without.map((m) => <span key={m.id}>{m.name}</span>)}</div>}
                {l.note && <div className="ticket-line-note">“{l.note}”</div>}
              </div>
            </li>
          );
        })}
      </ul>
      {failed && <p className="ticket-error" role="alert"><Icon name="warning" size={20} /><span>{c.failed}</span></p>}
      <footer className="ticket-actions">
        {quick && forward && <button type="button" className="ticket-primary ticket-quick" disabled={disabled} onClick={press('ready')}><Icon name="check" size={24} />{pending ? c.saving : c.quickReady}</button>}
        {!quick && o.status === 'sent' && <button type="button" className="ticket-primary" disabled={disabled} onClick={press('preparing')}><Icon name="kitchen" size={24} />{pending ? c.saving : c.start}</button>}
        {!quick && o.status === 'preparing' && <button type="button" className="ticket-primary" disabled={disabled} onClick={press('ready')}><Icon name="check" size={24} />{pending ? c.saving : c.ready}</button>}
        {o.status === 'ready' && <>
          <button type="button" className="ticket-recall" disabled={disabled} onClick={press('preparing')}><Icon name="refresh" size={24} /><span>{pending === 'preparing' ? c.saving : c.recall}</span></button>
          <button type="button" className="ticket-primary" disabled={disabled} onClick={press('collected')}><Icon name="pickup" size={24} />{pending === 'collected' ? c.saving : c.collected}</button>
        </>}
      </footer>
    </article>
  );
}

export function Kitchen() {
  const { t, lang } = useLang();
  const c = copy[lang];
  const { orders, online, newIds, clearNew } = useOrders('active');
  const now = useNow(5000);
  useEffect(() => { if (newIds.length) { beep(); clearNew(); } }, [newIds, clearNew]);
  // A tab that adds a round is new work too, even though its ticket already exists.
  const rounds = useRef(new Map<string, number>());
  useEffect(() => {
    let added = false;
    for (const o of orders) {
      const seen = rounds.current.get(o.id);
      if (seen !== undefined && (o.round ?? 1) > seen && (o.status === 'sent' || o.status === 'preparing')) added = true;
      rounds.current.set(o.id, o.round ?? 1);
    }
    if (added) beep();
  }, [orders]);
  const { kitchenFlow, kitchenLock } = useDevicePrefs();
  const quick = kitchenFlow === 'quick';
  const live = orders.filter((o) => o.status === 'sent' || o.status === 'preparing' || o.status === 'ready');
  // One-tap kitchen: everything still to cook in one grid, oldest first; what is ready shrinks to its number.
  const toMake = live.filter((o) => o.status !== 'ready').sort((a, b) => kitchenSince(a) - kitchenSince(b));
  const ready = live.filter((o) => o.status === 'ready').sort((a, b) => kitchenSince(a) - kitchenSince(b));
  // Tickets are dealt into the columns in turn (1 2 3 / 4 5 6), so the oldest still read first from the left and
  // each one sits right under the one above it, without the gap a row of uneven tickets would leave.
  const grid = useRef<HTMLDivElement>(null);
  const columnCount = useColumnCount(grid, quick);
  const columns = Array.from({ length: columnCount }, (_, i) => toMake.filter((_, j) => j % columnCount === i));
  const cols: { status: Column; title: string; icon: IconName; empty: string }[] = [
    { status: 'sent', title: t('st.sent'), icon: 'receipt', empty: c.sentEmpty },
    { status: 'preparing', title: t('st.preparing'), icon: 'kitchen', empty: c.preparingEmpty },
    { status: 'ready', title: t('st.ready'), icon: 'pickup', empty: c.readyEmpty },
  ];

  /* Narrow screens show one column at a time. It opens on the first column that has tickets and then stays
     where the cook left it, so a ticket moving on never swaps the list under a finger. An empty board starts over. */
  const root = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<Column | null>(null);
  const firstBusy = cols.find((col) => live.some((o) => o.status === col.status))?.status ?? 'sent';
  if (live.length === 0 && picked !== null) setPicked(null);
  else if (live.length > 0 && picked === null) setPicked(firstBusy);
  const shown = picked ?? firstBusy;
  const freshNew = live.some((o) => o.status === 'sent' && now - Date.parse(o.createdAt) < 20_000);
  function show(status: Column) {
    haptic(6);
    setPicked(status);
    root.current?.closest('main')?.scrollTo({ top: 0 });
  }

  /* Tickets slide when one moves on. Hold ticket taps for a moment after any such change. */
  const quietUntil = useRef(0);
  const layout = `${online}|${shown}|${live.map((o) => `${o.id}:${o.status}`).join(',')}`;
  useLayoutEffect(() => { quietUntil.current = Date.now() + SETTLE_MS; }, [layout]);
  const settled = useCallback(() => Date.now() >= quietUntil.current, []);

  /* Undo for the latest "ready" or "collected". It lives in the header, which always keeps room for it. */
  const [undo, setUndo] = useState<Undo | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const undoSeq = useRef(0);
  const undoInFlight = useRef(false);
  const moved = useCallback((o: Order, to: Step) => {
    // Start cannot be taken back (the API has no "sent"), and a recall is already a step back.
    if (to === 'preparing') { setUndo((u) => (u?.id === o.id ? null : u)); return; }
    setUndo({ key: ++undoSeq.current, id: o.id, ticketNumber: o.ticketNumber, to, failed: false });
  }, []);
  useEffect(() => {
    // The clock only runs while Undo can actually be used: not during its own request, not while offline.
    if (!undo || undoBusy || !online) return;
    const timer = window.setTimeout(() => setUndo((u) => (u?.key === undo.key ? null : u)), UNDO_MS);
    return () => clearTimeout(timer);
  }, [undo, undoBusy, online]);
  async function undoLast() {
    if (!undo || undoInFlight.current || !online) return;
    const target = undo;
    const retryKey = ++undoSeq.current;
    haptic(15);
    undoInFlight.current = true;
    setUndoBusy(true);
    try {
      await api(`/orders/${target.id}/status`, { body: { status: target.to === 'collected' ? 'ready' : 'preparing' } });
      setUndo((u) => (u?.key === target.key ? null : u));
    } catch {
      // Keep the control up for another round so the cook can try again.
      setUndo((u) => (u?.key === target.key ? { ...u, key: retryKey, failed: true } : u));
    } finally { undoInFlight.current = false; setUndoBusy(false); }
  }
  const undoneStatus = undo ? t(undo.to === 'ready' ? 'st.ready' : 'st.collected') : '';

  return (
    <div ref={root} className={`kitchen dark${live.length === 0 ? ' kitchen-idle' : ''}${quick ? ' kitchen-quick' : ''}`}>
      <div className={`kitchen-top${undo ? ' kitchen-top-undo' : ''}`}>
        <header className="kitchen-heading">
          {/* Locked to the kitchen there is no top bar, so Screen tools (and the way out of the lock) is here. */}
          {kitchenLock && <button type="button" className="kitchen-tools" aria-label={c.tools} aria-haspopup="dialog"
            onClick={() => window.dispatchEvent(new Event(SCREEN_TOOLS_EVENT))}><Icon name="sliders" size={26} /></button>}
          <h1 className="kitchen-title"><Icon name="kitchen" size={26} />{t('nav.kitchen')}</h1>
          <div className="kitchen-undo-slot" role="status">
            {undo && (
              <button key={undo.key} type="button" className={`kitchen-undo${undo.failed ? ' kitchen-undo-failed' : ''}`}
                style={{ '--undo-ms': `${UNDO_MS}ms` } as CSSProperties} disabled={undoBusy || !online}
                aria-label={`${undo.failed ? c.undoFailed : c.undo}: ${t('ticket')} ${undo.ticketNumber}, ${undoneStatus}`} onClick={() => void undoLast()}>
                <UndoIcon />
                <span className="kitchen-undo-label">{undoBusy ? c.saving : undo.failed ? c.undoFailed : c.undo}</span>
                <span className="kitchen-undo-what">{undo.failed ? `#${undo.ticketNumber}` : `#${undo.ticketNumber} · ${undoneStatus}`}</span>
              </button>
            )}
          </div>
          <div className="kitchen-overview">
            <span className="kitchen-active">{quick ? <><b>{toMake.length}</b> {c.toMake}</> : <><b>{live.length}</b> {c.active}</>}</span>
            <span className={`kitchen-connection${online ? '' : ' reconnecting'}`} role="status"><Icon name={online ? 'wifi' : 'wifi-off'} size={20} /><span className="kitchen-connection-label">{online ? c.live : c.reconnect}</span></span>
            <button type="button" className="kitchen-wipe" title={c.wipeHint} aria-label={`${c.wipe}. ${c.wipeHint}`}
              onClick={() => { haptic(10); window.dispatchEvent(new Event(CLEAN_SCREEN_EVENT)); }}>
              <Icon name="sparkles" size={24} /><span>{c.wipe}</span>
            </button>
          </div>
        </header>
        {quick && ready.length > 0 && (
          <div className="kitchen-ready-strip" role="group" aria-label={`${c.readyLabel}, ${c.readyHint}`}>
            <span className="kitchen-ready-label"><Icon name="pickup" size={22} /><span><b>{c.readyLabel}</b><small>{c.readyHint}</small></span></span>
            <div className="kitchen-ready-chips">
              {ready.map((o) => <ReadyChip key={o.id} o={o} online={online} settled={settled} onMoved={moved} />)}
            </div>
          </div>
        )}
        {!quick && <div className="kitchen-switch" role="group" aria-label={c.show}>
          {cols.map(({ status, title, icon }) => {
            const count = live.filter((o) => o.status === status).length;
            return (
              <button key={status} type="button" aria-pressed={shown === status} onClick={() => show(status)}
                className={`kitchen-switch-${status}${count > 0 ? ' kitchen-switch-busy' : ''}${status === 'sent' && freshNew && shown !== 'sent' ? ' kitchen-switch-fresh' : ''}`}>
                <Icon name={icon} size={24} /><span className="kitchen-switch-label">{title}</span><span className="kitchen-count">{count}</span>
              </button>
            );
          })}
        </div>}
      </div>
      {!online && <div className="kitchen-offline" role="status"><Icon name="wifi-off" /><span>{c.offline}</span></div>}
      {live.length === 0 && <div className="kitchen-empty"><Icon name="check" size={32} /><div><h2>{t('k.none')}</h2><p>{c.emptyHint}</p></div></div>}
      {quick && (
        <div ref={grid} className="kitchen-grid" style={{ '--kitchen-cols': columnCount } as CSSProperties}>
          {live.length > 0 && toMake.length === 0 && <p className="kitchen-column-empty">{c.nothingToMake}</p>}
          {toMake.length > 0 && columns.map((list, i) => (
            <div key={i} className="kitchen-grid-col">
              {list.map((o) => <Ticket key={o.id} o={o} now={now} online={online} settled={settled} onMoved={moved} quick />)}
            </div>
          ))}
        </div>
      )}
      {!quick && <div className="kcols">
        {cols.map(({ status, title, icon, empty }) => {
          const list = live.filter((o) => o.status === status);
          return <section className={`kitchen-column kitchen-column-${status}${shown === status ? ' kitchen-column-current' : ''}`} key={status} aria-label={title}>
            <header className="kitchen-column-heading"><h2><Icon name={icon} size={22} />{title}</h2><span className="kitchen-count">{list.length}</span></header>
            <div className="kitchen-tickets">
              {list.map((o) => <Ticket key={o.id} o={o} now={now} online={online} settled={settled} onMoved={moved} quick={false} />)}
            </div>
            {list.length === 0 && <p className="kitchen-column-empty">{empty}</p>}
          </section>;
        })}
      </div>}
    </div>
  );
}
