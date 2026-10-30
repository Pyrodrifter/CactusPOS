import { useEffect, useMemo, useState } from 'react';
import { formatMoney, MenuResponse, menuTagText, type Session } from '@cactus/shared';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { keepScreenAwake } from '../../lib/display';
import { useLang } from '../../i18n';
import { Icon } from '../../ui/Icon';
import { Logo } from '../../ui/Logo';
import './menu-board.css';

const copy = {
  en: { menu: 'On the menu', welcome: 'Choose something good.', tax: 'Prices in USD · include ABB', usd: 'Prices in USD', market: 'Market price', ask: 'Ask us for today’s price', loading: 'Getting the menu ready…', empty: 'The menu is being prepared.', retry: 'Waiting for the truck connection…', stale: 'Reconnecting · showing the last menu', pause: 'Pause rotation', play: 'Start rotation', previous: 'Previous category', next: 'Next category', fullscreen: 'Fullscreen', exit: 'Exit fullscreen', light: 'Light board', dark: 'Dark board', back: 'Back to till', unavailable: 'Fullscreen is unavailable in this browser.', language: 'Nederlands' },
  nl: { menu: 'Op de kaart', welcome: 'Kies iets lekkers.', tax: 'Prijzen in USD · inclusief ABB', usd: 'Prijzen in USD', market: 'Dagprijs', ask: 'Vraag naar de prijs van vandaag', loading: 'Het menu wordt geladen…', empty: 'Het menu wordt samengesteld.', retry: 'Wachten op verbinding met de truck…', stale: 'Opnieuw verbinden · laatste menu zichtbaar', pause: 'Rotatie pauzeren', play: 'Rotatie starten', previous: 'Vorige categorie', next: 'Volgende categorie', fullscreen: 'Volledig scherm', exit: 'Volledig scherm verlaten', light: 'Licht menu', dark: 'Donker menu', back: 'Terug naar kassa', unavailable: 'Volledig scherm is niet beschikbaar in deze browser.', language: 'English' },
};

export function MenuBoard({ session }: { session: Session }) {
  const { lang } = useLang();
  const [language, setLanguage] = useState(lang);
  const c = copy[language];
  const [menu, setMenu] = useState<MenuResponse | null>(null);
  const [offline, setOffline] = useState(false);
  const [page, setPage] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [dark, setDark] = useState(() => { try { return localStorage.getItem('cactus.menu-board.dark') === 'true'; } catch { return false; } });
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    let pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const next = MenuResponse.parse(await api('/menu'));
        if (!disposed) { setMenu(next); setOffline(false); }
      } catch { if (!disposed) setOffline(true); }
      finally { pending = false; }
    };
    void load();
    const timer = window.setInterval(() => void load(), 10000);
    window.addEventListener('online', load);
    return () => { disposed = true; clearInterval(timer); window.removeEventListener('online', load); };
  }, []);
  useEffect(() => keepScreenAwake(() => {}), []);
  useEffect(() => {
    try { localStorage.setItem('cactus.menu-board.dark', String(dark)); } catch { /* Optional device preference. */ }
  }, [dark]);
  useEffect(() => {
    const change = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', change);
    return () => document.removeEventListener('fullscreenchange', change);
  }, []);
  const pages = useMemo(() => (menu?.categories ?? []).slice().sort((a, b) => a.sort - b.sort).flatMap((category) => {
    const items = menu!.items.filter((item) => item.categoryId === category.id && item.available);
    return Array.from({ length: Math.ceil(items.length / 6) }, (_, index) => ({ category, items: items.slice(index * 6, index * 6 + 6), key: `${category.id}-${index}` }));
  }), [menu]);
  const count = pages.length;
  const currentIndex = count ? page % count : 0;
  const current = pages[currentIndex];
  useEffect(() => {
    if (!playing || count < 2) return;
    const timer = window.setInterval(() => setPage((value) => (value + 1) % count), 15000);
    return () => clearInterval(timer);
  }, [playing, count, page]);
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      setError('');
    } catch { setError(c.unavailable); }
  };
  return <main className={`menu-board${dark ? ' menu-board-dark' : ''}`}>
    <header className="mb-header"><div className="mb-brand"><Logo size={68} /><div><span>{c.menu}</span><h1>{session.business.name}</h1></div></div><p>{c.welcome}</p></header>
    <section className="mb-content" aria-label={c.menu}>
      {current ? <div key={current.key} className="mb-page"><div className="mb-category"><span>{String(currentIndex + 1).padStart(2, '0')}</span><h2>{current.category.name}</h2><i /></div><div className="mb-items">{current.items.map((item) => <article key={item.id} className="mb-item"><div className="mb-item-title"><h3>{item.name}</h3><b className={item.openPrice ? 'mb-market' : ''}>{item.openPrice ? c.market : formatMoney(item.priceCents)}</b></div><p>{item.description || (item.openPrice ? c.ask : '')}</p>{!!item.tags?.length && <p className="mb-tags">{menuTagText(item.tags, language)}</p>}</article>)}</div></div>
        : <div className="mb-empty"><Icon name="menu" size={56} /><h2>{menu ? c.empty : offline ? c.retry : c.loading}</h2></div>}
    </section>
    <footer className="mb-footer"><strong>{menu && !menu.taxCategories.some((x) => x.kind === 'taxed') ? c.usd : c.tax}</strong><div className="mb-progress" aria-label={`${currentIndex + 1} / ${count || 1}`}>{pages.map((entry, index) => <button key={entry.key} aria-label={entry.category.name} aria-pressed={currentIndex === index} onClick={() => setPage(index)}><span /></button>)}</div>{offline && <span role="status">{menu ? c.stale : c.retry}</span>}</footer>
    <nav className="mb-controls" aria-label={c.menu}><Link to="/pos"><Icon name="arrow-left" /><span>{c.back}</span></Link><button aria-label={c.previous} disabled={count < 2} onClick={() => setPage((currentIndex + count - 1) % count)}><Icon name="arrow-left" /></button><button onClick={() => setPlaying(!playing)} aria-pressed={!playing}>{playing ? c.pause : c.play}</button><button aria-label={c.next} disabled={count < 2} onClick={() => setPage((currentIndex + 1) % count)}><Icon name="arrow-right" /></button><button onClick={() => setDark(!dark)}><Icon name={dark ? 'sun' : 'moon'} /><span>{dark ? c.light : c.dark}</span></button><button onClick={() => setLanguage(language === 'en' ? 'nl' : 'en')}>{c.language}</button><button onClick={() => void toggleFullscreen()}><Icon name="expand" /><span>{fullscreen ? c.exit : c.fullscreen}</span></button></nav>
    {error && <p className="mb-error" role="status">{error}</p>}
  </main>;
}
