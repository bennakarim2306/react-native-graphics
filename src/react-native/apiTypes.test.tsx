/**
 * Type-level contract of `useGameFX()`: the `@ts-expect-error` lines must stay errors and the
 * other calls must compile (checked by `npm run typecheck`, which includes test files). The
 * function is never called; the Jest test only keeps the file in the suite.
 */
import { defineEffect } from '../runtime/effect';
import type { GameFX } from './useGameFX';

const custom = defineEffect<{ readonly target?: unknown; readonly size: number }>({
  name: 'custom',
  create: () => ({ drawables: [], done: true, update: () => undefined, dispose: () => undefined }),
});

export function typeContract(fx: GameFX): void {
  // Built-in effects: parameters are checked by name.
  fx.play('explosion', { position: { x: 0, y: 0 }, particles: 120 });
  // @ts-expect-error misspelled parameter of a built-in effect
  fx.play('explosion', { positon: { x: 0, y: 0 } });
  // @ts-expect-error wrong parameter type
  fx.play('confetti', { position: { x: 0, y: 0 }, count: 'many' });
  fx.attach('card', 'fire-border', { intensity: 0.8, color: '#FF6600' });
  fx.attach('card', 'burn-away', { duration: 900, from: 'top' });
  // @ts-expect-error intensity is a number
  fx.attach('card', 'fire-border', { intensity: 'high' });
  // @ts-expect-error glow-pulse has `pulses`, not `repeat`
  fx.attach('card', 'glow-pulse', { repeat: 3 });
  fx.attach('card', { effect: 'fire-border', intensity: 1 });
  // A union of names accepts parameters of either effect, and nothing that neither has.
  const border = Math.random() > 0.5 ? ('energy-border' as const) : ('fire-border' as const);
  fx.attach('card', border, { padding: 6, intensity: 1.4 });
  // @ts-expect-error neither border effect has `colour`
  fx.attach('card', border, { colour: 'red' });
  // @ts-expect-error misspelled key in an attach spec
  fx.attach('card', { effect: 'fire-border', intesity: 1 });
  fx.cue('confetti', () => ({ position: { x: 0, y: 0 } }));
  // @ts-expect-error misspelled key in a cue
  fx.cue('confetti', { positon: { x: 0, y: 0 } });
  // Custom effects: typed through their definition, untyped by registered name.
  fx.play(custom, { size: 3 });
  // @ts-expect-error `size` is required by the definition
  fx.play(custom, {});
  fx.play('my-registered-effect', { anything: true });
  fx.attach('card', 'my-registered-effect', { anything: true });
}

describe('useGameFX types', () => {
  it('compiles the contract (see npm run typecheck)', () => {
    expect(typeof typeContract).toBe('function');
  });
});
