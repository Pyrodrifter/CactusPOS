import { useCallback, useEffect, useState } from 'react';
import type { StaffRow } from '@cactus/shared';
import { api } from '../../lib/api';
import { useLang } from '../../i18n';
import { errText } from './Admin';
import { Icon } from '../../ui/Icon';
import { AdminDialog } from './AdminDialog';
import { AdminSwitch } from './controls';
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
    <div className="staff-admin">
      {err && !d && <div className="error" role="alert">{err}</div>}
      <div className="admin-toolbar">
        <p className="admin-toolbar-hint">{staff.length > 0 && copy.staffHint}</p>
        <button type="button" className="primary admin-add" disabled={busy} onClick={() => { setErr(''); setD({ name: '', role: 'staff', active: true, pin: '' }); }}><Icon name="plus" />{t('admin.addStaff')}</button>
      </div>
      <ul className="admin-rows">
        {staff.map((s) => (
          <li key={s.id} className={`admin-row${s.active ? '' : ' is-off'}`}>
            <button type="button" className="admin-row-main" aria-label={`${t('admin.edit')}: ${s.name}`} onClick={() => { setErr(''); setD({ ...s, pin: '' }); }}>
              <span className="admin-row-lead" aria-hidden="true">{s.name.trim().slice(0, 1).toUpperCase() || '?'}</span>
              <span className="admin-row-text">
                <b>{s.name}</b>
                <small>{s.role === 'owner' ? t('admin.owner') : t('admin.staffRole')}</small>
              </span>
              {!s.active && <span className="tag warn">{t('admin.inactive')}</span>}
              <Icon name="edit" className="admin-row-go" />
            </button>
          </li>
        ))}
      </ul>
      {!loaded && !err && <p className="muted center" role="status">{copy.loading}</p>}
      {loaded && staff.length === 0 && <p className="muted center">{copy.emptyStaff}</p>}
      {d && (
        <AdminDialog title={d.id ? `${t('admin.edit')} · ${staff.find((s) => s.id === d.id)?.name ?? d.name}` : t('admin.addStaff')} onClose={() => setD(null)} busy={busy} error={err} footer={<>
          <button type="button" className="ghost" disabled={busy} onClick={() => setD(null)}>{t('pay.cancel')}</button>
          <button type="button" className="primary" disabled={busy || !d.name.trim() || (!d.id && !d.pin)} onClick={() => void save()}><Icon name="check" />{busy ? copy.saving : t('admin.save')}</button>
        </>}>
          <label>{t('admin.name')}<input value={d.name} autoFocus autoComplete="off" onChange={(e) => setD({ ...d, name: e.target.value })} /></label>
          <label>{d.id ? t('admin.newPin') : t('admin.pin')}
            <input type="password" inputMode="numeric" autoComplete="new-password" value={d.pin} onChange={(e) => setD({ ...d, pin: e.target.value })} />
            <small className="muted">{t('admin.pinRule')}</small>
          </label>
          <div className="admin-field">
            <span className="admin-field-label" id="staff-role-label">{copy.role}</span>
            <div className="chips admin-choice" role="group" aria-labelledby="staff-role-label">
              <button type="button" className={d.role === 'staff' ? 'on' : ''} aria-pressed={d.role === 'staff'} disabled={busy} onClick={() => setD({ ...d, role: 'staff' })}><Icon name="staff" />{t('admin.staffRole')}</button>
              <button type="button" className={d.role === 'owner' ? 'on' : ''} aria-pressed={d.role === 'owner'} disabled={busy} onClick={() => setD({ ...d, role: 'owner' })}><Icon name="lock" />{t('admin.owner')}</button>
            </div>
            <small className="muted">{t('admin.ownerHint')}</small>
          </div>
          <AdminSwitch on={d.active} onChange={(active) => setD({ ...d, active })} label={t('admin.active')} hint={copy.activeHint} disabled={busy} />
        </AdminDialog>
      )}
    </div>
  );
}
