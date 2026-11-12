import { Emitter } from './emitter';

interface Events {
  ping: number;
}

describe('Emitter', () => {
  it('calls listeners in order, supports once and off', () => {
    const e = new Emitter<Events>();
    const calls: string[] = [];
    e.on('ping', (n) => calls.push(`a${String(n)}`));
    e.once('ping', (n) => calls.push(`once${String(n)}`));
    const off = e.on('ping', (n) => calls.push(`c${String(n)}`));
    e.emit('ping', 1);
    off();
    e.emit('ping', 2);
    expect(calls).toEqual(['a1', 'once1', 'c1', 'a2']);
  });

  it('reports a throwing listener and keeps dispatching to the others', () => {
    const errors: unknown[] = [];
    const e = new Emitter<Events>((err) => errors.push(err));
    const calls: number[] = [];
    e.on('ping', () => {
      throw new Error('boom');
    });
    e.on('ping', (n) => calls.push(n));
    e.emit('ping', 7);
    expect(calls).toEqual([7]);
    expect(errors).toHaveLength(1);
  });

  it('does not call listeners added during dispatch', () => {
    const e = new Emitter<Events>();
    const calls: string[] = [];
    e.on('ping', () => {
      calls.push('first');
      e.on('ping', () => calls.push('late'));
    });
    e.emit('ping', 0);
    expect(calls).toEqual(['first']);
  });
});
