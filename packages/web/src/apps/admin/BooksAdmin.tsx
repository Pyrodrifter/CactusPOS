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
interface Settings { pbkFolder: string; accounts: Accounts }
interface PbkStatus { configured: boolean; ok: boolean; problem?: string; postedDays: number; pendingDays: string[] }
interface View { settings: Settings; pbk: PbkStatus; today: string }

const copy = {
  en: {
    exportTitle: 'Export for your bookkeeper', exportIntro: 'Files any accounting program or accountant can open. They cover the days you have closed.',
    from: 'From', to: 'To', days: 'Daily sales (CSV)', daysHint: 'One row per day: sales, ABB per rate, cash, card, tips.',
    journal: 'Journal entries (CSV)', journalHint: 'Debit and credit lines per day, using the account numbers below.',
    pbkTitle: 'PyroBookKeeper (optional)', pbkIntro: 'If you keep your books in PyroBookKeeper on this computer, closed days can be posted straight into it. Leave this empty if you use something else.',
    folder: 'PyroBookKeeper data folder', folderHint: 'The folder you chose when PyroBookKeeper first started. It contains a "journal" folder.',
    save: 'Save', saved: 'Saved', off: 'Not connected.', ready: (n: number) => `Connected. ${n} day${n === 1 ? '' : 's'} posted.`,
    pending: (n: number) => `${n} closed day${n === 1 ? '' : 's'} waiting to be posted`, post: 'Post closed days', nothing: 'Everything is posted',
    posted: (p: number, r: number) => `Posted ${p} day${p === 1 ? '' : 's'}${r ? `, replaced ${r} earlier posting${r === 1 ? '' : 's'}` : ''}`,
    accounts: 'Account numbers', accountsHint: 'Defaults follow PyroBookKeeper’s chart of accounts. Change them only if your bookkeeper uses other numbers.',
    cash: 'Cash', card: 'Card takings (bank)', abb: 'ABB payable', tips: 'Tips owed to staff', overShort: 'Cash over / short',
    revenue: 'Revenue for', note: 'PyroBookKeeper builds its ABB return from invoices, so these daily postings appear in its ledger, profit and loss and balance sheet, but not on its ABB form. Use the Today reports here for the ABB figure.',
    downloadFailed: 'Could not make the file', loading: 'Loading…',
  },
  nl: {
    exportTitle: 'Export voor uw boekhouder', exportIntro: 'Bestanden die elk boekhoudprogramma of elke boekhouder kan openen. Ze bevatten de dagen die u heeft afgesloten.',
    from: 'Van', to: 'Tot', days: 'Dagomzet (CSV)', daysHint: 'Eén regel per dag: omzet, ABB per tarief, contant, pin, fooien.',
    journal: 'Journaalposten (CSV)', journalHint: 'Debet- en creditregels per dag, met de rekeningnummers hieronder.',
    pbkTitle: 'PyroBookKeeper (optioneel)', pbkIntro: 'Voert u uw boekhouding in PyroBookKeeper op deze computer, dan kunnen afgesloten dagen er direct in worden geboekt. Laat dit leeg als u iets anders gebruikt.',
    folder: 'Gegevensmap van PyroBookKeeper', folderHint: 'De map die u koos toen PyroBookKeeper voor het eerst startte. Er staat een map "journal" in.',
    save: 'Opslaan', saved: 'Opgeslagen', off: 'Niet gekoppeld.', ready: (n: number) => `Gekoppeld. ${n} dag${n === 1 ? '' : 'en'} geboekt.`,
    pending: (n: number) => `${n} afgesloten dag${n === 1 ? '' : 'en'} nog te boeken`, post: 'Afgesloten dagen boeken', nothing: 'Alles is geboekt',
    posted: (p: number, r: number) => `${p} dag${p === 1 ? '' : 'en'} geboekt${r ? `, ${r} eerdere boeking${r === 1 ? '' : 'en'} vervangen` : ''}`,
    accounts: 'Rekeningnummers', accountsHint: 'De standaard volgt het rekeningschema van PyroBookKeeper. Wijzig alleen als uw boekhouder andere nummers gebruikt.',
    cash: 'Kas', card: 'Pinontvangsten (bank)', abb: 'ABB te betalen', tips: 'Fooien voor personeel', overShort: 'Kasverschil',
    revenue: 'Omzet voor', note: 'PyroBookKeeper stelt de ABB-aangifte samen uit facturen. Deze dagboekingen staan dus wel in het grootboek, de winst-en-verliesrekening en de balans, maar niet op het ABB-formulier. Gebruik de rapporten onder Vandaag voor het ABB-bedrag.',
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
  const post = async () => {
    setBusy(true); setErr(''); setMsg('');
    try { const r = await api<{ posted: number; reversed: number }>('/books/pbk/post', { body: {} }); toast(c.posted(r.posted, r.reversed)); await load(); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const setAccount = (key: keyof Omit<Accounts, 'revenueByCategory'>, value: string) => { setMsg(''); setS({ ...s, accounts: { ...s.accounts, [key]: value.trim() } }); };
  const setRevenue = (id: string, value: string) => { setMsg(''); setS({ ...s, accounts: { ...s.accounts, revenueByCategory: { ...s.accounts.revenueByCategory, [id]: value.trim() } } }); };
  const account = (key: keyof Omit<Accounts, 'revenueByCategory'>, label: string) => (
    <label>{label}<input inputMode="numeric" value={s.accounts[key]} onChange={(e) => setAccount(key, e.target.value)} /></label>
  );
  const pbk = view.pbk;

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

      <section className="admin-form-card">
        <h3><Icon name="upload" />{c.pbkTitle}</h3>
        <p className="muted">{c.pbkIntro}</p>
        <label>{c.folder}
          <input value={s.pbkFolder} placeholder="C:\Users\…\Boekhouding" spellCheck={false} onChange={(e) => { setMsg(''); setS({ ...s, pbkFolder: e.target.value }); }} />
          <small>{c.folderHint}</small>
        </label>
        <p className={`reports-status${pbk.configured && !pbk.ok ? ' changed' : ''}`} role="status">
          <Icon name={pbk.ok ? 'check' : pbk.configured ? 'warning' : 'close'} />
          <span>{!pbk.configured ? c.off : pbk.ok ? `${c.ready(pbk.postedDays)} ${pbk.pendingDays.length ? c.pending(pbk.pendingDays.length) : c.nothing}.` : pbk.problem}</span>
        </p>
        {err && <div className="error" role="alert">{err}</div>}
        {msg && <div className="ok" role="status">{msg}</div>}
        <div className="actions">
          <button type="button" disabled={busy} onClick={() => void save()}><Icon name="check" />{c.save}</button>
          <button type="button" className="primary" disabled={busy || !pbk.ok || pbk.pendingDays.length === 0} onClick={() => void post()}><Icon name="upload" />{c.post}{pbk.pendingDays.length > 0 && ` (${pbk.pendingDays.length})`}</button>
        </div>
        <p className="notice">{c.note}</p>
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
          <div className="actions"><button type="button" className="primary" disabled={busy} onClick={() => void save()}><Icon name="check" />{c.save}</button></div>
        </div>
      </details>
    </div>
  );
}
