import { useEffect, useRef, useState } from 'react';
import type { Order } from '@cactus/shared';
import { api } from '../../lib/api';
import { beep, useNow, useOrders } from '../../lib/live';
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
  },
  nl: {
    subtitle: 'Elke bon in één oogopslag', live: 'Live updates', reconnect: 'Verbinding herstellen',
    active: 'actieve bonnen', emptyHint: 'Nieuwe bestellingen verschijnen hier automatisch.',
    sentEmpty: 'Geen nieuwe bonnen', preparingEmpty: 'Nog niets in bereiding', readyEmpty: 'Niets klaar om af te halen',
    start: 'Start bereiding', ready: 'Markeer klaar', recall: 'Terug', collected: 'Opgehaald',
    saving: 'Bijwerken…', failed: 'Deze bon kon niet worden bijgewerkt. Controleer de status voordat u opnieuw probeert.',
    offline: 'De laatst ontvangen bonnen blijven zichtbaar. Acties hervatten zodra de verbinding terug is.',
    elapsed: 'minuten sinds besteld',
  },
};

function Ticket({ o, now, online }: { o: Order; now: number; online: boolean }) {
  const { t, lang } = useLang();
  const c = copy[lang];
  const [pending, setPending] = useState<Order['status'] | null>(null);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  const mins = Math.max(0, Math.floor((now - Date.parse(o.createdAt)) / 60000));
  const late = mins >= 10 && o.status !== 'ready';
  const warm = mins >= 5 && !late && o.status !== 'ready';
  const fresh = o.status === 'sent' && now - Date.parse(o.createdAt) < 20_000;
  // Keep actions locked until the live projection confirms a successful update.
  useEffect(() => { if (pending === o.status) setPending(null); }, [o.status, pending]);
  async function setStatus(status: 'preparing' | 'ready' | 'collected') {
    if (inFlight.current || pending || !online) return;
    haptic(15);
    inFlight.current = true;
    setPending(status);
    setFailed(false);
    try { await api(`/orders/${o.id}/status`, { body: { status } }); }
    catch { setFailed(true); setPending(null); }
    finally { inFlight.current = false; }
  }
  const disabled = pending !== null || !online;
  return (
    <article className={`ticket${late ? ' late' : warm ? ' warm' : ''}${fresh ? ' ticket-fresh' : ''}${o.status === 'ready' ? ' ticket-ready' : ''}`} aria-label={`${t('ticket')} ${o.ticketNumber}`} aria-busy={pending !== null}>
      <header className="ticket-heading">
        <div className="ticket-number"><b>#{o.ticketNumber}</b></div>
        <div className={`ticket-payment ${o.paid ? 'ticket-paid' : 'ticket-unpaid'}`}>
          <Icon name={o.paid ? 'check' : 'cash'} size={16} />{o.paid ? t('orders.paid') : t('orders.unpaid')}
        </div>
        <span className={`ticket-age${late ? ' ticket-age-late' : warm ? ' ticket-age-warm' : ''}`} aria-label={`${mins} ${c.elapsed}`}><Icon name="clock" size={18} />{mins} min</span>
      </header>
      <ul className="ticket-lines">
        {o.lines.map((l) => (
          <li key={l.id}>
            <div className="ticket-line"><b className="ticket-quantity">{l.qty}×</b><strong>{l.name}</strong></div>
            {l.modifiers.length > 0 && <div className="ticket-modifiers">{l.modifiers.map((m) => <div key={m.id} className={/^(no|geen)\s/i.test(m.name) ? 'ticket-exclusion' : undefined}>{m.name}</div>)}</div>}
            {l.note && <div className="ticket-line-note">{l.note}</div>}
          </li>
        ))}
      </ul>
      {o.note && <p className="ticket-note"><Icon name="edit" size={18} /><span>{o.note}</span></p>}
      {failed && <p className="ticket-error" role="alert"><Icon name="warning" size={18} /><span>{c.failed}</span></p>}
      <footer className="ticket-actions">
        {o.status === 'sent' && <button className="ticket-primary" disabled={disabled} onClick={() => void setStatus('preparing')}><Icon name="kitchen" />{pending ? c.saving : c.start}</button>}
        {o.status === 'preparing' && <button className="ticket-primary" disabled={disabled} onClick={() => void setStatus('ready')}><Icon name="check" />{pending ? c.saving : c.ready}</button>}
        {o.status === 'ready' && <>
          <button className="ticket-recall" disabled={disabled} onClick={() => void setStatus('preparing')}><Icon name="refresh" />{pending === 'preparing' ? c.saving : c.recall}</button>
          <button className="ticket-primary" disabled={disabled} onClick={() => void setStatus('collected')}><Icon name="pickup" />{pending === 'collected' ? c.saving : c.collected}</button>
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
  const live = orders.filter((o) => o.status === 'sent' || o.status === 'preparing' || o.status === 'ready');
  const cols: { status: Order['status']; title: string; icon: IconName; empty: string }[] = [
    { status: 'sent', title: t('st.sent'), icon: 'receipt', empty: c.sentEmpty },
    { status: 'preparing', title: t('st.preparing'), icon: 'kitchen', empty: c.preparingEmpty },
    { status: 'ready', title: t('st.ready'), icon: 'pickup', empty: c.readyEmpty },
  ];
  return (
    <div className="kitchen dark">
      <header className="kitchen-heading">
        <h1 className="kitchen-title"><Icon name="kitchen" size={24} />{t('nav.kitchen')}</h1>
        <div className="kitchen-overview"><span><b>{live.length}</b> {c.active}</span><span className={`kitchen-connection${online ? '' : ' reconnecting'}`} role="status"><Icon name={online ? 'wifi' : 'wifi-off'} size={18} />{online ? c.live : c.reconnect}</span></div>
      </header>
      {!online && <div className="kitchen-offline" role="status"><Icon name="wifi-off" /><span>{c.offline}</span></div>}
      {live.length === 0 && <div className="kitchen-empty"><Icon name="check" size={30} /><div><h2>{t('k.none')}</h2><p>{c.emptyHint}</p></div></div>}
      <div className="kcols">
        {cols.map(({ status, title, icon, empty }) => {
          const list = live.filter((o) => o.status === status);
          return <section className={`kitchen-column kitchen-column-${status}`} key={status} aria-label={title}>
            <header className="kitchen-column-heading"><h2><Icon name={icon} size={20} />{title}</h2><span className="kitchen-count">{list.length}</span></header>
            {list.map((o) => <Ticket key={o.id} o={o} now={now} online={online} />)}
            {list.length === 0 && <p className="kitchen-column-empty">{empty}</p>}
          </section>;
        })}
      </div>
    </div>
  );
}
