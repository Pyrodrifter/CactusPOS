import { useEffect, useRef, useState } from 'react';
import { DEFAULT_RECEIPT_TEMPLATE, ReceiptTemplate, TemplateState, type DocumentDesign, type ReceiptLogo } from '@cactus/shared';
import { api, getSession } from '../../../lib/api';
import { useLang } from '../../../i18n';
import { Icon } from '../../../ui/Icon';
import { toast } from '../../../ui/touch';
import './receipt-editor.css';

async function bitmap(file: File): Promise<ReceiptLogo> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5_000_000) throw new Error('Use a PNG, JPG or WebP image under 5 MB.');
  const source = await createImageBitmap(file);
  try {
    const scale = Math.min(256 / source.width, 160 / source.height, 1);
    const width = Math.max(8, Math.ceil(source.width * scale / 8) * 8), height = Math.max(1, Math.round(source.height * scale));
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
    ctx.drawImage(source, (width - source.width * scale) / 2, 0, source.width * scale, height);
    const pixels = ctx.getImageData(0, 0, width, height).data;
    let hex = '';
    for (let y = 0; y < height; y++) for (let byte = 0; byte < width / 8; byte++) {
      let value = 0;
      for (let bit = 0; bit < 8; bit++) {
        const i = (y * width + byte * 8 + bit) * 4;
        if (pixels[i]! * .299 + pixels[i + 1]! * .587 + pixels[i + 2]! * .114 < 165) value |= 128 >> bit;
      }
      hex += value.toString(16).padStart(2, '0');
    }
    return { width, height, hex };
  } finally { source.close(); }
}

