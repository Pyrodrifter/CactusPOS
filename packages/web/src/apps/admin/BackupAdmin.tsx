import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useLang } from '../../i18n';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/touch';
import { errText } from './Admin';

interface BackupFile { name: string; at: string; bytes: number }
interface BackupRun { name: string; at: string; orders: number; lastReceipt: number; copied: boolean }
interface State { enabled: boolean; folder: string; settings: { folder: string }; files: BackupFile[]; last: BackupRun | null; problem: string | null }

const copy = {
  en: {
    loading: 'Loading…', off: 'Backups are not available for this database.',
    statusTitle: 'Backups on this computer', never: 'No backup has been made yet.',
    last: (when: string, orders: number, receipt: number) => `Last backup ${when}: ${orders} order${orders === 1 ? '' : 's'}${receipt ? `, up to receipt #${receipt}` : ''}.`,
    auto: 'A backup is made by itself when CactusPOS starts, when you close the day, and every half hour while there is something new. Each one is checked after it is written.',
    where: 'Kept in', now: 'Back up now', working: 'Backing up…', done: 'Backup made',
    secondTitle: 'A second copy somewhere else', secondIntro: 'A backup on the same laptop does not help when the laptop is lost or broken. Name a USB stick, or a folder that OneDrive, Dropbox or Google Drive keeps in sync, and every backup is copied there too.',
    folder: 'Folder for the second copy', folderHint: 'Leave empty for none. The folder has to exist on the till computer.',
    save: 'Save', saved: 'Saved', copied: 'The last backup is also in the second folder.', notCopied: 'The last backup is not in the second folder yet. Tap "Back up now".',
    listTitle: 'Recent backups', none: 'None yet.',
    restoreTitle: 'Putting a backup back', restoreText: 'Open the Start menu, then CactusPOS, then "Restore a backup". You take the newest backup or choose a file (a USB stick), it shows what the backup holds, asks before it does anything, and keeps the data it replaces in a folder of its own. On a new computer: install CactusPOS first, then restore from your backup file. Without the Start menu entry: double-click "Restore CactusPOS backup" in the program folder, or drag a backup file onto it.',
  },
  nl: {
    loading: 'Laden…', off: 'Back-ups zijn voor deze database niet beschikbaar.',
    statusTitle: 'Back-ups op deze computer', never: 'Er is nog geen back-up gemaakt.',
    last: (when: string, orders: number, receipt: number) => `Laatste back-up ${when}: ${orders} bestelling${orders === 1 ? '' : 'en'}${receipt ? `, tot en met bon #${receipt}` : ''}.`,
    auto: 'Er wordt vanzelf een back-up gemaakt als CactusPOS start, als u de dag afsluit, en elk half uur zolang er iets nieuws is. Elke back-up wordt na het schrijven gecontroleerd.',
    where: 'Bewaard in', now: 'Nu back-up maken', working: 'Back-up maken…', done: 'Back-up gemaakt',
    secondTitle: 'Een tweede kopie ergens anders', secondIntro: 'Een back-up op dezelfde laptop helpt niet als de laptop kwijt of kapot is. Kies een USB-stick, of een map die OneDrive, Dropbox of Google Drive synchroniseert, en elke back-up wordt daar ook neergezet.',
    folder: 'Map voor de tweede kopie', folderHint: 'Leeg laten voor geen. De map moet bestaan op de kassacomputer.',
    save: 'Opslaan', saved: 'Opgeslagen', copied: 'De laatste back-up staat ook in de tweede map.', notCopied: 'De laatste back-up staat nog niet in de tweede map. Tik op "Nu back-up maken".',
    listTitle: 'Recente back-ups', none: 'Nog geen.',
    restoreTitle: 'Een back-up terugzetten', restoreText: 'Open het menu Start, dan CactusPOS, dan "Restore a backup". U neemt de nieuwste back-up of kiest een bestand (een USB-stick), ziet wat erin zit, moet eerst bevestigen, en de gegevens die worden vervangen blijven bewaard in een eigen map. Op een nieuwe computer: installeer eerst CactusPOS en zet daarna uw back-upbestand terug. Zonder het menu Start: dubbelklik op "Restore CactusPOS backup" in de programmamap, of sleep een back-upbestand erop.',
  },
};

