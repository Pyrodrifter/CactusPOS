import { useCallback, useEffect, useState } from 'react';
import type { StaffRow } from '@cactus/shared';
import { api } from '../../lib/api';
import { useLang } from '../../i18n';
import { errText } from './Admin';
import { Icon } from '../../ui/Icon';
import { AdminDialog } from './AdminDialog';
import { useAdminCopy } from './copy';

interface Draft { id?: string; name: string; role: 'owner' | 'staff'; active: boolean; pin: string }

export function StaffAdmin() {
  const { t } = useLang();
  const copy = useAdminCopy();
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [d, setD] = useState<Draft | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(() => api<StaffRow[]>('/admin/staff').then(setStaff), []);
  useEffect(() => { void load().then(() => setLoaded(true)).catch((e) => setErr(errText(e))); }, [load]);

  const save = async () => {
    if (!d || busy) return;
    setErr('');
    if (d.pin && !/^\d{4,8}$/.test(d.pin)) return setErr(t('admin.pinRule'));
    const body = { name: d.name.trim(), role: d.role, active: d.active, ...(d.pin ? { pin: d.pin } : {}) };
    setBusy(true);
    try {
      if (d.id) await api(`/admin/staff/${d.id}`, { method: 'PUT', body }); else await api('/admin/staff', { body });
      setD(null);
      await load();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };

  return (
    <div>
      {err && !d && <div className="error" role="alert">{err}</div>}
      <div className="row-actions pad">
        <span className="spacer" />
        <button className="primary" disabled={busy} onClick={() => { setErr(''); setD({ name: '', role: 'staff', active: true, pin: '' }); }}><Icon name="plus" />{t('admin.addStaff')}</button>
      </div>
      <ul className="orders">
        {staff.map((s) => (
          <li key={s.id} className={s.active ? '' : 'inactive'}>
            <div className="grow">
              <b>{s.name}</b><br />
              <small className="muted">{s.role === 'owner' ? t('admin.owner') : t('admin.staffRole')}{!s.active && ` · ${t('admin.inactive')}`}</small>
            </div>
            <button aria-label={`${t('admin.edit')}: ${s.name}`} onClick={() => { setErr(''); setD({ ...s, pin: '' }); }}><Icon name="edit" />{t('admin.edit')}</button>
          </li>
        ))}
      </ul>
      {!loaded && !err && <p className="muted center" role="status">{copy.loading}</p>}
      {loaded && staff.length === 0 && <p className="muted center">{copy.emptyStaff}</p>}
      {d && (
        <AdminDialog title={d.id ? `${t('admin.edit')} · ${d.name}` : t('admin.addStaff')} onClose={() => setD(null)} busy={busy}>
            <label>{t('admin.name')}<input value={d.name} autoFocus onChange={(e) => setD({ ...d, name: e.target.value })} /></label>
            <label>{d.id ? t('admin.newPin') : t('admin.pin')}
              <input type="password" inputMode="numeric" autoComplete="new-password" value={d.pin} onChange={(e) => setD({ ...d, pin: e.target.value })} />
              <small className="muted">{t('admin.pinRule')}</small>
            </label>
            <div className="chips">
              <button className={d.role === 'staff' ? 'on' : ''} aria-pressed={d.role === 'staff'} disabled={busy} onClick={() => setD({ ...d, role: 'staff' })}><Icon name="staff" />{t('admin.staffRole')}</button>
              <button className={d.role === 'owner' ? 'on' : ''} aria-pressed={d.role === 'owner'} disabled={busy} onClick={() => setD({ ...d, role: 'owner' })}><Icon name="lock" />{t('admin.owner')}</button>
              <button className={d.active ? 'on' : ''} aria-pressed={d.active} disabled={busy} onClick={() => setD({ ...d, active: !d.active })}><Icon name={d.active ? 'check' : 'close'} />{d.active ? t('admin.active') : t('admin.inactive')}</button>
            </div>
            <small className="muted">{t('admin.ownerHint')}</small>
            {err && <div className="error" role="alert">{err}</div>}
            <div className="actions">
              <button className="ghost" disabled={busy} onClick={() => setD(null)}>{t('pay.cancel')}</button>
              <button className="primary" disabled={busy || !d.name.trim() || (!d.id && !d.pin)} onClick={() => void save()}><Icon name="check" />{busy ? copy.saving : t('admin.save')}</button>
            </div>
        </AdminDialog>
      )}
    </div>
  );
}
