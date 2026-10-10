import { useEffect, useRef, useState } from 'react';
import { DEFAULT_RECEIPT_TEMPLATE, ReceiptTemplate, TemplateState, type Business, type DesignMessage, type DocumentDesign, type Lettering, type ReceiptLogo, type TextStyle } from '@cactus/shared';
import { api, getSession } from '../../../lib/api';
import { useLang } from '../../../i18n';
import { Icon } from '../../../ui/Icon';
import { toast } from '../../../ui/touch';
import { addFontFile, cssFamily, deviceFonts, drawLettering, fontLabel, paperDots, pictureFrom } from './lettering';
import './receipt-editor.css';

const copy = {
  en: {
    title: 'Good on paper.', intro: 'Make your receipts and kitchen tickets your own. See every change as you go.', receipt: 'Customer receipt', kitchen: 'Kitchen ticket', edit: 'Design', preview: 'Preview',
    publish: 'Publish design', publishing: 'Saving…', saved: 'Published', draft: 'Unsaved changes', version: 'Version', load: 'Reload saved design',
    paper: 'Paper', width: 'Paper width', alignment: 'Header alignment', center: 'Center', left: 'Left', right: 'Right', large: 'Large', normal: 'Normal', huge: 'Extra large',
    header: 'Top of the receipt', logo: 'Upload logo', removeLogo: 'Remove logo', logoHint: 'PNG, JPG or WebP, up to 5 MB. Printed in black and white.', logoSize: 'Logo size', small: 'Small', medium: 'Medium', big: 'Large',
    name: 'Business name', printerLetters: 'Printer letters', lettering: 'Lettering', titleLabel: 'Line above the name', subtitle: 'Line under the header',
    letteringHint: 'Lettering is drawn in a font from this device and saved as a picture, so every printer prints exactly what you see.',
    letteringWords: 'Lettering shows the words exactly as typed. Automatic text such as {{order}} only works in printer letters.',
    font: 'Font', letterSize: 'Lettering size', addFont: 'Use a font file', fontMissing: (font: string) => `This was drawn in “${font}”, which this device does not have. It still prints as it is. Changing it here draws it again in a font from this device.`,
    nameChanged: 'The business name changed since this was drawn, so the receipt prints the name in printer letters. Choose a font to draw the new name.',
    size: 'Size', sizes: { small: 'Small', normal: 'Normal', tall: 'Tall', wide: 'Wide', large: 'Large', huge: 'Extra large' }, bold: 'Bold', underline: 'Underline', inverse: 'White on black',
    order: 'The order', number: 'Order number', item: 'Item text', phone: 'Show phone number', modifiers: 'Show modifiers', notes: 'Show notes',
    protected: 'Business details, order number, receipt number, date, amounts and tax always stay on receipts. Kitchen modifiers and notes always stay visible.',
    messages: 'Your own lines', add: 'Add a line', message: 'Line', words: 'Words', where: 'Where', above: 'Above the items', below: 'Below the total', up: 'Move up', down: 'Move down', remove: 'Remove',
    tokens: 'Use {{business}}, {{order}} or {{receipt}} for automatic text.',
    ending: 'End of the receipt', footer: 'Closing line (blank uses the business setting)', closing: 'Closing picture', closingHint: 'A drawing, a stamp, a QR code you made elsewhere: printed last, under the closing line.', addPicture: 'Upload picture', removePicture: 'Remove picture',
    divider: 'Dividing lines', dividers: { dashed: 'Dashes', solid: 'Line', double: 'Double', dotted: 'Dots', stars: 'Stars', wave: 'Waves', space: 'Space' },
    print: 'Print sample', thermal: 'Test receipt printer', printHint: 'Sample data — not a sale. Thermal printing follows the printer’s configured paper width.', sent: 'Sample sent to printer',
    history: 'Previous designs', restore: 'Republish this version', builtIn: 'Built-in design', historyHint: 'Restoring creates a new version. Existing receipts keep their original design.',
    preset: 'Start with a style', classic: 'Classic', boldStyle: 'Bold', compact: 'Compact', beach: 'Beach', publishingHint: 'Applies to new orders. Existing orders keep their design.', retry: 'Try again', loading: 'Loading…', previewFail: 'Preview unavailable',
  },
  nl: {
    title: 'Mooi op papier.', intro: 'Maak je eigen kassabon en keukenbon. Bekijk elke wijziging direct.', receipt: 'Kassabon', kitchen: 'Keukenbon', edit: 'Ontwerpen', preview: 'Voorbeeld',
    publish: 'Ontwerp publiceren', publishing: 'Opslaan…', saved: 'Gepubliceerd', draft: 'Niet opgeslagen', version: 'Versie', load: 'Opgeslagen ontwerp laden',
    paper: 'Papier', width: 'Papierbreedte', alignment: 'Kop uitlijnen', center: 'Midden', left: 'Links', right: 'Rechts', large: 'Groot', normal: 'Normaal', huge: 'Extra groot',
    header: 'Bovenkant van de bon', logo: 'Logo toevoegen', removeLogo: 'Logo verwijderen', logoHint: 'PNG, JPG of WebP, tot 5 MB. Wordt zwart-wit afgedrukt.', logoSize: 'Grootte van het logo', small: 'Klein', medium: 'Middel', big: 'Groot',
    name: 'Bedrijfsnaam', printerLetters: 'Printerletters', lettering: 'Sierletters', titleLabel: 'Regel boven de naam', subtitle: 'Regel onder de kop',
    letteringHint: 'Sierletters worden getekend in een lettertype van dit apparaat en als plaatje bewaard. Zo drukt elke printer precies af wat je ziet.',
    letteringWords: 'Sierletters tonen de woorden precies zoals getypt. Automatische tekst zoals {{order}} werkt alleen in printerletters.',
    font: 'Lettertype', letterSize: 'Grootte van de sierletters', addFont: 'Lettertypebestand gebruiken', fontMissing: (font: string) => `Dit is getekend in “${font}”, dat dit apparaat niet heeft. Het wordt gewoon zo afgedrukt. Wijzig je het hier, dan wordt het opnieuw getekend in een lettertype van dit apparaat.`,
    nameChanged: 'De bedrijfsnaam is veranderd sinds dit is getekend, dus de bon drukt de naam in printerletters af. Kies een lettertype om de nieuwe naam te tekenen.',
    size: 'Grootte', sizes: { small: 'Klein', normal: 'Normaal', tall: 'Hoog', wide: 'Breed', large: 'Groot', huge: 'Extra groot' }, bold: 'Vet', underline: 'Onderstreept', inverse: 'Wit op zwart',
    order: 'De bestelling', number: 'Bestelnummer', item: 'Artikeltekst', phone: 'Telefoon tonen', modifiers: 'Opties tonen', notes: 'Opmerkingen tonen',
    protected: 'Bedrijf, bestelnummer, bonnummer, datum, bedragen en belasting blijven altijd op de kassabon staan. Keukenopties en opmerkingen blijven altijd zichtbaar.',
    messages: 'Je eigen regels', add: 'Regel toevoegen', message: 'Regel', words: 'Woorden', where: 'Waar', above: 'Boven de artikelen', below: 'Onder het totaal', up: 'Omhoog', down: 'Omlaag', remove: 'Verwijderen',
    tokens: 'Gebruik {{business}}, {{order}} of {{receipt}} voor automatisch ingevulde tekst.',
    ending: 'Einde van de bon', footer: 'Slotregel (leeg = bedrijfsinstelling)', closing: 'Slotplaatje', closingHint: 'Een tekening, een stempel, een QR-code die je elders maakte: wordt als laatste afgedrukt, onder de slotregel.', addPicture: 'Plaatje toevoegen', removePicture: 'Plaatje verwijderen',
    divider: 'Scheidingslijnen', dividers: { dashed: 'Streepjes', solid: 'Lijn', double: 'Dubbel', dotted: 'Puntjes', stars: 'Sterren', wave: 'Golfjes', space: 'Witruimte' },
    print: 'Voorbeeld afdrukken', thermal: 'Test op bonprinter', printHint: 'Voorbeeldgegevens — geen verkoop. Thermisch afdrukken volgt de papierinstelling van de printer.', sent: 'Testbon verzonden',
    history: 'Eerdere ontwerpen', restore: 'Deze versie opnieuw publiceren', builtIn: 'Standaardontwerp', historyHint: 'Herstellen maakt een nieuwe versie. Bestaande bonnen behouden hun originele ontwerp.',
    preset: 'Begin met een stijl', classic: 'Klassiek', boldStyle: 'Duidelijk', compact: 'Compact', beach: 'Strand', publishingHint: 'Geldt voor nieuwe bestellingen. Bestaande bestellingen houden hun ontwerp.', retry: 'Opnieuw proberen', loading: 'Laden…', previewFail: 'Voorbeeld niet beschikbaar',
  },
};
type Copy = typeof copy.en;

