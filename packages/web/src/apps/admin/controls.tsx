import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLang } from '../../i18n';
import { Icon } from '../../ui/Icon';
import { errText } from './Admin';
import { AdminDialog } from './AdminDialog';
import { useAdminCopy } from './copy';

/**
 * A row that scrolls sideways when its buttons do not fit. The buttons never shrink, an arrow on
 * either edge shows that more exists, and the chosen button (`data-active="true"`) is brought into view.
 */
export function ScrollRow({ label, className = '', nav = false, children }: {
  label: string; className?: string; nav?: boolean; children: ReactNode;
}) {
  const track = useRef<HTMLDivElement>(null);
  const shown = useRef<{ item: HTMLElement | null; left: number }>({ item: null, left: 0 });
  const [more, setMore] = useState({ left: false, right: false });
  const update = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const left = el.scrollLeft > 6;
    const right = el.scrollLeft < max - 6;
    setMore((m) => (m.left === left && m.right === right ? m : { left, right }));
  }, []);
  useEffect(() => { update(); }); // the buttons inside may have changed
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(el);
    return () => { el.removeEventListener('scroll', update); window.removeEventListener('resize', update); observer?.disconnect(); };
  }, [update]);
  useEffect(() => {
    // Runs after every render: a chosen button can appear later than the choice (a category just added)
    // or change place (a category moved). Scrolling the row by hand changes neither, so it is left alone.
    const el = track.current;
    const item = el?.querySelector<HTMLElement>('[data-active="true"]') ?? null;
    if (!el || !item || (item === shown.current.item && item.offsetLeft === shown.current.left)) return;
    shown.current = { item, left: item.offsetLeft };
    const peek = 64; // clear of the edge arrows, with a slice of the neighbour showing
    const start = item.offsetLeft - peek;
    const end = item.offsetLeft + item.offsetWidth + peek;
    // Set at once: a smooth scroll here was cut short when the page itself moved in the same tap.
    if (start < el.scrollLeft) el.scrollLeft = Math.max(0, start);
    else if (end > el.scrollLeft + el.clientWidth) el.scrollLeft = end - el.clientWidth;
  });

  const Track = nav ? 'nav' : 'div';
  return (
    <div className={`admin-scroll ${className}${more.left ? ' more-left' : ''}${more.right ? ' more-right' : ''}`}>
      <Track ref={track} className="admin-scroll-track" aria-label={label} role={nav ? undefined : 'group'}>{children}</Track>
      <span className="admin-scroll-hint left" aria-hidden="true"><Icon name="chevron-down" /></span>
      <span className="admin-scroll-hint right" aria-hidden="true"><Icon name="chevron-down" /></span>
    </div>
  );
}

/** A full-width on/off row: the label on the left, the state in words and a switch on the right. */
export function AdminSwitch({ on, onChange, label, hint, disabled = false }: {
  on: boolean; onChange: (on: boolean) => void; label: string; hint?: string; disabled?: boolean;
}) {
  const copy = useAdminCopy();
  return (
    <button type="button" role="switch" aria-checked={on} className={`admin-switch${on ? ' is-on' : ''}`} disabled={disabled} onClick={() => onChange(!on)}>
      <span className="admin-switch-text"><b>{label}</b>{hint && <small>{hint}</small>}</span>
      <span className="admin-switch-state" aria-hidden="true">{on ? copy.on : copy.off}</span>
      <span className="admin-switch-track" aria-hidden="true"><i /></span>
    </button>
  );
}

/** Asks for one name with a real text field and big buttons, instead of the browser's own prompt box. */
export function NameDialog({ title, label, initial = '', placeholder, saveLabel, emptyError, onSave, onClose }: {
  title: string; label: string; initial?: string; placeholder?: string; saveLabel: string; emptyError: string;
  onSave: (name: string) => Promise<unknown>; onClose: () => void;
}) {
  const { t } = useLang();
  const copy = useAdminCopy();
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  const save = async () => {
    if (busy) return;
    const clean = name.trim();
    if (!clean) { setErr(emptyError); input.current?.focus(); return; }
    setBusy(true); setErr('');
    try { await onSave(clean); } catch (e) { setErr(errText(e)); setBusy(false); }
  };
  return (
    <AdminDialog title={title} onClose={onClose} busy={busy} error={err} footer={<>
      <button type="button" className="ghost" disabled={busy} onClick={onClose}>{t('pay.cancel')}</button>
      <button type="button" className="primary" disabled={busy} onClick={() => void save()}><Icon name="check" />{busy ? copy.saving : saveLabel}</button>
    </>}>
      <label>{label}
        <input ref={input} value={name} placeholder={placeholder} maxLength={60} enterKeyHint="done" autoComplete="off" disabled={busy}
          onChange={(e) => { setErr(''); setName(e.target.value); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void save(); } }} />
      </label>
    </AdminDialog>
  );
}

/** Asks before something is removed, instead of the browser's own confirm box. Cancel and the red button sit apart. */
export function ConfirmDialog({ title, text, confirmLabel, onConfirm, onClose }: {
  title: string; text: string; confirmLabel: string; onConfirm: () => Promise<unknown>; onClose: () => void;
}) {
  const { t } = useLang();
  const copy = useAdminCopy();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const proceed = async () => {
    if (busy) return;
    setBusy(true); setErr('');
    try { await onConfirm(); } catch (e) { setErr(errText(e)); setBusy(false); }
  };
  return (
    <AdminDialog title={title} onClose={onClose} busy={busy} error={err} footer={<>
      <button type="button" className="ghost" disabled={busy} onClick={onClose}>{t('pay.cancel')}</button>
      <button type="button" className="danger-solid" disabled={busy} onClick={() => void proceed()}><Icon name="trash" />{busy ? copy.deleting : confirmLabel}</button>
    </>}>
      <p className="admin-confirm-text">{text}</p>
    </AdminDialog>
  );
}
