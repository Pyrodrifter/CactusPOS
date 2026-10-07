import { useEffect } from 'react';
import type { Order } from '@cactus/shared';
import { api } from '../../lib/api';
import { beep, useNow, useOrders } from '../../lib/live';
import { useLang } from '../../i18n';

const setStatus = (o: Order, status: 'preparing' | 'ready' | 'collected') => api(`/orders/${o.id}/status`, { body: { status } });

function Ticket({ o, now }: { o: Order; now: number }) {
  const { t } = useLang();
  const mins = Math.max(0, Math.floor((now - Date.parse(o.createdAt)) / 60000));
  const late = mins >= 10 && o.status !== 'ready';
  return (
    <article className={`ticket ${late ? 'late' : ''}`}>
      <header>
        <b>#{o.ticketNumber}</b>
        <span className={`age ${late ? 'late' : ''}`}>{mins}′</span>
        <span className="tag">{o.paid ? t('orders.paid') : t('orders.unpaid')}</span>
      </header>
      <ul>
        {o.lines.map((l) => (
          <li key={l.id}>
            <b>{l.qty}×</b> {l.name}
            {l.modifiers.length > 0 && <div className="mods">{l.modifiers.map((m) => m.name).join(', ')}</div>}
            {l.note && <div className="mods">“{l.note}”</div>}
          </li>
        ))}
      </ul>
      {o.note && <p className="onote">“{o.note}”</p>}
      <footer>
        {o.status === 'sent' && <button className="primary big" onClick={() => void setStatus(o, 'preparing')}>{t('k.start')}</button>}
        {o.status === 'preparing' && <button className="primary big" onClick={() => void setStatus(o, 'ready')}>{t('k.ready')}</button>}
        {o.status === 'ready' && (
          <>
            <button className="ghost" onClick={() => void setStatus(o, 'preparing')}>{t('k.recall')}</button>
            <button className="primary big" onClick={() => void setStatus(o, 'collected')}>{t('k.done')}</button>
          </>
        )}
      </footer>
    </article>
  );
}

export function Kitchen() {
  const { t } = useLang();
  const { orders, online, newIds, clearNew } = useOrders('active');
  const now = useNow();
  useEffect(() => { if (newIds.length) { beep(); clearNew(); } }, [newIds, clearNew]);

  const live = orders.filter((o) => o.status === 'sent' || o.status === 'preparing' || o.status === 'ready');
  const col = (s: Order['status'][]) => live.filter((o) => s.includes(o.status));
  const cols: [string, Order[]][] = [
    [t('st.sent'), col(['sent'])],
    [t('st.preparing'), col(['preparing'])],
    [t('st.ready'), col(['ready'])],
  ];
  return (
    <div className="kitchen dark">
      {!online && <div className="banner">{t('offline')}</div>}
      {live.length === 0 && <p className="muted center">{t('k.none')}</p>}
      <div className="kcols">
        {cols.map(([title, list]) => (
          <section key={title}>
            <h2>{title} <span className="count">{list.length}</span></h2>
            {list.map((o) => <Ticket key={o.id} o={o} now={now} />)}
          </section>
        ))}
      </div>
    </div>
  );
}