const SIZES: TextStyle['size'][] = ['small', 'normal', 'tall', 'wide', 'large', 'huge'];
const DIVIDERS: [DocumentDesign['separator'], string][] = [['dashed', '- - - - -'], ['solid', '______'], ['double', '======'], ['dotted', '. . . . .'], ['stars', '* * * * *'], ['wave', '~~~~~~'], ['space', '']];
const PLAIN: TextStyle = { size: 'normal', bold: false, underline: false, inverse: false };
/** Logo and picture sizes in printer dots (8 per mm): width and height limits. */
const PICTURE: Record<'s' | 'm' | 'l', [number, number]> = { s: [160, 120], m: [256, 200], l: [400, 320] };

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (value: T) => void; label: string }) {
  return <div className="re-seg" role="group" aria-label={label}>{options.map(([option, text]) => <button key={option} type="button" aria-pressed={value === option} className={value === option ? 'on' : ''} onClick={() => onChange(option)}>{text}</button>)}</div>;
}

/** Size and the three switches every receipt printer has for its own letters. */
function StyleBar({ c, value, onChange }: { c: Copy; value: TextStyle; onChange: (style: TextStyle) => void }) {
  return <div className="re-style">
    <label>{c.size}<select value={value.size} onChange={(e) => onChange({ ...value, size: e.target.value as TextStyle['size'] })}>{SIZES.map((size) => <option key={size} value={size}>{c.sizes[size]}</option>)}</select></label>
    <div className="re-style-toggles">{(['bold', 'underline', 'inverse'] as const).map((key) => <button key={key} type="button" aria-pressed={value[key]} className={`re-look-${key}${value[key] ? ' on' : ''}`} onClick={() => onChange({ ...value, [key]: !value[key] })}>{c[key]}</button>)}</div>
  </div>;
}

