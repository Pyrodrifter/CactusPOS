import { useState } from 'react';
import { useLang } from '../../i18n';
import { MenuAdmin } from './MenuAdmin';
import { BusinessAdmin } from './BusinessAdmin';
import { StaffAdmin } from './StaffAdmin';
import { TaxAdmin } from './TaxAdmin';
import { PrinterAdmin } from './PrinterAdmin';
import { ReportsAdmin } from './ReportsAdmin';
import { Icon, type IconName } from '../../ui/Icon';
import { useAdminCopy } from './copy';
import './admin.css';

const TABS = ['reports', 'menu', 'business', 'staff', 'tax', 'printer'] as const;
type Tab = (typeof TABS)[number];
const tabIcons: Record<Tab, IconName> = { reports: 'receipt', menu: 'menu', business: 'leaf', staff: 'staff', tax: 'tax', printer: 'printer' };

export function Admin() {
  const { t } = useLang();
  const copy = useAdminCopy();
  const [tab, setTab] = useState<Tab>('reports');
  return (
    <div className="admin">
      <nav className="tabs admin-tabs" aria-label={t('nav.admin')}>
        {TABS.map((x) => <button key={x} className={tab === x ? 'on' : ''} aria-current={tab === x ? 'page' : undefined} onClick={() => setTab(x)}><Icon name={tabIcons[x]} />{t(`admin.${x}`)}</button>)}
      </nav>
      <div className="admin-body">
        <p className="admin-hint">{copy[tab]}</p>
        {tab === 'reports' && <ReportsAdmin />}
        {tab === 'menu' && <MenuAdmin />}
        {tab === 'business' && <BusinessAdmin />}
        {tab === 'staff' && <StaffAdmin />}
        {tab === 'tax' && <TaxAdmin />}
        {tab === 'printer' && <PrinterAdmin />}
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
