import { useEffect, useState } from 'react';
import type { Business } from '@cactus/shared';
import { api, getSession, setSession } from '../../lib/api';
import { useLang } from '../../i18n';
import { errText } from './Admin';
import { Icon } from '../../ui/Icon';
import { useAdminCopy } from './copy';

export function BusinessAdmin() {
  const { t } = useLang();
  const copy = useAdminCopy();
  const [b, setB] = useState<Business | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api<Business>('/admin/business').then(setB).catch((e) => setErr(errText(e))); }, []);
  if (!b) return <p className={err ? 'error' : 'muted center'} role={err ? 'alert' : 'status'}>{err || copy.loading}</p>;

  const field = (k: keyof Business, label: string, hint?: string) => (
    <label>{label}
      <input type={k === 'phone' ? 'tel' : 'text'} value={b[k] ?? ''} disabled={busy} onChange={(e) => { setMsg(''); setB({ ...b, [k]: e.target.value }); }} />
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setErr(''); setMsg('');
    try {
      const saved = await api<Business>('/admin/business', { method: 'PUT', body: b });
      const s = getSession();
      if (s) setSession({ ...s, business: saved });
      setMsg(t('admin.saved'));
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };

  return (
    <div className="form" aria-busy={busy}>
      <section className="admin-form-card">
      <h3><Icon name="leaf" />{copy.details}</h3>
      {field('name', t('admin.bizName'))}
      {field('crib', t('admin.crib'), t('admin.cribHint'))}
      {field('address', t('admin.address'))}
      {field('phone', t('admin.phone'))}
      </section>
      <section className="admin-form-card">
      <h3><Icon name="receipt" />{copy.receipt}</h3>
      {field('receiptFooter', t('admin.footer'))}
      <div className="two">
        <label>{t('admin.receiptLang')}
          <select value={b.locale} disabled={busy} onChange={(e) => { setMsg(''); setB({ ...b, locale: e.target.value as Business['locale'] }); }}>
            <option value="en">English</option>
            <option value="nl">Nederlands</option>
          </select>
        </label>
        {field('timezone', t('admin.timezone'))}
      </div>
      <label>{t('admin.brandColor')}
        <input type="color" value={b.brandColor ?? '#14506b'} disabled={busy} onChange={(e) => { setMsg(''); setB({ ...b, brandColor: e.target.value }); }} />
      </label>
      </section>
      {err && <div className="error" role="alert">{err}</div>}
      {msg && <div className="ok" role="status">{msg}</div>}
      <div className="actions"><button className="primary" disabled={busy} onClick={() => void save()}><Icon name="check" />{busy ? copy.saving : t('admin.save')}</button></div>
    </div>
  );
}