export function BackupAdmin() {
  const { lang } = useLang();
  const c = copy[lang];
  const [state, setState] = useState<State | null>(null);
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const s = await api<State>('/admin/backups');
    setState(s);
    setFolder(s.settings.folder);
  }, []);
  useEffect(() => { void load().catch((e) => setErr(errText(e))); }, [load]);
  if (!state) return <p className={err ? 'error' : 'muted center'} role="status">{err || c.loading}</p>;
  if (!state.enabled) return <p className="muted center" role="status">{c.off}</p>;

  const when = (iso: string) => new Date(iso).toLocaleString(lang === 'nl' ? 'nl-NL' : 'en-US', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const size = (bytes: number) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} kB`);
  const run = async () => {
    setBusy(true); setErr(''); setMsg('');
    try { setState(await api<State>('/admin/backups/run', { body: {} })); toast(c.done); }
    catch (e) { setErr(errText(e)); await load().catch(() => {}); } finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true); setErr(''); setMsg('');
    try { const s = await api<State>('/admin/backups/settings', { method: 'PUT', body: { folder } }); setState(s); setFolder(s.settings.folder); setMsg(c.saved); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const last = state.last;
  const trouble = !last || !!state.problem;

  return (
    <div className="form books">
      <section className="admin-form-card">
        <h3><Icon name="refresh" />{c.statusTitle}</h3>
        <p className={`reports-status${trouble ? ' changed' : ''}`} role="status">
          <Icon name={trouble ? 'warning' : 'check'} />
          <span>{last ? c.last(when(last.at), last.orders, last.lastReceipt) : c.never}{state.problem && ` ${state.problem}`}</span>
        </p>
        <p className="muted">{c.auto}</p>
        <p className="muted">{c.where} <b>{state.folder}</b></p>
        {err && <div className="error" role="alert">{err}</div>}
        <div className="actions">
          <button type="button" className="primary" disabled={busy} onClick={() => void run()}><Icon name={busy ? 'clock' : 'download'} />{busy ? c.working : c.now}</button>
        </div>
      </section>

      <section className="admin-form-card">
        <h3><Icon name="upload" />{c.secondTitle}</h3>
        <p className="muted">{c.secondIntro}</p>
        <label>{c.folder}
          <input value={folder} placeholder="E:\CactusPOS" spellCheck={false} autoComplete="off" disabled={busy} onChange={(e) => { setMsg(''); setFolder(e.target.value); }} />
          <small>{c.folderHint}</small>
        </label>
        {state.settings.folder && last && <p className={`reports-status${last.copied ? '' : ' changed'}`} role="status"><Icon name={last.copied ? 'check' : 'warning'} /><span>{last.copied ? c.copied : c.notCopied}</span></p>}
        {msg && <div className="ok" role="status">{msg}</div>}
        <div className="actions">
          <button type="button" disabled={busy || folder.trim() === state.settings.folder} onClick={() => void save()}><Icon name="check" />{c.save}</button>
        </div>
      </section>

      <section className="admin-form-card">
        <h3><Icon name="clock" />{c.listTitle}</h3>
        {state.files.length === 0 ? <p className="muted">{c.none}</p> : (
          <ul className="reports-rows">
            {state.files.slice(0, 10).map((f) => <li key={f.name}><span>{when(f.at)} <small>{f.name}</small></span><b>{size(f.bytes)}</b></li>)}
          </ul>
        )}
      </section>

      <section className="admin-form-card">
        <h3><Icon name="undo" />{c.restoreTitle}</h3>
        <p className="muted">{c.restoreText}</p>
      </section>
    </div>
  );
}
