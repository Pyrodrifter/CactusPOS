import { useCallback, useEffect, useRef, useState } from 'react';
import type { MenuResponse, Order, StockItem, StockKind, StockList, StockRow } from '@cactus/shared';
import { api, ApiError } from '../../lib/api';
import { STOCK_CHANGED } from '../../lib/live';
import { useLang } from '../../i18n';
import { Icon } from '../../ui/Icon';
import { haptic, Sheet, toast } from '../../ui/touch';
import './stock.css';

const copy = {
  en: {
    add: 'Add to stock', edit: 'Change', loading: 'Loading stock…', more: 'One more', less: 'One less',
    kinds: { prepared: 'Prepared for today', processed: 'Processed', whole: 'Whole ingredients' } satisfies Record<StockKind, string>,
    hints: { prepared: 'Starts at zero every day.', processed: 'Cut, cooked or mixed, ready to use.', whole: 'As it came from the supplier.' } satisfies Record<StockKind, string>,
    empty: 'Nothing here yet', emptyHint: 'Add what you want to keep count of, like burgers made for today or bags of buns.',
    prepared: 'Prepared', sold: 'sold', left: 'left', low: 'Running low',
    name: 'Name', namePlaceholder: 'e.g. Burgers', kind: 'Where it belongs', unit: 'Counted in', unitPlaceholder: 'pcs, kg, bags', countPrepared: 'Prepared today', countStock: 'In stock',
    lowAt: 'Warn at (optional)', links: 'Count down when sold', linksHint: 'Each one sold takes one off what was prepared.',
    save: 'Save', cancel: 'Cancel', remove: 'Remove', removed: 'Removed from the list', needName: 'Give it a name', badNumber: 'Enter a whole number',
  },
  nl: {
    add: 'Toevoegen aan voorraad', edit: 'Wijzigen', loading: 'Voorraad laden…', more: 'Eén meer', less: 'Eén minder',
    kinds: { prepared: 'Klaargemaakt voor vandaag', processed: 'Bewerkt', whole: 'Hele ingrediënten' } satisfies Record<StockKind, string>,
    hints: { prepared: 'Begint elke dag op nul.', processed: 'Gesneden, gegaard of gemengd, klaar voor gebruik.', whole: 'Zoals het van de leverancier kwam.' } satisfies Record<StockKind, string>,
    empty: 'Nog niets hier', emptyHint: 'Voeg toe wat je wilt tellen, zoals burgers voor vandaag of zakken broodjes.',
    prepared: 'Klaargemaakt', sold: 'verkocht', left: 'over', low: 'Bijna op',
    name: 'Naam', namePlaceholder: 'bijv. Burgers', kind: 'Waar het hoort', unit: 'Geteld in', unitPlaceholder: 'stuks, kg, zakken', countPrepared: 'Vandaag klaargemaakt', countStock: 'Op voorraad',
    lowAt: 'Waarschuwen bij (optioneel)', links: 'Aftellen bij verkoop', linksHint: 'Elke verkochte telt één af van wat is klaargemaakt.',
    save: 'Opslaan', cancel: 'Annuleren', remove: 'Verwijderen', removed: 'Van de lijst gehaald', needName: 'Geef het een naam', badNumber: 'Vul een heel getal in',
  },
};

const KINDS: StockKind[] = ['prepared', 'processed', 'whole'];
const message = (e: unknown) => (e instanceof ApiError ? e.message : String(e));
const whole = (s: string) => (/^\d{1,7}$/.test(s.trim()) ? Number(s) : null);

interface Draft { item: StockItem; isNew: boolean; count: string; lowAt: string; was: number }

