import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { builtInEffects } from '../effects';
import type { Clock } from '../runtime/clock';
import type { EffectDefinition } from '../runtime/effect';
import type { ErrorReporter } from '../runtime/emitter';
import { createEngine } from '../runtime/engine';
import type { Engine } from '../runtime/engine';
import { GameFXContext } from './context';
import { createDefaultClock } from './defaultClock';

export interface GameFXProviderProps {
  readonly children?: ReactNode;
  /** Extra effect types to register in addition to the built-in ones. */
  readonly effects?: readonly EffectDefinition<never>[];
  /** Seed for effects that don't pass their own. */
  readonly seed?: number;
  /** Maximum simultaneous effects; the oldest is cancelled beyond it. Default 32. */
  readonly maxActiveEffects?: number;
  /** Clock override, mainly for tests. Defaults to a `requestAnimationFrame` clock. */
  readonly clock?: Clock;
  readonly onError?: ErrorReporter;
}

/**
 * Owns one effects engine for its subtree. The engine is created when the provider mounts and
 * disposed (all effects cancelled, frame loop stopped) when it unmounts.
 *
 * Options are read once at mount; changing them later has no effect.
 */
export function GameFXProvider({
  children,
  effects,
  seed,
  maxActiveEffects,
  clock,
  onError,
}: GameFXProviderProps): ReactNode {
  const [engine, setEngine] = useState<Engine | null>(null);

  useEffect(() => {
    const created = createEngine({
      clock: clock ?? createDefaultClock(),
      effects: [...builtInEffects, ...(effects ?? [])],
      ...(seed !== undefined ? { seed } : {}),
      ...(maxActiveEffects !== undefined ? { maxActiveEffects } : {}),
      ...(onError !== undefined ? { onError } : {}),
    });
    setEngine(created);
    return () => {
      created.dispose();
      setEngine((current) => (current === created ? null : current));
    };
  }, []);

  return <GameFXContext.Provider value={engine}>{children}</GameFXContext.Provider>;
}
