import { useEffect, useState } from 'react';
import { ServiceSettings, type ServiceMode } from '@cactus/shared';
import { api } from '../../lib/api';
import { MENU_CHANGED, SERVICE_MODE_CHANGED } from '../../lib/live';
import { useLang } from '../../i18n';
import { Icon } from '../../ui/Icon';
import { Sheet, toast } from '../../ui/touch';

export function useServiceMode() {
  const [mode, setMode] = useState<ServiceMode | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => { void api('/service-mode').then((value) => { if (alive) setMode(ServiceSettings.parse(value).mode); }).catch(() => {}); };
    load(); window.addEventListener(SERVICE_MODE_CHANGED, load); window.addEventListener(MENU_CHANGED, load);
    return () => { alive = false; window.removeEventListener(SERVICE_MODE_CHANGED, load); window.removeEventListener(MENU_CHANGED, load); };
  }, []);
  return mode;
}

export function ServiceModeControl({ mode, disabled }: { mode: ServiceMode | null; disabled: boolean }) {
  const { lang } = useLang();
  const nl = lang === 'nl';
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const c = nl ? { title: 'Service kiezen', calm: 'Rustige service', busy: 'Drukke service', calmHint: 'Direct afrekenen. Nieuwe bestellingen gaan niet naar de keuken of het afhaalscherm.', busyHint: 'Nieuwe bestellingen verschijnen op beide schermen. De keuken kan ze bereiden en gereedmelden.', hint: 'Geldt voor nieuwe bestellingen op alle kassa’s. Bestaande keukenbonnen blijven staan. Bonnen afdrukken kan in beide standen.', changed: 'Servicestand bijgewerkt' }
    : { title: 'Choose service mode', calm: 'Calm service', busy: 'Busy service', calmHint: 'Serve at the counter. New orders skip the kitchen and pickup screens.', busyHint: 'New orders go to both screens. The kitchen can prepare them and mark them ready.', hint: 'Applies to new orders on every till. Existing kitchen tickets stay in place. Receipts work in both modes.', changed: 'Service mode updated' };
  const save = async (next: ServiceMode) => {
    if (busy) return; setBusy(true); setError('');
    try { await api('/service-mode', { method: 'PUT', body: { mode: next } }); window.dispatchEvent(new Event(SERVICE_MODE_CHANGED)); setOpen(false); toast(c.changed); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <><button className={`service-mode ${mode === 'counter' ? 'calm' : ''}`} disabled={disabled || !mode} onClick={() => setOpen(true)} aria-haspopup="dialog"><Icon name={mode === 'counter' ? 'sun' : 'kitchen'} /><span>{mode === 'counter' ? c.calm : c.busy}</span><Icon name="chevron-down" size={16} /></button>
    {open && <div className="service-mode-dialog"><Sheet title={c.title} onClose={() => setOpen(false)} dismissable={!busy}>
      <p className="muted">{c.hint}</p>
      {(['counter', 'board'] as const).map((value) => <button className={`service-choice${mode === value ? ' selected' : ''}`} key={value} aria-pressed={mode === value} disabled={busy} onClick={() => void save(value)}><Icon name={value === 'counter' ? 'sun' : 'kitchen'} size={30} /><span><strong>{value === 'counter' ? c.calm : c.busy}</strong><small>{value === 'counter' ? c.calmHint : c.busyHint}</small></span>{mode === value && <Icon name="check" />}</button>)}
      {error && <p className="error" role="alert">{error}</p>}
    </Sheet></div>}
  </>;
}
