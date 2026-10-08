import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from '../../ui/Icon';
import { useAdminCopy } from './copy';

/** Native modal provides focus containment, Escape handling and focus restoration. */
export function AdminDialog({ title, onClose, busy = false, wide = false, children }: {
  title: string; onClose: () => void; busy?: boolean; wide?: boolean; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const copy = useAdminCopy();
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <dialog ref={ref} className={`admin-dialog${wide ? ' wide' : ''}`} aria-label={title}
      onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="admin-dialog-content" aria-busy={busy}>
        <header className="admin-dialog-heading">
          <h2>{title}</h2>
          <button className="ghost admin-close" aria-label={copy.close} disabled={busy} onClick={onClose}><Icon name="close" /></button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
