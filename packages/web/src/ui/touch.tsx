import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { formatMoney } from '@cactus/shared';
import { Icon as UiIcon } from './Icon';
import { useLang } from '../i18n';

/** Short vibration on phones that support it; silently nothing elsewhere. */
export function haptic(ms = 10): void {
  try { navigator.vibrate?.(ms); } catch { /* unsupported */ }
}

/* ---------- icons (inline, so they work offline) ---------- */
export const Icon = {
  order: () => <UiIcon name="menu" />,
  kitchen: () => <UiIcon name="kitchen" />,
  admin: () => <UiIcon name="settings" />,
  board: () => <UiIcon name="pickup" />,
  cart: () => <UiIcon name="cart" />,
  back: () => <UiIcon name="arrow-left" />,
  check: () => <UiIcon name="check" />,
  close: () => <UiIcon name="close" />,
  logout: () => <UiIcon name="logout" />,
  cash: () => <UiIcon name="cash" />,
  card: () => <UiIcon name="card" />,
  chevron: () => <UiIcon name="arrow-right" />,
  receipt: () => <UiIcon name="receipt" />,
};
/* ---------- sheet: centred dialog on tablets, slides up from the bottom on phones ---------- */
export function Sheet({ title, onClose, children, wide, dismissable = true }: {
  title?: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; dismissable?: boolean;
}) {
  const { lang } = useLang();
  const panel = useRef<HTMLDivElement>(null);
  const closing = useRef({ onClose, dismissable });
  closing.current = { onClose, dismissable };
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = panel.current;
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closing.current.dismissable) { e.preventDefault(); closing.current.onClose(); }
      if (e.key !== 'Tab' || !dialog) return;
      const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')]
        .filter((element) => element.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (!first) { e.preventDefault(); dialog.focus(); }
      else if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <div className="sheet-bg" onClick={dismissable ? onClose : undefined}>
      <div ref={panel} tabIndex={-1} className={`sheet${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} onClick={(e) => e.stopPropagation()}>
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
      <button type="button" className="pad-back" aria-label={lang === 'nl' ? 'Laatste cijfer wissen' : 'Delete last digit'} onClick={() => press('back')}><UiIcon name="backspace" /></button>
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
