import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { CashMovementBody, RequestId, formatMoney, parseMoney, type CashMovement, type CashRequestStatus, type DayReport } from '@cactus/shared';
import { api, getSession, newRequestId } from '../../lib/api';
import { isPractice } from '../../lib/clientMode';
import { useLang } from '../../i18n';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/touch';
import { AdminDialog } from './AdminDialog';

const Pending = z.object({ id: RequestId, body: CashMovementBody });
type Pending = z.infer<typeof Pending>;
export function CashDrawerPanel({ report, today, onChanged }: { report: DayReport; today: string; onChanged: () => Promise<void> }) {
  const { lang } = useLang(), nl = lang === 'nl';
  const session = getSession();
  const storageKey = `cactus.cash.pending:${session?.instanceId ?? location.origin}:${session?.staff.id}:${isPractice() ? 'practice' : 'live'}`;
  const [pending, setPending] = useState<Pending | null>(() => { try { return Pending.parse(JSON.parse(localStorage.getItem(storageKey) ?? 'null')); } catch { return null; } });
  const [form, setForm] = useState<{ direction: 'in' | 'out'; original?: CashMovement } | null>(null);
  const [amount, setAmount] = useState(''), [reason, setReason] = useState(''), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [discarding, setDiscarding] = useState(false), [canOpen, setCanOpen] = useState(false);
  const locked = useRef(false);
  const clear = () => { try { localStorage.removeItem(storageKey); } catch { /* preserve retry record if storage is restricted */ } setPending(null); };
  const check = async (saved = pending) => {
    if (!saved || locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const found = await api<CashRequestStatus>(`/cash/movements/request/${saved.id}`);
      if (found.movement) { clear(); await onChanged(); toast(nl ? 'Kasboeking teruggevonden. Verplaats het geld niet opnieuw.' : 'Cash entry recovered. Do not move the cash again.'); }
    } catch (problem) { setError(problem instanceof Error ? problem.message : String(problem)); }
    finally { locked.current = false; setBusy(false); }
  };
  useEffect(() => {
    void api<{ enabled: boolean; drawer: boolean }>('/admin/printer').then((p) => setCanOpen(p.enabled && p.drawer && !isPractice())).catch(() => {});
    if (pending) void check(pending);
  }, []);
  const submit = async (saved: Pending) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      // Save before sending: a reload must keep the same request and never require moving cash twice.
      localStorage.setItem(storageKey, JSON.stringify(saved)); setPending(saved);
      await api<CashMovement>('/cash/movements', { body: saved.body, requestId: saved.id });
      clear(); setForm(null); setAmount(''); setReason(''); await onChanged();
      toast(nl ? 'Kasboeking opgeslagen' : 'Cash entry saved');
    } catch (problem) { setForm(null); setError(problem instanceof Error ? problem.message : String(problem)); }
    finally { locked.current = false; setBusy(false); }
  };
  const save = () => {
    const cents = parseMoney(amount);
    if (!form || cents === null || cents <= 0 || !reason.trim()) { setError(nl ? 'Vul een positief bedrag en een reden in.' : 'Enter a positive amount and a reason.'); return; }
    void submit({ id: newRequestId(), body: { direction: form.direction, amountCents: cents, reason: reason.trim(), reverses: form.original?.id } });
  };
  const openForm = (direction: 'in' | 'out', original?: CashMovement) => { setError(''); setAmount(original ? (original.amountCents / 100).toFixed(2) : ''); setReason(''); setForm({ direction, original }); };
  const entries = report.drawer?.movements ?? [], reversed = new Set(entries.flatMap((entry) => entry.reverses ? [entry.reverses] : []));
  return <section className="admin-form-card cash-drawer">
    <div className="cash-drawer-heading"><h3><Icon name="cash" />{nl ? 'Kassalade' : 'Cash drawer'}</h3>
      <div className="actions"><button className="cash-in" disabled={busy || !!pending || report.businessDate !== today} onClick={() => openForm('in')}><Icon name="plus" />{nl ? 'Kas in' : 'Cash in'}</button>
        <button className="cash-out" disabled={busy || !!pending || report.businessDate !== today} onClick={() => openForm('out')}><Icon name="minus" />{nl ? 'Kas uit' : 'Cash out'}</button>
        {canOpen && <button disabled={busy} onClick={() => { void api('/print/drawer', { body: {} }).catch((e: unknown) => toast(e instanceof Error ? e.message : String(e), 'error')); }}>{nl ? 'Lade openen' : 'Open drawer'}</button>}</div></div>
    <p>{nl ? 'Boek elke ochtend het aanwezige startgeld als Kas in. Registreer bijstorten en opnames met een reden. Tel bij afsluiten al het geld in de lade, inclusief startgeld.' : 'Record the cash present each morning as Cash in. Record top-ups and withdrawals with a reason. At settlement count all cash in the drawer, including the opening float.'}</p>
    <ul className="reports-rows"><li><span>{nl ? 'Contant uit verkoop' : 'Cash from sales'}</span><b>{formatMoney(report.cashExpectedCents)}</b></li>
      <li><span>{nl ? 'Kas in (incl. startgeld)' : 'Cash in (including float)'}</span><b>+{formatMoney(report.drawer?.cashInCents ?? 0)}</b></li>
      <li><span>{nl ? 'Kas uit' : 'Cash out'}</span><b>−{formatMoney(report.drawer?.cashOutCents ?? 0)}</b></li>
      <li><strong>{nl ? 'Verwacht in lade' : 'Expected in drawer'}</strong><b className="cash-expected">{formatMoney(report.drawer?.expectedCents ?? report.cashExpectedCents)}</b></li></ul>
    {pending && <div className="notice cash-pending" role="status"><p>{nl ? 'Kasboeking niet bevestigd. Verplaats het geld niet opnieuw. Controleer of herhaal alleen dezelfde boeking.' : 'Cash entry not confirmed. Do not move the money again. Check confirmation or retry the same entry.'}</p>
      <div className="actions"><button disabled={busy} onClick={() => void check()}>{nl ? 'Bevestiging controleren' : 'Check confirmation'}</button><button className="cash-retry" disabled={busy} onClick={() => void submit(pending)}>{nl ? 'Dezelfde boeking herhalen' : 'Retry original entry'}</button><button disabled={busy} onClick={() => setDiscarding(true)}>{nl ? 'Concept wegdoen' : 'Discard pending entry'}</button></div></div>}
    {error && !form && <p className="error" role="alert">{error}</p>}
    {entries.length ? <details className="cash-journal"><summary>{nl ? 'Kasboekingen' : 'Cash entries'} ({entries.length})</summary><ul>{entries.map((entry) => <li key={entry.id}>
      <div><strong>{entry.direction === 'in' ? '+' : '−'}{formatMoney(entry.amountCents)} · {entry.reason}</strong><small>{new Date(entry.at).toLocaleTimeString()} · {entry.staffName}{entry.reverses ? (nl ? ' · Tegenboeking' : ' · Reversal') : reversed.has(entry.id) ? (nl ? ' · Teruggedraaid' : ' · Reversed') : ''}</small></div>
      {!entry.reverses && !reversed.has(entry.id) && report.businessDate === today && <button className="cash-reverse" disabled={busy || !!pending} onClick={() => openForm(entry.direction === 'in' ? 'out' : 'in', entry)}>{nl ? 'Boeking herstellen' : 'Reverse entry'}</button>}
    </li>)}</ul></details> : <p className="muted">{nl ? 'Nog geen kasboekingen op deze dag.' : 'No cash entries on this day yet.'}</p>}
    {form && <AdminDialog title={form.original ? (nl ? 'Kasboeking terugdraaien' : 'Reverse cash entry') : form.direction === 'in' ? (nl ? 'Kas in' : 'Cash in') : (nl ? 'Kas uit' : 'Cash out')} busy={busy} error={error} onClose={() => setForm(null)} footer={<><button disabled={busy} onClick={() => setForm(null)}>{nl ? 'Annuleren' : 'Cancel'}</button><button className="primary cash-save" disabled={busy} onClick={save}>{nl ? 'Boeking opslaan' : 'Save entry'}</button></>}>
      <p>{form.original ? (nl ? 'De oorspronkelijke boeking blijft bewaard. Dit maakt een gelijke tegenboeking; registreer daarna zo nodig het juiste bedrag.' : 'The original entry stays on record. This adds an equal opposite entry; then record the correct amount if needed.') : (nl ? 'Registreer het geld dat u werkelijk in de lade legt of eruit neemt. Dit verandert geen verkopen of ABB.' : 'Record the money you actually put in or take out of the drawer. This does not change sales or ABB.')}</p>
      <label>{nl ? 'Bedrag' : 'Amount'}<input className="cash-amount" inputMode="decimal" value={amount} readOnly={!!form.original} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></label>
      <label>{nl ? 'Reden' : 'Reason'}<input className="cash-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder={nl ? 'Bijvoorbeeld startgeld of geld naar de bank' : 'For example opening float or cash to bank'} /></label>
    </AdminDialog>}
    {discarding && <AdminDialog title={nl ? 'Openstaand concept wegdoen?' : 'Discard pending entry?'} onClose={() => setDiscarding(false)} footer={<><button onClick={() => setDiscarding(false)}>{nl ? 'Bewaren' : 'Keep'}</button><button onClick={() => { clear(); setDiscarding(false); }}>{nl ? 'Alleen concept wegdoen' : 'Clear device draft only'}</button></>}><p>{nl ? 'Controleer eerst de kasboekingen: de server kan de boeking al hebben opgeslagen. Dit verwijdert nooit een opgeslagen kasboeking.' : 'Check the cash entries first: the server may already have saved it. This never deletes a recorded cash entry.'}</p></AdminDialog>}
  </section>;
}
