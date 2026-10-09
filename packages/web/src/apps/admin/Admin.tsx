import { useRef, useState } from 'react';
import { useLang } from '../../i18n';
import { MenuAdmin } from './MenuAdmin';
import { BusinessAdmin } from './BusinessAdmin';
import { StaffAdmin } from './StaffAdmin';
import { TaxAdmin } from './TaxAdmin';
import { PrinterAdmin } from './PrinterAdmin';
import { ReportsAdmin } from './ReportsAdmin';
import { BooksAdmin } from './BooksAdmin';
import { Icon, type IconName } from '../../ui/Icon';
import { useAdminCopy } from './copy';
import { ScrollRow } from './controls';
import './admin.css';

const TABS = ['reports', 'menu', 'business', 'staff', 'tax', 'printer', 'books'] as const;
type Tab = (typeof TABS)[number];
const tabIcons: Record<Tab, IconName> = { reports: 'receipt', menu: 'menu', business: 'leaf', staff: 'staff', tax: 'tax', printer: 'printer', books: 'download' };

export function Admin() {
  const { t } = useLang();
  const copy = useAdminCopy();
  const [tab, setTab] = useState<Tab>('reports');
  const root = useRef<HTMLDivElement>(null);
  /* The tabs stay pinned, so a new tab starts at its top instead of wherever the last one was scrolled to. */
  const choose = (x: Tab) => { setTab(x); root.current?.closest('main')?.scrollTo({ top: 0 }); };
  return (
    <div className="admin" ref={root}>
      <div className="admin-tabbar">
        <ScrollRow nav className="admin-tabs" label={t('nav.admin')}>
          {TABS.map((x) => (
            <button key={x} type="button" className={tab === x ? 'on' : ''} data-active={tab === x} aria-current={tab === x ? 'page' : undefined} onClick={() => choose(x)}>
              <Icon name={tabIcons[x]} /><span>{t(`admin.${x}`)}</span>
            </button>
          ))}
        </ScrollRow>
      </div>
      <div className="admin-body">
        {/* Menu and Staff show their one line of help beside their own buttons, to keep the list high on the screen. */}
        {tab !== 'menu' && tab !== 'staff' && <p className="admin-hint">{copy[tab]}</p>}
        {tab === 'reports' && <ReportsAdmin />}
        {tab === 'menu' && <MenuAdmin />}
        {tab === 'business' && <BusinessAdmin />}
        {tab === 'staff' && <StaffAdmin />}
        {tab === 'tax' && <TaxAdmin />}
        {tab === 'printer' && <PrinterAdmin />}
        {tab === 'books' && <BooksAdmin />}
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
