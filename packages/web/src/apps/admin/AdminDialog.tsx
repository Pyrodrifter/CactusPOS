import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from '../../ui/Icon';
import { useAdminCopy } from './copy';

/**
 * Native modal provides focus containment, Escape handling and focus restoration.
 * The heading and the `footer` (the actions) stay put; only the middle scrolls, so the main action is
 * always under the thumb. On phones the dialog rises from the bottom edge (touch-ui.md).
 */
export function AdminDialog({ title, onClose, busy = false, wide = false, error = '', footer, children }: {
  title: string; onClose: () => void; busy?: boolean; wide?: boolean; error?: string; footer?: ReactNode; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const copy = useAdminCopy();
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog ref={ref} className={`admin-dialog${wide ? ' wide' : ''}`} aria-label={title}
      onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="admin-dialog-content" aria-busy={busy}>
        <header className="admin-dialog-heading">
          <h2>{title}</h2>
          <button type="button" className="ghost admin-close" aria-label={copy.close} disabled={busy} onClick={onClose}><Icon name="close" /></button>
        </header>
        <div className="admin-dialog-body">{children}</div>
        {(footer || error) && (
          <footer className="admin-dialog-foot">
            {error && <div className="error" role="alert">{error}</div>}
            {footer && <div className="admin-dialog-actions">{footer}</div>}
          </footer>
        )}
      </div>
    </dialog>
  );
}
