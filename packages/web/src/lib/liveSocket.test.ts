import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openLive, QUIET_MS } from './liveSocket';

class FakeSocket {
  static made: FakeSocket[] = [];
  readyState = 0;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  closedByClient = false;
  constructor(public url: string) { FakeSocket.made.push(this); }
  close() { this.closedByClient = true; this.readyState = 3; }
  // What the other end does:
  open() { this.readyState = 1; this.onopen?.({}); }
  say(data: string) { this.onmessage?.({ data }); }
  hangUp() { this.readyState = 3; this.onclose?.({}); }
}

let states: boolean[];
let opens: number;
let heard: unknown[];
let stop: () => void;
const start = (url: () => string | null = () => 'ws://till/ws') => {
  stop = openLive({ url, onState: (s) => states.push(s), onOpen: () => { opens += 1; }, onMessage: (d) => heard.push(d), createSocket: (u) => new FakeSocket(u) });
};
const latest = () => FakeSocket.made.at(-1)!;

beforeEach(() => { vi.useFakeTimers(); FakeSocket.made = []; states = []; opens = 0; heard = []; });
afterEach(() => { stop?.(); vi.useRealTimers(); });

describe('live connection', () => {
  it('stays up while the server keeps saying hello', () => {
    start();
    latest().open();
    for (let i = 0; i < 20; i++) { vi.advanceTimersByTime(15_000); latest().say('hello'); }
    expect(FakeSocket.made).toHaveLength(1);
    expect(states).toEqual([true]);
    expect(opens).toBe(1);
    expect(heard).toHaveLength(20);
  });

  it('a connection that goes silent is replaced, and the screen reloads on the new one', () => {
    start();
    const dead = latest();
    dead.open();
    dead.say('hello');
    vi.advanceTimersByTime(QUIET_MS + 5000); // no goodbye, no close event: just nothing
    expect(FakeSocket.made).toHaveLength(2);
    expect(dead.closedByClient).toBe(true);
    expect(states).toEqual([true, false]);
    latest().open();
    expect(states).toEqual([true, false, true]);
    expect(opens).toBe(2);
    // Whatever the dead connection still does later is ignored.
    dead.say('stale');
    dead.hangUp();
    expect(heard).toEqual(['hello']);
    expect(FakeSocket.made).toHaveLength(2);
    expect(states).toEqual([true, false, true]);
  });

  it('a connection that never opens is tried again too', () => {
    start();
    vi.advanceTimersByTime(QUIET_MS + 5000);
    expect(FakeSocket.made).toHaveLength(2);
    expect(FakeSocket.made[0]!.closedByClient).toBe(true);
  });

  it('reconnects with a growing pause after the server hangs up, and starts over once connected', () => {
    start();
    latest().open();
    latest().hangUp();
    expect(states).toEqual([true, false]);
    vi.advanceTimersByTime(999);
    expect(FakeSocket.made).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.made).toHaveLength(2);
    latest().hangUp(); // server still down
    vi.advanceTimersByTime(1999);
    expect(FakeSocket.made).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.made).toHaveLength(3);
    latest().open();
    latest().hangUp();
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.made).toHaveLength(4);
  });

  it('does nothing while nobody is signed in, and stops for good when the screen closes', () => {
    start(() => null);
    vi.advanceTimersByTime(120_000);
    expect(FakeSocket.made).toHaveLength(0);
    stop();
    start();
    const socket = latest();
    socket.open();
    stop();
    expect(socket.closedByClient).toBe(true);
    vi.advanceTimersByTime(120_000);
    expect(FakeSocket.made).toHaveLength(1);
  });
});
