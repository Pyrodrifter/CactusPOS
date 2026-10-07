import { useCallback, useEffect, useState } from 'react';
import { formatMoney, parseMoney, type MenuCategory, type MenuItem, type ModifierGroup, type TaxCategory } from '@cactus/shared';
import { api } from '../../lib/api';
import { useLang } from '../../i18n';
import { errText, newId } from './Admin';

interface Menu { categories: MenuCategory[]; items: MenuItem[]; taxCategories: TaxCategory[] }
const dollars = (c: number) => (c / 100).toFixed(2);

export function MenuAdmin() {
  const { t } = useLang();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [cat, setCat] = useState('');
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const m = await api<Menu>('/menu');
    setMenu(m);
    setCat((c) => (m.categories.some((x) => x.id === c) ? c : m.categories[0]?.id ?? ''));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setErr('');
    try { await fn(); await load(); } catch (e) { setErr(errText(e)); }
  };

  if (!menu) return <p className="muted center">…</p>;
  const current = menu.categories.find((c) => c.id === cat);
  const items = menu.items.filter((i) => i.categoryId === cat).sort((a, b) => a.name.localeCompare(b.name));

  const addCategory = () => {
    const name = prompt(t('admin.catName'));
    if (!name?.trim()) return;
    const id = newId('cat');
    void run(async () => { await api(`/admin/menu/categories/${id}`, { method: 'PUT', body: { name: name.trim(), sort: menu.categories.length + 1 } }); setCat(id); });
  };
  const renameCategory = () => {
    if (!current) return;
    const name = prompt(t('admin.catName'), current.name);
    if (!name?.trim()) return;
    void run(() => api(`/admin/menu/categories/${current.id}`, { method: 'PUT', body: { name: name.trim(), sort: current.sort } }));
  };
  const moveCategory = (dir: -1 | 1) => {
    const list = [...menu.categories];
    const i = list.findIndex((c) => c.id === cat);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    void run(() => Promise.all(list.map((c, n) => api(`/admin/menu/categories/${c.id}`, { method: 'PUT', body: { name: c.name, sort: n + 1 } }))));
  };

  const blank = (): MenuItem => ({
    id: newId('item'), categoryId: cat, name: '', priceCents: 0,
    taxCategoryId: menu.taxCategories.find((x) => x.kind === 'taxed')?.id ?? menu.taxCategories[0]?.id ?? '',
    station: 'kitchen', available: true, modifierGroups: [], openPrice: false,
  });

  return (
    <div>
      {err && <div className="error">{err}</div>}
      <div className="cats">
        {menu.categories.map((c) => <button key={c.id} className={c.id === cat ? 'on' : ''} onClick={() => setCat(c.id)}>{c.name}</button>)}
        <button className="ghost" onClick={addCategory}>+ {t('admin.addCat')}</button>
      </div>
      {current && (
        <div className="row-actions pad">
          <button className="ghost" onClick={() => moveCategory(-1)} aria-label="Move left">←</button>
          <button className="ghost" onClick={() => moveCategory(1)} aria-label="Move right">→</button>
          <button className="ghost" onClick={renameCategory}>{t('admin.rename')}</button>
          <button className="ghost" onClick={() => confirm(t('admin.confirmDelete')) && void run(() => api(`/admin/menu/categories/${current.id}`, { method: 'DELETE' }))}>{t('admin.delete')}</button>
          <span className="spacer" />
          <button className="primary" onClick={() => setEditing(blank())}>+ {t('admin.addItem')}</button>
        </div>
      )}
      <ul className="orders">
        {items.map((i) => (
          <li key={i.id}>
            <div className="grow">
              <div><b>{i.name}</b></div>
              <small className="muted">
                {menu.taxCategories.find((x) => x.id === i.taxCategoryId)?.name} · {i.station}
                {i.modifierGroups.length > 0 && ` · ${i.modifierGroups.map((g) => g.name).join(', ')}`}
              </small>
            </div>
            <b>{i.openPrice ? t('pos.market') : formatMoney(i.priceCents)}</b>
            <div className="row-actions">
              <button className={i.available ? '' : 'on'} onClick={() => void run(() => api(`/menu/items/${i.id}/available`, { body: { available: !i.available } }))}>
                {i.available ? t('admin.inStock') : t('soldout')}
              </button>
              <button onClick={() => setEditing(i)}>{t('admin.edit')}</button>
            </div>
          </li>
        ))}
        {current && items.length === 0 && <p className="muted center">{t('admin.noItems')}</p>}
      </ul>
      {editing && (
        <ItemEditor
          item={editing} menu={menu} isNew={!menu.items.some((i) => i.id === editing.id)}
          onClose={() => setEditing(null)}
          onSave={async (item) => { await api(`/admin/menu/items/${item.id}`, { method: 'PUT', body: item }); setEditing(null); await load(); }}
          onDelete={async () => { await api(`/admin/menu/items/${editing.id}`, { method: 'DELETE' }); setEditing(null); await load(); }}
        />
      )}
    </div>
  );
}

