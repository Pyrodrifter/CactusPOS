import { useEffect, useState } from 'react';
import { usePickup, useNow } from '../../lib/live';
import { useLang } from '../../i18n';

/** Customer-facing board. No login: shows ticket numbers only, never items or names. */
export function Pickup() {
  const { t } = useLang();
  const { board, online } = usePickup();
  const now = useNow(10_000);
  const [name, setName] = useState('');
  useEffect(() => {
    void fetch('/api/health').then((r) => r.json()).then((h: { business?: string }) => setName(h.business ?? '')).catch(() => {});
  }, []);
  return (
    <div className="pickup dark">
      <header className="pickup-head">
        <strong>🌵 {name}</strong>
        <span>{new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </header>
      <section className="prep">
        <h1>{t('p.preparing')}</h1>
        <div className="nums">{board.preparing.map((n) => <span key={n}>{n}</span>)}</div>
      </section>
      <section className="ready">
        <h1>{t('p.ready')}</h1>
        <div className="nums">{board.ready.map((n) => <span key={n}>{n}</span>)}</div>
      </section>
      {!online && <div className="banner">{t('offline')}</div>}
    </div>
  );
}
