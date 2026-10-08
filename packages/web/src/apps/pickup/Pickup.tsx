import { useEffect, useState, type CSSProperties } from 'react';
import { useNow, usePickup } from '../../lib/live';
import { useLang } from '../../i18n';
import { Icon } from '../../ui/Icon';
import { Logo } from '../../ui/Logo';
import './pickup.css';

const copy = {
  en: {
    title: 'Good food. Almost ready.', subtitle: 'Keep an eye on your ticket number', live: 'Live updates',
    reconnect: 'Reconnecting', preparingHint: 'Freshly made, just for you', readyHint: 'Your order is waiting at the counter',
    preparingEmpty: 'A little quiet in the kitchen', preparingEmptyHint: 'Your number will appear here once your order is sent.',
    readyEmpty: 'Good things take a moment', readyEmptyHint: 'Ready orders will appear here. Thanks for waiting!',
    offline: 'Showing the last received numbers. The board will update when the connection returns.', orders: 'orders',
  },
  nl: {
    title: 'Lekker eten. Bijna klaar.', subtitle: 'Houd uw bonnummer in de gaten', live: 'Live updates',
    reconnect: 'Verbinding herstellen', preparingHint: 'Vers bereid, speciaal voor u', readyHint: 'Uw bestelling staat klaar bij de balie',
    preparingEmpty: 'Even rustig in de keuken', preparingEmptyHint: 'Uw nummer verschijnt hier zodra uw bestelling is verstuurd.',
    readyEmpty: 'Nog een klein moment', readyEmptyHint: 'Bestellingen die klaar zijn verschijnen hier. Bedankt voor het wachten!',
    offline: 'De laatst ontvangen nummers blijven zichtbaar. Het scherm wordt bijgewerkt zodra de verbinding terug is.', orders: 'bestellingen',
  },
};

/** Customer-facing board. No login: shows ticket numbers only, never items or names. */
export function Pickup() {
  const { t, lang } = useLang();
  const c = copy[lang];
  const { board, online } = usePickup();
  const now = useNow(10_000);
  const [businessName, setBusinessName] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/health', { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((health: { business?: unknown } | null) => {
        if (typeof health?.business === 'string') setBusinessName(health.business);
      }).catch(() => { /* Keep the local board usable while the server reconnects. */ });
    return () => controller.abort();
  }, [online]);
  return (
    <div className="pickup pickup-board">
      <header className="pickup-heading">
        <div className="pickup-brand"><Logo size={72} /><div><p>{businessName || t('nav.pickup')}</p><h1>{c.title}</h1><span>{c.subtitle}</span></div></div>
        <div className="pickup-overview"><time dateTime={new Date(now).toISOString()} className="pickup-clock">{new Date(now).toLocaleTimeString(lang === 'nl' ? 'nl-NL' : 'en-US', { hour: '2-digit', minute: '2-digit' })}</time><div className={`pickup-connection${online ? '' : ' pickup-reconnecting'}`} role="status"><Icon name={online ? 'wifi' : 'wifi-off'} size={20} />{online ? c.live : c.reconnect}</div></div>
      </header>
      {!online && <p className="pickup-offline" role="status"><Icon name="wifi-off" /><span>{c.offline}</span></p>}
      <div className="pickup-columns">
        <section className="pickup-preparing" aria-labelledby="pickup-preparing-title">
          <header className="pickup-column-heading"><span className="pickup-status-icon"><Icon name="kitchen" size={30} /></span><div><h2 id="pickup-preparing-title">{t('p.preparing')}</h2><p>{c.preparingHint}</p></div><span className="pickup-count" aria-label={`${board.preparing.length} ${c.orders}`}>{board.preparing.length}</span></header>
          {board.preparing.length ? <ul className="pickup-numbers" aria-label={t('p.preparing')}>{board.preparing.map((n) => <li key={n} style={{ '--number-length': String(n).length } as CSSProperties} className={String(n).length > 4 ? 'pickup-long-number' : String(n).length > 3 ? 'pickup-wide-number' : undefined}>{n}</li>)}</ul> : <div className="pickup-empty"><Icon name="clock" size={42} /><h3>{c.preparingEmpty}</h3><p>{c.preparingEmptyHint}</p></div>}
        </section>
        <section className="pickup-ready" aria-labelledby="pickup-ready-title">
          <header className="pickup-column-heading"><span className="pickup-status-icon"><Icon name="pickup" size={30} /></span><div><h2 id="pickup-ready-title">{t('p.ready')}</h2><p>{c.readyHint}</p></div><span className="pickup-count" aria-label={`${board.ready.length} ${c.orders}`}>{board.ready.length}</span></header>
          {board.ready.length ? <ul className="pickup-numbers" aria-label={t('p.ready')} aria-live="polite" aria-atomic="true">{board.ready.map((n) => <li key={n} style={{ '--number-length': String(n).length } as CSSProperties} className={String(n).length > 4 ? 'pickup-long-number' : String(n).length > 3 ? 'pickup-wide-number' : undefined}>{n}<Icon name="check" size={24} /></li>)}</ul> : <div className="pickup-empty"><Icon name="pickup" size={48} /><h3>{c.readyEmpty}</h3><p>{c.readyEmptyHint}</p></div>}
        </section>
      </div>
    </div>
  );
}
