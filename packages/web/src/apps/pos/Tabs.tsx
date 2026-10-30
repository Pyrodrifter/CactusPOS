import { useState } from 'react';
import { formatMoney, isOpenTab, type Order } from '@cactus/shared';
import { api, ApiError, printReceipt } from '../../lib/api';
import { useNow, useOrders } from '../../lib/live';
import { useLang } from '../../i18n';
import { Icon } from '../../ui/Icon';
import { haptic, Sheet, toast } from '../../ui/touch';
import './tabs.css';

const copy = {
  en: {
    empty: 'No open tabs', emptyHint: 'When a guest wants to pay later, send the order with "Open a tab".',
    ticket: 'Ticket', items: (n: number) => `${n} item${n === 1 ? '' : 's'}`, min: 'min', since: 'since', older: 'from an earlier day',
    add: 'Add items', pay: 'Pay', bill: 'Print bill', rename: 'Name', save: 'Save name', namePlaceholder: 'Guest name', round: 'Round',
    renamed: 'Name saved', billSent: 'Bill sent to print', total: 'Total', inclAbb: 'incl. ABB', offline: 'Offline. The list will update when the connection returns.',
    kitchen: { sent: 'In the kitchen queue', preparing: 'Being prepared', ready: 'Ready for pickup', collected: 'Served', void: 'Void' },
  },
  nl: {
    empty: 'Geen open rekeningen', emptyHint: 'Wil een gast later betalen? Verstuur de bestelling dan met "Rekening openen".',
    ticket: 'Bon', items: (n: number) => `${n} item${n === 1 ? '' : 's'}`, min: 'min', since: 'sinds', older: 'van een eerdere dag',
    add: 'Items toevoegen', pay: 'Betalen', bill: 'Rekening afdrukken', rename: 'Naam', save: 'Naam opslaan', namePlaceholder: 'Naam van de gast', round: 'Ronde',
    renamed: 'Naam opgeslagen', billSent: 'Rekening naar de printer gestuurd', total: 'Totaal', inclAbb: 'incl. ABB', offline: 'Offline. De lijst wordt bijgewerkt zodra de verbinding terug is.',
    kitchen: { sent: 'In de wachtrij', preparing: 'In bereiding', ready: 'Klaar om af te halen', collected: 'Geserveerd', void: 'Geannuleerd' },
  },
};

/** What to call a tab on screen: its name, or its ticket number when nobody named it. */
export function tabLabel(o: Order, lang: 'en' | 'nl' = 'en'): string {
  return o.tabName ?? `${copy[lang].ticket} #${o.ticketNumber}`;
}

/**
 * The open tabs: every order that is not paid yet, from today or left over from an earlier day.
 * Tap a tab to add another round or to take payment.
 */
export function TabList({ onAdd, onPay }: { onAdd: (tab: Order) => void; onPay: (tab: Order) => void }) {
  const { lang } = useLang();
  const c = copy[lang];
  const { orders, online } = useOrders('open');
  const now = useNow(30_000);
  const [openId, setOpenId] = useState<string | null>(null);
  const tabs = orders.filter(isOpenTab).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const open = tabs.find((t) => t.id === openId) ?? null;
  const money = (cents: number) => formatMoney(cents);
  const clock = (iso: string) => new Date(iso).toLocaleTimeString(lang === 'nl' ? 'nl-NL' : 'en-US', { hour: '2-digit', minute: '2-digit' });
  const age = (o: Order) => {
    const mins = Math.max(0, Math.floor((now - Date.parse(o.createdAt)) / 60000));
    if (mins >= 12 * 60) return c.older;
    return mins < 60 ? `${mins} ${c.min}` : `${c.since} ${clock(o.createdAt)}`;
  };

  return (
    <div className="tab-list-view">
      {!online && <p className="banner" role="status">{c.offline}</p>}
      {tabs.length === 0 ? (
        <div className="tab-empty"><Icon name="tabs" size={44} /><h2>{c.empty}</h2><p>{c.emptyHint}</p></div>
      ) : (
        <ul className="tab-list">
          {tabs.map((o) => {
            const count = o.lines.reduce((s, l) => s + l.qty, 0);
            return (
              <li key={o.id}>
                <button className="tab-card" onClick={() => { haptic(6); setOpenId(o.id); }}>
                  <span className="tab-card-name">{tabLabel(o, lang)}</span>
                  <span className="tab-card-meta">{o.tabName && <>#{o.ticketNumber} · </>}{c.items(count)} · {age(o)}</span>
                  <span className={`tab-card-state tab-state-${o.status}`}>{c.kitchen[o.status]}</span>
                  <b className="tab-card-total">{money(o.totalCents)}</b>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {open && <TabSheet tab={open} onClose={() => setOpenId(null)} onAdd={() => { setOpenId(null); onAdd(open); }} onPay={() => { setOpenId(null); onPay(open); }} />}
    </div>
  );
}

function TabSheet({ tab, onClose, onAdd, onPay }: { tab: Order; onClose: () => void; onAdd: () => void; onPay: () => void }) {
  const { lang } = useLang();
  const c = copy[lang];
  const [name, setName] = useState(tab.tabName ?? '');
  const [busy, setBusy] = useState(false);
  const money = (cents: number) => formatMoney(cents);
  const rounds = [...new Set(tab.lines.map((l) => l.round ?? 1))].sort((a, b) => a - b);
  const dirty = name.trim() !== (tab.tabName ?? '');

  const rename = async () => {
    setBusy(true);
    try { await api(`/orders/${tab.id}/tab`, { body: { tabName: name.trim() } }); toast(c.renamed); }
    catch (e) { toast(e instanceof ApiError ? e.message : String(e), 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Sheet title={<>{tabLabel(tab, lang)} <span className="tab-sheet-ticket">#{tab.ticketNumber}</span></>} onClose={onClose}>
      <div className="tab-sheet-name">
        <label>{c.rename}
          <input value={name} maxLength={40} placeholder={c.namePlaceholder} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && dirty) void rename(); }} />
        </label>
        {dirty && <button disabled={busy} onClick={() => void rename()}><Icon name="check" />{c.save}</button>}
      </div>
      <div className="tab-sheet-lines">
        {rounds.map((r) => (
          <section key={r}>
            {rounds.length > 1 && <h3>{c.round} {r}</h3>}
            <ul>
              {tab.lines.filter((l) => (l.round ?? 1) === r).map((l) => (
                <li key={l.id}>
                  <span className="tab-line-qty">{l.qty}×</span>
                  <span className="grow">{l.name}{l.modifiers.length > 0 && <small>{l.modifiers.map((m) => m.name).join(', ')}</small>}</span>
                  <b>{money(l.lineTotalCents)}</b>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <div className="tab-sheet-total"><span>{c.total} <small>{c.inclAbb} {money(tab.taxCents)}</small></span><b>{money(tab.totalCents)}</b></div>
      <div className="tab-sheet-actions">
        <button className="tab-sheet-bill" onClick={() => { void printReceipt(tab); toast(c.billSent); }}><Icon name="printer" />{c.bill}</button>
        <button className="tab-sheet-add" onClick={onAdd}><Icon name="plus" />{c.add}</button>
        <button className="primary tab-sheet-pay" onClick={onPay}><Icon name="cash" />{c.pay}<span>{money(tab.totalCents)}</span></button>
      </div>
    </Sheet>
  );
}
