import { createRandom } from '../runtime/rng';
import { defineEffect } from '../runtime/effect';
import type { Drawable, EffectContext, EffectDefinition, EffectInstance } from '../runtime/effect';
import { InvalidOptionError } from '../runtime/errors';

/** One part of a composite effect. */
export interface CompositeLayer {
  /** A layer name, used by `setParams` routing and tests. */
  readonly name: string;
  readonly effect: EffectDefinition<never>;
  readonly params: unknown;
  /** Start after this many ms of the composite's time. Default 0. */
  readonly delay?: number;
}

export interface CompositeDefinition<Params> {
  readonly name: string;
  /** Builds the layers from the parameters. Validate here; throw `InvalidOptionError`. */
  layers(params: Params, context: EffectContext): readonly CompositeLayer[];
  /**
   * Maps a runtime parameter patch to patches per layer name (default: the same patch to every
   * layer that accepts updates).
   */
  readonly route?: (patch: Readonly<Record<string, unknown>>) => Readonly<Record<string, Readonly<Record<string, unknown>>>> | null;
}

interface Child {
  readonly name: string;
  readonly delay: number;
  readonly instance: EffectInstance;
  started: boolean;
  skipped: boolean;
}

/**
 * Runs several effects as one: each layer starts at its delay on the composite's clock (the
 * engine clock), draws in layer order, and the composite completes when every layer has.
 * Pause, stop, cancel and parameter updates apply to all layers through the single handle.
 * All layers are created (and validated) up front, so invalid parameters fail before
 * anything is shown.
 */
export class CompositeInstance implements EffectInstance {
  private readonly children: Child[] = [];
  private drawList: Drawable[] = [];

  constructor(
    layers: readonly CompositeLayer[],
    context: EffectContext,
    private readonly router: CompositeDefinition<unknown>['route'],
  ) {
    try {
      for (const layer of layers) {
        const delay = layer.delay ?? 0;
        if (!Number.isFinite(delay) || delay < 0) throw new InvalidOptionError(`Layer "${layer.name}" delay must be >= 0.`);
        // Each layer gets its own random stream derived from the composite's seed.
        const childContext: EffectContext = { ...context, random: createRandom(context.random.nextUint32()) };
        const instance = (layer.effect as EffectDefinition<unknown>).create(layer.params, childContext);
        this.children.push({ name: layer.name, delay, instance, started: false, skipped: false });
      }
    } catch (error) {
      for (const child of this.children) child.instance.dispose();
      throw error;
    }
  }

  /** Layer names in draw order, for inspection. */
  get layerNames(): readonly string[] {
    return this.children.map((c) => c.name);
  }

  /** The instance of a layer, for inspection and tests. */
  layer(name: string): EffectInstance | undefined {
    return this.children.find((c) => c.name === name)?.instance;
  }

  get drawables(): readonly Drawable[] {
    return this.drawList;
  }

  get done(): boolean {
    return this.children.every((c) => c.skipped || (c.started && c.instance.done));
  }

  update(elapsedMs: number): void {
    this.drawList = [];
    for (const child of this.children) {
      if (child.skipped) continue;
      if (elapsedMs < child.delay) continue;
      child.started = true;
      if (!child.instance.done) child.instance.update(elapsedMs - child.delay);
      if (!child.instance.done) this.drawList.push(...child.instance.drawables);
    }
  }

  stop(): void {
    for (const child of this.children) {
      if (!child.started) {
        child.skipped = true;
        continue;
      }
      if (child.instance.stop) child.instance.stop();
      else child.skipped = true;
    }
  }

  setParams(patch: Readonly<Record<string, unknown>>): void {
    const routed = this.router ? this.router(patch) : null;
    for (const child of this.children) {
      const childPatch = routed ? routed[child.name] : patch;
      if (childPatch && child.instance.setParams) child.instance.setParams(childPatch);
    }
  }

  dispose(): void {
    for (const child of this.children) child.instance.dispose();
    this.drawList = [];
  }
}

/** Defines an effect made of other effects. */
export function defineComposite<Params>(definition: CompositeDefinition<Params>): EffectDefinition<Params> {
  return defineEffect<Params>({
    name: definition.name,
    create: (params, context) =>
      new CompositeInstance(definition.layers(params, context), context, definition.route),
  });
}
