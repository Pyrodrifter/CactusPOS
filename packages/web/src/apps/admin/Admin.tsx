import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { useLang } from '../../i18n';
import { MenuAdmin } from './MenuAdmin';
import { BusinessAdmin } from './BusinessAdmin';
import { StaffAdmin } from './StaffAdmin';
import { TaxAdmin } from './TaxAdmin';
import { PrinterAdmin } from './PrinterAdmin';
import { ReportsAdmin } from './ReportsAdmin';
import { BooksAdmin } from './BooksAdmin';
import { BackupAdmin } from './BackupAdmin';
import { Icon, type IconName } from '../../ui/Icon';
import { useAdminCopy } from './copy';
import { ScrollRow } from './controls';
import './admin.css';
import { ReceiptEditor } from './receipt-editor/ReceiptEditor';

const TABS = ['reports', 'menu', 'receipts', 'business', 'staff', 'tax', 'printer', 'books', 'backups'] as const;
type Tab = (typeof TABS)[number];
const tabIcons: Record<Tab, IconName> = { reports: 'receipt', menu: 'menu', receipts: 'edit', business: 'leaf', staff: 'staff', tax: 'tax', printer: 'printer', books: 'download', backups: 'refresh' };

export function Admin() {
  const { t, lang } = useLang();
  const copy = useAdminCopy();
  const [tab, setTab] = useState<Tab>('reports');
  const root = useRef<HTMLDivElement>(null);
  /* The tabs stay pinned, so a new tab starts at its top instead of wherever the last one was scrolled to. */
  const choose = (x: Tab) => { setTab(x); root.current?.closest('main')?.scrollTo({ top: 0 }); };
  // A new database starts with the PINs 1234 and 1111. Until they are changed, the first Admin page says so
  // (one quiet line, not on every page); checked again after a visit to Staff.
  const [examplePins, setExamplePins] = useState<string[]>([]);
  useEffect(() => {
    let stale = false;
    void api<{ staff: { name: string }[] }>('/admin/staff/example-pins')
      .then((r) => { if (!stale) setExamplePins(r.staff.map((s) => s.name)); }).catch(() => { /* a reminder only */ });
    return () => { stale = true; };
  }, [tab]);
  return (
    <div className="admin" ref={root}>
      <div className="admin-tabbar">
        <ScrollRow nav className="admin-tabs" label={t('nav.admin')}>
          {TABS.map((x) => (
            <button key={x} type="button" className={tab === x ? 'on' : ''} data-active={tab === x} aria-current={tab === x ? 'page' : undefined} onClick={() => choose(x)}>
              <Icon name={tabIcons[x]} /><span>{x === 'receipts' ? (lang === 'nl' ? 'Bonontwerp' : 'Receipt design') : t(`admin.${x}`)}</span>
            </button>
          ))}
        </ScrollRow>
      </div>
      <div className="admin-body">
        {examplePins.length > 0 && tab === 'reports' && (
          <p className="notice admin-pin-reminder" role="status">
            <span>{copy.examplePins(examplePins.join(', '))}</span>
            <button type="button" onClick={() => choose('staff')}><Icon name="staff" />{t('admin.staff')}</button>
          </p>
        )}
        {/* Menu and Staff show their one line of help beside their own buttons, to keep the list high on the screen. */}
        {tab !== 'menu' && tab !== 'staff' && tab !== 'receipts' && <p className="admin-hint">{copy[tab]}</p>}
        {tab === 'receipts' && <ReceiptEditor />}
        {tab === 'reports' && <ReportsAdmin />}
        {tab === 'menu' && <MenuAdmin />}
        {tab === 'business' && <BusinessAdmin />}
        {tab === 'staff' && <StaffAdmin />}
        {tab === 'tax' && <TaxAdmin />}
        {tab === 'printer' && <PrinterAdmin />}
        {tab === 'books' && <BooksAdmin />}
        {tab === 'backups' && <BackupAdmin />}
      </div>
    </div>
  );
}

/** Ids must work on plain http LAN addresses, where crypto.randomUUID is unavailable. */
export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
