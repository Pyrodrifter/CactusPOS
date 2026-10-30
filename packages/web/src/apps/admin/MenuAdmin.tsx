import { useCallback, useEffect, useState } from 'react';
import { formatMoney, grossFromNet, parseMoney, taxInGross, type MenuItem, type MenuResponse, type ModifierGroup } from '@cactus/shared';
import { api } from '../../lib/api';
import { useLang } from '../../i18n';
import { errText, newId } from './Admin';
import { Icon } from '../../ui/Icon';
import { AdminDialog } from './AdminDialog';
import { AdminSwitch, ConfirmDialog, NameDialog, ScrollRow } from './controls';
import { useAdminCopy } from './copy';
import { pct, rateToday } from './TaxAdmin';

type Menu = MenuResponse;
const dollars = (c: number) => (c / 100).toFixed(2);

/**
 * Prices are always stored and charged with ABB in them. "Without ABB" only changes what the owner types:
 * the field shows the price minus its ABB, and the typed amount gets the ABB added on save.
 */
const EX_ABB_KEY = 'cactus.admin.pricesWithoutAbb';
const readExAbb = () => { try { return localStorage.getItem(EX_ABB_KEY) === '1'; } catch { return false; } };
/** The tax category a new item gets: the one the menu already uses most (set for the whole menu in Admin > Tax). */
const menuTax = (menu: MenuResponse) => {
  const count = new Map<string, number>();
  for (const i of menu.items) count.set(i.taxCategoryId, (count.get(i.taxCategoryId) ?? 0) + 1);
  const most = [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
  return most ?? menu.taxCategories.find((x) => x.kind === 'taxed')?.id ?? menu.taxCategories[0]?.id ?? '';
};
const shownPrice = (cents: number, ex: boolean, bps: number) => dollars(ex ? cents - taxInGross(cents, bps) : cents);
/**
 * Stored (inclusive) cents for a field, or null when it is not an amount. An untouched field keeps its stored
 * price exactly: not every inclusive price is reachable from a whole-cent net, so converting back could move it a cent.
 */
const storedPrice = (text: string, ex: boolean, bps: number, original?: number): number | null => {
  const cents = parseMoney(text);
  if (cents === null || !ex) return cents;
  if (original !== undefined && text === shownPrice(original, true, bps)) return original;
  return grossFromNet(cents, bps);
};

export function MenuAdmin() {
  const { t } = useLang();
  const copy = useAdminCopy();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [cat, setCat] = useState('');
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [ask, setAsk] = useState<'add' | 'rename' | 'delete' | null>(null);
  const [pending, setPending] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const m = await api<Menu>('/menu');
    setMenu(m);
    setCat((c) => (m.categories.some((x) => x.id === c) ? c : m.categories[0]?.id ?? ''));
  }, []);
  useEffect(() => { void load().catch((e) => setErr(errText(e))); }, [load]);
  /** After a dialog has done its work and closed: reload, and report a failed reload on the page. */
  const refresh = () => load().catch((e) => setErr(errText(e)));

  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setErr('');
    try { await fn(); await load(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };

  if (!menu) return <p className={err ? 'error' : 'muted center'} role={err ? 'alert' : 'status'}>{err || copy.loading}</p>;
  const current = menu.categories.find((c) => c.id === cat);
  const items = menu.items.filter((i) => i.categoryId === cat).sort((a, b) => a.name.localeCompare(b.name));

  const addCategory = async (name: string) => {
    const id = newId('cat');
    await api(`/admin/menu/categories/${id}`, { method: 'PUT', body: { name, sort: menu.categories.length + 1 } });
    setCat(id);
    setAsk(null);
    await refresh();
  };
  const renameCategory = async (name: string) => {
    if (!current) return;
    await api(`/admin/menu/categories/${current.id}`, { method: 'PUT', body: { name, sort: current.sort } });
    setAsk(null);
    await refresh();
  };
  const deleteCategory = async () => {
    if (!current) return;
    await api(`/admin/menu/categories/${current.id}`, { method: 'DELETE' });
    setAsk(null);
    await refresh();
  };
  const moveCategory = (dir: -1 | 1) => {
    const list = [...menu.categories];
    const i = list.findIndex((c) => c.id === cat);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    void run(() => Promise.all(list.map((c, n) => api(`/admin/menu/categories/${c.id}`, { method: 'PUT', body: { name: c.name, sort: n + 1 } }))));
  };
  const toggleAvailable = (i: MenuItem) => {
    if (busy) return;
    setPending(i.id);
    void run(() => api(`/menu/items/${i.id}/available`, { body: { available: !i.available } })).finally(() => setPending(''));
  };
  const open = (dialog: 'add' | 'rename' | 'delete') => { setErr(''); setAsk(dialog); };
  const stationName = (s: string) => (s === 'kitchen' ? t('nav.kitchen') : s === 'bar' ? t('admin.bar') : s);

  const blank = (): MenuItem => ({
    id: newId('item'), categoryId: cat, name: '', priceCents: 0,
    taxCategoryId: menuTax(menu),
    station: 'kitchen', available: true, modifierGroups: [], openPrice: false,
  });

  return (
    <div className="menu-admin" aria-busy={busy}>
      {err && <div className="error" role="alert">{err}</div>}
      <ScrollRow className="admin-cats" label={copy.categories}>
        {menu.categories.map((c) => <button key={c.id} type="button" className={c.id === cat ? 'on' : ''} data-active={c.id === cat} aria-pressed={c.id === cat} onClick={() => setCat(c.id)}>{c.name}</button>)}
        <button type="button" className="ghost admin-cat-add" disabled={busy} onClick={() => open('add')}><Icon name="plus" />{t('admin.addCat')}</button>
      </ScrollRow>
      {/* One row on a landscape tablet (name, category tools, Add item); two rows when narrower. */}
      <div className="menu-head">
        <h3 className="menu-title"><span>{current?.name ?? copy.menuItems}</span> <span className="admin-count">{items.length}</span></h3>
        {current && (
          <div className="admin-toolbar">
            <button type="button" className="ghost admin-move" aria-label={copy.earlier} disabled={busy || menu.categories[0]?.id === cat} onClick={() => moveCategory(-1)}><Icon name="arrow-left" /><span>{copy.earlier}</span></button>
            <button type="button" className="ghost admin-move" aria-label={copy.later} disabled={busy || menu.categories.at(-1)?.id === cat} onClick={() => moveCategory(1)}><Icon name="arrow-right" /><span>{copy.later}</span></button>
            <button type="button" className="ghost admin-rename" disabled={busy} onClick={() => open('rename')}><Icon name="edit" />{t('admin.rename')}</button>
            <button type="button" className="ghost danger admin-remove" aria-label={`${t('admin.delete')}: ${current.name}`} disabled={busy} onClick={() => open('delete')}><Icon name="trash" /><span>{t('admin.delete')}</span></button>
          </div>
        )}
        {current && <button type="button" className="primary admin-add" disabled={busy} onClick={() => setEditing(blank())}><Icon name="plus" />{t('admin.addItem')}</button>}
      </div>
      <ul className="admin-rows" aria-label={current?.name ?? copy.menuItems}>
        {items.map((i) => (
          <li key={i.id} className={`admin-row${i.available ? '' : ' is-off'}`}>
            <button type="button" className="admin-row-main" aria-label={`${t('admin.edit')}: ${i.name}`} aria-disabled={busy} onClick={() => { if (!busy) setEditing(i); }}>
              <span className="admin-row-text">
                <b>{i.name}</b>
                <small>
                  {/* Tax is the same for the whole menu (Admin > Tax), so the row shows only what differs per item. */}
                  {stationName(i.station)}
                  {i.modifierGroups.length > 0 && ` · ${i.modifierGroups.map((g) => g.name).join(', ')}`}
                </small>
              </span>
              <b className="admin-row-price">{i.openPrice ? t('pos.market') : formatMoney(i.priceCents)}</b>
              <Icon name="edit" className="admin-row-go" />
            </button>
            <button type="button" role="switch" aria-checked={i.available} className={`admin-avail${i.available ? ' is-on' : ''}`}
              aria-label={`${i.name}: ${i.available ? t('admin.inStock') : t('soldout')}`} aria-busy={pending === i.id} onClick={() => toggleAvailable(i)}>
              <span className="admin-switch-track" aria-hidden="true"><i /></span>
              <span>{i.available ? t('admin.inStock') : t('soldout')}</span>
            </button>
          </li>
        ))}
        {current && items.length === 0 && <li className="admin-rows-empty muted center">{t('admin.noItems')}</li>}
      </ul>
      {items.length > 0 && <p className="admin-list-note">{copy.availableHint}</p>}
      {ask === 'add' && (
        <NameDialog title={copy.newCategory} label={t('admin.catName')} placeholder={copy.categoryExample} saveLabel={copy.add}
          emptyError={copy.needCategoryName} onSave={addCategory} onClose={() => setAsk(null)} />
      )}
      {ask === 'rename' && current && (
        <NameDialog title={copy.renameCategory} label={t('admin.catName')} initial={current.name} saveLabel={t('admin.save')}
          emptyError={copy.needCategoryName} onSave={renameCategory} onClose={() => setAsk(null)} />
      )}
      {ask === 'delete' && current && (
        <ConfirmDialog title={copy.deleteNamed(current.name)} text={copy.deleteCategoryText} confirmLabel={t('admin.delete')}
          onConfirm={deleteCategory} onClose={() => setAsk(null)} />
      )}
      {editing && (
        <ItemEditor
          item={editing} menu={menu} isNew={!menu.items.some((i) => i.id === editing.id)}
          onClose={() => setEditing(null)}
          onSave={async (item) => { await api(`/admin/menu/items/${item.id}`, { method: 'PUT', body: item }); setEditing(null); await refresh(); }}
          onDelete={async () => { await api(`/admin/menu/items/${editing.id}`, { method: 'DELETE' }); setEditing(null); await refresh(); }}
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
  const copy = useAdminCopy();
  const [d, setD] = useState<MenuItem>(item);
  const tax = menu.taxCategories.find((x) => x.id === d.taxCategoryId);
  const bps = (tax && rateToday(tax)) ?? 0;
  const [ex, setEx] = useState(readExAbb);
  const originalDeltas = Object.fromEntries(item.modifierGroups.flatMap((g) => g.options.map((o) => [o.id, o.priceDeltaCents])));
  const original = isNew ? undefined : item.priceCents;
  const [price, setPrice] = useState(() => (original === undefined ? '' : shownPrice(original, ex, bps)));
  const [deltas, setDeltas] = useState<Record<string, string>>(
    () => Object.fromEntries(Object.entries(originalDeltas).map(([id, c]) => [id, shownPrice(c, ex, bps)])));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const toCents = (text: string, orig?: number) => storedPrice(text, ex, bps, orig);
  const priceCents = d.openPrice ? null : toCents(price, original);

  /** Flip how prices are typed; every field is rewritten so the price the customer pays stays the same. */
  const switchEx = (next: boolean) => {
    const flip = (text: string, orig?: number) => { const c = toCents(text, orig); return c === null ? text : shownPrice(c, next, bps); };
    setPrice(flip(price, original));
    setDeltas(Object.fromEntries(Object.entries(deltas).map(([id, text]) => [id, flip(text, originalDeltas[id])])));
    setEx(next);
    try { localStorage.setItem(EX_ABB_KEY, next ? '1' : '0'); } catch { /* only a convenience */ }
  };

  const setGroup = (gid: string, patch: Partial<ModifierGroup>) =>
    setD((x) => ({ ...x, modifierGroups: x.modifierGroups.map((g) => (g.id === gid ? { ...g, ...patch } : g)) }));

  const save = async () => {
    if (busy) return;
    setErr('');
    const cents = priceCents;
    if (!d.name.trim()) return setErr(t('admin.needName'));
    if (cents === null && !d.openPrice) return setErr(t('admin.badPrice'));
    const groups: ModifierGroup[] = [];
    for (const g of d.modifierGroups) {
      const options = [];
      for (const o of g.options) {
        const dc = toCents(deltas[o.id] || '0', originalDeltas[o.id]);
        if (dc === null || !o.name.trim()) return setErr(t('admin.badOption'));
        options.push({ ...o, name: o.name.trim(), priceDeltaCents: dc });
      }
      groups.push({ ...g, name: g.name.trim() || t('admin.options'), options });
    }
    setBusy(true);
    try { await onSave({ ...d, name: d.name.trim(), description: d.description?.trim() || undefined, priceCents: d.openPrice ? 0 : cents!, modifierGroups: groups }); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };

  return (
    <>
      <AdminDialog title={isNew ? t('admin.addItem') : `${t('admin.edit')} · ${item.name}`} onClose={onClose} busy={busy} wide error={err} footer={<>
        <button type="button" className="ghost" disabled={busy} onClick={onClose}>{t('pay.cancel')}</button>
        <button type="button" className="primary" disabled={busy} onClick={() => void save()}><Icon name="check" />{busy ? copy.saving : t('admin.save')}</button>
      </>}>
        <label>{t('admin.name')}<input value={d.name} autoFocus onChange={(e) => setD({ ...d, name: e.target.value })} /></label>
        <div className="two">
          <label>{ex ? copy.priceEx : t('admin.price')}<input inputMode="decimal" value={d.openPrice ? '' : price} disabled={d.openPrice} placeholder={d.openPrice ? t('pos.market') : '0.00'} onChange={(e) => setPrice(e.target.value)} /></label>
          <label>{t('admin.category')}
            <select value={d.categoryId} onChange={(e) => setD({ ...d, categoryId: e.target.value })}>
              {menu.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </div>
        <div className="two">
          {/* Tax is set once for the whole menu in Admin > Tax (TAX03); here it is only shown. */}
          <div className="menu-tax-readonly"><span className="admin-field-label">{t('admin.taxCat')}</span><strong>{tax?.name ?? '—'}</strong><small className="muted">{copy.taxSetInTax}</small></div>
          <label>{t('admin.station')}
            <select value={d.station} onChange={(e) => setD({ ...d, station: e.target.value })}>
              <option value="kitchen">{t('nav.kitchen')}</option>
              <option value="bar">{t('admin.bar')}</option>
            </select>
          </label>
        </div>
        {priceCents !== null && <small className="muted">{copy.customerPays(formatMoney(priceCents), formatMoney(taxInGross(priceCents, bps)), pct(bps))}</small>}
        <AdminSwitch on={ex} onChange={switchEx} label={copy.exAbb} hint={copy.exAbbHint} />
        <AdminSwitch on={d.openPrice} onChange={(openPrice) => setD({ ...d, openPrice })} label={t('admin.openPrice')} />
        <label>{t('admin.description')}<input value={d.description ?? ''} onChange={(e) => setD({ ...d, description: e.target.value })} /></label>
        {tax?.unverified && <small className="warn-text">{t('admin.taxUnverified')}</small>}

        <div className="admin-dialog-section">
          <h3>{t('admin.options')}</h3>
          <small className="muted">{copy.optionsHint}</small>
        </div>
        {d.modifierGroups.map((g) => (
          <div key={g.id} className="group-edit">
            <div className="group-edit-head">
              <label>{t('admin.groupName')}<input value={g.name} placeholder={t('admin.groupName')} onChange={(e) => setGroup(g.id, { name: e.target.value })} /></label>
              <button type="button" className="ghost danger" aria-label={`${t('admin.delete')}: ${g.name || t('admin.groupName')}`} onClick={() => setD({ ...d, modifierGroups: d.modifierGroups.filter((x) => x.id !== g.id) })}><Icon name="trash" /></button>
            </div>
            <div className="two">
              <AdminSwitch on={g.required} onChange={(required) => setGroup(g.id, { required })} label={t('mods.required')} />
              <AdminSwitch on={g.multi} onChange={(multi) => setGroup(g.id, { multi })} label={t('admin.multi')} />
            </div>
            {g.options.map((o) => (
              <div key={o.id} className="opt-row">
                <label>{copy.optionName}<input value={o.name} placeholder={t('admin.optName')} onChange={(e) => setGroup(g.id, { options: g.options.map((x) => (x.id === o.id ? { ...x, name: e.target.value } : x)) })} /></label>
                <label>{copy.optionPrice}{ex && copy.withoutAbb}<input inputMode="decimal" value={deltas[o.id] ?? ''} placeholder="+0.00" onChange={(e) => setDeltas({ ...deltas, [o.id]: e.target.value })} /></label>
                <button type="button" className="ghost danger" aria-label={`${t('admin.delete')}: ${o.name || copy.optionName}`} onClick={() => setGroup(g.id, { options: g.options.filter((x) => x.id !== o.id) })}><Icon name="trash" /></button>
              </div>
            ))}
            <button type="button" className="ghost" onClick={() => setGroup(g.id, { options: [...g.options, { id: newId('opt'), name: '', priceDeltaCents: 0 }] })}><Icon name="plus" />{t('admin.addOption')}</button>
          </div>
        ))}
        <button type="button" className="ghost" onClick={() => setD({ ...d, modifierGroups: [...d.modifierGroups, { id: newId('grp'), name: '', required: false, multi: false, options: [{ id: newId('opt'), name: '', priceDeltaCents: 0 }] }] })}>
          <Icon name="plus" />{t('admin.addGroup')}
        </button>

        {!isNew && (
          <div className="admin-danger-zone">
            <button type="button" className="ghost danger" disabled={busy} onClick={() => setConfirming(true)}><Icon name="trash" />{copy.deleteItem}</button>
          </div>
        )}
      </AdminDialog>
      {confirming && (
        <ConfirmDialog title={copy.deleteNamed(item.name)} text={copy.deleteItemText} confirmLabel={t('admin.delete')}
          onConfirm={onDelete} onClose={() => setConfirming(false)} />
      )}
    </>
  );
}
