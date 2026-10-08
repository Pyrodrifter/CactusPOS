import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { formatMoney } from '@cactus/shared';
import { Icon as UiIcon } from './Icon';
import { useLang } from '../i18n';

/** Short vibration on phones that support it; silently nothing elsewhere. */
export function haptic(ms = 10): void {
  try { navigator.vibrate?.(ms); } catch { /* unsupported */ }
}

/* ---------- icons (inline, so they work offline) ---------- */
const svg = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
export const Icon = {
  order: () => svg(<><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>),
  kitchen: () => svg(<><path d="M6 13.87A4 4 0 0 1 7.41 6a5.11 5.11 0 0 1 1.05-1.54 5 5 0 0 1 7.08 0A5.11 5.11 0 0 1 16.59 6 4 4 0 0 1 18 13.87V21H6Z" /><path d="M6 17h12" /></>),
  admin: () => svg(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></>),
  board: () => svg(<><rect x="2" y="4" width="20" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>),
  cart: () => svg(<><circle cx="9" cy="20" r="1.5" /><circle cx="18" cy="20" r="1.5" /><path d="M2 3h3l2.7 12.4a1 1 0 0 0 1 .8h9.7a1 1 0 0 0 1-.8L21 7H6" /></>),
  back: () => svg(<><path d="M21 5H9l-7 7 7 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1Z" /><path d="m17 9-6 6M11 9l6 6" /></>),
  check: () => svg(<path d="m5 12.5 4.5 4.5L19 7.5" />),
  close: () => svg(<path d="M6 6l12 12M18 6 6 18" />),
  logout: () => svg(<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></>),
  cash: () => svg(<><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></>),
  card: () => svg(<><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20M6 15h4" /></>),
  chevron: () => svg(<path d="m9 6 6 6-6 6" />),
  receipt: () => svg(<><path d="M5 3v18l2.5-1.5L10 21l2-1.5 2 1.5 2.5-1.5L19 21V3Z" /><path d="M9 8h6M9 12h6" /></>),
};

/* ---------- sheet: centred dialog on tablets, slides up from the bottom on phones ---------- */
export function Sheet({ title, onClose, children, wide, dismissable = true }: {
  title?: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; dismissable?: boolean;
}) {
  const { lang } = useLang();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && dismissable) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, dismissable]);
  return (
    <div className="sheet-bg" onClick={dismissable ? onClose : undefined}>
      <div className={`sheet${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        {title !== undefined && (
          <div className="sheet-head">
            <h2>{title}</h2>
            {dismissable && <button className="icon-btn" aria-label={lang === 'nl' ? 'Sluiten' : 'Close'} onClick={onClose}><UiIcon name="close" /></button>}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/* ---------- money keypad: type cents like a card terminal (2 2 5 0 = $22.50) ---------- */
export function MoneyPad({ cents, onChange, max = 9_999_999 }: { cents: number; onChange: (c: number) => void; max?: number }) {
  const { lang } = useLang();
  const press = (k: string) => {
    haptic(6);
    if (k === 'back') return onChange(Math.floor(cents / 10));
    const next = k === '00' ? cents * 100 : cents * 10 + Number(k);
    if (next <= max) onChange(next);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('back');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <div className="money-pad">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0'].map((k) => <button key={k} type="button" onClick={() => press(k)}>{k}</button>)}
      <button type="button" className="pad-back" aria-label={lang === 'nl' ? 'Laatste cijfer wissen' : 'Delete last digit'} onClick={() => press('back')}><UiIcon name="arrow-left" /></button>
    </div>
  );
}

export function Money({ cents, className }: { cents: number; className?: string }) {
  return <span className={`money${className ? ` ${className}` : ''}`}>{formatMoney(cents)}</span>;
}

/* ---------- quantity stepper ---------- */
export function Stepper({ value, onChange, min = 0, max = 99 }: { value: number; onChange: (n: number) => void; min?: number; max?: number }) {
  const { lang } = useLang();
  return (
    <div className="stepper">
      <button type="button" aria-label={lang === 'nl' ? 'Minder' : 'Less'} disabled={value <= min} onClick={() => { haptic(6); onChange(value - 1); }}><UiIcon name="minus" /></button>
      <span aria-live="polite">{value}</span>
      <button type="button" aria-label={lang === 'nl' ? 'Meer' : 'More'} disabled={value >= max} onClick={() => { haptic(6); onChange(value + 1); }}><UiIcon name="plus" /></button>
    </div>
  );
}

/* ---------- toasts ---------- */
interface Toast { id: number; text: string; kind: 'ok' | 'error' }
let toasts: Toast[] = [];
let nextToast = 1;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function toast(text: string, kind: Toast['kind'] = 'ok'): void {
  const id = nextToast++;
  toasts = [...toasts.slice(-2), { id, text, kind }];
  emit();
  setTimeout(() => { toasts = toasts.filter((x) => x.id !== id); emit(); }, kind === 'error' ? 5000 : 2600);
}

export function Toasts() {
  const list = useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => toasts);
  return (
    <div className="toasts" aria-live="polite">
      {list.map((x) => <div key={x.id} className={`toast ${x.kind}`}>{x.kind === 'ok' && <Icon.check />}{x.text}</div>)}
    </div>
  );
}
