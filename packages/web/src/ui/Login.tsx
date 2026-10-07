import { useState } from 'react';
import { api, type Session } from '../lib/api';
import { useLang } from '../i18n';

export function Login({ onDone }: { onDone: (s: Session) => void }) {
  const { t } = useLang();
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');

  const submit = async (p: string) => {
    try {
      onDone(await api<Session>('/login', { body: { pin: p } }));
    } catch {
      setErr(t('login.wrong'));
      setPin('');
    }
  };
  const press = (d: string) => {
    setErr('');
    const next = (pin + d).slice(0, 8);
    setPin(next);
  };

  return (
    <div className="login">
      <h1>🌵 {t('app.name')}</h1>
      <p>{t('login.title')}</p>
      <div className="pin-dots" aria-live="polite">{pin ? '•'.repeat(pin.length) : ' '}</div>
      {err && <div className="error">{err}</div>}
      <div className="keypad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} onClick={() => press(d)}>{d}</button>)}
        <button className="ghost" onClick={() => setPin(pin.slice(0, -1))}>⌫</button>
        <button onClick={() => press('0')}>0</button>
        <button className="primary" disabled={pin.length < 3} onClick={() => submit(pin)}>{t('login.go')}</button>
      </div>
    </div>
  );
}
