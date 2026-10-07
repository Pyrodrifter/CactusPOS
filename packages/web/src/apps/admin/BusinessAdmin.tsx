import { useEffect, useState } from 'react';
import type { Business } from '@cactus/shared';
import { api, getSession, setSession } from '../../lib/api';
import { useLang } from '../../i18n';
import { errText } from './Admin';

export function BusinessAdmin() {
  const { t } = useLang();
  const [b, setB] = useState<Business | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { void api<Business>('/admin/business').then(setB).catch((e) => setErr(errText(e))); }, []);
  if (!b) return <p className="muted center">{err || '…'}</p>;

  const field = (k: keyof Business, label: string, hint?: string) => (
    <label>{label}
      <input value={b[k] ?? ''} onChange={(e) => { setMsg(''); setB({ ...b, [k]: e.target.value }); }} />
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
  const save = async () => {
    setErr(''); setMsg('');
    try {
      const saved = await api<Business>('/admin/business', { method: 'PUT', body: b });
      const s = getSession();
      if (s) setSession({ ...s, business: { name: saved.name, currency: saved.currency, brandColor: saved.brandColor } });
      setMsg(t('admin.saved'));
    } catch (e) { setErr(errText(e)); }
  };

  return (
    <div className="form">
      {field('name', t('admin.bizName'))}
      {field('crib', t('admin.crib'), t('admin.cribHint'))}
      {field('address', t('admin.address'))}
      {field('phone', t('admin.phone'))}
      {field('receiptFooter', t('admin.footer'))}
      <div className="two">
        <label>{t('admin.receiptLang')}
          <select value={b.locale} onChange={(e) => setB({ ...b, locale: e.target.value as Business['locale'] })}>
            <option value="en">English</option>
            <option value="nl">Nederlands</option>
          </select>
        </label>
        {field('timezone', t('admin.timezone'))}
      </div>
      <label>{t('admin.brandColor')}
        <input type="color" value={b.brandColor ?? '#14506b'} onChange={(e) => { setMsg(''); setB({ ...b, brandColor: e.target.value }); }} />
      </label>
      {err && <div className="error">{err}</div>}
      {msg && <div className="ok">{msg}</div>}
      <div className="actions"><button className="primary" onClick={() => void save()}>{t('admin.save')}</button></div>
    </div>
  );
}
