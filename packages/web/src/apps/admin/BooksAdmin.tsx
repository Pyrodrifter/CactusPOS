import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, getSession } from '../../lib/api';
import { apiPath } from '../../lib/clientMode';
import { useLang } from '../../i18n';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/touch';
import { errText } from './Admin';

interface Accounts {
  cash: string; card: string; abbPayable: string; tips: string; overShort: string;
  revenueByCategory: Record<string, string>; revenueTaxed: string; revenueExempt: string; revenueOutsideScope: string;
}
interface Settings { accounts: Accounts }
interface View { settings: Settings; today: string }

const copy = {
  en: {
    exportTitle: 'Export for your bookkeeper', exportIntro: 'Files any accounting program or accountant can open. They cover the days you have closed.',
    from: 'From', to: 'To', days: 'Daily sales (CSV)', daysHint: 'One row per day: sales, ABB per rate, cash, card, tips.',
    journal: 'Journal entries (CSV)', journalHint: 'Debit and credit lines per day, using the account numbers below.',
    save: 'Save', saved: 'Saved',
    accounts: 'Account numbers', accountsHint: 'Change them only if your bookkeeper uses other numbers.',
    cash: 'Cash', card: 'Card takings (bank)', abb: 'ABB payable', tips: 'Tips owed to staff', overShort: 'Cash over / short',
    revenue: 'Revenue for',
    downloadFailed: 'Could not make the file', loading: 'Loading…',
  },
  nl: {
    exportTitle: 'Export voor uw boekhouder', exportIntro: 'Bestanden die elk boekhoudprogramma of elke boekhouder kan openen. Ze bevatten de dagen die u heeft afgesloten.',
    from: 'Van', to: 'Tot', days: 'Dagomzet (CSV)', daysHint: 'Eén regel per dag: omzet, ABB per tarief, contant, pin, fooien.',
    journal: 'Journaalposten (CSV)', journalHint: 'Debet- en creditregels per dag, met de rekeningnummers hieronder.',
    save: 'Opslaan', saved: 'Opgeslagen',
    accounts: 'Rekeningnummers', accountsHint: 'Wijzig ze alleen als uw boekhouder andere nummers gebruikt.',
    cash: 'Kas', card: 'Pinontvangsten (bank)', abb: 'ABB te betalen', tips: 'Fooien voor personeel', overShort: 'Kasverschil',
    revenue: 'Omzet voor',
    downloadFailed: 'Het bestand kon niet worden gemaakt', loading: 'Laden…',
  },
};

export function BooksAdmin() {
  const { lang } = useLang();
  const c = copy[lang];
  const [view, setView] = useState<View | null>(null);
  const [s, setS] = useState<Settings | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const v = await api<View>('/books');
    setView(v);
    setS((old) => old ?? v.settings);
    setFrom((f) => f || `${v.today.slice(0, 8)}01`);
    setTo((t) => t || v.today);
  }, []);
  useEffect(() => { void load().catch((e) => setErr(errText(e))); }, [load]);
  if (!view || !s) return <p className={err ? 'error' : 'muted center'} role="status">{err || c.loading}</p>;

  const download = async (kind: 'days' | 'journal') => {
    try {
      const res = await fetch(apiPath(`/books/${kind}.csv?from=${from}&to=${to}`), { headers: { 'x-token': getSession()?.token ?? '' } });
      if (!res.ok) throw new ApiError(res.status, c.downloadFailed);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `${kind === 'days' ? 'daily-sales' : 'journal'}_${from}_${to}.csv`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { toast(errText(e), 'error'); }
  };
  const save = async () => {
    setBusy(true); setErr(''); setMsg('');
    try { setS(await api<Settings>('/books/settings', { method: 'PUT', body: s })); setMsg(c.saved); await load(); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const setAccount = (key: keyof Omit<Accounts, 'revenueByCategory'>, value: string) => { setMsg(''); setS({ ...s, accounts: { ...s.accounts, [key]: value.trim() } }); };
  const setRevenue = (id: string, value: string) => { setMsg(''); setS({ ...s, accounts: { ...s.accounts, revenueByCategory: { ...s.accounts.revenueByCategory, [id]: value.trim() } } }); };
  const account = (key: keyof Omit<Accounts, 'revenueByCategory'>, label: string) => (
    <label>{label}<input inputMode="numeric" value={s.accounts[key]} onChange={(e) => setAccount(key, e.target.value)} /></label>
  );

  return (
    <div className="form books">
      <section className="admin-form-card">
        <h3><Icon name="download" />{c.exportTitle}</h3>
        <p className="muted">{c.exportIntro}</p>
        <div className="two">
          <label>{c.from}<input type="date" value={from} max={to || view.today} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>{c.to}<input type="date" value={to} min={from} max={view.today} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <div className="books-downloads">
          <button type="button" onClick={() => void download('days')}><Icon name="download" /><span><b>{c.days}</b><small>{c.daysHint}</small></span></button>
          <button type="button" onClick={() => void download('journal')}><Icon name="download" /><span><b>{c.journal}</b><small>{c.journalHint}</small></span></button>
        </div>
      </section>

      <details className="admin-form-card books-accounts">
        <summary><Icon name="tax" />{c.accounts}</summary>
        <div className="books-accounts-body">
          <p className="muted">{c.accountsHint}</p>
          <div className="two">
            {account('cash', c.cash)}{account('card', c.card)}{account('abbPayable', c.abb)}{account('tips', c.tips)}{account('overShort', c.overShort)}
            {Object.keys(s.accounts.revenueByCategory).map((id) => (
              <label key={id}>{c.revenue} {id}<input inputMode="numeric" value={s.accounts.revenueByCategory[id]} onChange={(e) => setRevenue(id, e.target.value)} /></label>
            ))}
          </div>
          {err && <div className="error" role="alert">{err}</div>}
          {msg && <div className="ok" role="status">{msg}</div>}
          <div className="actions"><button type="button" className="primary" disabled={busy} onClick={() => void save()}><Icon name="check" />{c.save}</button></div>
        </div>
      </details>
    </div>
  );
}
