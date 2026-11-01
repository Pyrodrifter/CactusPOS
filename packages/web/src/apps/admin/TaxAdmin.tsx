import { useCallback, useEffect, useState } from 'react';
import { formatMoney, rateAt, taxInGross, TaxKind, type MenuResponse, type TaxCategory, type TaxExemption } from '@cactus/shared';
import { api } from '../../lib/api';
import { useLang } from '../../i18n';
import { errText, newId } from './Admin';
import { Icon } from '../../ui/Icon';
import { AdminDialog } from './AdminDialog';
import { AdminSwitch } from './controls';
import { toast } from '../../ui/touch';
import { useAdminCopy } from './copy';

const today = () => new Date().toISOString().slice(0, 10);
export const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;
/** Rate in force today, or null when a taxed category has no row covering today (a sale would be refused). */
export const rateToday =(c: TaxCategory): number | null => { try { return rateAt(c, today()); } catch { return null; } };
/** Rate % as typed ("6", "6,5") to basis points; null when it is not a rate. An empty field is not 0%. */
const parseBps = (s: string): number | null => {
  const n = Number(s.replace(',', '.'));
  return s.trim() && Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) : null;
};
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * Bonaire starting points for a new category (Belastingdienst CN rate table). They only fill the form:
 * the owner still checks them with the accountant.
 */
const PRESETS = [
  { id: 'service_6', kind: 'taxed', bps: 600 },
  { id: 'insurance_7', kind: 'taxed', bps: 700 },
  { id: 'zero_rated', kind: 'taxed', bps: 0 },
  { id: 'exempt', kind: 'exempt', bps: 0 },
  { id: 'outside_scope', kind: 'outside_scope', bps: 0 },
] as const;
type Preset = typeof PRESETS[number];

