import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { api, getSession, setSession, type Session } from './lib/api';
import { setLang, useLang } from './i18n';
import { Login } from './ui/Login';
import { Pos } from './apps/pos/Pos';
import { Kitchen } from './apps/kitchen/Kitchen';
import { Pickup } from './apps/pickup/Pickup';
import { Admin } from './apps/admin/Admin';
import './ui/styles.css';

function Shell({ session }: { session: Session }) {
  const { lang, t } = useLang();
  return (
    <div className="shell">
      <header className="topbar">
        <strong className="brand">🌵 {session.business.name}</strong>
        <nav>
          <NavLink to="/pos">{t('nav.order')}</NavLink>
          <NavLink to="/kitchen">{t('nav.kitchen')}</NavLink>
          {session.staff.role === 'owner' && <NavLink to="/admin">{t('nav.admin')}</NavLink>}
          <a href="/pickup" target="_blank" rel="noreferrer">{t('nav.pickup')}</a>
        </nav>
        <span className="spacer" />
        <button className="ghost" onClick={() => setLang(lang === 'en' ? 'nl' : 'en')}>{lang === 'en' ? 'NL' : 'EN'}</button>
        <span className="who">{session.staff.name}</span>
        <button className="ghost" onClick={() => { void api('/logout', { body: {} }).catch(() => {}).finally(() => { setSession(null); location.assign('/login'); }); }}>{t('nav.logout')}</button>
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
      <Routes>
        <Route path="/pickup" element={<Pickup />} />
        <Route path="/login" element={session ? <Navigate to="/pos" replace /> : <Login onDone={(s) => { setSession(s); setS(s); }} />} />
        <Route path="*" element={session ? <Shell session={session} /> : <Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
