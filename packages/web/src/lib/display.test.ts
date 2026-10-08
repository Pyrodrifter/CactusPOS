import { afterEach, describe, expect, it, vi } from 'vitest';
import { keepScreenAwake } from './display';

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const doc = Object.assign(new EventTarget(), { hidden: false });
  const sentinels: Array<EventTarget & { release: ReturnType<typeof vi.fn> }> = [];
  const request = vi.fn(async () => {
    const sentinel = Object.assign(new EventTarget(), { release: vi.fn(async () => { sentinel.dispatchEvent(new Event('release')); }) });
    sentinels.push(sentinel);
    return sentinel;
  });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('navigator', { wakeLock: { request } });
  return { doc, request, sentinels };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('screen wake lock lifecycle', () => {
  it('releases when hidden, reacquires when visible and releases on unmount', async () => {
    const { doc, request, sentinels } = setup();
    const state = vi.fn();
    const stop = keepScreenAwake(state);
    await settle();
    expect(state).toHaveBeenLastCalledWith(true);
    doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(sentinels[0]!.release).toHaveBeenCalledOnce();
    expect(state).toHaveBeenLastCalledWith(false);
    doc.hidden = false; doc.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(request).toHaveBeenCalledTimes(2);
    stop();
    expect(sentinels[1]!.release).toHaveBeenCalledOnce();
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('releases a late grant after the operator switches keep-awake off', async () => {
    const { request } = setup();
    let grant!: (sentinel: WakeLockSentinel) => void;
    const pending = new Promise<WakeLockSentinel>((resolve) => { grant = resolve; });
    request.mockImplementationOnce(() => pending as never);
    const state = vi.fn();
    const stop = keepScreenAwake(state);
    stop();
    const release = vi.fn(async () => {});
    grant({ release } as unknown as WakeLockSentinel);
    await settle();
    expect(release).toHaveBeenCalledOnce();
    expect(state).not.toHaveBeenCalled();
  });

  it('shows rejection without repeatedly requesting permission', async () => {
    const { request } = setup();
    request.mockRejectedValue(new Error('denied'));
    const state = vi.fn();
    const stop = keepScreenAwake(state);
    await settle();
    expect(state).toHaveBeenLastCalledWith(false);
    expect(request).toHaveBeenCalledOnce();
    stop();
  });

  it('does not request a lock on a hidden or unsupported screen', async () => {
    const { doc, request } = setup();
    doc.hidden = true;
    const stop = keepScreenAwake(vi.fn());
    await settle();
    expect(request).not.toHaveBeenCalled();
    stop();
    vi.stubGlobal('navigator', {});
    doc.hidden = false;
    expect(() => keepScreenAwake(vi.fn())()).not.toThrow();
  });
});