const COPY = {
  en: {
    intro: 'Menu prices always include ABB: on Bonaire, prices for customers may not leave the ABB out. The till takes the ABB out of each price for the receipt and the day report.',
    check: 'Tax check', example: (price: string, net: string, tax: string, rate: string) => `${price} on the menu = ${net} + ${tax} ABB (${rate})`,
    noRate: (name: string) => `${name} has no rate for today. Items in it cannot be sold until you add one.`,
    unverifiedUsed: (n: number) => `${n} tax ${n === 1 ? 'category is' : 'categories are'} used on the menu but not verified with the accountant yet.`,
    allGood: 'Every category used on the menu has a rate for today and is verified.',
    items: (n: number) => (n === 1 ? '1 menu item' : `${n} menu items`), noItems: 'No menu items', allItems: 'The whole menu',
    applyAll: 'Use for the whole menu', applied: (n: number) => `${n} menu ${n === 1 ? 'item' : 'items'} changed.`, remove: 'Remove',
    oneRate: 'Tax is set here for the whole menu, not per item.',
    addCategory: 'New tax category', editCategory: 'Change category', startFrom: 'Start from',
    kind: 'Kind', taxed: 'Taxed (ABB)', ground: 'Legal ground', groundHint: 'Write down why no ABB applies; the Belastingdienst can ask for it.',
    needName: 'Give the category a name', needGround: 'Write down the legal ground', already: 'already set up',
    preset: { service_6: 'Services 6%', insurance_7: 'Insurance 7%', zero_rated: 'Zero-rated 0% (export)', exempt: 'Exempt', outside_scope: 'Outside scope' } satisfies Record<Preset['id'], string>,
    charge: 'Charge ABB', chargeOn: 'Sales are taxed by the categories below.', chargeOff: (reason: string) => `Off: every new sale is recorded as exempt (${reason}). Earlier sales keep their ABB.`,
    offTitle: 'Switch ABB off', offIntro: 'Only for a business that is allowed to sell without ABB. Check it with the accountant or the Belastingdienst first. Prices stay the same; from now on they hold no ABB.',
    offReason: 'Why no ABB is charged', offExample: 'e.g. food truck (trukipan) arrangement', offDefault: 'food trucks, fishermen and small food carts are exempt', offCheck: 'ABB is switched off, so no sale gets ABB. Prices on the menu are what the customer pays.',
    grounds: { exempt: ['First necessities of life (staple foods)', 'Prescription medicines and medical aids', 'Water, electricity and gas from a licensed supplier'], outside_scope: ['Resale of goods bought or imported (not a producer)'] },
  },
  nl: {
    intro: 'Menuprijzen zijn altijd inclusief ABB: op Bonaire mogen prijzen voor klanten de ABB niet weglaten. De kassa haalt de ABB uit elke prijs voor de bon en het dagrapport.',
    check: 'Belastingcontrole', example: (price: string, net: string, tax: string, rate: string) => `${price} op het menu = ${net} + ${tax} ABB (${rate})`,
    noRate: (name: string) => `${name} heeft geen tarief voor vandaag. Items hierin kunnen pas verkocht worden als u er een toevoegt.`,
    unverifiedUsed: (n: number) => `${n} ${n === 1 ? 'belastingcategorie wordt' : 'belastingcategorieën worden'} op het menu gebruikt maar ${n === 1 ? 'is' : 'zijn'} nog niet gecontroleerd met de boekhouder.`,
    allGood: 'Elke categorie op het menu heeft een tarief voor vandaag en is gecontroleerd.',
    items: (n: number) => (n === 1 ? '1 menu-item' : `${n} menu-items`), noItems: 'Geen menu-items', allItems: 'Het hele menu',
    applyAll: 'Voor het hele menu gebruiken', applied: (n: number) => `${n} menu-${n === 1 ? 'item' : 'items'} aangepast.`, remove: 'Verwijderen',
    oneRate: 'De belasting stel je hier in voor het hele menu, niet per item.',
    addCategory: 'Nieuwe belastingcategorie', editCategory: 'Categorie wijzigen', startFrom: 'Begin met',
    kind: 'Soort', taxed: 'Belast (ABB)', ground: 'Wettelijke grond', groundHint: 'Schrijf op waarom er geen ABB geldt; de Belastingdienst kan erom vragen.',
    needName: 'Geef de categorie een naam', needGround: 'Vul de wettelijke grond in', already: 'al ingesteld',
    preset: { service_6: 'Diensten 6%', insurance_7: 'Verzekeringen 7%', zero_rated: 'Nultarief 0% (export)', exempt: 'Vrijgesteld', outside_scope: 'Buiten toepassing' } satisfies Record<Preset['id'], string>,
    charge: 'ABB rekenen', chargeOn: 'Verkopen worden belast volgens de categorieën hieronder.', chargeOff: (reason: string) => `Uit: elke nieuwe verkoop wordt als vrijgesteld vastgelegd (${reason}). Eerdere verkopen houden hun ABB.`,
    offTitle: 'ABB uitzetten', offIntro: 'Alleen voor een bedrijf dat zonder ABB mag verkopen. Controleer dit eerst met de boekhouder of de Belastingdienst. De prijzen blijven gelijk; vanaf nu zit er geen ABB in.',
    offReason: 'Waarom er geen ABB wordt gerekend', offExample: 'bijv. regeling voor foodtrucks (trukipan)', offDefault: 'foodtrucks, vissers en kleine eetkarren zijn vrijgesteld', offCheck: 'ABB staat uit, dus geen enkele verkoop krijgt ABB. De prijzen op het menu zijn wat de klant betaalt.',
    grounds: { exempt: ['Eerste levensbehoeften (basisvoedsel)', 'Geneesmiddelen op recept en medische hulpmiddelen', 'Water, elektriciteit en gas van een vergunninghouder'], outside_scope: ['Doorverkoop van ingekochte of ingevoerde goederen (geen producent)'] },
  },
};

interface Draft { cat: TaxCategory; isNew: boolean; pct: string; from: string }

/**
 * Rates are never edited in place: a change is a new row with a start date,
 * so receipts from before the change keep adding up. The kind of a saved category is fixed for the same reason.
 */
