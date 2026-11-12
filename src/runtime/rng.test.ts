import { createRandom } from './rng';

describe('createRandom', () => {
  it('is deterministic per seed and stays in range', () => {
    const a = createRandom(42);
    const b = createRandom(42);
    const c = createRandom(43);
    const seqA = Array.from({ length: 100 }, () => a.next());
    const seqB = Array.from({ length: 100 }, () => b.next());
    const seqC = Array.from({ length: 100 }, () => c.next());
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('produces ranges and integers within bounds', () => {
    const r = createRandom(1);
    for (let i = 0; i < 1000; i++) {
      const f = r.range(5, 10);
      expect(f).toBeGreaterThanOrEqual(5);
      expect(f).toBeLessThan(10);
      const n = r.int(3);
      expect([0, 1, 2]).toContain(n);
    }
  });
});
