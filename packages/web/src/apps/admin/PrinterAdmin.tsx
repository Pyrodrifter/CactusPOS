import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useLang } from '../../i18n';
import { errText } from './Admin';

interface Settings { enabled: boolean; host: string; port: number; columns: 32 | 42 | 48; cutter: boolean; drawer: boolean; autoReceipt: boolean; autoKitchen: boolean }
interface Job { id: number; label: string; status: 'queued' | 'printing' | 'done' | 'failed'; attempts: number; error?: string }

export function PrinterAdmin() {
  const { t } = useLang();
  const [s, setS] = useState<Settings | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const refresh = useCallback(() => api<{ jobs: Job[] }>('/print/status').then((r) => setJobs(r.jobs)).catch(() => {}), []);
  useEffect(() => {
    void api<Settings>('/admin/printer').then(setS).catch((e) => setErr(errText(e)));
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [refresh]);
  if (!s) return <p className="muted center">{err || '…'}</p>;

  const set = (patch: Partial<Settings>) => { setMsg(''); setS({ ...s, ...patch }); };
  const toggle = (k: 'enabled' | 'cutter' | 'drawer' | 'autoReceipt' | 'autoKitchen', label: string) => (
    <button className={s[k] ? 'on' : ''} onClick={() => set({ [k]: !s[k] })}>{label}</button>
  );
  const save = async (): Promise<boolean> => {
    setErr(''); setMsg('');
    try { setS(await api<Settings>('/admin/printer', { method: 'PUT', body: s })); setMsg(t('admin.saved')); return true; } catch (e) { setErr(errText(e)); return false; }
  };
  const test = async () => {
    if (!(await save())) return;
    try { await api('/admin/printer/test', { body: {} }); setMsg(t('printer.testSent')); void refresh(); } catch (e) { setErr(errText(e)); }
  };

  return (
    <div className="form">
      <p className="notice">{t('printer.intro')}</p>
      <div className="chips">{toggle('enabled', t('printer.enabled'))}</div>
      <div className="two">
        <label>{t('printer.host')}<input value={s.host} placeholder="192.168.1.50" onChange={(e) => set({ host: e.target.value.trim() })} /></label>
        <label>{t('printer.port')}<input inputMode="numeric" value={s.port} onChange={(e) => set({ port: Number(e.target.value.replace(/\D/g, '')) || 0 })} /></label>
      </div>
      <label>{t('printer.paper')}
        <select value={s.columns} onChange={(e) => set({ columns: Number(e.target.value) as Settings['columns'] })}>
          <option value={48}>80 mm</option>
          <option value={42}>80 mm ({t('printer.narrow')})</option>
          <option value={32}>58 mm</option>
        </select>
      </label>
      <div className="chips">
        {toggle('cutter', t('printer.cutter'))}
        {toggle('drawer', t('printer.drawer'))}
        {toggle('autoReceipt', t('printer.autoReceipt'))}
        {toggle('autoKitchen', t('printer.autoKitchen'))}
      </div>
      {err && <div className="error">{err}</div>}
      {msg && <div className="ok">{msg}</div>}
      <div className="actions">
        <button onClick={() => void test()}>{t('printer.test')}</button>
        <button className="primary" onClick={() => void save()}>{t('admin.save')}</button>
      </div>
      {jobs.length > 0 && (
        <>
          <h3>{t('printer.jobs')}</h3>
          <ul className="orders">
            {jobs.map((j) => (
              <li key={j.id}>
                <div className="grow">{j.label}{j.error && <><br /><small className="warn-text">{j.error}</small></>}</div>
                <span className={`tag${j.status === 'failed' ? ' warn' : ''}`}>{t(`printer.st.${j.status}`)}</span>
              </li>
            ))}
          </ul>
          {jobs.some((j) => j.status === 'failed') && <button onClick={() => void api('/print/retry', { body: {} }).then(refresh)}>{t('printer.retry')}</button>}
        </>
      )}
    </div>
  );
}
