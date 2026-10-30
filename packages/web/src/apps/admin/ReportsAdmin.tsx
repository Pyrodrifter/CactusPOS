import { useCallback, useEffect, useRef, useState } from 'react';
import { formatMoney, parseMoney, type DayReport, type ZReport } from '@cactus/shared';
import { api, getSession, serverPrints } from '../../lib/api';
import { apiPath } from '../../lib/clientMode';
import { printHtml } from '../../lib/print';
import { useLang } from '../../i18n';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/touch';
import { errText } from './Admin';
import { AdminDialog } from './AdminDialog';

const copy = {
  en: {
    day: 'Day', today: 'Today', sales: 'Sales', inclAbb: 'incl. ABB', orders: 'Orders', abb: 'ABB to declare', net: 'net', cashDrawer: 'Cash from sales',
    excludesFloat: 'excluding the float', payments: 'Payments', cash: 'Cash', card: 'Card', tips: 'Tips', refunds: 'Refunded', taxTitle: 'ABB by rate',
    over: 'over', exempt: 'Exempt', outside: 'Outside scope', byHour: 'Sales by hour', topItems: 'Items sold', none: 'No sales yet on this day.',
    unpaidWarn: (n: number, amount: string) => `${n} order${n === 1 ? ' is' : 's are'} still unpaid (${amount}). Take payment or void ${n === 1 ? 'it' : 'them'} before closing.`,
    closeDay: 'Close the day', closeAgain: 'Close again', print: 'Print', closedAs: (n: number, time: string) => `Closed as Z report #${n} at ${time}.`,
    changedSince: 'Sales changed after it was closed. Close again to record the new figures.',
    closeTitle: 'Close the day', closeIntro: 'This stores today’s figures as a numbered Z report for the bookkeeping. Sales can continue afterwards; close again if anything changes.',
    counted: 'Cash counted in the drawer (without the float)', countedHint: 'Leave empty if you did not count.', note: 'Note (optional)',
    expected: 'Expected', difference: 'Over / short', confirmClose: 'Close day', cancel: 'Cancel', badAmount: 'Enter an amount like 152.50',
    earlier: (n: number, amount: string) => `Includes ${n} refund${n === 1 ? '' : 's'} of sales from an earlier day (${amount}). That money left the drawer today, so it is taken off today's sales, ABB and cash.`,
    corrections: (n: number, net: string) => `${n} paid order${n === 1 ? ' was' : 's were'} corrected on this day (${net} in all). The originals are kept as void; the corrected sales are the ones that count.`,
    closedToast: (n: number) => `Day closed: Z report #${n}`, history: 'Closed days', receipts: 'Receipts', loading: 'Loading…', sold: 'sold', printed: 'Sent to the printer',
  },
  nl: {
    day: 'Dag', today: 'Vandaag', sales: 'Omzet', inclAbb: 'incl. ABB', orders: 'Bestellingen', abb: 'Af te dragen ABB', net: 'netto', cashDrawer: 'Contant uit verkoop',
    excludesFloat: 'exclusief wisselgeld', payments: 'Betalingen', cash: 'Contant', card: 'Pin', tips: 'Fooien', refunds: 'Terugbetaald', taxTitle: 'ABB per tarief',
    over: 'over', exempt: 'Vrijgesteld', outside: 'Buiten toepassing', byHour: 'Omzet per uur', topItems: 'Verkochte items', none: 'Nog geen verkoop op deze dag.',
    unpaidWarn: (n: number, amount: string) => `${n} bestelling${n === 1 ? ' is' : 'en zijn'} nog niet betaald (${amount}). Reken af of annuleer voordat u afsluit.`,
    closeDay: 'Dag afsluiten', closeAgain: 'Opnieuw afsluiten', print: 'Afdrukken', closedAs: (n: number, time: string) => `Afgesloten als Z-rapport #${n} om ${time}.`,
    changedSince: 'De omzet is gewijzigd na het afsluiten. Sluit opnieuw af om de nieuwe cijfers vast te leggen.',
    closeTitle: 'Dag afsluiten', closeIntro: 'Hiermee worden de cijfers van vandaag vastgelegd als genummerd Z-rapport voor de boekhouding. Verkopen kan daarna gewoon; sluit opnieuw af als er iets verandert.',
    counted: 'Contant geteld in de lade (zonder wisselgeld)', countedHint: 'Leeg laten als u niet heeft geteld.', note: 'Opmerking (optioneel)',
    expected: 'Verwacht', difference: 'Verschil', confirmClose: 'Dag afsluiten', cancel: 'Annuleren', badAmount: 'Vul een bedrag in zoals 152,50',
    earlier: (n: number, amount: string) => `Inclusief ${n} terugbetaling${n === 1 ? '' : 'en'} van verkopen van een eerdere dag (${amount}). Dat geld ging vandaag uit de lade en is dus van de omzet, ABB en kas van vandaag afgetrokken.`,
    corrections: (n: number, net: string) => `${n} betaalde bestelling${n === 1 ? ' is' : 'en zijn'} op deze dag gecorrigeerd (${net} in totaal). De originelen blijven bewaard als geannuleerd; de gecorrigeerde verkopen tellen mee.`,
    closedToast: (n: number) => `Dag afgesloten: Z-rapport #${n}`, history: 'Afgesloten dagen', receipts: 'Bonnen', loading: 'Laden…', sold: 'verkocht', printed: 'Naar de printer gestuurd',
  },
};

