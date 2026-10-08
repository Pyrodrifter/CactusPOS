import { useLang } from '../../i18n';

const copy = {
  en: {
    title: 'Make it yours', intro: 'Your menu, team and truck settings in one place.',
    reports: 'Today at a glance, and closing the day for the books.',
    menu: 'Keep your menu ready for service. Prices include ABB.',
    business: 'Business details and the personal touches on every receipt.',
    staff: 'Manage the people who can sign in and their access.',
    tax: 'Review categories and dated rates before service.',
    printer: 'Connect your printer and choose what prints automatically.',
    books: 'Hand your closed days to a bookkeeper or a bookkeeping program.',
    earlier: 'Move earlier', later: 'Move later', loading: 'Loading…', saving: 'Saving…',
    close: 'Close editor', optionPrice: 'Extra price (USD)', optionName: 'Option name',
    menuItems: 'Menu items', categories: 'Categories', settings: 'Settings',
    details: 'Business details', receipt: 'Receipt & appearance', connection: 'Printer connection',
    preferences: 'Printing preferences', optionsHint: 'Offer extras or choices with this item.',
    availableHint: 'Tap availability to show or hide an item at the counter.',
    emptyStaff: 'Add the first person to your team.',
  },
  nl: {
    title: 'Maak het eigen', intro: 'Je menu, team en instellingen op één plek.',
    reports: 'Vandaag in één oogopslag, en de dag afsluiten voor de boekhouding.',
    menu: 'Houd je menu klaar voor verkoop. Prijzen zijn inclusief ABB.',
    business: 'Bedrijfsgegevens en de persoonlijke details op elke bon.',
    staff: 'Beheer wie kan inloggen en welke toegang zij hebben.',
    tax: 'Controleer categorieën en gedateerde tarieven vóór de verkoop.',
    printer: 'Verbind je printer en kies wat automatisch wordt afgedrukt.',
    books: 'Geef je afgesloten dagen door aan een boekhouder of boekhoudprogramma.',
    earlier: 'Naar voren', later: 'Naar achteren', loading: 'Laden…', saving: 'Opslaan…',
    close: 'Editor sluiten', optionPrice: 'Meerprijs (USD)', optionName: 'Naam van de optie',
    menuItems: 'Menu-items', categories: 'Categorieën', settings: 'Instellingen',
    details: 'Bedrijfsgegevens', receipt: 'Bon & uitstraling', connection: 'Printerverbinding',
    preferences: 'Afdrukvoorkeuren', optionsHint: 'Bied extra’s of keuzes aan bij dit item.',
    availableHint: 'Tik op beschikbaarheid om een item aan de kassa te tonen of te verbergen.',
    emptyStaff: 'Voeg de eerste persoon toe aan je team.',
  },
} as const;

export function useAdminCopy() {
  const { lang } = useLang();
  return copy[lang];
}
