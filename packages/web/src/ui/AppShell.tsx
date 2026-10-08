import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { api, setSession, type Session } from '../lib/api';
import { keepScreenAwake } from '../lib/display';
import { usePwa } from '../lib/pwa';
import { setLang, useLang } from '../i18n';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { Sheet, toast } from './touch';
import './shell.css';

const copy = {
  en: {
    subtitle: 'Good food. Smooth service.', navigation: 'Main navigation', tools: 'Screen tools',
    connected: 'Truck connected', offline: 'Reconnecting', checking: 'Connecting',
    device: 'Make yourself comfortable', deviceHint: 'Set up this screen for your shift.',
    sunlight: 'Sunlight mode', sunlightHint: 'Stronger counter outlines and darker menu text.',
    awake: 'Keep screen awake', awakeOn: 'Active while this screen is open.', awakeWaiting: 'Waiting for the browser. Tap again to turn off.',
    awakeHint: 'Stop the display sleeping during service.', unsupported: 'Not available in this browser or connection.',
    fullscreen: 'Go fullscreen', exitFullscreen: 'Exit fullscreen', fullscreenHint: 'More room for the menu and your orders.',
    fullscreenError: 'Fullscreen is not available right now.', clean: 'Clean the screen', cleanHint: 'Pause touch for 20 seconds while you wipe it down.',
    cleaning: 'A little freshen-up.', cleaningHint: 'Touch is paused. Give the screen a wipe.', resume: 'Hold to resume', resumeHint: 'Hold for 2 seconds, or press Escape.',
    seconds: 'seconds remaining', language: 'Language', signedIn: 'Signed in as', signout: 'Sign out',
    done: 'Back to work', pickup: 'Pickup board (opens in a new tab)', skip: 'Skip to content',
  },
  nl: {
    subtitle: 'Lekker eten. Fijne service.', navigation: 'Hoofdnavigatie', tools: 'Schermopties',
    connected: 'Truck verbonden', offline: 'Opnieuw verbinden', checking: 'Verbinden',
    device: 'Maak het jezelf gemakkelijk', deviceHint: 'Stel dit scherm in voor je dienst.',
    sunlight: 'Zonlichtmodus', sunlightHint: 'Duidelijke randen en donkere menutekst op de kassa.',
    awake: 'Scherm wakker houden', awakeOn: 'Actief zolang dit scherm open is.', awakeWaiting: 'Wacht op de browser. Tik opnieuw om uit te zetten.',
    awakeHint: 'Voorkom dat het scherm tijdens de dienst uitgaat.', unsupported: 'Niet beschikbaar in deze browser of verbinding.',
    fullscreen: 'Volledig scherm', exitFullscreen: 'Volledig scherm verlaten', fullscreenHint: 'Meer ruimte voor het menu en je bestellingen.',
    fullscreenError: 'Volledig scherm is nu niet beschikbaar.', clean: 'Scherm schoonmaken', cleanHint: 'Pauzeer aanrakingen 20 seconden om het scherm af te nemen.',
    cleaning: 'Even opfrissen.', cleaningHint: 'Aanrakingen zijn gepauzeerd. Maak het scherm schoon.', resume: 'Ingedrukt houden om door te gaan', resumeHint: 'Houd 2 seconden vast, of druk op Escape.',
    seconds: 'seconden resterend', language: 'Taal', signedIn: 'Ingelogd als', signout: 'Uitloggen',
    done: 'Aan het werk', pickup: 'Afhaalscherm (opent in een nieuw tabblad)', skip: 'Naar inhoud',
  },
};

function preference(key: string): boolean {
  try { return localStorage.getItem(`cactus.display.${key}`) === 'true'; } catch { return false; }
}

