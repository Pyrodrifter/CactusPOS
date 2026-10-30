import { describe, expect, it } from 'vitest';
import { MenuItem, type Session } from '@cactus/shared';
import { draftKey, emptyDraft, readDraft, saveDraft } from './draftStore';

const item = MenuItem.parse({ id: 'fixture', categoryId: 'food', name: 'Fixture', priceCents: 100, taxCategoryId: 'food' });
const storage = () => {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
};
describe('durable device cart', () => {
  it('keeps quantities, notes, modifiers, tab and exact retry identity/body across reloads', () => {
    const store = storage();
    const draft = { ...emptyDraft(), cart: [{ key: 'fixture', item, qty: 2, optionIds: [], note: 'No onions' }], note: 'Take away', tab: { id: 'tab1', label: 'A guest' },
      pendingSend: { id: 'recovery-1234', kind: 'add' as const, orderId: 'tab1', body: '{"lines":[{"itemId":"fixture","qty":2}]}', intent: 'send' as const } };
    expect(saveDraft(store, 'draft', draft)).toBe(true);
    expect(readDraft(store, 'draft')).toEqual(draft);
  });
  it('isolates staff, live/practice and database instances', () => {
    const session = { instanceId: 'server-a', staff: { id: 'staff-a' } } as Session;
    const key = draftKey(session, 'http://cactus.local', false);
    expect(draftKey(session, 'http://cactus.local', true)).not.toBe(key);
    expect(draftKey({ ...session, instanceId: 'server-b' }, 'http://cactus.local', false)).not.toBe(key);
    expect(draftKey({ ...session, staff: { ...session.staff, id: 'staff-b' } }, 'http://cactus.local', false)).not.toBe(key);
  });
  it('retains interrupted payment IDs with an empty cart and removes only acknowledged device state', () => {
    const store = storage();
    saveDraft(store, 'draft', { ...emptyDraft(), paymentOrderId: 'order-1' });
    expect(readDraft(store, 'draft')?.paymentOrderId).toBe('order-1');
    saveDraft(store, 'draft', emptyDraft()); expect(store.getItem('draft')).toBeNull();
  });
  it('refuses corrupt/invalid saved carts and handles unavailable device storage', () => {
    const store = storage(); store.setItem('draft', 'bad json'); expect(readDraft(store, 'draft')).toBeNull();
    store.setItem('draft', JSON.stringify({ ...emptyDraft(), cart: [{ key: 'bad', item, qty: -1, optionIds: [] }] })); expect(readDraft(store, 'draft')).toBeNull();
    expect(saveDraft({ setItem: () => { throw Error('quota'); }, removeItem: () => { throw Error('blocked'); } }, 'draft', emptyDraft())).toBe(false);
  });
});
