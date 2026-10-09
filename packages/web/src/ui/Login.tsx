import { useEffect, useRef, useState } from 'react';
import { api, ApiError, type Session } from '../lib/api';
import { setLang, useLang } from '../i18n';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { useTheme } from '../lib/theme';
import './login.css';
import './theme.css';

export function Login({ onDone }: { onDone: (s: Session) => void }) {
  const { lang, t } = useLang();
  const { dark, setTheme } = useTheme();
  const copy = lang === 'nl' ? {
    eyebrow: 'Gemaakt voor goede service', title: 'Klaar voor een\nmooie werkdag.',
    intro: 'Bestellingen opnemen, de keuken laten doorlopen en eenvoudig afrekenen.',
    pin: 'Uw persoonlijke pincode', hint: 'Log in om aan de slag te gaan.', erase: 'Laatste cijfer wissen',
    waiting: 'Even geduld', connection: 'De server is niet bereikbaar. Controleer de verbinding en probeer opnieuw.',
    blocked: 'Te veel pogingen. Wacht 30 seconden en probeer opnieuw.', digits: 'cijfers ingevoerd',
    clear: 'Pincode wissen', service: 'Een fijne dienst begint hier.',
  } : {
    eyebrow: 'Made for great service', title: 'Ready for a\ngood day.',
    intro: 'Take orders, keep the kitchen moving, and make checkout simple.',
    pin: 'Your staff PIN', hint: 'Sign in to get things moving.', erase: 'Delete last digit',
    waiting: 'One moment', connection: 'Cannot reach the server. Check the connection and try again.',
    blocked: 'Too many attempts. Wait 30 seconds and try again.', digits: 'digits entered',
    clear: 'Clear PIN', service: 'A good shift starts here.',
  };
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  const submit = async (p: string) => {
    if (submitting.current || p.length < 3) return;
    submitting.current = true; setBusy(true); setErr('');
    try {
      onDone(await api<Session>('/login', { body: { pin: p } }));
    } catch (error) {
      setErr(error instanceof ApiError && error.status === 401 ? t('login.wrong')
        : error instanceof ApiError && error.status === 429 ? copy.blocked : copy.connection);
      setPin('');
    } finally { submitting.current = false; setBusy(false); }
  };
  const press = (d: string) => {
    if (submitting.current) return;
    setErr('');
    setPin((value) => (value + d).slice(0, 8));
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (busy || event.altKey || event.ctrlKey || event.metaKey) return;
      if (/^\d$/.test(event.key)) { event.preventDefault(); press(event.key); }
      if (event.key === 'Backspace') { event.preventDefault(); setPin((value) => value.slice(0, -1)); }
      if (event.key === 'Enter') { event.preventDefault(); void submit(pin); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [busy, pin, lang]);

  return (
    <div className="login">
      <section className="login-story">
        <div className="login-brand"><Logo size={56} /><strong>{t('app.name')}</strong><button className="ghost login-language" aria-label={lang === 'nl' ? 'Taal wijzigen' : 'Change language'} onClick={() => setLang(lang === 'en' ? 'nl' : 'en')}><Icon name="language" size={20} /><span>{lang === 'en' ? 'NL' : 'EN'}</span></button></div>
        <button className="login-theme" aria-label={lang === 'nl' ? (dark ? 'Lichte weergave' : 'Donkere weergave') : (dark ? 'Use light theme' : 'Use dark theme')} onClick={() => setTheme(dark ? 'light' : 'dark')}><Icon name={dark ? 'sun' : 'moon'} /><span>{lang === 'nl' ? (dark ? 'Licht' : 'Donker') : (dark ? 'Light' : 'Dark')}</span></button>
        <p className="login-eyebrow">{copy.eyebrow}</p>
        <h1>{copy.title}</h1><p className="login-intro">{copy.intro}</p>
        <div className="login-features">
          <span><Icon name="cart" />{t('nav.orders')}</span><span><Icon name="kitchen" />{t('nav.kitchen')}</span><span><Icon name="card" />{t('pay.title')}</span>
        </div>
        <div className="login-service"><span /><span /><span /><p>{copy.service}</p></div>
      </section>
      <section className="login-card" aria-busy={busy}>
        <div className="login-lock"><Icon name="lock" size={24} /></div>
        <h2>{copy.pin}</h2><p className="muted">{copy.hint}</p>
        <div className="pin-entry"><div className="pin-dots" role="status" aria-label={`${pin.length} ${copy.digits}`}>
          {Array.from({ length: Math.max(4, pin.length) }, (_, index) => <span key={index} className={index < pin.length ? 'filled' : ''} aria-hidden="true" />)}
        </div><button className="pin-clear" disabled={busy || !pin.length} aria-label={copy.clear} onClick={() => setPin('')}><Icon name="close" size={20} /></button></div>
        {err && <div className="error" role="alert">{err}</div>}
        <div className="keypad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} disabled={busy} onClick={() => press(d)}>{d}</button>)}
          <button className="ghost" disabled={busy} aria-label={copy.erase} onClick={() => setPin(pin.slice(0, -1))}><Icon name="backspace" size={24} /></button>
          <button disabled={busy} onClick={() => press('0')}>0</button>
          <button className="primary login-submit" disabled={busy || pin.length < 3} onClick={() => { void submit(pin); }}><Icon name={busy ? 'clock' : 'arrow-right'} size={21} /><span>{busy ? copy.waiting : t('login.go')}</span></button>
        </div>
      </section>
    </div>
  );
}