/** Font, size and weight for one line of lettering. Every choice draws the picture again. */
function LetteringBox({ c, nl, value, words, dots, onChange }: { c: Copy; nl: boolean; value: Lettering; words: string; dots: number; onChange: (art: Lettering) => void }) {
  const [fonts, setFonts] = useState<string[]>(() => deviceFonts());
  const [error, setError] = useState('');
  const fontFile = useRef<HTMLInputElement>(null);
  const known = fonts.includes(value.font);
  const draw = (next: Partial<Pick<Lettering, 'font' | 'size' | 'bold'>>) => {
    const art = drawLettering(words, next.font ?? (known ? value.font : fonts[0]!), next.size ?? value.size, next.bold ?? value.bold, dots);
    if (art) onChange(art);
  };
  const sample = words.trim().slice(0, 16) || 'Abc';
  return <div className="re-lettering">
    {!known && <p className="notice" role="status">{c.fontMissing(value.font)}</p>}
    <div className="re-lettering-row">
      <Segmented label={c.letterSize} value={value.size} options={[['s', 'S'], ['m', 'M'], ['l', 'L'], ['xl', 'XL']]} onChange={(size) => draw({ size })} />
      <button type="button" aria-pressed={value.bold} className={`re-look-bold${value.bold ? ' on' : ''}`} onClick={() => draw({ bold: !value.bold })}>{c.bold}</button>
    </div>
    <div className="re-fonts" role="group" aria-label={c.font}>
      {fonts.map((font) => <button key={font} type="button" className={`re-font${known && value.font === font ? ' on' : ''}`} aria-pressed={known && value.font === font} onClick={() => draw({ font })}>
        <span style={{ fontFamily: cssFamily(font) }}>{sample}</span><small>{fontLabel(font, nl)}</small>
      </button>)}
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    <button type="button" className="ghost" onClick={() => fontFile.current?.click()}><Icon name="upload" />{c.addFont}</button>
    <input ref={fontFile} type="file" accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2" hidden onChange={(e) => {
      const file = e.target.files?.[0]; e.target.value = '';
      if (!file) return;
      setError('');
      void addFontFile(file).then((font) => { setFonts(deviceFonts()); const art = drawLettering(words, font, value.size, value.bold, dots); if (art) onChange(art); })
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    }} />
    <p className="re-hint">{c.letteringHint}</p>
  </div>;
}

