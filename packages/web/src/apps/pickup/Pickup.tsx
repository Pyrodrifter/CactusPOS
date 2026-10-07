import { usePickup } from '../../lib/live';
import { useLang } from '../../i18n';

/** Customer-facing board. No login: shows ticket numbers only, never items or names. */
export function Pickup() {
  const { t } = useLang();
  const { board, online } = usePickup();
  return (
    <div className="pickup dark">
      <section>
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
