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
import { useDevicePrefs } from './lib/display';
import { Pos, PosDraftProvider } from './apps/pos/Pos';
import { Kitchen } from './apps/kitchen/Kitchen';
import { Pickup } from './apps/pickup/Pickup';
import { Admin } from './apps/admin/Admin';
import { MenuBoard } from './apps/order/MenuBoard';

function Shell({ session }: { session: Session }) {
  // A tablet locked to the kitchen (Screen tools) has no other screen: every address leads back there.
  const { kitchenLock } = useDevicePrefs();
  return (
    <PosDraftProvider><AppShell session={session}>
        {kitchenLock ? (
          <Routes>
            <Route path="/kitchen" element={<Kitchen />} />
            <Route path="*" element={<Navigate to="/kitchen" replace />} />
          </Routes>
        ) : (
          <Routes>
            <Route path="/pos" element={<Pos />} />
            <Route path="/kitchen" element={<Kitchen />} />
            {session.staff.role === 'owner' && <Route path="/admin" element={<Admin />} />}
            <Route path="*" element={<Navigate to="/pos" replace />} />
          </Routes>
        )}
    </AppShell></PosDraftProvider>
  );
}

function App() {
  const [session, setS] = useState<Session | null>(getSession());
  const { kitchenLock } = useDevicePrefs();
  const home = kitchenLock ? '/kitchen' : '/pos';
  return (
    <BrowserRouter>
      <div className="app-frame">
        <Toasts />
        <PwaStatus />
        <Routes>
          <Route path="/pickup" element={<Pickup />} />
          <Route path="/menu-board" element={session ? <MenuBoard session={session} /> : <Navigate to="/login?next=menu-board" replace />} />
          <Route path="/login" element={session ? <Navigate to={new URLSearchParams(location.search).get('next') === 'menu-board' ? '/menu-board' : home} replace /> : <Login onDone={(s) => { setSession(s); setS(s); }} />} />
          <Route path="*" element={session ? <Shell session={session} /> : <Navigate to="/login" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

initializePwa(import.meta.env.PROD);
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
