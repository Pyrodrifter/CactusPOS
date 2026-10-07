import { useLang } from '../i18n';
import { applyUpdate, checkServer, installApp, usePwa } from '../lib/pwa';

// Kept beside the shell until T07 consolidates the message catalogs.
const messages = {
  en: {
    offline: 'Cannot reach the truck server. Orders and payments need a connection to it.',
    ready: 'The app is available on this device.', retry: 'Try connection', install: 'Install app',
    update: 'An app update is ready.', reload: 'Reload when ready', updating: 'Updating…',
    confirm: 'Reloading clears any unsent cart. Finish or send your order first. Reload now?',
  },
  nl: {
    offline: 'Geen verbinding met de server in de truck. Bestellingen en betalingen hebben die verbinding nodig.',
    ready: 'De app is beschikbaar op dit apparaat.', retry: 'Verbinding proberen', install: 'App installeren',
    update: 'Er staat een app-update klaar.', reload: 'Herladen zodra u klaar bent', updating: 'Bijwerken…',
    confirm: 'Herladen wist een nog niet verstuurde bestelling. Rond deze eerst af of verstuur hem. Nu herladen?',
  },
} as const;

export function PwaStatus() {
  const { lang } = useLang();
  const pwa = usePwa();
  const text = messages[lang];
  if (pwa.connection !== 'offline' && !pwa.installAvailable && !pwa.updateAvailable) return null;
  return (
    <aside className="pwa-status" aria-label="CactusPOS" aria-live="polite">
      {pwa.connection === 'offline' && <div className="pwa-message">
        <span>{text.offline} {pwa.offlineReady && text.ready}</span>
        <button onClick={() => { void checkServer(); }}>{text.retry}</button>
      </div>}
      {pwa.installAvailable && <button onClick={() => { void installApp(); }}>{text.install}</button>}
      {pwa.updateAvailable && <div className="pwa-message">
        <span>{text.update}</span>
        <button disabled={pwa.updating} onClick={() => { if (confirm(text.confirm)) applyUpdate(); }}>
          {pwa.updating ? text.updating : text.reload}
        </button>
      </div>}
    </aside>
  );
}
