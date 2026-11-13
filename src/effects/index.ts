import type { EffectDefinition } from '../runtime/effect';
import { energyBorder, glowBorder } from './border';
import type { GlowBorderParams, ShaderBorderParams } from './border';
import { fireBorder } from './fireBorder';
import type { FireBorderParams } from './fireBorder';
import { particleBurst } from './particleBurst';
import type { ParticleBurstParams } from './particleBurst';
import { confetti, explosion, glowPulse, goldenSparks, smoke, trail, victory } from './presets';
import type {
  ConfettiParams,
  ExplosionParams,
  GlowPulseParams,
  GoldenSparksParams,
  SmokeParams,
  TrailParams,
  VictoryParams,
} from './presets';
import { flash, particles, screenShake, shockwave } from './primitives';
import type { FlashParams, ParticlesParams, ScreenShakeParams, ShockwaveParams } from './primitives';

export { DEFAULT_BURST_COLORS, particleBurst, resolveBurstParams } from './particleBurst';
export type { FromTo, ParticleBurstParams, Range } from './particleBurst';
export { energyBorder, glowBorder } from './border';
export type { BorderParams, GlowBorderParams, ShaderBorderParams } from './border';
export { FireBorderInstance, fireBorder } from './fireBorder';
export type { FireBorderParams, FireBorderShape } from './fireBorder';
export { flash, particles, ParticlesInstance, screenShake, shockwave } from './primitives';
export type { FlashParams, ParticlesParams, ScreenShakeParams, ShockwaveParams } from './primitives';
export {
  CONFETTI_COLORS,
  confetti,
  EXPLOSION_COLORS,
  explosion,
  GOLD_COLORS,
  glowPulse,
  goldenSparks,
  SMOKE_COLORS,
  smoke,
  trail,
  victory,
} from './presets';
export type {
  ConfettiParams,
  ExplosionParams,
  GlowPulseParams,
  GoldenSparksParams,
  SmokeParams,
  TrailParams,
  VictoryParams,
} from './presets';
export { CompositeInstance, defineComposite } from './composite';
export type { CompositeDefinition, CompositeLayer } from './composite';
export { Placement } from './placement';
export type { PlacementParams } from './placement';

/** Parameter types of the effects that ship with the SDK, by name. */
export interface BuiltInEffects {
  'particle-burst': ParticleBurstParams;
  'glow-border': GlowBorderParams;
  'energy-border': ShaderBorderParams;
  'fire-border': FireBorderParams;
  particles: ParticlesParams;
  flash: FlashParams;
  shockwave: ShockwaveParams;
  'screen-shake': ScreenShakeParams;
  confetti: ConfettiParams;
  'golden-sparks': GoldenSparksParams;
  smoke: SmokeParams;
  trail: TrailParams;
  'glow-pulse': GlowPulseParams;
  explosion: ExplosionParams;
  victory: VictoryParams;
}

/** All built-in effect definitions, registered by default by `GameFXProvider`. */
export const builtInEffects: readonly EffectDefinition<never>[] = [
  particleBurst,
  glowBorder,
  energyBorder,
  fireBorder,
  particles,
  flash,
  shockwave,
  screenShake,
  confetti,
  goldenSparks,
  smoke,
  trail,
  glowPulse,
  explosion,
  victory,
];
