import { useState } from 'react';
import type { PracticeLaunch } from '@cactus/shared';
import { api, setSession } from '../lib/api';
import { androidPracticeSupported, isPractice } from '../lib/clientMode';
import { useLang } from '../i18n';
import { Icon } from './Icon';

export function PracticeControl() {
  const { lang } = useLang();
  const nl = lang === 'nl';
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (isPractice()) return null;
  const enter = async () => {
    setBusy(true); setError('');
    try {
      if (!androidPracticeSupported()) throw new Error(nl ? 'Werk de Android-app bij om veilig te oefenen.' : 'Update the Android app to use practice mode safely.');
      const result = await api<PracticeLaunch>('/practice/start', { body: {} });
      setSession(result.session, 'practice'); location.assign(result.path);
    } catch (problem) { setError(problem instanceof Error ? problem.message : String(problem)); setBusy(false); }
  };
  return <div className="practice-control">
    <button type="button" className="screen-option" onClick={() => setConfirm(true)}><Icon name="staff" /><span><strong>{nl ? 'Oefenmodus' : 'Practice mode'}</strong><small>{nl ? 'Probeer de kassa met aparte oefenverkopen.' : 'Learn the till with separate practice sales.'}</small></span></button>
    {confirm && <div className="practice-confirm" role="dialog" aria-modal="true" aria-label={nl ? 'Oefenmodus starten' : 'Enter practice mode'}>
      <p>{nl ? 'Rond een lopende betaling eerst af. Oefenen gebruikt een aparte database; echte printers, kassalade en boekhoudkoppeling staan uit.' : 'Finish any payment first. Practice uses a separate database; real printers, the cash drawer and bookkeeping posting are disabled.'}</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions"><button disabled={busy} onClick={() => setConfirm(false)}>{nl ? 'Annuleren' : 'Cancel'}</button><button className="primary practice-start" disabled={busy} onClick={() => void enter()}>{busy ? (nl ? 'Even geduld…' : 'One moment…') : (nl ? 'Oefenen starten' : 'Start practice')}</button></div>
    </div>}
  </div>;
}

export function PracticeBanner() {
  const { lang } = useLang(); const nl = lang === 'nl';
  const [confirm, setConfirm] = useState(false);
  if (!isPractice()) return null;
  const supported = androidPracticeSupported();
  return <aside className="practice-banner" role="status">
    <div><strong>{nl ? 'OEFENMODUS' : 'PRACTICE MODE'}</strong><span>{nl ? 'Aparte oefenverkopen · echte printers en boekhouding staan uit' : 'Separate practice sales · real printers and bookkeeping are off'}</span>
      {!supported && <b>{nl ? 'Werk de Android-app bij voordat u oefent.' : 'Update the Android app before practicing.'}</b>}</div>
    <button onClick={() => setConfirm(true)}>{nl ? 'Naar de echte kassa' : 'Return to live till'}</button>
    {confirm && <div className="practice-exit" role="dialog" aria-modal="true" aria-label={nl ? 'Naar de echte kassa' : 'Return to live till'}>
      <p>{nl ? 'Volgende bestellingen tellen weer als echte verkopen. Terug naar de echte kassa?' : 'New orders will count as real sales again. Return to the live till?'}</p>
      <div className="actions"><button onClick={() => setConfirm(false)}>{nl ? 'Blijven oefenen' : 'Keep practicing'}</button><button className="primary" onClick={() => location.assign('/pos')}>{nl ? 'Echte kassa openen' : 'Open live till'}</button></div>
    </div>}
  </aside>;
}
