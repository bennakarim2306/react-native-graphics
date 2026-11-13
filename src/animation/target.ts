import { InvalidOptionError } from '../runtime/errors';

/**
 * Something whose numeric properties an animation can read and write. Scene nodes implement
 * it; `objectTarget` adapts a plain object. Animations never write to a destroyed target.
 */
export interface AnimationTarget<P extends string = string> {
  hasProperty(name: string): name is P;
  getProperty(name: P): number;
  setProperty(name: P, value: number): void;
  /** True once the target is gone (for example a destroyed scene node). Writes are skipped. */
  readonly destroyed?: boolean;
  /**
   * Shorthand properties that write several real ones (for example `scale` → `scaleX`,
   * `scaleY`). Used to detect overlapping animations. Defaults to `[name]`.
   */
  expandProperty?(name: P): readonly P[];
}

/** Property names of a target. */
export type TargetProperty<T> = T extends AnimationTarget<infer P> ? P : never;

/** Adapts a plain object with numeric fields, so animations can drive arbitrary values. */
export function objectTarget<T extends Record<string, number>>(object: T): AnimationTarget<Extract<keyof T, string>> {
  type P = Extract<keyof T, string>;
  return {
    hasProperty: (name: string): name is P =>
      Object.prototype.hasOwnProperty.call(object, name) && typeof object[name] === 'number',
    getProperty: (name: P) => object[name] as number,
    setProperty: (name: P, value: number) => {
      (object as Record<string, number>)[name] = value;
    },
  };
}

export function isAnimationTarget(value: unknown): value is AnimationTarget {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnimationTarget).hasProperty === 'function' &&
    typeof (value as AnimationTarget).getProperty === 'function' &&
    typeof (value as AnimationTarget).setProperty === 'function'
  );
}

export function assertAnimationTarget(value: unknown): asserts value is AnimationTarget {
  if (!isAnimationTarget(value)) {
    throw new InvalidOptionError('An animation target must be a scene node or an objectTarget(...).');
  }
}
