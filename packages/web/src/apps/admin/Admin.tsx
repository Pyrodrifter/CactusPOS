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

type Tab = 'reports' | 'menu' | 'receipts' | 'business' | 'staff' | 'tax' | 'printer' | 'books' | 'backups';
/** The pages in three groups: what is used every day, what is set up once, and the records kept for later. */
const GROUPS: { id: 'daily' | 'setup' | 'records'; tabs: Tab[] }[] = [
  { id: 'daily', tabs: ['reports', 'menu'] },
  { id: 'setup', tabs: ['receipts', 'business', 'staff', 'tax', 'printer'] },
  { id: 'records', tabs: ['books', 'backups'] },
];
const tabIcons: Record<Tab, IconName> = { reports: 'receipt', menu: 'menu', receipts: 'edit', business: 'leaf', staff: 'staff', tax: 'tax', printer: 'printer', books: 'download', backups: 'refresh' };

export function Admin() {
  const { t } = useLang();
  const copy = useAdminCopy();
  const [tab, setTab] = useState<Tab>('reports');
  const root = useRef<HTMLDivElement>(null);
  /* The tabs stay pinned, so a new tab starts at its top instead of wherever the last one was scrolled to. */
  const choose = (x: Tab) => { setTab(x); root.current?.closest('main')?.scrollTo({ top: 0 }); };
  const label = (x: Tab) => (x === 'receipts' ? copy.receiptDesign : t(`admin.${x}`));
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
        {/* One list for every size: a row that scrolls sideways on phones and portrait tablets, a side menu on a
            landscape tablet. The group names show in the side menu; in the row they are thin dividers. */}
        <ScrollRow nav className="admin-tabs" label={t('nav.admin')}>
          {GROUPS.flatMap((g) => [
            <span key={g.id} className="admin-tabs-group">{copy.groups[g.id]}</span>,
            ...g.tabs.map((x) => (
              <button key={x} type="button" data-tab={x} className={tab === x ? 'on' : ''} data-active={tab === x} aria-current={tab === x ? 'page' : undefined} onClick={() => choose(x)}>
                <Icon name={tabIcons[x]} /><span>{label(x)}</span>
              </button>
            )),
          ])}
        </ScrollRow>
      </div>
      <div className="admin-body">
        {/* Menu and Staff show their one line of help beside their own buttons, to keep the list high on the screen.
            The receipt editor opens with a heading of its own, so its page name is only for screen readers. */}
        <header className={`admin-page-head${tab === 'receipts' ? ' is-quiet' : ''}`}>
          <h1>{label(tab)}</h1>
          {tab !== 'menu' && tab !== 'staff' && tab !== 'receipts' && <p>{copy[tab]}</p>}
        </header>
        {examplePins.length > 0 && tab === 'reports' && (
          <p className="notice admin-pin-reminder" role="status">
            <span>{copy.examplePins(examplePins.join(', '))}</span>
            <button type="button" onClick={() => choose('staff')}><Icon name="staff" />{t('admin.staff')}</button>
          </p>
        )}
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