/** Keeping count: what was prepared for today, and the general stock. Everyone who works the till can use it. */
export function StockView({ orders, menu }: { orders: Order[]; menu: MenuResponse }) {
  const { lang } = useLang();
  const c = copy[lang];
  const [list, setList] = useState<StockList | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // Replies can overtake each other on quick tapping: only the latest request may fill the list.
  const latest = useRef(0);
  const take = useCallback(async (request: Promise<StockList>) => {
    const mine = ++latest.current;
    const result = await request;
    if (mine === latest.current) setList(result);
  }, []);
  const load = useCallback(() => { take(api<StockList>('/stock')).catch((e) => toast(message(e), 'error')); }, [take]);
  // Orders are in the list so that what is left follows every sale, void and correction.
  useEffect(load, [load, orders]);
  useEffect(() => { window.addEventListener(STOCK_CHANGED, load); return () => window.removeEventListener(STOCK_CHANGED, load); }, [load]);

  const bump = (row: StockRow, delta: number) => {
    haptic(6);
    take(api<StockList>(`/stock/items/${row.id}/adjust`, { body: { delta } })).catch((e) => toast(message(e), 'error'));
  };
  const open = (row: StockRow) => {
    setErr('');
    const { qty, sold, left, ...item } = row;
    void sold; void left;
    setDraft({ item, isNew: false, count: String(qty), lowAt: row.lowAt === undefined ? '' : String(row.lowAt), was: qty });
  };
  const start = () => {
    setErr('');
    setDraft({ item: { id: `stock_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, name: '', kind: 'prepared', unit: '', menuItemIds: [] }, isNew: true, count: '0', lowAt: '', was: 0 });
  };
  const save = async () => {
    if (!draft || busy) return;
    const name = draft.item.name.trim(), count = whole(draft.count), lowAt = draft.lowAt.trim() ? whole(draft.lowAt) : undefined;
    if (!name) return setErr(c.needName);
    if (count === null || lowAt === null) return setErr(c.badNumber);
    setBusy(true); setErr('');
    try {
      await api(`/stock/items/${draft.item.id}`, { method: 'PUT', body: { ...draft.item, name, lowAt } });
      if (count !== draft.was) await api(`/stock/items/${draft.item.id}/adjust`, { body: { delta: count - draft.was } });
      load();
      setDraft(null);
    } catch (e) { setErr(message(e)); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!draft || busy) return;
    setBusy(true); setErr('');
    try { await take(api<StockList>(`/stock/items/${draft.item.id}`, { method: 'DELETE' })); toast(c.removed); setDraft(null); }
    catch (e) { setErr(message(e)); } finally { setBusy(false); }
  };

  if (!list) return <p className="muted center" role="status">{c.loading}</p>;
  const set = (patch: Partial<StockItem>) => draft && setDraft({ ...draft, item: { ...draft.item, ...patch } });
  return (
    <div className="stock">
      <div className="stock-bar"><button className="primary stock-add" onClick={start}><Icon name="plus" />{c.add}</button></div>
      {!list.items.length && <div className="pos-orders-empty"><Icon name="box" size={40} /><h2>{c.empty}</h2><p>{c.emptyHint}</p></div>}
      {KINDS.map((kind) => {
        const rows = list.items.filter((i) => i.kind === kind);
        if (!rows.length) return null;
        return (
          <section key={kind} className="stock-group" aria-label={c.kinds[kind]}>
            <h2>{c.kinds[kind]}<small>{c.hints[kind]}</small></h2>
            <ul>
              {rows.map((row) => {
                const low = row.lowAt !== undefined && row.left <= row.lowAt;
                const detail = kind === 'prepared' ? `${c.prepared} ${row.qty}${row.menuItemIds.length ? ` · ${row.sold} ${c.sold}` : ''}` : row.unit;
                return (
                  <li key={row.id} className={low ? 'is-low' : ''}>
                    <button className="stock-row-main" aria-label={`${c.edit}: ${row.name}`} onClick={() => open(row)}>
                      <b>{row.name}</b>
                      <small>{detail}{low ? ` · ${c.low}` : ''}</small>
                    </button>
                    <div className="stock-count">
                      <button aria-label={`${c.less}: ${row.name}`} disabled={row.qty <= 0} onClick={() => bump(row, -1)}><Icon name="minus" /></button>
                      <strong>{row.left}{kind === 'prepared' && <small>{c.left}</small>}</strong>
                      <button aria-label={`${c.more}: ${row.name}`} onClick={() => bump(row, 1)}><Icon name="plus" /></button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {draft && (
        <Sheet title={draft.isNew ? c.add : draft.item.name} onClose={() => !busy && setDraft(null)}>
          <div className="stock-form">
            <label>{c.name}<input autoFocus={draft.isNew} maxLength={60} placeholder={c.namePlaceholder} value={draft.item.name} onChange={(e) => set({ name: e.target.value })} /></label>
            <div className="stock-field"><span>{c.kind}</span>
              <div className="chips">{KINDS.map((kind) => <button key={kind} type="button" aria-pressed={draft.item.kind === kind} className={draft.item.kind === kind ? 'on' : ''} onClick={() => set({ kind })}>{c.kinds[kind]}</button>)}</div>
            </div>
            <div className="two">
              <label>{draft.item.kind === 'prepared' ? c.countPrepared : c.countStock}<input inputMode="numeric" value={draft.count} onChange={(e) => setDraft({ ...draft, count: e.target.value })} /></label>
              <label>{c.unit}<input maxLength={20} placeholder={c.unitPlaceholder} value={draft.item.unit} onChange={(e) => set({ unit: e.target.value })} /></label>
            </div>
            <label>{c.lowAt}<input inputMode="numeric" value={draft.lowAt} onChange={(e) => setDraft({ ...draft, lowAt: e.target.value })} /></label>
            {draft.item.kind === 'prepared' && (
              <div className="stock-field"><span>{c.links}</span><small className="muted">{c.linksHint}</small>
                <div className="chips">{menu.items.map((i) => {
                  const on = draft.item.menuItemIds.includes(i.id);
                  return <button key={i.id} type="button" aria-pressed={on} className={on ? 'on' : ''} onClick={() => set({ menuItemIds: on ? draft.item.menuItemIds.filter((x) => x !== i.id) : [...draft.item.menuItemIds, i.id] })}>{i.name}</button>;
                })}</div>
              </div>
            )}
            {err && <div className="error" role="alert">{err}</div>}
            <div className="actions">
              {!draft.isNew && <button type="button" className="ghost stock-remove" disabled={busy} onClick={() => void remove()}><Icon name="trash" />{c.remove}</button>}
              <button type="button" className="ghost" disabled={busy} onClick={() => setDraft(null)}>{c.cancel}</button>
              <button type="button" className="primary stock-save" disabled={busy} onClick={() => void save()}><Icon name="check" />{c.save}</button>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}
