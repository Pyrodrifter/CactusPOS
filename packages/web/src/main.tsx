import React, { StrictMode, useState } from 'react';
import './ui/styles.css';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { api, getSession, setSession, type Session } from './lib/api';
import { setLang, useLang } from './i18n';
import { Login } from './ui/Login';
import { Icon } from './ui/Icon';
import { PwaStatus } from './ui/PwaStatus';
import { initializePwa } from './lib/pwa';
import { Pos } from './apps/pos/Pos';
import { Kitchen } from './apps/kitchen/Kitchen';
import { Pickup } from './apps/pickup/Pickup';
import { Admin } from './apps/admin/Admin';

function Shell({ session }: { session: Session }) {
  const { lang, t } = useLang();
  const copy = lang === 'nl'
    ? { subtitle: 'Kassasysteem', navigation: 'Hoofdnavigatie', language: 'Taal wijzigen' }
    : { subtitle: 'Point of sale', navigation: 'Main navigation', language: 'Change language' };
  return (
    <div className="shell" style={session.business.brandColor ? ({ '--brand': session.business.brandColor } as React.CSSProperties) : undefined}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><Icon name="leaf" size={26} /></span>
          <span className="brand-copy"><strong>{session.business.name}</strong><small>{copy.subtitle}</small></span>
        </div>
        <nav aria-label={copy.navigation}>
          <NavLink to="/pos"><Icon name="cart" /><span>{t('nav.order')}</span></NavLink>
          <NavLink to="/kitchen"><Icon name="kitchen" /><span>{t('nav.kitchen')}</span></NavLink>
          {session.staff.role === 'owner' && <NavLink to="/admin"><Icon name="settings" /><span>{t('nav.admin')}</span></NavLink>}
          <a href="/pickup" target="_blank" rel="noreferrer"><Icon name="pickup" /><span>{t('nav.pickup')}</span></a>
        </nav>
        <div className="topbar-tools">
          <div className="who"><span className="staff-avatar">{session.staff.name.slice(0, 1).toUpperCase()}</span><span>{session.staff.name}</span></div>
          <button className="ghost language-button" aria-label={copy.language} onClick={() => setLang(lang === 'en' ? 'nl' : 'en')}><Icon name="language" size={20} /><span>{lang === 'en' ? 'NL' : 'EN'}</span></button>
          <button className="ghost logout-button" aria-label={t('nav.logout')} onClick={() => { void api('/logout', { body: {} }).catch(() => {}).finally(() => { setSession(null); location.assign('/login'); }); }}><Icon name="logout" size={20} /><span>{t('nav.logout')}</span></button>
        </div>
      </header>
      <main>
        <Routes>
          <Route path="/pos" element={<Pos />} />
          <Route path="/kitchen" element={<Kitchen />} />
          {session.staff.role === 'owner' && <Route path="/admin" element={<Admin />} />}
          <Route path="*" element={<Navigate to="/pos" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  const [session, setS] = useState<Session | null>(getSession());
  return (
    <BrowserRouter>
      <div className="app-frame">
        <PwaStatus />
        <Routes>
          <Route path="/pickup" element={<Pickup />} />
          <Route path="/login" element={session ? <Navigate to="/pos" replace /> : <Login onDone={(s) => { setSession(s); setS(s); }} />} />
          <Route path="*" element={session ? <Shell session={session} /> : <Navigate to="/login" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

initializePwa(import.meta.env.PROD);
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
