import { useEffect, useState } from 'react';
import { useNow, usePickup } from '../../lib/live';
import { useLang } from '../../i18n';
import { Logo } from '../../ui/Logo';
import './pickup.css';

/**
 * Customer-facing board. No login: shows ticket numbers, or the name given to an order, never items or amounts.
 * Deliberately plain: two lists that can be read from across the beach.
 */
export function Pickup() {
  const { t, lang } = useLang();
  const { board, online } = usePickup();
  const now = useNow(10_000);
  const [businessName, setBusinessName] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/health', { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((health: { business?: unknown } | null) => {
        if (typeof health?.business === 'string') setBusinessName(health.business);
      }).catch(() => { /* Keep the board usable while the server reconnects. */ });
    return () => controller.abort();
  }, [online]);
  const label = (n: number) => board.names?.[n] ?? n;
  const size = (n: number) => `${String(n).length > 3 ? 'pickup-small' : ''}${board.names?.[n] ? ' pickup-name' : ''}`;
  return (
    <div className="pickup-board">
      <header className="pickup-top">
        <Logo size={44} />
        <strong>{businessName}</strong>
        <time dateTime={new Date(now).toISOString()}>{new Date(now).toLocaleTimeString(lang === 'nl' ? 'nl-NL' : 'en-US', { hour: '2-digit', minute: '2-digit' })}</time>
      </header>
      <section className="pickup-col pickup-preparing" aria-labelledby="pickup-preparing-title">
        <h1 id="pickup-preparing-title">{t('p.preparing')}</h1>
        <ul aria-label={t('p.preparing')}>{board.preparing.map((n) => <li key={n} className={size(n)}>{label(n)}</li>)}</ul>
      </section>
      <section className="pickup-col pickup-ready" aria-labelledby="pickup-ready-title">
        <h1 id="pickup-ready-title">{t('p.ready')}</h1>
        <ul aria-label={t('p.ready')} aria-live="polite">{board.ready.map((n) => <li key={n} className={size(n)}>{label(n)}</li>)}</ul>
      </section>
      {!online && <p className="pickup-offline" role="status">{t('offline')}</p>}
    </div>
  );
}