function ItemEditor({ item, menu, isNew, onSave, onDelete, onClose }: {
  item: MenuItem; menu: Menu; isNew: boolean;
  onSave: (i: MenuItem) => Promise<void>; onDelete: () => Promise<void>; onClose: () => void;
}) {
  const { t } = useLang();
  const [d, setD] = useState<MenuItem>(item);
  const [price, setPrice] = useState(isNew ? '' : dollars(item.priceCents));
  const [deltas, setDeltas] = useState<Record<string, string>>(
    Object.fromEntries(item.modifierGroups.flatMap((g) => g.options.map((o) => [o.id, dollars(o.priceDeltaCents)]))));
  const [err, setErr] = useState('');
  const tax = menu.taxCategories.find((x) => x.id === d.taxCategoryId);

  const setGroup = (gid: string, patch: Partial<ModifierGroup>) =>
    setD((x) => ({ ...x, modifierGroups: x.modifierGroups.map((g) => (g.id === gid ? { ...g, ...patch } : g)) }));

  const save = async () => {
    const cents = parseMoney(price);
    if (!d.name.trim()) return setErr(t('admin.needName'));
    if (cents === null && !d.openPrice) return setErr(t('admin.badPrice'));
    const groups: ModifierGroup[] = [];
    for (const g of d.modifierGroups) {
      const options = [];
      for (const o of g.options) {
        const dc = parseMoney(deltas[o.id] || '0');
        if (dc === null || !o.name.trim()) return setErr(t('admin.badOption'));
        options.push({ ...o, name: o.name.trim(), priceDeltaCents: dc });
      }
      groups.push({ ...g, name: g.name.trim() || t('admin.options'), options });
    }
    try { await onSave({ ...d, name: d.name.trim(), description: d.description?.trim() || undefined, priceCents: d.openPrice ? 0 : cents!, modifierGroups: groups }); } catch (e) { setErr(errText(e)); }
  };

  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet wide" onClick={(e) => e.stopPropagation()}>
        <h2>{isNew ? t('admin.addItem') : t('admin.edit')}</h2>
        <label>{t('admin.name')}<input value={d.name} autoFocus onChange={(e) => setD({ ...d, name: e.target.value })} /></label>
        <div className="two">
          <label>{t('admin.price')}<input inputMode="decimal" value={d.openPrice ? '' : price} disabled={d.openPrice} placeholder={d.openPrice ? t('pos.market') : '0.00'} onChange={(e) => setPrice(e.target.value)} /></label>
          <label>{t('admin.category')}
            <select value={d.categoryId} onChange={(e) => setD({ ...d, categoryId: e.target.value })}>
              {menu.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </div>
        <div className="two">
          <label>{t('admin.taxCat')}
            <select value={d.taxCategoryId} onChange={(e) => setD({ ...d, taxCategoryId: e.target.value })}>
              {menu.taxCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>{t('admin.station')}
            <select value={d.station} onChange={(e) => setD({ ...d, station: e.target.value })}>
              <option value="kitchen">{t('nav.kitchen')}</option>
              <option value="bar">{t('admin.bar')}</option>
            </select>
          </label>
        </div>
        <div className="chips"><button className={d.openPrice ? 'on' : ''} onClick={() => setD({ ...d, openPrice: !d.openPrice })}>{t('admin.openPrice')}</button></div>
        <label>{t('admin.description')}<input value={d.description ?? ''} onChange={(e) => setD({ ...d, description: e.target.value })} /></label>
        {tax?.unverified && <small className="warn-text">{t('admin.taxUnverified')}</small>}

        <h3>{t('admin.options')}</h3>
        {d.modifierGroups.map((g) => (
          <div key={g.id} className="group-edit">
            <div className="two">
              <input value={g.name} placeholder={t('admin.groupName')} onChange={(e) => setGroup(g.id, { name: e.target.value })} />
              <button className="ghost" onClick={() => setD({ ...d, modifierGroups: d.modifierGroups.filter((x) => x.id !== g.id) })}>{t('admin.delete')}</button>
            </div>
            <div className="chips">
              <button className={g.required ? 'on' : ''} onClick={() => setGroup(g.id, { required: !g.required })}>{t('mods.required')}</button>
              <button className={g.multi ? 'on' : ''} onClick={() => setGroup(g.id, { multi: !g.multi })}>{t('admin.multi')}</button>
            </div>
            {g.options.map((o) => (
              <div key={o.id} className="opt-row">
                <input value={o.name} placeholder={t('admin.optName')} onChange={(e) => setGroup(g.id, { options: g.options.map((x) => (x.id === o.id ? { ...x, name: e.target.value } : x)) })} />
                <input className="narrow" inputMode="decimal" value={deltas[o.id] ?? ''} placeholder="+0.00" onChange={(e) => setDeltas({ ...deltas, [o.id]: e.target.value })} />
                <button className="ghost" aria-label={t('admin.delete')} onClick={() => setGroup(g.id, { options: g.options.filter((x) => x.id !== o.id) })}>✕</button>
              </div>
            ))}
            <button className="ghost" onClick={() => setGroup(g.id, { options: [...g.options, { id: newId('opt'), name: '', priceDeltaCents: 0 }] })}>+ {t('admin.addOption')}</button>
          </div>
        ))}
        <button className="ghost" onClick={() => setD({ ...d, modifierGroups: [...d.modifierGroups, { id: newId('grp'), name: '', required: false, multi: false, options: [{ id: newId('opt'), name: '', priceDeltaCents: 0 }] }] })}>
          + {t('admin.addGroup')}
        </button>

        {err && <div className="error">{err}</div>}
        <div className="actions">
          {!isNew && <button className="ghost danger" onClick={() => confirm(t('admin.confirmDelete')) && void onDelete().catch((e) => setErr(errText(e)))}>{t('admin.delete')}</button>}
          <button className="ghost" onClick={onClose}>{t('pay.cancel')}</button>
          <button className="primary" onClick={() => void save()}>{t('admin.save')}</button>
        </div>
      </div>
    </div>
  );
}
