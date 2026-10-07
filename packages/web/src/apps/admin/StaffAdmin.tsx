import { useCallback, useEffect, useState } from 'react';
import type { StaffRow } from '@cactus/shared';
import { api } from '../../lib/api';
import { useLang } from '../../i18n';
import { errText } from './Admin';

interface Draft { id?: string; name: string; role: 'owner' | 'staff'; active: boolean; pin: string }

export function StaffAdmin() {
  const { t } = useLang();
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [d, setD] = useState<Draft | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => api<StaffRow[]>('/admin/staff').then(setStaff), []);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!d) return;
    setErr('');
    if (d.pin && !/^\d{4,8}$/.test(d.pin)) return setErr(t('admin.pinRule'));
    const body = { name: d.name.trim(), role: d.role, active: d.active, ...(d.pin ? { pin: d.pin } : {}) };
    try {
      if (d.id) await api(`/admin/staff/${d.id}`, { method: 'PUT', body }); else await api('/admin/staff', { body });
      setD(null);
      await load();
    } catch (e) { setErr(errText(e)); }
  };

  return (
    <div>
      <div className="row-actions pad">
        <span className="spacer" />
        <button className="primary" onClick={() => { setErr(''); setD({ name: '', role: 'staff', active: true, pin: '' }); }}>+ {t('admin.addStaff')}</button>
      </div>
      <ul className="orders">
        {staff.map((s) => (
          <li key={s.id} className={s.active ? '' : 'inactive'}>
            <div className="grow">
              <b>{s.name}</b><br />
              <small className="muted">{s.role === 'owner' ? t('admin.owner') : t('admin.staffRole')}{!s.active && ` · ${t('admin.inactive')}`}</small>
            </div>
            <button onClick={() => { setErr(''); setD({ ...s, pin: '' }); }}>{t('admin.edit')}</button>
          </li>
        ))}
      </ul>
      {d && (
        <div className="sheet-bg" onClick={() => setD(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h2>{d.id ? t('admin.edit') : t('admin.addStaff')}</h2>
            <label>{t('admin.name')}<input value={d.name} autoFocus onChange={(e) => setD({ ...d, name: e.target.value })} /></label>
            <label>{d.id ? t('admin.newPin') : t('admin.pin')}
              <input type="password" inputMode="numeric" autoComplete="new-password" value={d.pin} onChange={(e) => setD({ ...d, pin: e.target.value })} />
              <small className="muted">{t('admin.pinRule')}</small>
            </label>
            <div className="chips">
              <button className={d.role === 'staff' ? 'on' : ''} onClick={() => setD({ ...d, role: 'staff' })}>{t('admin.staffRole')}</button>
              <button className={d.role === 'owner' ? 'on' : ''} onClick={() => setD({ ...d, role: 'owner' })}>{t('admin.owner')}</button>
              <button className={d.active ? 'on' : ''} onClick={() => setD({ ...d, active: !d.active })}>{d.active ? t('admin.active') : t('admin.inactive')}</button>
            </div>
            <small className="muted">{t('admin.ownerHint')}</small>
            {err && <div className="error">{err}</div>}
            <div className="actions">
              <button className="ghost" onClick={() => setD(null)}>{t('pay.cancel')}</button>
              <button className="primary" disabled={!d.name.trim() || (!d.id && !d.pin)} onClick={() => void save()}>{t('admin.save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
