import { useLocation } from 'react-router-dom';
import { useLang } from '../i18n';
import { applyUpdate, checkServer, installApp, usePwa } from '../lib/pwa';
import { Icon } from './Icon';

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
  // Offer installing only where nobody is mid-sale: on the sign-in screen and in Admin.
  const { pathname } = useLocation();
  const offerInstall = pwa.installAvailable && (pathname === '/login' || pathname.startsWith('/admin'));
  if (pwa.connection !== 'offline' && !offerInstall && !pwa.updateAvailable) return null;
  return (
    <aside className={`pwa-status ${pwa.connection === 'offline' ? 'is-offline' : ''}`} aria-label="CactusPOS" aria-live="polite">
      {pwa.connection === 'offline' && <div className="pwa-message">
        <Icon name="wifi-off" size={20} /><span>{text.offline} {pwa.offlineReady && text.ready}</span>
        <button onClick={() => { void checkServer(); }}><Icon name="refresh" size={18} />{text.retry}</button>
      </div>}
      {offerInstall && <button onClick={() => { void installApp(); }}><Icon name="download" size={18} />{text.install}</button>}
      {pwa.updateAvailable && <div className="pwa-message">
        <span>{text.update}</span>
        <button disabled={pwa.updating} onClick={() => { if (confirm(text.confirm)) applyUpdate(); }}>
          <Icon name="refresh" size={18} />{pwa.updating ? text.updating : text.reload}
        </button>
      </div>}
    </aside>
  );
}
