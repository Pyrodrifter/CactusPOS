import { useSyncExternalStore } from 'react';

export type Lang = 'en' | 'nl';
const EN = {
  'app.name': 'CactusPOS', 'login.title': 'Enter PIN', 'login.wrong': 'Wrong PIN', 'login.go': 'Sign in',
  'nav.order': 'Order', 'nav.orders': 'Orders', 'nav.kitchen': 'Kitchen', 'nav.pickup': 'Pickup board', 'nav.logout': 'Sign out',
  'cart.empty': 'Tap items to start an order', 'cart.total': 'Total', 'cart.abb': 'incl. ABB', 'cart.send': 'Send', 'cart.pay': 'Send & pay',
  'cart.clear': 'Clear', 'cart.note': 'Order note', 'pay.title': 'Payment', 'pay.cash': 'Cash', 'pay.card': 'Card', 'pay.exact': 'Exact',
  'pay.tendered': 'Cash received', 'pay.change': 'Change', 'pay.confirm': 'Confirm payment', 'pay.ref': 'Card reference (optional)', 'pay.tip': 'Tip',
  'pay.cancel': 'Cancel', 'mods.add': 'Add to order', 'mods.required': 'Required',
  'orders.empty': 'No orders yet today', 'orders.unpaid': 'Unpaid', 'orders.paid': 'Paid', 'orders.void': 'Void', 'orders.reprint': 'Receipt',
  'orders.pay': 'Pay', 'orders.voidBtn': 'Void', 'orders.reason': 'Reason for void', 'orders.pin': 'Manager PIN (if asked)',
  'st.sent': 'New', 'st.preparing': 'Preparing', 'st.ready': 'Ready', 'st.collected': 'Collected', 'st.void': 'Void',
  'k.start': 'Start', 'k.ready': 'Ready', 'k.recall': 'Back', 'k.done': 'Collected', 'k.none': 'Nothing in the queue',
  'p.preparing': 'Preparing', 'p.ready': 'Ready for pickup', 'offline': 'Offline — reconnecting…', 'ticket': 'Ticket', 'soldout': 'Sold out',
} as const;
type Key = keyof typeof EN;
const NL: Record<Key, string> = {
  'app.name': 'CactusPOS', 'login.title': 'Voer pincode in', 'login.wrong': 'Foute pincode', 'login.go': 'Inloggen',
  'nav.order': 'Bestellen', 'nav.orders': 'Bestellingen', 'nav.kitchen': 'Keuken', 'nav.pickup': 'Afhaalscherm', 'nav.logout': 'Uitloggen',
  'cart.empty': 'Tik op items om te beginnen', 'cart.total': 'Totaal', 'cart.abb': 'incl. ABB', 'cart.send': 'Versturen', 'cart.pay': 'Versturen & betalen',
  'cart.clear': 'Wissen', 'cart.note': 'Opmerking', 'pay.title': 'Betaling', 'pay.cash': 'Contant', 'pay.card': 'Pinpas',
  'pay.exact': 'Gepast', 'pay.tendered': 'Ontvangen bedrag', 'pay.change': 'Wisselgeld', 'pay.confirm': 'Betaling bevestigen',
  'pay.ref': 'Pinreferentie (optioneel)', 'pay.tip': 'Fooi', 'pay.cancel': 'Annuleren', 'mods.add': 'Toevoegen', 'mods.required': 'Verplicht',
  'orders.empty': 'Nog geen bestellingen vandaag', 'orders.unpaid': 'Onbetaald', 'orders.paid': 'Betaald', 'orders.void': 'Geannuleerd', 'orders.reprint': 'Bon',
  'orders.pay': 'Betalen', 'orders.voidBtn': 'Annuleren', 'orders.reason': 'Reden van annulering', 'orders.pin': 'Managerpincode (indien gevraagd)',
  'st.sent': 'Nieuw', 'st.preparing': 'In bereiding', 'st.ready': 'Klaar', 'st.collected': 'Opgehaald', 'st.void': 'Geannuleerd',
  'k.start': 'Start', 'k.ready': 'Klaar', 'k.recall': 'Terug', 'k.done': 'Opgehaald', 'k.none': 'Niets in de wachtrij',
  'p.preparing': 'In bereiding', 'p.ready': 'Klaar om af te halen', 'offline': 'Offline — verbinding herstellen…', 'ticket': 'Bon', 'soldout': 'Uitverkocht',
};
const DICT: Record<Lang, Record<Key, string>> = { en: EN, nl: NL };

let lang: Lang = (() => { try { return (localStorage.getItem('cactus.lang') as Lang) || (navigator.language.startsWith('nl') ? 'nl' : 'en'); } catch { return 'en'; } })();
const subs = new Set<() => void>();

export function setLang(l: Lang): void {
  lang = l;
  try { localStorage.setItem('cactus.lang', l); } catch { /* ignore */ }
  subs.forEach((f) => f());
}
export function useLang(): { lang: Lang; t: (k: Key) => string } {
  const l = useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => lang);
  return { lang: l, t: (k) => DICT[l][k] };
}
