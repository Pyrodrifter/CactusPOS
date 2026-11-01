import { z } from 'zod';
import { AddLinesBody, CreateOrderBody, MenuItem, RequestId, type Session } from '@cactus/shared';

export const CartLine = z.object({ key: z.string().min(1).max(400), item: MenuItem, qty: z.number().int().min(1).max(99),
  optionIds: z.array(z.string()).max(100), note: z.string().max(200).optional(), priceCents: z.number().int().min(1).max(1_000_000).optional() });
export type CartLine = z.infer<typeof CartLine>;
const PendingSend = z.object({ id: RequestId, kind: z.enum(['create', 'add']), orderId: z.string().optional(), body: z.string().max(100_000), intent: z.enum(['send', 'pay']) });
export type PendingSend = z.infer<typeof PendingSend>;
export const SavedDraft = z.object({ version: z.literal(1), cart: z.array(CartLine).max(100), note: z.string().max(300), pickupName: z.string().max(40).default(''),
  tab: z.object({ id: z.string(), label: z.string() }).nullable(), pendingSend: PendingSend.nullable(), paymentOrderId: z.string().nullable() });
export type SavedDraft = z.infer<typeof SavedDraft>;
export const emptyDraft = (): SavedDraft => ({ version: 1, cart: [], note: '', pickupName: '', tab: null, pendingSend: null, paymentOrderId: null });
export function draftKey(session: Session | null, origin: string, practice: boolean): string {
  return `cactus.draft.v1:${practice ? 'practice' : 'live'}:${session?.instanceId ?? origin}:${session?.staff.id ?? 'anonymous'}`;
}
export function readDraft(storage: Pick<Storage, 'getItem'>, key: string): SavedDraft | null {
  try {
    const raw = storage.getItem(key); if (!raw || raw.length > 500_000) return null;
    const value = SavedDraft.parse(JSON.parse(raw));
    if (value.pendingSend) {
      const pending = value.pendingSend;
      (pending.kind === 'create' ? CreateOrderBody : AddLinesBody).parse(JSON.parse(pending.body));
      if (pending.kind === 'add' && !pending.orderId) return null;
    }
    return value;
  } catch { return null; }
}
export function saveDraft(storage: Pick<Storage, 'setItem' | 'removeItem'>, key: string, draft: SavedDraft): boolean {
  try {
    if (!draft.cart.length && !draft.pendingSend && !draft.paymentOrderId) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(draft));
    return true;
  } catch { return false; }
}
