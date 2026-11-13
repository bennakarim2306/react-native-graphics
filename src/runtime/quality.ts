import { InvalidOptionError } from './errors';

export type QualityLevel = 'low' | 'medium' | 'high';

/**
 * How much visual detail effects produce. Effects read it when they start; changing the
 * engine's quality affects effects started afterwards.
 */
export interface QualityProfile {
  readonly level: QualityLevel;
  /** Multiplier for particle counts and emission rates. */
  readonly particleScale: number;
  /** Runtime shaders (fire, energy). When false, effects use particle or solid fallbacks. */
  readonly shaders: boolean;
  /** Blur-based glows (offscreen layers). */
  readonly glow: boolean;
  /** Secondary details such as sparks, smoke and second shockwave rings. */
  readonly details: boolean;
}

export const QUALITY_PROFILES: Readonly<Record<QualityLevel, QualityProfile>> = {
  low: { level: 'low', particleScale: 0.35, shaders: false, glow: false, details: false },
  medium: { level: 'medium', particleScale: 0.65, shaders: true, glow: false, details: true },
  high: { level: 'high', particleScale: 1, shaders: true, glow: true, details: true },
};

export function resolveQuality(quality: QualityLevel | QualityProfile): QualityProfile {
  if (typeof quality === 'string') {
    const profile = QUALITY_PROFILES[quality] as QualityProfile | undefined;
    if (!profile) throw new InvalidOptionError(`Unknown quality "${quality}". Use low, medium or high.`);
    return profile;
  }
  if (typeof quality !== 'object' || !(quality.particleScale >= 0) || !Number.isFinite(quality.particleScale)) {
    throw new InvalidOptionError('A quality profile needs a finite particleScale >= 0.');
  }
  return quality;
}

export interface AdaptiveQualityOptions {
  /** Frame time (ms) above which quality drops. Default 22 (below ~45 fps). */
  readonly downshiftAboveMs?: number;
  /** Frame time below which quality may rise again. Default 14. */
  readonly upshiftBelowMs?: number;
  /** Frames averaged before deciding. Default 30. */
  readonly window?: number;
  /** Lowest level it may choose. Default `low`. */
  readonly min?: QualityLevel;
  /** Highest level it may choose. Default `high`. */
  readonly max?: QualityLevel;
}

const ORDER: readonly QualityLevel[] = ['low', 'medium', 'high'];

/**
 * Chooses a quality level from measured frame intervals: drops one level when the average of
 * a window of frames is too slow, raises one level after a fast window. Each change starts a
 * new window, so it never oscillates faster than once per window.
 */
export class AdaptiveQuality {
  private readonly down: number;
  private readonly up: number;
  private readonly window: number;
  private readonly min: number;
  private readonly max: number;
  private sum = 0;
  private samples = 0;

  constructor(
    private levelValue: QualityLevel,
    options: AdaptiveQualityOptions = {},
  ) {
    this.down = options.downshiftAboveMs ?? 22;
    this.up = options.upshiftBelowMs ?? 14;
    this.window = options.window ?? 30;
    this.min = ORDER.indexOf(options.min ?? 'low');
    this.max = ORDER.indexOf(options.max ?? 'high');
    if (!(this.up < this.down) || !(this.window >= 1) || this.min < 0 || this.max < this.min) {
      throw new InvalidOptionError('Invalid adaptive quality options.');
    }
  }

  get level(): QualityLevel {
    return this.levelValue;
  }

  /** Feeds one frame interval. Returns the new level when it changed, else null. */
  sample(frameMs: number): QualityLevel | null {
    if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 1000) return null;
    this.sum += frameMs;
    this.samples++;
    if (this.samples < this.window) return null;
    const average = this.sum / this.samples;
    this.sum = 0;
    this.samples = 0;
    const index = ORDER.indexOf(this.levelValue);
    let next = index;
    if (average > this.down && index > this.min) next = index - 1;
    else if (average < this.up && index < this.max) next = index + 1;
    if (next === index) return null;
    this.levelValue = ORDER[next] ?? this.levelValue;
    return this.levelValue;
  }
}