/** A logo or closing picture: choose a size, upload, remove. */
function PictureBox({ c, value, upload, remove, hint, onChange, onError }: { c: Copy; value: ReceiptLogo | null; upload: string; remove: string; hint: string; onChange: (picture: ReceiptLogo | null) => void; onError: (message: string) => void }) {
  const [size, setSize] = useState<'s' | 'm' | 'l'>('m');
  const input = useRef<HTMLInputElement>(null);
  return <div className="re-upload"><Icon name={value ? 'check' : 'upload'} size={32} /><p>{hint}</p>
    <Segmented label={c.logoSize} value={size} options={[['s', c.small], ['m', c.medium], ['l', c.big]]} onChange={setSize} />
    <button type="button" onClick={() => input.current?.click()}><Icon name="upload" />{upload}</button>{value && <button type="button" onClick={() => onChange(null)}>{remove}</button>}
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => {
      const file = e.target.files?.[0]; e.target.value = '';
      if (!file) return;
      onError('');
      void pictureFrom(file, PICTURE[size][0], PICTURE[size][1]).then(onChange).catch((err: unknown) => onError(err instanceof Error ? err.message : String(err)));
    }} />
  </div>;
}

export function ReceiptEditor() {
  const { lang } = useLang(); const nl = lang === 'nl';
  const c = copy[lang];
  const [saved, setSaved] = useState<TemplateState | null>(null);
  const [template, setTemplate] = useState<ReceiptTemplate>(structuredClone(DEFAULT_RECEIPT_TEMPLATE));
  const [businessName, setBusinessName] = useState(getSession()?.business.name ?? '');
  const [kind, setKind] = useState<'receipt' | 'kitchen'>('receipt');
  const [mobile, setMobile] = useState<'edit' | 'preview'>('edit');
  const [html, setHtml] = useState(''), [previewBusy, setPreviewBusy] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [previewError, setPreviewError] = useState('');
  const [restoreVersion, setRestoreVersion] = useState('0');
  const [frameHeight, setFrameHeight] = useState(620);
  const frame = useRef<HTMLIFrameElement>(null);
  const design = template[kind];
  const dots = paperDots(design.widthMm);
  const dirty = saved && JSON.stringify(saved.current.template) !== JSON.stringify(template);

  const load = async () => {
    setError(''); setBusy(true);
    try {
      const state = TemplateState.parse(await api('/admin/receipt-templates')); setSaved(state); setTemplate(state.current.template);
      // The name as it is now, not as it was when this screen signed in: lettering has to spell it exactly.
      void api<Business>('/admin/business').then((b) => setBusinessName(b.name)).catch(() => { /* the signed-in name will do */ });
    }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!saved) return;
    const controller = new AbortController();
    setPreviewBusy(true); setPreviewError('');
    const timer = setTimeout(() => {
      void fetch('/api/admin/receipt-templates/preview', { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': getSession()?.token ?? '' }, body: JSON.stringify({ template, kind }), signal: controller.signal })
        .then(async (res) => { if (!res.ok) throw new Error(c.previewFail); return res.text(); })
        .then((value) => { if (!controller.signal.aborted) setHtml(value); })
        .catch((e: unknown) => { if (!controller.signal.aborted) setPreviewError(e instanceof Error ? e.message : String(e)); })
        .finally(() => { if (!controller.signal.aborted) setPreviewBusy(false); });
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [template, kind, saved, c.previewFail]);
  const patch = (value: Partial<DocumentDesign>) => setTemplate((old) => ({ ...old, [kind]: { ...old[kind], ...value } }));
  const publish = async (restore = false) => {
    if (!saved || busy) return; setBusy(true); setError('');
    try {
      const state = TemplateState.parse(await api(`/admin/receipt-templates${restore ? '/restore' : ''}`, { method: restore ? 'POST' : 'PUT', body: restore ? { baseVersion: saved.current.version, version: Number(restoreVersion) } : { baseVersion: saved.current.version, template: ReceiptTemplate.parse(template) } }));
      setSaved(state); setTemplate(state.current.template); toast(`${c.saved} · ${c.version} ${state.current.version}`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const message = (index: number, value: Partial<DesignMessage>) => patch({ messages: design.messages.map((entry, i) => i === index ? { ...entry, ...value } : entry) });
  const move = (index: number, delta: number) => { const messages = [...design.messages]; const a = messages[index]!, b = messages[index + delta]!; messages[index] = b; messages[index + delta] = a; patch({ messages }); };
  /** Lettering drawn for the other paper width would be too wide or needlessly small: draw it again where this device has the font. */
  const setWidth = (widthMm: 58 | 80) => {
    const fonts = deviceFonts(), max = paperDots(widthMm);
    const again = (art: Lettering | null | undefined) => (art && fonts.includes(art.font) ? drawLettering(art.text, art.font, art.size, art.bold, max) ?? art : art);
    patch({ widthMm, nameArt: again(design.nameArt) ?? null, messages: design.messages.map((m) => (m.art ? { ...m, art: again(m.art) } : m)) });
  };
  const firstFont = () => deviceFonts()[0] ?? 'cursive';
  /** The font to draw with: the one asked for when this device has it, otherwise the first it does have. */
  const usable = (font: string) => (deviceFonts().includes(font) ? font : firstFont());
  if (!saved) return <div className="receipt-editor"><p role="status">{error || c.loading}</p>{error && <button onClick={() => void load()}>{c.retry}</button>}</div>;

  const usualName: TextStyle = kind === 'kitchen' ? { ...PLAIN, bold: true } : { ...PLAIN, size: 'large', bold: true };
  return <section className={`receipt-editor mobile-${mobile}`}>
    <header className="re-heading"><div><p className="re-eyebrow"><Icon name="receipt" />{c.version} {saved.current.version} <span className={dirty ? 're-unsaved' : ''}>{dirty ? c.draft : c.saved}</span></p><h1>{c.title}</h1><p>{c.intro}</p></div><button className="primary re-publish" disabled={busy || !dirty} onClick={() => void publish()}><Icon name="check" />{busy ? c.publishing : c.publish}</button></header>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="re-document-tabs">{(['receipt', 'kitchen'] as const).map((value) => <button key={value} aria-pressed={kind === value} className={kind === value ? 'on' : ''} disabled={busy} onClick={() => setKind(value)}><Icon name={value === 'receipt' ? 'receipt' : 'kitchen'} />{c[value]}</button>)}</div>
    <div className="re-mobile-tabs"><button aria-pressed={mobile === 'edit'} onClick={() => setMobile('edit')}>{c.edit}</button><button aria-pressed={mobile === 'preview'} onClick={() => setMobile('preview')}>{c.preview}</button></div>
    <div className="re-grid">
      <fieldset className="re-controls" disabled={busy}>
        <section className="re-card"><h2>{c.preset}</h2><div className="re-presets">
          <button onClick={() => patch({ separator: 'dashed', align: 'center', numberSize: 'large', itemSize: kind === 'kitchen' ? 'large' : 'normal' })}>{c.classic}</button>
          <button onClick={() => patch({ separator: 'solid', align: 'center', numberSize: 'large', itemSize: 'large' })}>{c.boldStyle}</button>
          <button onClick={() => patch({ separator: 'space', align: 'left', numberSize: 'large', itemSize: 'normal' })}>{c.compact}</button>
          <button onClick={() => patch({ separator: 'wave', align: 'center', numberSize: 'huge', itemSize: kind === 'kitchen' ? 'large' : 'normal' })}>{c.beach}</button>
        </div></section>

        <section className="re-card"><h2><Icon name="leaf" />{c.header}</h2>
          <PictureBox c={c} value={design.logo} upload={c.logo} remove={c.removeLogo} hint={c.logoHint} onChange={(logo) => patch({ logo })} onError={setError} />
          <div className="re-field"><span className="re-field-label">{c.name}</span>
            <Segmented label={c.name} value={design.nameArt ? 'art' : 'printer'} options={[['printer', c.printerLetters], ['art', c.lettering]]}
              onChange={(mode) => patch({ nameArt: mode === 'art' ? drawLettering(businessName, firstFont(), 'l', false, dots) : null })} />
            {design.nameArt
              ? <>{design.nameArt.text.trim().toLowerCase() !== businessName.trim().toLowerCase() && <p className="notice" role="status">{c.nameChanged}</p>}
                <LetteringBox c={c} nl={nl} value={design.nameArt} words={businessName} dots={dots} onChange={(nameArt) => patch({ nameArt })} /></>
              : <StyleBar c={c} value={design.nameStyle ?? usualName} onChange={(nameStyle) => patch({ nameStyle })} />}
          </div>
          <div className="re-field"><label>{c.titleLabel}<input value={design.title} maxLength={80} onChange={(e) => patch({ title: e.target.value })} /></label>
            {design.title && <StyleBar c={c} value={design.titleStyle ?? { ...PLAIN, bold: true }} onChange={(titleStyle) => patch({ titleStyle })} />}</div>
          <div className="re-field"><label>{c.subtitle}<input value={design.subtitle} maxLength={160} onChange={(e) => patch({ subtitle: e.target.value })} /></label>
            {design.subtitle && <StyleBar c={c} value={design.subtitleStyle ?? PLAIN} onChange={(subtitleStyle) => patch({ subtitleStyle })} />}</div>
          <small>{c.tokens}</small>
        </section>

        <section className="re-card"><h2><Icon name="edit" />{c.messages}</h2>{design.messages.map((entry, index) => <div className="re-message" key={index}>
          <div className="re-message-head"><strong>{c.message} {index + 1}</strong>
            <Segmented label={`${c.message} ${index + 1}`} value={entry.art ? 'art' : 'printer'} options={[['printer', c.printerLetters], ['art', c.lettering]]}
              onChange={(mode) => message(index, { art: mode === 'art' ? drawLettering(entry.text || c.message, firstFont(), 'm', false, dots) : null, ...(mode === 'art' && !entry.text ? { text: c.message } : {}) })} /></div>
          <label>{c.words}<textarea rows={2} maxLength={entry.art ? 80 : 240} value={entry.text} onChange={(e) => {
            const text = entry.art ? e.target.value.replace(/\n/g, ' ') : e.target.value;
            // The picture follows the words. While the box is empty the last picture is kept, but not printed.
            message(index, { text, ...(entry.art ? { art: drawLettering(text, usable(entry.art.font), entry.art.size, entry.art.bold, dots) ?? entry.art } : {}) });
          }} /></label>
          {entry.art
            ? <><LetteringBox c={c} nl={nl} value={entry.art} words={entry.text} dots={dots} onChange={(art) => message(index, { art })} /><p className="re-hint">{c.letteringWords}</p></>
            : <StyleBar c={c} value={{ size: entry.size ?? 'normal', bold: entry.bold, underline: !!entry.underline, inverse: !!entry.inverse }} onChange={(style) => message(index, style)} />}
          <div className="re-message-tools">
            <select aria-label={c.where} value={entry.position ?? 'bottom'} onChange={(e) => message(index, { position: e.target.value as 'top' | 'bottom' })}><option value="top">{c.above}</option><option value="bottom">{c.below}</option></select>
            <select aria-label={c.alignment} value={entry.align} onChange={(e) => message(index, { align: e.target.value as 'left' | 'center' | 'right' })}><option value="left">{c.left}</option><option value="center">{c.center}</option><option value="right">{c.right}</option></select>
            <button aria-label={c.up} disabled={!index} onClick={() => move(index, -1)}>↑</button><button aria-label={c.down} disabled={index === design.messages.length - 1} onClick={() => move(index, 1)}>↓</button><button aria-label={c.remove} onClick={() => patch({ messages: design.messages.filter((_, i) => i !== index) })}><Icon name="trash" /></button>
          </div>
        </div>)}<button disabled={design.messages.length >= 6} onClick={() => patch({ messages: [...design.messages, { text: '', bold: false, align: 'center', position: 'bottom' }] })}><Icon name="plus" />{c.add}</button></section>

        <section className="re-card"><h2><Icon name="receipt" />{c.order}</h2><div className="two">
          <label>{c.number}<select value={design.numberSize} onChange={(e) => patch({ numberSize: e.target.value as DocumentDesign['numberSize'] })}><option value="normal">{c.normal}</option><option value="large">{c.large}</option><option value="huge">{c.huge}</option></select></label>
          <label>{c.item}<select value={design.itemSize} onChange={(e) => patch({ itemSize: e.target.value as 'large' | 'normal' })}><option value="normal">{c.normal}</option><option value="large">{c.large}</option></select></label>
        </div>
        {kind === 'receipt' && <div className="re-toggles">{(['showPhone', 'showModifiers', 'showNotes'] as const).map((key, i) => <button key={key} role="switch" aria-checked={design[key]} onClick={() => patch({ [key]: !design[key] })}><span>{[c.phone, c.modifiers, c.notes][i]}</span><Icon name={design[key] ? 'check' : 'minus'} /></button>)}</div>}<p className="re-hint">{c.protected}</p></section>

        <section className="re-card"><h2><Icon name="check" />{c.ending}</h2>
          <div className="re-field"><label>{c.footer}<textarea rows={3} value={design.footer} maxLength={400} onChange={(e) => patch({ footer: e.target.value })} /></label>
            <StyleBar c={c} value={design.footerStyle ?? PLAIN} onChange={(footerStyle) => patch({ footerStyle })} /></div>
          <div className="re-field"><span className="re-field-label">{c.closing}</span>
            <PictureBox c={c} value={design.closing} upload={c.addPicture} remove={c.removePicture} hint={c.closingHint} onChange={(closing) => patch({ closing })} onError={setError} /></div>
        </section>

        <section className="re-card"><h2><Icon name="more" />{c.divider}</h2><div className="re-dividers" role="group" aria-label={c.divider}>
          {DIVIDERS.map(([style, sample]) => <button key={style} type="button" aria-pressed={design.separator === style} className={design.separator === style ? 'on' : ''} onClick={() => patch({ separator: style })}><code aria-hidden="true">{sample || ' '}</code><span>{c.dividers[style]}</span></button>)}
        </div></section>

        <section className="re-card"><h2><Icon name="settings" />{c.paper}</h2><div className="two">
          <label>{c.width}<select value={design.widthMm} onChange={(e) => setWidth(Number(e.target.value) as 58 | 80)}><option value="80">80 mm</option><option value="58">58 mm</option></select></label>
          <label>{c.alignment}<select value={design.align} onChange={(e) => patch({ align: e.target.value as 'left' | 'center' })}><option value="center">{c.center}</option><option value="left">{c.left}</option></select></label>
        </div></section>

        <section className="re-card"><h2><Icon name="clock" />{c.history}</h2><p className="re-hint">{c.historyHint}</p><select aria-label={c.history} value={restoreVersion} onChange={(e) => setRestoreVersion(e.target.value)}>{saved.history.map((entry) => <option key={entry.version} value={entry.version}>{entry.version === 0 ? c.builtIn : `${c.version} ${entry.version} · ${new Date(entry.createdAt).toLocaleString(nl ? 'nl-NL' : 'en-US')}`}</option>)}</select><button disabled={Number(restoreVersion) === saved.current.version} onClick={() => void publish(true)}><Icon name="undo" />{c.restore}</button><button onClick={() => { setTemplate(saved.current.template); setError(''); }}>{c.load}</button></section>
      </fieldset>
      <aside className="re-preview"><div className="re-preview-heading"><strong>{c.preview}</strong><span>{design.widthMm} mm · {previewBusy ? c.loading : c[kind]}</span></div>
        {previewError && <p className="error" role="alert">{previewError}</p>}
        <div className={`re-paper-stage${previewBusy ? ' updating' : ''}`}><iframe ref={frame} title={c.preview} sandbox="allow-same-origin allow-modals" srcDoc={html} style={{ width: `${design.widthMm}mm`, height: frameHeight }} onLoad={() => setFrameHeight(Math.min(1600, Math.max(420, (frame.current?.contentDocument?.body.scrollHeight ?? 600) + 30)))} /></div>
        <p className="re-hint">{c.printHint}</p><div className="re-print-actions"><button disabled={!html || previewBusy || !!previewError} onClick={() => { frame.current?.contentWindow?.focus(); frame.current?.contentWindow?.print(); }}><Icon name="printer" />{c.print}</button><button disabled={busy || previewBusy || !!previewError} onClick={() => {
          setBusy(true); setError(''); void api('/admin/receipt-templates/test-print', { body: { template, kind } }).then(() => toast(c.sent)).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e))).finally(() => setBusy(false));
        }}>{c.thermal}</button></div>
        <p className="re-hint">{c.publishingHint}</p>
      </aside>
    </div>
  </section>;
}
