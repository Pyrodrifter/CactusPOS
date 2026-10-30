import { useCallback, useEffect, useState } from 'react';
import type { ServiceReadiness } from '@cactus/shared';
import { api } from '../../lib/api';
import { useLang } from '../../i18n';
import { Icon } from '../../ui/Icon';
import { PracticeControl } from '../../ui/PracticeMode';

const descriptions = {
  en: {
    'server-online': 'The till server is responding.', 'calm-mode': 'Calm mode skips the kitchen and pickup boards.',
    'kitchen-online': 'Kitchen screens connected', 'kitchen-missing': 'No kitchen screen connected. Open one if you will use busy mode.',
    'practice-no-printer': 'Real printers and the cash drawer are disabled while practicing.',
    'browser-printing': 'No automatic printer is configured. The Receipt button can use browser printing.',
    'printer-reachable': 'The printer connection answers. Check paper and print a test page before service.',
    'printer-unreachable': 'The configured printer did not answer. Check its power and connection.',
    'practice-local-backup': 'Practice has its own local backups; external copies are disabled.',
    'backup-missing': 'No backup is available yet. Make one under Backups.', 'backup-old': 'The latest backup is over 24 hours old.',
    'backup-local-only': 'A local backup exists. Choose a USB or second folder under Backups for an off-laptop copy.',
    'backup-problem': 'The last backup or second copy reported a problem. Check Backups.', 'backup-current': 'Recent backup and second copy available.',
    'business-ready': 'Business name and CRIB are filled in.', 'business-incomplete': 'Fill in the business name and CRIB under Business.',
    'tax-unverified': 'Menu tax categories still need owner verification', 'tax-verified': 'The tax categories used by available menu items are marked verified.',
    'example-pins': 'Staff accounts still use an example PIN', 'pins-changed': 'No active account uses an example PIN.',
  },
  nl: {
    'server-online': 'De kassaserver reageert.', 'calm-mode': 'In rustige modus worden keuken en afhaalscherm overgeslagen.',
    'kitchen-online': 'Verbonden keukenschermen', 'kitchen-missing': 'Geen keukenscherm verbonden. Open er een als u de drukke modus gebruikt.',
    'practice-no-printer': 'Echte printers en kassalade staan uit tijdens het oefenen.',
    'browser-printing': 'Geen automatische printer ingesteld. De knop Bon kan via de browser afdrukken.',
    'printer-reachable': 'De printerverbinding reageert. Controleer het papier en druk voor opening een testpagina af.',
    'printer-unreachable': 'De ingestelde printer reageert niet. Controleer stroom en verbinding.',
    'practice-local-backup': 'Oefenen heeft aparte lokale back-ups; externe kopieën staan uit.',
    'backup-missing': 'Nog geen back-up beschikbaar. Maak er een onder Back-ups.', 'backup-old': 'De laatste back-up is ouder dan 24 uur.',
    'backup-local-only': 'Er is een lokale back-up. Kies bij Back-ups een USB-stick of tweede map voor een kopie buiten de laptop.',
    'backup-problem': 'Er is een probleem met de laatste back-up of tweede kopie. Kijk onder Back-ups.', 'backup-current': 'Recente back-up en tweede kopie beschikbaar.',
    'business-ready': 'Bedrijfsnaam en CRIB zijn ingevuld.', 'business-incomplete': 'Vul bedrijfsnaam en CRIB in onder Bedrijf.',
    'tax-unverified': 'Menubelastingcategorieën moeten nog worden gecontroleerd', 'tax-verified': 'De belastingcategorieën van beschikbare menu-items zijn gemarkeerd als gecontroleerd.',
    'example-pins': 'Personeelsaccounts gebruiken nog een voorbeeldpincode', 'pins-changed': 'Geen actief account gebruikt een voorbeeldpincode.',
  },
};

export function OpeningCheck() {
  const { lang } = useLang(), nl = lang === 'nl';
  const [state, setState] = useState<ServiceReadiness | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setBusy(true); setError('');
    try { setState(await api<ServiceReadiness>('/admin/readiness')); }
    catch (problem) { setState(null); setError(problem instanceof Error ? problem.message : String(problem)); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const labels = nl ? { server: 'Server', kitchen: 'Keuken', printer: 'Printer', backup: 'Back-up', business: 'Bedrijf', tax: 'Belasting', pins: 'Pincodes' } : { server: 'Server', kitchen: 'Kitchen', printer: 'Printer', backup: 'Backup', business: 'Business', tax: 'Tax', pins: 'PINs' };
  return <section className="opening-check" aria-busy={busy}>
    <div className="opening-heading"><h2>{nl ? 'Klaar om te openen' : 'Ready to open'}</h2><button disabled={busy} onClick={() => void refresh()}><Icon name="refresh" />{nl ? 'Opnieuw controleren' : 'Check again'}</button></div>
    <p>{nl ? 'Loop de punten na voordat de eerste klant bestelt. De verbindingstest drukt niets af.' : 'Check these before the first customer orders. Connection checks do not print anything.'}</p>
    {error && <p className="error" role="alert">{error}</p>}
    {state && <><p className="notice">{nl ? 'Punten om na te kijken' : 'Things to check'}: {state.checks.filter((check) => check.state === 'warn').length}</p>
      <ul className="orders">{state.checks.map((check) => <li key={check.id} className={`opening-item ${check.state}`}>
        <Icon name={check.state === 'ok' ? 'check' : check.state === 'warn' ? 'warning' : 'eye'} /><div><strong>{labels[check.id]}</strong>
          <p>{descriptions[lang][check.code as keyof typeof descriptions.en] ?? check.code}{check.count !== undefined && check.count > 0 ? ` (${check.count})` : ''}</p>
          {check.at && <small>{new Date(check.at).toLocaleString(lang === 'nl' ? 'nl-NL' : 'en-US')}</small>}</div>
      </li>)}</ul><small>{nl ? 'Gecontroleerd om' : 'Checked at'} {new Date(state.checkedAt).toLocaleTimeString()}</small></>}
    <PracticeControl />
  </section>;
}
