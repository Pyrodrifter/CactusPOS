import { useEffect, useState } from 'react';
import { AutoCollect } from '@cactus/shared';
import { api } from '../lib/api';
import { useLang } from '../i18n';
import { toast } from './touch';

const copy = {
  en: { title: 'Picked up by itself after', off: 'Off', min: (n: number) => `${n} min`, hint: 'Ready orders leave the kitchen and the pickup board by themselves. For every screen.', error: 'Could not save. Try again.' },
  nl: { title: 'Vanzelf opgehaald na', off: 'Uit', min: (n: number) => `${n} min`, hint: 'Klare bestellingen verdwijnen vanzelf van de keuken en het ophaalscherm. Voor elk scherm.', error: 'Niet opgeslagen. Probeer opnieuw.' },
};
const CHOICES = [0, 60, 120, 300];

/** Owner's choice of how long a ready order stays before it counts as picked up. Business-wide, saved on the server. */
export function AutoCollectPicker() {
  const { lang } = useLang();
  const c = copy[lang];
  const [seconds, setSeconds] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    void api('/auto-collect').then((v) => { if (alive) setSeconds(AutoCollect.parse(v).seconds); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const choose = async (next: number) => {
    const before = seconds;
    setSeconds(next);
    try { await api('/auto-collect', { method: 'PUT', body: { seconds: next } }); } catch { setSeconds(before); toast(c.error, 'error'); }
  };
  return <div className="auto-collect">
    <strong>{c.title}</strong>
    <div className="auto-collect-choices">{CHOICES.map((value) => <button key={value} aria-pressed={seconds === value} disabled={seconds === null} onClick={() => void choose(value)}>{value ? c.min(value / 60) : c.off}</button>)}</div>
    <p>{c.hint}</p>
  </div>;
}
