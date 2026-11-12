import type { EffectDefinition } from '../runtime/effect';
import { particleBurst } from './particleBurst';
import type { ParticleBurstParams } from './particleBurst';

export { DEFAULT_BURST_COLORS, particleBurst, resolveBurstParams } from './particleBurst';
export type { FromTo, ParticleBurstParams, Point, Range } from './particleBurst';

/** Parameter types of the effects that ship with the SDK, by name. */
export interface BuiltInEffects {
  'particle-burst': ParticleBurstParams;
}

/** All built-in effect definitions, registered by default by `GameFXProvider`. */
export const builtInEffects: readonly EffectDefinition<never>[] = [particleBurst];
