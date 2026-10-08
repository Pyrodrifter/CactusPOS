import { useEffect, useState } from 'react';
import type { Order } from '@cactus/shared';
import { api } from '../../lib/api';
import { beep, useNow, useOrders } from '../../lib/live';
import { useLang } from '../../i18n';
import { haptic, Icon, toast } from '../../ui/touch';

type Next = 'preparing' | 'ready' | 'collected';

function Ticket({ o, now }: { o: Order; now: number }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const mins = Math.max(0, Math.floor((now - Date.parse(o.createdAt)) / 60000));
  const age = o.status === 'ready' ? 'ok' : mins >= 10 ? 'late' : mins >= 5 ? 'warm' : 'ok';
  const fresh = now - Date.parse(o.createdAt) < 20_000 && o.status === 'sent';
  const go = async (status: Next) => {
    haptic(15);
    setBusy(true);
    try { await api(`/orders/${o.id}/status`, { body: { status } }); }
    catch (e) { toast(e instanceof Error ? e.message : String(e), 'error'); }
    finally { setBusy(false); }
  };
  return (
    <article className={`ticket age-${age}${fresh ? ' fresh' : ''}`}>
      <header>
        <b className="ticket-num">#{o.ticketNumber}</b>
        <span className={`pill ${o.paid ? 'paid' : 'unpaid'}`}>{o.paid ? t('orders.paid') : t('orders.unpaid')}</span>
        <span className="age">{mins}′</span>
      </header>
      <ul>
        {o.lines.map((l) => (
          <li key={l.id}>
            <span className="qty-big">{l.qty}</span>
            <div>
              <div className="ticket-item">{l.name}</div>
              {l.modifiers.map((m) => <div key={m.id} className={`mods${m.name.toLowerCase().startsWith('no ') ? ' minus' : ''}`}>{m.name}</div>)}
              {l.note && <div className="mods note">“{l.note}”</div>}
            </div>
          </li>
        ))}
      </ul>
      {o.note && <p className="onote">“{o.note}”</p>}
      <footer>
        {o.status === 'sent' && <button className="primary xl" disabled={busy} onClick={() => void go('preparing')}>{t('k.start')}</button>}
        {o.status === 'preparing' && <button className="primary xl go" disabled={busy} onClick={() => void go('ready')}><Icon.check />{t('k.ready')}</button>}
        {o.status === 'ready' && (
          <>
            <button className="ghost" disabled={busy} onClick={() => void go('preparing')}>{t('k.recall')}</button>
            <button className="primary xl" disabled={busy} onClick={() => void go('collected')}>{t('k.done')}</button>
          </>
        )}
      </footer>
    </article>
  );
}

export function Kitchen() {
  const { t } = useLang();
  const { orders, online, newIds, clearNew } = useOrders('active');
  const now = useNow(5000);
  useEffect(() => { if (newIds.length) { beep(); clearNew(); } }, [newIds, clearNew]);

  const live = orders.filter((o) => o.status === 'sent' || o.status === 'preparing' || o.status === 'ready');
  const cols: [Order['status'], string][] = [['sent', t('st.sent')], ['preparing', t('st.preparing')], ['ready', t('st.ready')]];
  return (
    <div className="kitchen dark">
      {!online && <div className="banner">{t('offline')}</div>}
      <div className="kcols">
        {cols.map(([status, title]) => {
          const list = live.filter((o) => o.status === status);
          return (
            <section key={status} className={`kcol k-${status}`}>
              <h2>{title}<span className="count">{list.length}</span></h2>
              {list.map((o) => <Ticket key={o.id} o={o} now={now} />)}
              {list.length === 0 && <div className="kempty">{status === 'sent' ? t('k.none') : '—'}</div>}
            </section>
          );
        })}
      </div>
    </div>
  );
}
