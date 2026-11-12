import { FrameClock, VirtualClock } from './clock';

describe('VirtualClock', () => {
  it('only moves when advanced and delivers frames at exact times', () => {
    const clock = new VirtualClock(100);
    const frames: number[] = [];
    clock.subscribe((t) => frames.push(t));
    expect(clock.now()).toBe(100);
    clock.advance(50);
    clock.advance(40, { frameMs: 16 });
    expect(frames).toEqual([150, 166, 182, 190]);
    expect(clock.now()).toBe(190);
  });

  it('stops delivering after unsubscribe, even during a frame', () => {
    const clock = new VirtualClock();
    const calls: string[] = [];
    let offB = (): void => undefined;
    clock.subscribe(() => {
      calls.push('a');
      offB();
    });
    offB = clock.subscribe(() => calls.push('b'));
    clock.advance(1);
    expect(calls).toEqual(['a']);
    expect(clock.subscriberCount).toBe(1);
  });

  it('rejects invalid time changes', () => {
    const clock = new VirtualClock(10);
    expect(() => { clock.advance(-1); }).toThrow();
    expect(() => { clock.advance(Number.NaN); }).toThrow();
    expect(() => { clock.setTime(5); }).toThrow(RangeError);
    expect(() => { clock.advance(10, { frameMs: 0 }); }).toThrow(RangeError);
    expect(() => new VirtualClock(-1)).toThrow();
  });
});

describe('FrameClock', () => {
  function fakeScheduler() {
    let time = 0;
    let nextHandle = 1;
    const pending = new Map<number, (t: number) => void>();
    return {
      fns: {
        requestFrame: (cb: (t: number) => void) => {
          const h = nextHandle++;
          pending.set(h, cb);
          return h;
        },
        cancelFrame: (h: number) => {
          pending.delete(h);
        },
        now: () => time,
      },
      pending,
      flush(advance: number) {
        time += advance;
        const callbacks = [...pending.values()];
        pending.clear();
        for (const cb of callbacks) cb(time);
      },
    };
  }

  it('requests frames only while subscribed and cancels the pending frame on last unsubscribe', () => {
    const s = fakeScheduler();
    const clock = new FrameClock(s.fns);
    expect(s.pending.size).toBe(0);
    const times: number[] = [];
    const off = clock.subscribe((t) => times.push(t));
    expect(s.pending.size).toBe(1);
    s.flush(16);
    s.flush(16);
    expect(times).toEqual([16, 32]);
    expect(s.pending.size).toBe(1);
    off();
    expect(s.pending.size).toBe(0);
    expect(clock.now()).toBe(32);
  });
});