export function AppShell({ session, children }: { session: Session; children: ReactNode }) {
  const { lang, t } = useLang();
  const c = copy[lang];
  const { connection } = usePwa();
  const [tools, setTools] = useState(false);
  const [sunlight, setSunlight] = useState(() => preference('sunlight'));
  const [awake, setAwake] = useState(() => preference('awake'));
  const [awakeActive, setAwakeActive] = useState(false);
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  const [cleaning, setCleaning] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try {
      localStorage.setItem('cactus.display.sunlight', String(sunlight));
      localStorage.setItem('cactus.display.awake', String(awake));
    } catch { /* Device preferences are optional. */ }
  }, [sunlight, awake]);
  useEffect(() => {
    if (!awake) { setAwakeActive(false); return; }
    return keepScreenAwake(setAwakeActive);
  }, [awake]);
  useEffect(() => {
    const change = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', change);
    return () => document.removeEventListener('fullscreenchange', change);
  }, []);
  useEffect(() => {
    content.current?.toggleAttribute('inert', tools || cleaning);
  }, [tools, cleaning]);
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { toast(c.fullscreenError, 'error'); }
  };
  const closeTools = () => { content.current?.removeAttribute('inert'); setTools(false); };
  const closeCleaning = () => {
    content.current?.removeAttribute('inert'); setCleaning(false);
    requestAnimationFrame(() => content.current?.querySelector<HTMLButtonElement>('.screen-tools-button')?.focus());
  };
  return <div className={`shell${sunlight ? ' sunlight' : ''}`} style={session.business.brandColor ? ({ '--brand': session.business.brandColor } as CSSProperties) : undefined}>
    <div className="shell-content" ref={content}>
      <a href="#workspace" className="skip-link">{c.skip}</a>
      <header className="topbar">
        <div className="brand"><Logo size={48} /><span className="brand-copy"><strong>{session.business.name}</strong><small>{c.subtitle}</small></span></div>
        <nav aria-label={c.navigation}>
          <NavLink to="/pos"><Icon name="cart" /><span>{t('nav.order')}</span></NavLink>
          <NavLink to="/kitchen"><Icon name="kitchen" /><span>{t('nav.kitchen')}</span></NavLink>
          {session.staff.role === 'owner' && <NavLink to="/admin"><Icon name="settings" /><span>{t('nav.admin')}</span></NavLink>}
          <a href="/pickup" target="_blank" rel="noreferrer" aria-label={c.pickup}><Icon name="pickup" /><span>{t('nav.pickup')}</span><Icon name="external" size={14} className="nav-external" /></a>
        </nav>
        <div className="topbar-tools">
          <span className={`shell-connection ${connection}`} role="status"><i /><span>{connection === 'online' ? c.connected : connection === 'offline' ? c.offline : c.checking}</span></span>
          <button className="screen-tools-button" aria-label={c.tools} aria-haspopup="dialog" aria-expanded={tools} onClick={() => setTools(true)}><Icon name="sliders" /><span>{c.tools}</span></button>
        </div>
      </header>
      <main id="workspace" tabIndex={-1}>{children}</main>
    </div>
    {tools && <div className="screen-tools"><Sheet title={c.tools} onClose={closeTools}>
      <div className="screen-tools-scroll">
      <div className="screen-tools-intro"><span className="screen-tool-emblem"><Icon name="sun" size={28} /></span><div><h3>{c.device}</h3><p>{c.deviceHint}</p></div></div>
      <button className="screen-option" role="switch" aria-checked={sunlight} onClick={() => setSunlight(!sunlight)}><Icon name="sun" /><span><strong>{c.sunlight}</strong><small>{c.sunlightHint}</small></span><i className="touch-switch" /></button>
      <button className="screen-option" role="switch" aria-checked={awake} disabled={!navigator.wakeLock} onClick={() => setAwake(!awake)}><Icon name="eye" /><span><strong>{c.awake}</strong><small>{!navigator.wakeLock ? c.unsupported : awake ? awakeActive ? c.awakeOn : c.awakeWaiting : c.awakeHint}</small></span><i className="touch-switch" /></button>
      <button className="screen-option" disabled={!document.fullscreenEnabled} onClick={() => void toggleFullscreen()}><Icon name="expand" /><span><strong>{fullscreen ? c.exitFullscreen : c.fullscreen}</strong><small>{document.fullscreenEnabled ? c.fullscreenHint : c.unsupported}</small></span><Icon name="arrow-right" /></button>
      <button className="screen-option" onClick={() => { setTools(false); setCleaning(true); }}><Icon name="sparkles" /><span><strong>{c.clean}</strong><small>{c.cleanHint}</small></span><Icon name="arrow-right" /></button>
      <div className="screen-language"><span><Icon name="language" />{c.language}</span><div><button aria-pressed={lang === 'en'} className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>English</button><button aria-pressed={lang === 'nl'} className={lang === 'nl' ? 'on' : ''} onClick={() => setLang('nl')}>Nederlands</button></div></div>
      <div className="screen-account"><span className="staff-avatar">{session.staff.name.slice(0, 1).toUpperCase()}</span><span><small>{c.signedIn}</small><strong>{session.staff.name}</strong></span><button className="ghost" disabled={signingOut} onClick={() => {
        setSigningOut(true);
        void api('/logout', { body: {} }).catch(() => {}).finally(() => { setSession(null); location.assign('/login'); });
      }}><Icon name="logout" />{c.signout}</button></div>
      </div>
      <button className="primary screen-tools-done" onClick={closeTools}>{c.done}<Icon name="arrow-right" /></button>
    </Sheet></div>}
    {cleaning && <CleanScreen onClose={closeCleaning} />}
  </div>;
}

function CleanScreen({ onClose }: { onClose: () => void }) {
  const { lang } = useLang();
  const c = copy[lang];
  const [seconds, setSeconds] = useState(20);
  const [holding, setHolding] = useState(false);
  const hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const end = Date.now() + 20_000;
    const timer = setInterval(() => {
      const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      setSeconds(left);
      if (!left) close.current();
    }, 250);
    return () => { clearInterval(timer); clearTimeout(hold.current); };
  }, []);
  const cancel = () => { clearTimeout(hold.current); hold.current = undefined; setHolding(false); };
  const start = () => {
    if (hold.current) return;
    setHolding(true);
    hold.current = setTimeout(() => close.current(), 2000);
  };
  return <div className="clean-screen"><Sheet title={c.clean} onClose={onClose} dismissable={false}>
    <div onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }} className="clean-content">
      <Icon name="sparkles" size={52} /><h2>{c.cleaning}</h2><p>{c.cleaningHint}</p>
      <strong className="clean-count">{seconds}</strong><span>{c.seconds}</span>
      <button autoFocus className={`clean-resume${holding ? ' holding' : ''}`} onPointerDown={(e) => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); start(); }} onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) cancel(); }} onPointerUp={cancel} onPointerCancel={cancel} onLostPointerCapture={cancel} onBlur={cancel} onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); start(); } }} onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') cancel(); }}><span>{c.resume}</span></button>
      <small>{c.resumeHint}</small>
    </div>
  </Sheet></div>;
}