export function TaxAdmin() {
  const { t, lang } = useLang();
  const c = COPY[lang];
  const copy = useAdminCopy();
  const [menu, setMenu] = useState<MenuResponse | null>(null);
  const [setup, setSetup] = useState<{ categories: TaxCategory[]; exemption: TaxExemption } | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ cat: TaxCategory; pct: string; from: string } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // The menu gives the items; the categories come from the tax setup itself, because the menu shows them as exempt while ABB is off.
  const load = useCallback(async () => {
    const [m, s] = await Promise.all([api<MenuResponse>('/menu'), api<{ categories: TaxCategory[]; exemption: TaxExemption }>('/admin/tax')]);
    setMenu(m);
    setSetup(s);
  }, []);
  useEffect(() => { void load().catch((e) => setErr(errText(e))); }, [load]);
  const cats = setup?.categories ?? [];
  const charged = setup?.exemption.charged ?? true;
  const used = (id: string) => menu?.items.filter((i) => i.taxCategoryId === id).length ?? 0;

  const total = menu?.items.length ?? 0;
  const act = async (path: string, method: 'POST' | 'DELETE') => {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const r = await api<{ items?: number }>(path, { method });
      if (typeof r.items === 'number') toast(c.applied(r.items));
      await load();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };

  const save = async (cat: TaxCategory) => {
    if (busy) return false;
    setBusy(true);
    setErr('');
    try { await api(`/admin/tax/${cat.id}`, { method: 'PUT', body: cat }); await load(); return true; } catch (e) { setErr(errText(e)); return false; } finally { setBusy(false); }
  };
  const setCharged = async (exemption: TaxExemption) => {
    if (busy) return;
    if (!exemption.charged && !exemption.reason.trim()) return setErr(c.needGround);
    setBusy(true);
    setErr('');
    try { await api('/admin/tax-exemption', { method: 'PUT', body: exemption }); await load(); setSwitching(null); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const addRate = async () => {
    if (!adding) return;
    const bps = parseBps(adding.pct);
    if (bps === null || !isDate(adding.from)) return setErr(t('admin.badRate'));
    const rates = [...adding.cat.rates.filter((r) => r.validFrom !== adding.from), { validFrom: adding.from, bps }];
    if (await save({ ...adding.cat, rates })) setAdding(null);
  };
  const saveDraft = async () => {
    if (!draft) return;
    const cat = { ...draft.cat, name: draft.cat.name.trim(), reason: draft.cat.reason?.trim() || undefined };
    if (!cat.name) return setErr(c.needName);
    if (cat.kind !== 'taxed') {
      if (!cat.reason) return setErr(c.needGround);
      cat.rates = [];
    } else if (draft.isNew) {
      const bps = parseBps(draft.pct);
      if (bps === null || !isDate(draft.from)) return setErr(t('admin.badRate'));
      cat.rates = [{ validFrom: draft.from, bps }];
    }
    if (await save(cat)) setDraft(null);
  };
  const startNew = () => {
    setErr('');
    setDraft({ cat: { id: newId('tax'), name: '', kind: 'taxed', rates: [], unverified: true }, isNew: true, pct: '', from: today() });
  };
  const applyPreset = (p: Preset) => {
    if (!draft) return;
    // The preset's own id when it is free, so a fresh till and a set-up one name the same category alike.
    const id = cats.some((x) => x.id === p.id) ? draft.cat.id : p.id;
    const reason = p.kind === 'taxed' ? undefined : c.grounds[p.kind][0];
    setDraft({ ...draft, cat: { ...draft.cat, id, name: c.preset[p.id], kind: p.kind, reason }, pct: p.kind === 'taxed' ? String(p.bps / 100) : '' });
  };

  // The check only looks at what the till will actually sell: available items and their categories.
  const sold = cats.filter((x) => menu?.items.some((i) => i.available && i.taxCategoryId === x.id));
  const missingRate = sold.filter((x) => x.kind === 'taxed' && rateToday(x) === null);
  const unverified = sold.filter((x) => x.unverified).length;
  const examples = sold.flatMap((x) => {
    const bps = rateToday(x);
    if (x.kind !== 'taxed' || bps === null) return [];
    const tax = taxInGross(1000, bps);
    return [{ id: x.id, text: c.example(formatMoney(1000), formatMoney(1000 - tax), formatMoney(tax), pct(bps)) }];
  });

  return (
    <div>
      {charged && <p className="notice info">{c.intro} {c.oneRate}</p>}
      {err && !adding && !draft && switching === null && <div className="error" role="alert">{err}</div>}
      {setup && (
        <div className="tax-switch">
          <AdminSwitch on={charged} disabled={busy} label={c.charge} hint={charged ? c.chargeOn : c.chargeOff(setup.exemption.reason)}
            onChange={(on) => { setErr(''); if (on) void setCharged({ charged: true, reason: '' }); else setSwitching(setup.exemption.reason || c.offDefault); }} />
        </div>
      )}
      {menu && !charged && <section className="tax-check" aria-label={c.check}><h3>{c.check}</h3><p><Icon name="check" size={16} /> {c.offCheck}</p></section>}
      {menu && charged && (
        <section className="tax-check" aria-label={c.check}>
          <h3>{c.check}</h3>
          {missingRate.map((x) => <p key={x.id} className="warn-text"><Icon name="warning" size={16} /> {c.noRate(x.name)}</p>)}
          {unverified > 0 && <p className="warn-text"><Icon name="warning" size={16} /> {c.unverifiedUsed(unverified)}</p>}
          {!missingRate.length && !unverified && <p><Icon name="check" size={16} /> {c.allGood}</p>}
          {examples.map((x) => <p key={x.id} className="muted">{x.text}</p>)}
        </section>
      )}
      <ul className="orders">
        {cats.map((x) => {
          const now = rateToday(x);
          const n = used(x.id);
          return (
            <li key={x.id}>
              <div className="grow">
                <div className="admin-card-title">
                  <b>{x.name}</b>
                  <span className={`tag ${x.unverified ? 'warn' : 'good'}`}><Icon name={x.unverified ? 'warning' : 'check'} size={16} />{x.unverified ? t('admin.unverified') : copy.verified}</span>
                </div>
                <small className="muted">
                  {x.kind === 'taxed'
                    ? `${t('admin.now')}: ${now === null ? '—' : pct(now)} · ${[...x.rates].sort((a, b) => a.validFrom.localeCompare(b.validFrom)).map((r) => `${pct(r.bps)} ${t('admin.from')} ${r.validFrom}`).join(' · ')}`
                    : `${x.kind === 'exempt' ? t('admin.exempt') : t('admin.outside')} — ${x.reason ?? ''}`}
                  {` · ${n && n === total ? c.allItems : n ? c.items(n) : c.noItems}`}
                </small>
              </div>
              <div className="row-actions">
                <button type="button" className="ghost" disabled={busy} onClick={() => { setErr(''); setDraft({ cat: x, isNew: false, pct: '', from: today() }); }}><Icon name="edit" />{t('admin.edit')}</button>
                {total > 0 && n < total && <button type="button" className="primary" disabled={busy} onClick={() => void act(`/admin/tax/${x.id}/apply-to-menu`, 'POST')}><Icon name="check" />{c.applyAll}</button>}
                {x.kind === 'taxed' && <button type="button" disabled={busy} onClick={() => { setErr(''); setAdding({ cat: x, pct: '', from: today() }); }}><Icon name="plus" />{t('admin.newRate')}</button>}
                {n === 0 && <button type="button" className="ghost" disabled={busy} onClick={() => void act(`/admin/tax/${x.id}`, 'DELETE')}><Icon name="trash" />{c.remove}</button>}
                <button type="button" className={x.unverified ? 'primary' : 'ghost'} disabled={busy} onClick={() => void save({ ...x, unverified: !x.unverified })}>
                  <Icon name={x.unverified ? 'check' : 'warning'} />
                  {x.unverified ? t('admin.markVerified') : t('admin.markUnverified')}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <button type="button" disabled={busy || !menu} onClick={startNew}><Icon name="plus" />{c.addCategory}</button>
      {switching !== null && (
        <AdminDialog title={c.offTitle} onClose={() => setSwitching(null)} busy={busy} error={err} footer={<>
          <button type="button" className="ghost" disabled={busy} onClick={() => setSwitching(null)}>{t('pay.cancel')}</button>
          <button type="button" className="primary" disabled={busy} onClick={() => void setCharged({ charged: false, reason: switching })}><Icon name="check" />{busy ? copy.saving : c.offTitle}</button>
        </>}>
          <p>{c.offIntro}</p>
          <label>{c.offReason}<input autoFocus value={switching} placeholder={c.offExample} onChange={(e) => setSwitching(e.target.value)} /></label>
        </AdminDialog>
      )}
      {adding && (
        <AdminDialog title={`${t('admin.newRate')} · ${adding.cat.name}`} onClose={() => setAdding(null)} busy={busy} error={err} footer={<>
          <button type="button" className="ghost" disabled={busy} onClick={() => setAdding(null)}>{t('pay.cancel')}</button>
          <button type="button" className="primary" disabled={busy} onClick={() => void addRate()}><Icon name="check" />{busy ? copy.saving : t('admin.save')}</button>
        </>}>
          <div className="two">
            <label>{t('admin.ratePct')}<input inputMode="decimal" autoFocus value={adding.pct} placeholder="6" onChange={(e) => setAdding({ ...adding, pct: e.target.value })} /></label>
            <label>{t('admin.validFrom')}<input type="date" value={adding.from} onChange={(e) => setAdding({ ...adding, from: e.target.value })} /></label>
          </div>
        </AdminDialog>
      )}
      {draft && (
        <AdminDialog title={draft.isNew ? c.addCategory : `${c.editCategory} · ${draft.cat.name}`} onClose={() => setDraft(null)} busy={busy} error={err} footer={<>
          <button type="button" className="ghost" disabled={busy} onClick={() => setDraft(null)}>{t('pay.cancel')}</button>
          <button type="button" className="primary" disabled={busy} onClick={() => void saveDraft()}><Icon name="check" />{busy ? copy.saving : t('admin.save')}</button>
        </>}>
          {draft.isNew && (
            <div className="admin-dialog-section">
              <h3>{c.startFrom}</h3>
              <div className="row-actions">
                {PRESETS.map((p) => {
                  const exists = cats.some((x) => x.kind === p.kind && (p.kind !== 'taxed' || rateToday(x) === p.bps));
                  return (
                    <button key={p.id} type="button" className={draft.cat.name === c.preset[p.id] ? 'primary' : 'ghost'} onClick={() => applyPreset(p)}>
                      {c.preset[p.id]}{exists ? ` · ${c.already}` : ''}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <label>{t('admin.name')}<input value={draft.cat.name} autoFocus={!draft.isNew} onChange={(e) => setDraft({ ...draft, cat: { ...draft.cat, name: e.target.value } })} /></label>
          {draft.isNew && (
            <label>{c.kind}
              <select value={draft.cat.kind} onChange={(e) => { const kind = TaxKind.parse(e.target.value); setDraft({ ...draft, cat: { ...draft.cat, kind, reason: kind === 'taxed' ? undefined : draft.cat.reason } }); }}>
                <option value="taxed">{c.taxed}</option>
                <option value="exempt">{t('admin.exempt')}</option>
                <option value="outside_scope">{t('admin.outside')}</option>
              </select>
            </label>
          )}
          {draft.isNew && draft.cat.kind === 'taxed' && (
            <div className="two">
              <label>{t('admin.ratePct')}<input inputMode="decimal" value={draft.pct} placeholder="6" onChange={(e) => setDraft({ ...draft, pct: e.target.value })} /></label>
              <label>{t('admin.validFrom')}<input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></label>
            </div>
          )}
          {draft.cat.kind !== 'taxed' && (
            <label>{c.ground}
              <input list="tax-grounds" value={draft.cat.reason ?? ''} onChange={(e) => setDraft({ ...draft, cat: { ...draft.cat, reason: e.target.value } })} />
              <datalist id="tax-grounds">{c.grounds[draft.cat.kind].map((g) => <option key={g} value={g} />)}</datalist>
              <small className="muted">{c.groundHint}</small>
            </label>
          )}
        </AdminDialog>
      )}
    </div>
  );
}
