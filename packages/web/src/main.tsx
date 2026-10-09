import { StrictMode, useState } from 'react';
import './ui/styles.css';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { getSession, setSession, type Session } from './lib/api';
import { Login } from './ui/Login';
import { AppShell } from './ui/AppShell';
import { Toasts } from './ui/touch';
import { PwaStatus } from './ui/PwaStatus';
import { initializePwa } from './lib/pwa';
import { Pos, PosDraftProvider } from './apps/pos/Pos';
import { Kitchen } from './apps/kitchen/Kitchen';
import { Pickup } from './apps/pickup/Pickup';
import { Admin } from './apps/admin/Admin';

function Shell({ session }: { session: Session }) {
  return (
    <PosDraftProvider><AppShell session={session}>
        <Routes>
          <Route path="/pos" element={<Pos />} />
          <Route path="/kitchen" element={<Kitchen />} />
          {session.staff.role === 'owner' && <Route path="/admin" element={<Admin />} />}
          <Route path="*" element={<Navigate to="/pos" replace />} />
        </Routes>
    </AppShell></PosDraftProvider>
  );
}

function App() {
  const [session, setS] = useState<Session | null>(getSession());
  return (
    <BrowserRouter>
      <div className="app-frame">
        <Toasts />
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
