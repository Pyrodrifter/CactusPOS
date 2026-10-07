import { useCallback, useEffect, useState } from 'react';
import { rateAt, type TaxCategory } from '@cactus/shared';
import { api } from '../../lib/api';
import { useLang } from '../../i18n';
import { errText } from './Admin';

const today = () => new Date().toISOString().slice(0, 10);
const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;

/**
 * Rates are never edited in place: a change is a new row with a start date,
 * so receipts from before the change keep adding up.
 */
export function TaxAdmin() {
  const { t } = useLang();
  const [cats, setCats] = useState<TaxCategory[]>([]);
  const [adding, setAdding] = useState<{ cat: TaxCategory; pct: string; from: string } | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => api<{ taxCategories: TaxCategory[] }>('/menu').then((m) => setCats(m.taxCategories)), []);
  useEffect(() => { void load(); }, [load]);

  const save = async (cat: TaxCategory) => {
    setErr('');
    try { await api(`/admin/tax/${cat.id}`, { method: 'PUT', body: cat }); await load(); return true; } catch (e) { setErr(errText(e)); return false; }
  };
  const addRate = async () => {
    if (!adding) return;
    const n = Number(adding.pct.replace(',', '.'));
    if (!Number.isFinite(n) || n < 0 || n > 100 || !/^\d{4}-\d{2}-\d{2}$/.test(adding.from)) return setErr(t('admin.badRate'));
    const rates = [...adding.cat.rates.filter((r) => r.validFrom !== adding.from), { validFrom: adding.from, bps: Math.round(n * 100) }];
    if (await save({ ...adding.cat, rates })) setAdding(null);
  };

  return (
    <div>
      <p className="notice">{t('admin.taxIntro')}</p>
      {err && !adding && <div className="error">{err}</div>}
      <ul className="orders">
        {cats.map((c) => (
          <li key={c.id}>
            <div className="grow">
              <b>{c.name}</b> {c.unverified && <span className="tag warn">{t('admin.unverified')}</span>}<br />
              <small className="muted">
                {c.kind === 'taxed'
                  ? `${t('admin.now')}: ${pct(rateAt(c, today()))} · ${[...c.rates].sort((a, b) => a.validFrom.localeCompare(b.validFrom)).map((r) => `${pct(r.bps)} ${t('admin.from')} ${r.validFrom}`).join(' · ')}`
                  : `${c.kind === 'exempt' ? t('admin.exempt') : t('admin.outside')} — ${c.reason ?? ''}`}
              </small>
            </div>
            <div className="row-actions">
              {c.kind === 'taxed' && <button onClick={() => { setErr(''); setAdding({ cat: c, pct: '', from: today() }); }}>{t('admin.newRate')}</button>}
              <button className={c.unverified ? 'primary' : 'ghost'} onClick={() => void save({ ...c, unverified: !c.unverified })}>
                {c.unverified ? t('admin.markVerified') : t('admin.markUnverified')}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {adding && (
        <div className="sheet-bg" onClick={() => setAdding(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h2>{t('admin.newRate')} · {adding.cat.name}</h2>
            <div className="two">
              <label>{t('admin.ratePct')}<input inputMode="decimal" autoFocus value={adding.pct} placeholder="6" onChange={(e) => setAdding({ ...adding, pct: e.target.value })} /></label>
              <label>{t('admin.validFrom')}<input type="date" value={adding.from} onChange={(e) => setAdding({ ...adding, from: e.target.value })} /></label>
            </div>
            {err && <div className="error">{err}</div>}
            <div className="actions">
              <button className="ghost" onClick={() => setAdding(null)}>{t('pay.cancel')}</button>
              <button className="primary" onClick={() => void addRate()}>{t('admin.save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