interface DayView { report: DayReport; closed: ZReport | null; today: string }
const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;

export function ReportsAdmin() {
  const { lang } = useLang();
  const c = copy[lang];
  const money = (cents: number) => formatMoney(cents);
  const [date, setDate] = useState('');
  const [view, setView] = useState<DayView | null>(null);
  const [history, setHistory] = useState<ZReport[]>([]);
  const [closing, setClosing] = useState(false);
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const root = useRef<HTMLDivElement>(null);
  /** The closed-days list sits below the figures, so bring the chosen day's figures into view. */
  const showDay = (d: string) => { setDate(d); root.current?.closest('main')?.scrollTo({ top: 0 }); };

  const load = useCallback(async (d: string) => {
    try {
      const v = await api<DayView>(`/reports/day${d ? `?date=${d}` : ''}`);
      setView(v);
      if (!d) setDate(v.today);
      setHistory(await api<ZReport[]>('/reports/z'));
      setErr('');
    } catch (e) { setErr(errText(e)); }
  }, []);
  useEffect(() => { void load(date); }, [date, load]);

  if (!view) return <p className={err ? 'error' : 'muted center'} role="status">{err || c.loading}</p>;
  const { report: r, closed } = view;
  const time = (iso: string) => new Date(iso).toLocaleTimeString(lang === 'nl' ? 'nl-NL' : 'en-US', { hour: '2-digit', minute: '2-digit' });
  const changed = !!closed && (closed.report.sales.grossCents !== r.sales.grossCents || closed.report.orders.sold !== r.orders.sold || closed.report.orders.refunded !== r.orders.refunded);
  const peak = Math.max(1, ...r.hours.map((h) => h.grossCents));
  const countedCents = counted.trim() ? parseMoney(counted) : undefined;

  const close = async () => {
    if (countedCents === null) return setErr(c.badAmount);
    setBusy(true); setErr('');
    try {
      const z = await api<ZReport>('/reports/day/close', { body: { date: r.businessDate, countedCashCents: countedCents, note: note.trim() || undefined } });
      toast(c.closedToast(z.number));
      setClosing(false); setCounted(''); setNote('');
      await load(r.businessDate);
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const print = async () => {
    if (await serverPrints()) {
      try { await api('/reports/day/print', { body: { date: r.businessDate } }); toast(c.printed); } catch (e) { toast(errText(e), 'error'); }
      return;
    }
    try {
      const res = await fetch(apiPath(`/reports/day/print.html?date=${r.businessDate}`), { headers: { 'x-token': getSession()?.token ?? '' } });
      if (!res.ok) throw new Error(res.statusText);
      await printHtml(await res.text());
    } catch (e) { toast(errText(e), 'error'); }
  };

  return (
    <div className="reports" ref={root}>
      <div className="reports-bar">
        <label className="reports-date"><span>{c.day}</span>
          <input type="date" value={date} max={view.today} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        {date !== view.today && <button type="button" className="ghost" onClick={() => setDate(view.today)}>{c.today}</button>}
        <span className="spacer" />
        <button type="button" className="reports-print" onClick={() => void print()}><Icon name="printer" />{c.print}</button>
        <button type="button" className="primary reports-close" onClick={() => { setErr(''); setClosing(true); }}><Icon name="lock" />{closed ? c.closeAgain : c.closeDay}</button>
      </div>

      {closed && <p className={`reports-status${changed ? ' changed' : ''}`} role="status"><Icon name={changed ? 'warning' : 'check'} /><span>{c.closedAs(closed.number, time(closed.closedAt))}{changed && ` ${c.changedSince}`}</span></p>}
      {r.orders.unpaid > 0 && <p className="notice" role="status">{c.unpaidWarn(r.orders.unpaid, money(r.orders.unpaidCents))}</p>}
      {r.refundedEarlier && <p className="notice" role="status">{c.earlier(r.refundedEarlier.count, money(r.refundedEarlier.grossCents))}</p>}
      {r.corrections && <p className="notice" role="status">{c.corrections(r.corrections.count, `${r.corrections.addedCents >= r.corrections.removedCents ? '+' : '−'}${money(Math.abs(r.corrections.addedCents - r.corrections.removedCents))}`)}</p>}
      {err && !closing && <div className="error" role="alert">{err}</div>}

      <div className="reports-stats">
        <div className="reports-stat main"><span>{c.sales}</span><b>{money(r.sales.grossCents)}</b><small>{c.inclAbb}</small></div>
        <div className="reports-stat"><span>{c.orders}</span><b>{r.orders.sold}</b><small>{r.receipts.first !== null ? `${c.receipts} #${r.receipts.first}–#${r.receipts.last}` : '—'}</small></div>
        <div className="reports-stat"><span>{c.abb}</span><b>{money(r.sales.taxCents)}</b><small>{money(r.sales.netCents)} {c.net}</small></div>
        <div className="reports-stat"><span>{c.cashDrawer}</span><b>{money(r.cashExpectedCents)}</b><small>{c.excludesFloat}</small></div>
      </div>

      {r.orders.sold === 0 && r.orders.refunded === 0 ? <p className="muted center">{c.none}</p> : (
        <div className="reports-grid">
          <section className="admin-form-card">
            <h3><Icon name="cash" />{c.payments}</h3>
            <ul className="reports-rows">
              {r.tenders.map((x) => <li key={x.method}><span>{x.method === 'cash' ? c.cash : c.card} <small>×{x.count}</small></span><b>{money(x.amountCents)}</b></li>)}
              {r.tipsCents > 0 && <li><span>{c.tips}</span><b>{money(r.tipsCents)}</b></li>}
              {r.refunds.map((x) => <li key={`r-${x.method}`} className="neg"><span>{c.refunds} · {x.method === 'cash' ? c.cash : c.card} <small>×{x.count}</small></span><b>−{money(x.amountCents)}</b></li>)}
            </ul>
          </section>
          <section className="admin-form-card">
            <h3><Icon name="tax" />{c.taxTitle}</h3>
            <ul className="reports-rows">
              {r.tax.map((x) => (
                <li key={`${x.taxCategoryId}-${x.bps}`}>
                  <span>{x.kind === 'taxed' ? `${pct(x.bps)} ${c.over} ${money(x.netCents)}` : x.kind === 'exempt' ? c.exempt : c.outside}</span>
                  <b>{money(x.kind === 'taxed' ? x.taxCents : x.grossCents)}</b>
                </li>
              ))}
            </ul>
          </section>
          <section className="admin-form-card">
            <h3><Icon name="clock" />{c.byHour}</h3>
            <div className="reports-hours" role="img" aria-label={c.byHour}>
              {r.hours.map((h) => (
                <div key={h.hour} className="reports-hour" title={`${h.hour}:00 · ${money(h.grossCents)}`}>
                  <small>{money(h.grossCents).replace('.00', '')}</small>
                  <i style={{ height: `${Math.max(6, Math.round((h.grossCents / peak) * 100))}%` }} />
                  <span>{h.hour}:00</span>
                </div>
              ))}
            </div>
          </section>
          <section className="admin-form-card">
            <h3><Icon name="receipt" />{c.topItems}</h3>
            <ul className="reports-rows">
              {r.items.map((x) => <li key={x.name}><span><small>{x.qty}×</small> {x.name}</span><b>{money(x.grossCents)}</b></li>)}
            </ul>
          </section>
        </div>
      )}

      {history.length > 0 && (
        <section className="reports-history">
          <h3>{c.history}</h3>
          <ul className="admin-rows">
            {history.map((z) => (
              <li key={z.number} className={`admin-row${z.businessDate === date ? ' is-current' : ''}`}>
                <button type="button" className="admin-row-main" aria-label={`${c.day} ${z.businessDate}`} aria-current={z.businessDate === date ? 'true' : undefined} onClick={() => showDay(z.businessDate)}>
                  <span className="admin-row-lead num" aria-hidden="true">Z{z.number}</span>
                  <span className="admin-row-text">
                    <b>{z.businessDate}</b>
                    <small>{z.report.orders.sold} {c.sold} · {c.cash} {money(z.report.cashExpectedCents)}{z.cashDifferenceCents !== null && ` · ${c.difference} ${z.cashDifferenceCents > 0 ? '+' : ''}${money(z.cashDifferenceCents)}`}</small>
                  </span>
                  <b className="admin-row-price">{money(z.report.sales.grossCents)}</b>
                  <Icon name="arrow-right" className="admin-row-go" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {closing && (
        <AdminDialog title={c.closeTitle} onClose={() => setClosing(false)} busy={busy} error={err} footer={<>
          <button type="button" className="ghost" disabled={busy} onClick={() => setClosing(false)}>{c.cancel}</button>
          <button type="button" className="primary" disabled={busy} onClick={() => void close()}><Icon name="lock" />{c.confirmClose}</button>
        </>}>
          <p className="muted admin-dialog-intro">{c.closeIntro}</p>
          {r.orders.unpaid > 0 && <p className="notice">{c.unpaidWarn(r.orders.unpaid, money(r.orders.unpaidCents))}</p>}
          <label>{c.counted}
            <input inputMode="decimal" autoFocus placeholder="0.00" value={counted} onChange={(e) => { setErr(''); setCounted(e.target.value); }} />
            <small>{c.countedHint}</small>
          </label>
          <ul className="reports-rows reports-count">
            <li><span>{c.expected}</span><b>{money(r.cashExpectedCents)}</b></li>
            {typeof countedCents === 'number' && <li className={countedCents - r.cashExpectedCents < 0 ? 'neg' : ''}><span>{c.difference}</span><b>{countedCents - r.cashExpectedCents > 0 ? '+' : ''}{money(countedCents - r.cashExpectedCents)}</b></li>}
          </ul>
          <label>{c.note}<input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></label>
        </AdminDialog>
      )}
    </div>
  );
}