export function ReceiptEditor() {
  const { lang } = useLang(); const nl = lang === 'nl';
  const [saved, setSaved] = useState<TemplateState | null>(null);
  const [template, setTemplate] = useState<ReceiptTemplate>(structuredClone(DEFAULT_RECEIPT_TEMPLATE));
  const [kind, setKind] = useState<'receipt' | 'kitchen'>('receipt');
  const [mobile, setMobile] = useState<'edit' | 'preview'>('edit');
  const [html, setHtml] = useState(''), [previewBusy, setPreviewBusy] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [previewError, setPreviewError] = useState('');
  const [restoreVersion, setRestoreVersion] = useState('0');
  const [frameHeight, setFrameHeight] = useState(620);
  const frame = useRef<HTMLIFrameElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const design = template[kind];
  const dirty = saved && JSON.stringify(saved.current.template) !== JSON.stringify(template);
  const c = nl ? {
    title: 'Mooi op papier.', intro: 'Maak je eigen kassabon en keukenbon. Bekijk elke wijziging direct.', receipt: 'Kassabon', kitchen: 'Keukenbon', edit: 'Ontwerpen', preview: 'Voorbeeld',
    publish: 'Ontwerp publiceren', publishing: 'Opslaan…', saved: 'Gepubliceerd', draft: 'Niet opgeslagen', version: 'Versie', load: 'Opgeslagen ontwerp laden',
    paper: 'Papier & indeling', width: 'Papierbreedte', alignment: 'Kop uitlijnen', center: 'Midden', left: 'Links', right: 'Rechts', number: 'Bestelnummer', large: 'Groot', normal: 'Normaal', item: 'Artikeltekst', divider: 'Scheidingslijnen', dashed: 'Streepjes', solid: 'Doorlopend', space: 'Witruimte',
    branding: 'Jouw uitstraling', titleLabel: 'Tekst boven de bedrijfsnaam', subtitle: 'Ondertitel', footer: 'Voettekst (leeg = bedrijfsinstelling)', logo: 'Logo toevoegen', removeLogo: 'Logo verwijderen', logoHint: 'PNG, JPG of WebP, tot 5 MB. Wordt zwart-wit voor de bonprinter.',
    details: 'Bongegevens', phone: 'Telefoon tonen', modifiers: 'Opties tonen', notes: 'Opmerkingen tonen', protected: 'Bedrijf, bestelnummer, bonnummer, datum, bedragen en belasting blijven altijd op de kassabon staan. Keukenopties en opmerkingen blijven altijd zichtbaar.',
    messages: 'Extra tekstblokken', add: 'Tekstblok toevoegen', message: 'Tekstblok', bold: 'Vet', up: 'Omhoog', down: 'Omlaag', remove: 'Verwijderen', tokens: 'Gebruik {{business}}, {{order}} of {{receipt}} voor automatisch ingevulde tekst.',
    print: 'Voorbeeld afdrukken', thermal: 'Test op bonprinter', printHint: 'Voorbeeldgegevens — geen verkoop. Thermisch afdrukken volgt de papierinstelling van de printer.',
    history: 'Eerdere ontwerpen', restore: 'Deze versie opnieuw publiceren', builtIn: 'Standaardontwerp', historyHint: 'Herstellen maakt een nieuwe versie. Bestaande bonnen behouden hun originele ontwerp.',
    preset: 'Begin met een stijl', classic: 'Klassiek', boldStyle: 'Duidelijk', compact: 'Compact', publishingHint: 'Geldt voor nieuwe bestellingen. Bestaande bestellingen houden hun ontwerp.', retry: 'Opnieuw proberen', loading: 'Laden…', previewFail: 'Voorbeeld niet beschikbaar',
  } : {
    title: 'Good on paper.', intro: 'Make your receipts and kitchen tickets your own. See every change as you go.', receipt: 'Customer receipt', kitchen: 'Kitchen ticket', edit: 'Design', preview: 'Preview',
    publish: 'Publish design', publishing: 'Saving…', saved: 'Published', draft: 'Unsaved changes', version: 'Version', load: 'Reload saved design',
    paper: 'Paper & layout', width: 'Paper width', alignment: 'Header alignment', center: 'Center', left: 'Left', right: 'Right', number: 'Order number', large: 'Large', normal: 'Normal', item: 'Item text', divider: 'Dividers', dashed: 'Dashed', solid: 'Solid', space: 'Whitespace',
    branding: 'Make it yours', titleLabel: 'Text above business name', subtitle: 'Subtitle', footer: 'Footer (blank uses business setting)', logo: 'Upload logo', removeLogo: 'Remove logo', logoHint: 'PNG, JPG or WebP, up to 5 MB. Converted to black and white for thermal printing.',
    details: 'Receipt details', phone: 'Show phone number', modifiers: 'Show modifiers', notes: 'Show notes', protected: 'Business details, order number, receipt number, date, amounts and tax always stay on receipts. Kitchen modifiers and notes always stay visible.',
    messages: 'Extra text blocks', add: 'Add text block', message: 'Text block', bold: 'Bold', up: 'Move up', down: 'Move down', remove: 'Remove', tokens: 'Use {{business}}, {{order}} or {{receipt}} for automatic text.',
    print: 'Print sample', thermal: 'Test receipt printer', printHint: 'Sample data — not a sale. Thermal printing follows the printer’s configured paper width.',
    history: 'Previous designs', restore: 'Republish this version', builtIn: 'Built-in design', historyHint: 'Restoring creates a new version. Existing receipts keep their original design.',
    preset: 'Start with a style', classic: 'Classic', boldStyle: 'Bold', compact: 'Compact', publishingHint: 'Applies to new orders. Existing orders keep their design.', retry: 'Try again', loading: 'Loading…', previewFail: 'Preview unavailable',
  };

  const load = async () => {
    setError(''); setBusy(true);
    try { const state = TemplateState.parse(await api('/admin/receipt-templates')); setSaved(state); setTemplate(state.current.template); }
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
  const message = (index: number, value: Partial<DocumentDesign['messages'][number]>) => patch({ messages: design.messages.map((entry, i) => i === index ? { ...entry, ...value } : entry) });
  const move = (index: number, delta: number) => { const messages = [...design.messages]; const a = messages[index]!, b = messages[index + delta]!; messages[index] = b; messages[index + delta] = a; patch({ messages }); };
  if (!saved) return <div className="receipt-editor"><p role="status">{error || c.loading}</p>{error && <button onClick={() => void load()}>{c.retry}</button>}</div>;

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
        </div></section>
        <section className="re-card"><h2><Icon name="settings" />{c.paper}</h2><div className="two">
          <label>{c.width}<select value={design.widthMm} onChange={(e) => patch({ widthMm: Number(e.target.value) as 58 | 80 })}><option value="80">80 mm</option><option value="58">58 mm</option></select></label>
          <label>{c.alignment}<select value={design.align} onChange={(e) => patch({ align: e.target.value as 'left' | 'center' })}><option value="center">{c.center}</option><option value="left">{c.left}</option></select></label>
          <label>{c.number}<select value={design.numberSize} onChange={(e) => patch({ numberSize: e.target.value as 'large' | 'normal' })}><option value="large">{c.large}</option><option value="normal">{c.normal}</option></select></label>
          <label>{c.item}<select value={design.itemSize} onChange={(e) => patch({ itemSize: e.target.value as 'large' | 'normal' })}><option value="normal">{c.normal}</option><option value="large">{c.large}</option></select></label>
          <label>{c.divider}<select value={design.separator} onChange={(e) => patch({ separator: e.target.value as DocumentDesign['separator'] })}><option value="dashed">{c.dashed}</option><option value="solid">{c.solid}</option><option value="space">{c.space}</option></select></label>
        </div></section>
        <section className="re-card"><h2><Icon name="leaf" />{c.branding}</h2>
          <div className="re-upload"><Icon name={design.logo ? 'check' : 'upload'} size={32} /><p>{c.logoHint}</p><button onClick={() => fileInput.current?.click()}><Icon name="upload" />{c.logo}</button>{design.logo && <button onClick={() => patch({ logo: null })}>{c.removeLogo}</button>}
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => {
              const file = e.target.files?.[0]; if (!file) return;
              const targetKind = kind; setBusy(true); setError('');
              void bitmap(file).then((logo) => setTemplate((old) => ({ ...old, [targetKind]: { ...old[targetKind], logo } }))).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err))).finally(() => setBusy(false));
              e.target.value = '';
            }} />
          </div>
          <label>{c.titleLabel}<input value={design.title} maxLength={80} onChange={(e) => patch({ title: e.target.value })} /></label>
          <label>{c.subtitle}<input value={design.subtitle} maxLength={160} onChange={(e) => patch({ subtitle: e.target.value })} /></label>
          <label>{c.footer}<textarea rows={3} value={design.footer} maxLength={400} onChange={(e) => patch({ footer: e.target.value })} /></label>
          <small>{c.tokens}</small>
        </section>
        <section className="re-card"><h2>{c.details}</h2>{kind === 'receipt' && <div className="re-toggles">{(['showPhone', 'showModifiers', 'showNotes'] as const).map((key, i) => <button key={key} role="switch" aria-checked={design[key]} onClick={() => patch({ [key]: !design[key] })}><span>{[c.phone, c.modifiers, c.notes][i]}</span><Icon name={design[key] ? 'check' : 'minus'} /></button>)}</div>}<p className="re-hint">{c.protected}</p></section>
        <section className="re-card"><h2>{c.messages}</h2>{design.messages.map((entry, index) => <div className="re-message" key={index}>
          <label>{c.message} {index + 1}<textarea rows={2} maxLength={240} value={entry.text} onChange={(e) => message(index, { text: e.target.value })} /></label>
          <div className="re-message-tools"><button aria-pressed={entry.bold} className={entry.bold ? 'on' : ''} onClick={() => message(index, { bold: !entry.bold })}>{c.bold}</button><select aria-label={c.alignment} value={entry.align} onChange={(e) => message(index, { align: e.target.value as 'left' | 'center' | 'right' })}><option value="left">{c.left}</option><option value="center">{c.center}</option><option value="right">{c.right}</option></select><button aria-label={c.up} disabled={!index} onClick={() => move(index, -1)}>↑</button><button aria-label={c.down} disabled={index === design.messages.length - 1} onClick={() => move(index, 1)}>↓</button><button aria-label={c.remove} onClick={() => patch({ messages: design.messages.filter((_, i) => i !== index) })}><Icon name="trash" /></button></div>
        </div>)}<button disabled={design.messages.length >= 4} onClick={() => patch({ messages: [...design.messages, { text: '', bold: false, align: 'center' }] })}><Icon name="plus" />{c.add}</button></section>
        <section className="re-card"><h2><Icon name="clock" />{c.history}</h2><p className="re-hint">{c.historyHint}</p><select aria-label={c.history} value={restoreVersion} onChange={(e) => setRestoreVersion(e.target.value)}>{saved.history.map((entry) => <option key={entry.version} value={entry.version}>{entry.version === 0 ? c.builtIn : `${c.version} ${entry.version} · ${new Date(entry.createdAt).toLocaleString(nl ? 'nl-NL' : 'en-US')}`}</option>)}</select><button disabled={Number(restoreVersion) === saved.current.version} onClick={() => void publish(true)}><Icon name="undo" />{c.restore}</button><button onClick={() => { setTemplate(saved.current.template); setError(''); }}>{c.load}</button></section>
      </fieldset>
      <aside className="re-preview"><div className="re-preview-heading"><strong>{c.preview}</strong><span>{design.widthMm} mm · {previewBusy ? c.loading : c[kind]}</span></div>
        {previewError && <p className="error" role="alert">{previewError}</p>}
        <div className={`re-paper-stage${previewBusy ? ' updating' : ''}`}><iframe ref={frame} title={c.preview} sandbox="allow-same-origin allow-modals" srcDoc={html} style={{ width: `${design.widthMm}mm`, height: frameHeight }} onLoad={() => setFrameHeight(Math.min(1600, Math.max(420, (frame.current?.contentDocument?.body.scrollHeight ?? 600) + 30)))} /></div>
        <p className="re-hint">{c.printHint}</p><div className="re-print-actions"><button disabled={!html || previewBusy || !!previewError} onClick={() => { frame.current?.contentWindow?.focus(); frame.current?.contentWindow?.print(); }}><Icon name="printer" />{c.print}</button><button disabled={busy || previewBusy || !!previewError} onClick={() => {
          setBusy(true); setError(''); void api('/admin/receipt-templates/test-print', { body: { template, kind } }).then(() => toast(nl ? 'Testbon verzonden' : 'Sample sent to printer')).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e))).finally(() => setBusy(false));
        }}>{c.thermal}</button></div>
        <p className="re-hint">{c.publishingHint}</p>
      </aside>
    </div>
  </section>;
}
