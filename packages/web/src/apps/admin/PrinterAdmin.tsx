import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useLang } from '../../i18n';
import { errText } from './Admin';
import { Icon } from '../../ui/Icon';
import { AdminSwitch } from './controls';
import { useAdminCopy } from './copy';

interface Settings { enabled: boolean; host: string; port: number; columns: 32 | 42 | 48; cutter: boolean; drawer: boolean; autoReceipt: boolean; autoKitchen: boolean }
interface Job { id: number; label: string; status: 'queued' | 'printing' | 'done' | 'failed'; attempts: number; error?: string }

export function PrinterAdmin() {
  const { t } = useLang();
  const copy = useAdminCopy();
  const [s, setS] = useState<Settings | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => api<{ jobs: Job[] }>('/print/status').then((r) => setJobs(r.jobs)).catch(() => {}), []);
  useEffect(() => {
    void api<Settings>('/admin/printer').then(setS).catch((e) => setErr(errText(e)));
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [refresh]);
  if (!s) return <p className={err ? 'error' : 'muted center'} role={err ? 'alert' : 'status'}>{err || copy.loading}</p>;

  const set = (patch: Partial<Settings>) => { setMsg(''); setS({ ...s, ...patch }); };
  const toggle = (k: 'enabled' | 'cutter' | 'drawer' | 'autoReceipt' | 'autoKitchen', label: string) => (
    <AdminSwitch on={s[k]} onChange={(on) => set({ [k]: on })} label={label} disabled={busy} />
  );
  const save = async (): Promise<boolean> => {
    setErr(''); setMsg('');
    try { setS(await api<Settings>('/admin/printer', { method: 'PUT', body: s })); setMsg(t('admin.saved')); return true; } catch (e) { setErr(errText(e)); return false; }
  };
  const test = async () => {
    if (!(await save())) return;
    try { await api('/admin/printer/test', { body: {} }); setMsg(t('printer.testSent')); void refresh(); } catch (e) { setErr(errText(e)); }
  };
  const act = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };

  return (
    <div className="form" aria-busy={busy}>
      <p className="notice info">{t('printer.intro')}</p>
      <section className="admin-form-card">
        <h3><Icon name="printer" />{copy.connection}</h3>
        {toggle('enabled', t('printer.enabled'))}
        <div className="two">
          <label>{t('printer.host')}<input value={s.host} disabled={busy} placeholder="192.168.1.50" autoComplete="off" autoCapitalize="off" spellCheck={false} onChange={(e) => set({ host: e.target.value.trim() })} /></label>
          <label>{t('printer.port')}<input inputMode="numeric" value={s.port} disabled={busy} onChange={(e) => set({ port: Number(e.target.value.replace(/\D/g, '')) || 0 })} /></label>
        </div>
        <label>{t('printer.paper')}
          <select value={s.columns} disabled={busy} onChange={(e) => set({ columns: Number(e.target.value) as Settings['columns'] })}>
            <option value={48}>80 mm</option>
            <option value={42}>80 mm ({t('printer.narrow')})</option>
            <option value={32}>58 mm</option>
          </select>
        </label>
        <button type="button" disabled={busy} onClick={() => void act(test)}><Icon name="printer" />{t('printer.test')}</button>
      </section>
      <section className="admin-form-card">
        <h3><Icon name="receipt" />{copy.preferences}</h3>
        <div className="admin-switches">
          {toggle('cutter', t('printer.cutter'))}
          {toggle('drawer', t('printer.drawer'))}
          {toggle('autoReceipt', t('printer.autoReceipt'))}
          {toggle('autoKitchen', t('printer.autoKitchen'))}
        </div>
      </section>
      <div className="admin-savebar">
        {err && <div className="error" role="alert">{err}</div>}
        {msg && <div className="ok" role="status">{msg}</div>}
        <div className="actions">
          <button type="button" className="primary" disabled={busy} onClick={() => void act(save)}><Icon name="check" />{busy ? copy.saving : t('admin.save')}</button>
        </div>
      </div>
      {jobs.length > 0 && (
        <>
          <h3 className="admin-subheading">{t('printer.jobs')}</h3>
          <ul className="orders">
            {jobs.map((j) => (
              <li key={j.id}>
                <div className="grow">{j.label}{j.error && <small className="warn-text">{j.error}</small>}</div>
                <span className={`tag${j.status === 'failed' ? ' warn' : j.status === 'done' ? ' good' : ''}`}>{t(`printer.st.${j.status}`)}</span>
              </li>
            ))}
          </ul>
          {jobs.some((j) => j.status === 'failed') && <button type="button" disabled={busy} onClick={() => void act(() => api('/print/retry', { body: {} }).then(refresh))}><Icon name="refresh" />{t('printer.retry')}</button>}
        </>
      )}
    </div>
  );
}
