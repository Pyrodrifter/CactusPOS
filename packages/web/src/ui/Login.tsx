import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type Session } from '../lib/api';
import { setLang, useLang } from '../i18n';
import { haptic, Icon } from './touch';

const MAX = 8;

export function Login({ onDone }: { onDone: (s: Session) => void }) {
  const { lang, t } = useLang();
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);

  const submit = useCallback(async (p: string) => {
    if (p.length < 4 || busy) return;
    setBusy(true);
    try {
      onDone(await api<Session>('/login', { body: { pin: p } }));
    } catch (e) {
      haptic(60);
      setErr(e instanceof ApiError && e.status === 429 ? e.message : t('login.wrong'));
      setShake((n) => n + 1);
      setPin('');
      setBusy(false);
    }
  }, [busy, onDone, t]);

  const press = useCallback((d: string) => {
    haptic(6);
    setErr('');
    setPin((p) => (d === 'back' ? p.slice(0, -1) : (p + d).slice(0, MAX)));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('back');
      else if (e.key === 'Enter') void submit(pin);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pin, press, submit]);

  return (
    <div className="login">
      <button className="ghost login-lang" onClick={() => setLang(lang === 'en' ? 'nl' : 'en')}>{lang === 'en' ? 'Nederlands' : 'English'}</button>
      <div className="login-card">
        <div className="login-logo">🌵</div>
        <h1>{t('app.name')}</h1>
        <p className="muted">{t('login.title')}</p>
        <div key={shake} className={`pin-dots${err ? ' shake' : ''}`} aria-label={`${pin.length} digits`}>
          {Array.from({ length: Math.max(4, pin.length) }, (_, i) => <i key={i} className={i < pin.length ? 'on' : ''} />)}
        </div>
        <div className="login-msg error" aria-live="polite">{err || ' '}</div>
        <div className="pad round">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} onClick={() => press(d)}>{d}</button>)}
          <button className="pad-back" aria-label="Delete" onClick={() => press('back')}><Icon.back /></button>
          <button onClick={() => press('0')}>0</button>
          <button className="primary" aria-label={t('login.go')} disabled={pin.length < 4 || busy} onClick={() => void submit(pin)}><Icon.check /></button>
        </div>
      </div>
    </div>
  );
}
