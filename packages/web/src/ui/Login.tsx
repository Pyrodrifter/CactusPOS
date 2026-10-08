import { useRef, useState } from 'react';
import { api, ApiError, type Session } from '../lib/api';
import { useLang } from '../i18n';
import { Icon } from './Icon';

export function Login({ onDone }: { onDone: (s: Session) => void }) {
  const { lang, t } = useLang();
  const copy = lang === 'nl' ? {
    eyebrow: 'Gemaakt voor goede service', title: 'Klaar voor een\nmooie werkdag.',
    intro: 'Bestellingen opnemen, de keuken laten doorlopen en eenvoudig afrekenen.',
    pin: 'Uw persoonlijke pincode', hint: 'Log in om aan de slag te gaan.', erase: 'Laatste cijfer wissen',
    waiting: 'Even geduld', connection: 'De server is niet bereikbaar. Controleer de verbinding en probeer opnieuw.',
    blocked: 'Te veel pogingen. Wacht 30 seconden en probeer opnieuw.', digits: 'cijfers ingevoerd',
  } : {
    eyebrow: 'Made for great service', title: 'Ready for a\ngood day.',
    intro: 'Take orders, keep the kitchen moving, and make checkout simple.',
    pin: 'Your staff PIN', hint: 'Sign in to get things moving.', erase: 'Delete last digit',
    waiting: 'One moment', connection: 'Cannot reach the server. Check the connection and try again.',
    blocked: 'Too many attempts. Wait 30 seconds and try again.', digits: 'digits entered',
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
    const next = (pin + d).slice(0, 8);
    setPin(next);
  };

  return (
    <div className="login" onKeyDown={(event) => {
      if (busy || event.altKey || event.ctrlKey || event.metaKey) return;
      if (/^\d$/.test(event.key)) { event.preventDefault(); press(event.key); }
      if (event.key === 'Backspace') { event.preventDefault(); setPin(pin.slice(0, -1)); }
      if (event.key === 'Enter') { event.preventDefault(); void submit(pin); }
    }}>
      <section className="login-story">
        <div className="login-brand"><span className="brand-mark"><Icon name="leaf" size={28} /></span><strong>{t('app.name')}</strong></div>
        <p className="login-eyebrow">{copy.eyebrow}</p>
        <h1>{copy.title}</h1><p className="login-intro">{copy.intro}</p>
        <div className="login-features">
          <span><Icon name="cart" />{t('nav.orders')}</span><span><Icon name="kitchen" />{t('nav.kitchen')}</span><span><Icon name="card" />{t('pay.title')}</span>
        </div>
      </section>
      <section className="login-card" aria-busy={busy}>
        <div className="login-lock"><Icon name="lock" size={24} /></div>
        <h2>{copy.pin}</h2><p className="muted">{copy.hint}</p>
        <div className="pin-dots" role="status" aria-label={`${pin.length} ${copy.digits}`}>
          {Array.from({ length: Math.max(4, pin.length) }, (_, index) => <span key={index} className={index < pin.length ? 'filled' : ''} aria-hidden="true" />)}
        </div>
        {err && <div className="error" role="alert">{err}</div>}
        <div className="keypad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} disabled={busy} onClick={() => press(d)}>{d}</button>)}
          <button className="ghost" disabled={busy} aria-label={copy.erase} onClick={() => setPin(pin.slice(0, -1))}><Icon name="arrow-left" size={24} /></button>
          <button disabled={busy} onClick={() => press('0')}>0</button>
          <button className="primary login-submit" disabled={busy || pin.length < 3} onClick={() => { void submit(pin); }}><Icon name={busy ? 'clock' : 'arrow-right'} size={21} /><span>{busy ? copy.waiting : t('login.go')}</span></button>
        </div>
      </section>
    </div>
  );
}
