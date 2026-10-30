import { useEffect, useState } from 'react';
import { formatMoney, type MenuResponse, type Order } from '@cactus/shared';
import { api, printReceipt } from '../../lib/api';
import { useLang } from '../../i18n';
import { Icon } from '../../ui/Icon';
import { CorrectSheet } from '../pos/Pos';

export function DaySalesReview({ date, today, revision, onChanged }: { date: string; today: string; revision: string; onChanged: () => Promise<void> }) {
  const { lang } = useLang(), nl = lang === 'nl';
  const [orders, setOrders] = useState<Order[]>([]), [menu, setMenu] = useState<MenuResponse | null>(null);
  const [correcting, setCorrecting] = useState<Order | null>(null), [error, setError] = useState(''), [query, setQuery] = useState('');
  useEffect(() => {
    let active = true;
    Promise.all([api<Order[]>(`/reports/day/orders?date=${date}`), api<MenuResponse>('/menu')])
      .then(([list, data]) => { if (active) { setOrders(list); setMenu(data); setError(''); } }).catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : String(e)); });
    return () => { active = false; };
  }, [date, revision]);
  const filtered = orders.filter((order) => `${order.receiptNumber ?? ''} ${order.ticketNumber} ${order.tabName ?? ''} ${order.lines.map((line) => line.name).join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <section className="admin-form-card day-sales-review">
    <h3><Icon name="receipt" />{nl ? 'Verkopen controleren vóór afsluiten' : 'Review sales before settlement'}</h3>
    <p>{nl ? 'Controleer bedragen, artikelen en betaalwijze. Corrigeren bewaart de eerste bon en maakt een gekoppelde vervangende verkoop. Controleer een losse betaalautomaat zelf.' : 'Review amounts, items and payment method. Correct keeps the original receipt and creates a linked replacement sale. Check any separate card-terminal transaction yourself.'}</p>
    {date !== today && <p className="notice">{nl ? 'Dit is een eerdere dag. Correcties worden vandaag geboekt; gebruik Bestellingen voor een correctie van een eerdere verkoop.' : 'This is an earlier day. Corrections are recorded today; use Orders to correct an earlier sale.'}</p>}
    <label>{nl ? 'Zoek bon, bestelling of artikel' : 'Find a receipt, order or item'}<input className="review-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
    {error && <p className="error" role="alert">{error}</p>}
    <ul className="day-sales-list">{filtered.map((order) => <li key={order.id} data-order-id={order.id}>
      <div><strong>{nl ? 'Bon' : 'Receipt'} #{order.receiptNumber ?? '—'} · #{order.ticketNumber}{order.tabName ? ` · ${order.tabName}` : ''}</strong>
        <p>{order.lines.map((line) => `${line.qty}× ${line.name}`).join(', ')}</p>
        <small>{order.status === 'void' ? (nl ? 'Geannuleerd' : 'Void') : !order.paid ? (nl ? 'Onbetaald' : 'Unpaid') : order.payments.map((p) => p.method === 'cash' ? (nl ? 'Contant' : 'Cash') : (nl ? 'Pin' : 'Card')).join(' / ')}{order.correctedBy ? ` · ${nl ? 'Vervangen door bon' : 'Replaced by receipt'} #${order.correctedBy.receiptNumber}` : ''}</small></div>
      <b>{formatMoney(order.totalCents)}</b><div className="actions">{order.paid && <button onClick={() => { void printReceipt(order).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e))); }}>{nl ? 'Bon' : 'Receipt'}</button>}
      {date === today && order.paid && order.status !== 'void' && <button className="review-correct" disabled={!menu} onClick={() => setCorrecting(order)}><Icon name="edit" />{nl ? 'Corrigeren' : 'Correct'}</button>}</div>
    </li>)}</ul>
    {!filtered.length && <p className="muted">{nl ? 'Geen overeenkomende verkopen.' : 'No matching sales.'}</p>}
    {correcting && menu && <CorrectSheet order={correcting} menu={menu} onCancel={() => setCorrecting(null)} onDone={() => { setCorrecting(null); void onChanged(); }} />}
  </section>;
}
