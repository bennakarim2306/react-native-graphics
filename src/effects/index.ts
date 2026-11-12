import type { EffectDefinition } from '../runtime/effect';
import { energyBorder, fireBorder, glowBorder } from './border';
import type { GlowBorderParams, ShaderBorderParams } from './border';
import { particleBurst } from './particleBurst';
import type { ParticleBurstParams } from './particleBurst';

export { DEFAULT_BURST_COLORS, particleBurst, resolveBurstParams } from './particleBurst';
export type { FromTo, ParticleBurstParams, Range } from './particleBurst';
export { energyBorder, fireBorder, glowBorder } from './border';
export type { BorderParams, GlowBorderParams, ShaderBorderParams } from './border';

/** Parameter types of the effects that ship with the SDK, by name. */
export interface BuiltInEffects {
  'particle-burst': ParticleBurstParams;
  'glow-border': GlowBorderParams;
  'energy-border': ShaderBorderParams;
  'fire-border': ShaderBorderParams;
}

/** All built-in effect definitions, registered by default by `GameFXProvider`. */
export const builtInEffects: readonly EffectDefinition<never>[] = [
  particleBurst,
  glowBorder,
  energyBorder,
  fireBorder,
];
