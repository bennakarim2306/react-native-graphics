import type { AnimationTarget } from '../animation/target';
import type { TransformOffset } from '../runtime/effect';
import { Emitter, rethrowAsync } from '../runtime/emitter';
import type { ErrorReporter, Unsubscribe } from '../runtime/emitter';
import { InvalidOptionError } from '../runtime/errors';
import { createHostViewBinding } from './host';
import type { HostLayout, HostViewBinding } from './host';
import type { Point } from './matrix';
import type { SceneNode } from './node';
import type { Scene } from './scene';

/** A rectangle in window coordinates, as `measureInWindow` reports it. */
export interface WindowRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Extra transform a host knows about its view (measurement only gives an axis-aligned box). */
export interface TargetTransform {
  readonly rotation?: number;
  readonly scaleX?: number;
  readonly scaleY?: number;
}

/** Properties of a target's motion that animations can drive. */
export type TargetMotionProperty = 'x' | 'y' | 'rotation' | 'scale' | 'scaleX' | 'scaleY' | 'opacity';

/** The full transform a host should apply to its view (relative to its layout position). */
export interface TargetViewTransform {
  readonly translateX: number;
  readonly translateY: number;
  /** Degrees, around the view's centre. */
  readonly rotation: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly opacity: number;
}

/**
 * Explicit transform binding of a host target. The engine owns these values: animate them
 * (`engine.animate(target.motion, { x: 120, rotation: 360 })`) and `GameFXTarget` applies them
 * to the view on the UI thread, while effects attached to the target see exactly the same
 * transform. `x`/`y` are offsets in points from the view's layout position; rotation and
 * scale apply around the view's centre.
 */
export class TargetMotion implements AnimationTarget<TargetMotionProperty> {
  private values = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 };
  private dead = false;

  constructor(private readonly changed: () => void) {}

  get destroyed(): boolean {
    return this.dead;
  }

  get x(): number {
    return this.values.x;
  }
  set x(v: number) {
    this.set('x', v);
  }
  get y(): number {
    return this.values.y;
  }
  set y(v: number) {
    this.set('y', v);
  }
  get rotation(): number {
    return this.values.rotation;
  }
  set rotation(v: number) {
    this.set('rotation', v);
  }
  get scaleX(): number {
    return this.values.scaleX;
  }
  set scaleX(v: number) {
    this.set('scaleX', v);
  }
  get scaleY(): number {
    return this.values.scaleY;
  }
  set scaleY(v: number) {
    this.set('scaleY', v);
  }
  /** Uniform scale (reads scaleX). */
  get scale(): number {
    return this.values.scaleX;
  }
  set scale(v: number) {
    this.set('scaleX', v);
    this.set('scaleY', v);
  }
  get opacity(): number {
    return this.values.opacity;
  }
  set opacity(v: number) {
    this.set('opacity', Math.min(1, Math.max(0, v)));
  }

  /** Back to no offset, no rotation, scale 1, opacity 1. */
  reset(): void {
    this.values = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 };
    this.changed();
  }

  hasProperty(name: string): name is TargetMotionProperty {
    return ['x', 'y', 'rotation', 'scale', 'scaleX', 'scaleY', 'opacity'].includes(name);
  }
  getProperty(name: TargetMotionProperty): number {
    return this[name];
  }
  setProperty(name: TargetMotionProperty, value: number): void {
    this[name] = value;
  }
  expandProperty(name: TargetMotionProperty): readonly TargetMotionProperty[] {
    return name === 'scale' ? ['scaleX', 'scaleY'] : [name];
  }

  /** @internal */
  kill(): void {
    this.dead = true;
  }

  private set(key: keyof TargetMotion['values'], value: number): void {
    if (this.dead || !Number.isFinite(value) || this.values[key] === value) return;
    this.values[key] = value;
    this.changed();
  }
}

/** A registered host target. */
export interface TargetHandle {
  readonly id: string;
  /** Proxy node: attach effects to it. Follows layout and motion. */
  readonly node: SceneNode;
  /** Explicit transform binding applied to the host view. */
  readonly motion: TargetMotion;
}

/**
 * Anything that names what an effect attaches to: a host target id (`<GameFXTarget id>`), the
 * handle `getTarget(id)` returns, or a scene node.
 */
export type TargetRef = string | SceneNode | TargetHandle;

/** True for the handle returned by `getTarget(id)`. */
export function isTargetHandle(value: unknown): value is TargetHandle {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { id?: unknown }).id === 'string' &&
    'node' in value &&
    'motion' in value
  );
}

export interface TargetEvents {
  /** A target was registered (its proxy node exists, maybe not measured yet). */
  added: { readonly id: string; readonly node: SceneNode };
  /** A target got its first or a new layout. */
  layout: { readonly id: string; readonly layout: HostLayout };
  removed: { readonly id: string };
  /** Hosts should measure their views again (for example after scrolling). Empty id = all. */
  remeasure: { readonly id: string | null };
  /** The transform a host must apply to its view changed (motion or offsets such as shakes). */
  transform: { readonly id: string; readonly transform: TargetViewTransform };
}

interface OffsetEntry extends TransformOffset {
  removed: boolean;
}

interface TargetEntry {
  readonly binding: HostViewBinding;
  readonly motion: TargetMotion;
  readonly offsets: Set<OffsetEntry>;
  window: WindowRect | null;
  transform: TargetTransform;
  measured: boolean;
}

/**
 * Named anchors for host views (React Native components). Each id owns a proxy scene node whose
 * position and size mirror the host view, converted from window coordinates to overlay
 * coordinates. Effects attach to the proxy node like to any node, so the same effect works on
 * engine objects and on app components.
 *
 * Platform-independent: the React Native layer feeds it measurements (`GameFXTarget`) and the
 * overlay's window origin (`GameFXOverlay`).
 */
export class TargetRegistry {
  private readonly entries = new Map<string, TargetEntry>();
  private readonly emitter: Emitter<TargetEvents>;
  private overlayOrigin: Point = { x: 0, y: 0 };
  private disposed = false;

  constructor(
    private readonly scene: Scene,
    reportError: ErrorReporter = rethrowAsync,
  ) {
    this.emitter = new Emitter<TargetEvents>(reportError);
  }

  on<K extends keyof TargetEvents>(type: K, listener: (event: TargetEvents[K]) => void): Unsubscribe {
    return this.emitter.on(type, listener);
  }

  /** Window position of the overlay's top-left corner. Target layouts are relative to it. */
  get origin(): Point {
    return this.overlayOrigin;
  }

  /** Called by the overlay when it is measured. Re-syncs every target. */
  setOrigin(origin: Point): void {
    if (!Number.isFinite(origin.x) || !Number.isFinite(origin.y)) throw new InvalidOptionError('Overlay origin must be finite.');
    if (origin.x === this.overlayOrigin.x && origin.y === this.overlayOrigin.y) return;
    this.overlayOrigin = { x: origin.x, y: origin.y };
    for (const [id, entry] of this.entries) this.sync(id, entry);
  }

  /**
   * Registers a target and creates its proxy node (in the scene, invisible, with no shape).
   * Throws if the id is taken.
   */
  register(id: string): SceneNode {
    this.assertAlive();
    if (typeof id !== 'string' || id.length === 0) throw new InvalidOptionError('Target ids must be non-empty strings.');
    if (this.entries.has(id)) throw new InvalidOptionError(`A target with id "${id}" is already registered.`);
    const node = this.scene.createNode({ name: `target:${id}`, size: { width: 0, height: 0 } });
    const motion = new TargetMotion(() => {
      const current = this.entries.get(id);
      if (current) this.syncMotion(id, current);
    });
    this.entries.set(id, {
      binding: createHostViewBinding(node),
      motion,
      offsets: new Set(),
      window: null,
      transform: {},
      measured: false,
    });
    this.emitter.emit('added', { id, node });
    return node;
  }

  /** Feeds a window measurement (and optional rotation/scale) for a target. */
  updateWindowLayout(id: string, rect: WindowRect, transform: TargetTransform = {}): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width < 0 || rect.height < 0) return;
    entry.window = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    entry.transform = transform;
    this.sync(id, entry);
  }

  /** Destroys the proxy node: effects attached to it end with `targetDestroyed`. */
  unregister(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    entry.motion.kill();
    for (const offset of entry.offsets) offset.removed = true;
    entry.offsets.clear();
    entry.binding.dispose();
    this.emitter.emit('removed', { id });
  }

  /** The proxy node of a target, or undefined. */
  node(id: string): SceneNode | undefined {
    return this.entries.get(id)?.binding.node;
  }

  /** The explicit transform binding of a target, or undefined. */
  motion(id: string): TargetMotion | undefined {
    return this.entries.get(id)?.motion;
  }

  /** Id, proxy node and motion of a target, or undefined. */
  get(id: string): TargetHandle | undefined {
    const entry = this.entries.get(id);
    return entry ? { id, node: entry.binding.node, motion: entry.motion } : undefined;
  }

  /** The id of the target whose proxy node is `node`, or undefined. */
  idOf(node: SceneNode): string | undefined {
    for (const [id, entry] of this.entries) if (entry.binding.node === node) return id;
    return undefined;
  }

  /**
   * Adds a temporary offset to a target's transform (for example a shake). Offsets add to the
   * motion; removing one restores the transform exactly. Returns null for unknown ids.
   */
  addOffset(id: string): TransformOffset | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    const values = { x: 0, y: 0, rotation: 0 };
    const sync = () => {
      const current = this.entries.get(id);
      if (current === entry && !offset.removed) this.syncMotion(id, entry);
    };
    const offset: OffsetEntry = {
      removed: false,
      get x() {
        return values.x;
      },
      set x(v: number) {
        values.x = v;
        sync();
      },
      get y() {
        return values.y;
      },
      set y(v: number) {
        values.y = v;
        sync();
      },
      get rotation() {
        return values.rotation;
      },
      set rotation(v: number) {
        values.rotation = v;
        sync();
      },
      remove: () => {
        if (offset.removed) return;
        offset.removed = true;
        entry.offsets.delete(offset);
        if (this.entries.get(id) === entry) this.syncMotion(id, entry);
      },
    };
    entry.offsets.add(offset);
    return offset;
  }

  /** The transform the host view of `id` should have now, or undefined. */
  viewTransform(id: string): TargetViewTransform | undefined {
    const entry = this.entries.get(id);
    return entry ? this.computeView(entry) : undefined;
  }

  /** True once the target has been measured at least once. */
  isMeasured(id: string): boolean {
    return this.entries.get(id)?.measured ?? false;
  }

  /** The target's current layout in overlay coordinates, or undefined before measurement. */
  layout(id: string): HostLayout | undefined {
    const entry = this.entries.get(id);
    return entry?.measured ? this.toLayout(entry) : undefined;
  }

  get ids(): readonly string[] {
    return [...this.entries.keys()];
  }

  /** Asks hosts to measure again, for example after the app scrolled a list. */
  requestRemeasure(id?: string): void {
    this.emitter.emit('remeasure', { id: id ?? null });
  }

  dispose(): void {
    if (this.disposed) return;
    for (const id of [...this.entries.keys()]) this.unregister(id);
    this.disposed = true;
    this.emitter.clear();
  }

  private toLayout(entry: TargetEntry): HostLayout {
    const w = entry.window ?? { x: 0, y: 0, width: 0, height: 0 };
    return {
      x: w.x - this.overlayOrigin.x,
      y: w.y - this.overlayOrigin.y,
      width: w.width,
      height: w.height,
      ...entry.transform,
    };
  }

  private computeView(entry: TargetEntry): TargetViewTransform {
    const m = entry.motion;
    let x = m.x;
    let y = m.y;
    let rotation = m.rotation;
    for (const offset of entry.offsets) {
      x += offset.x;
      y += offset.y;
      rotation += offset.rotation;
    }
    return { translateX: x, translateY: y, rotation, scaleX: m.scaleX, scaleY: m.scaleY, opacity: m.opacity };
  }

  /** Places the proxy node from the layout plus the motion and offsets. */
  private placeNode(entry: TargetEntry): void {
    const node = entry.binding.node;
    if (node.destroyed || !entry.window) return;
    const layout = this.toLayout(entry);
    const view = this.computeView(entry);
    node.x = layout.x + layout.width / 2 + view.translateX;
    node.y = layout.y + layout.height / 2 + view.translateY;
    node.rotation = (entry.transform.rotation ?? 0) + view.rotation;
    node.scaleX = (entry.transform.scaleX ?? 1) * view.scaleX;
    node.scaleY = (entry.transform.scaleY ?? 1) * view.scaleY;
    node.opacity = view.opacity;
  }

  private syncMotion(id: string, entry: TargetEntry): void {
    this.placeNode(entry);
    this.emitter.emit('transform', { id, transform: this.computeView(entry) });
  }

  private sync(id: string, entry: TargetEntry): void {
    if (!entry.window) return;
    const layout = this.toLayout(entry);
    const node = entry.binding.node;
    if (node.destroyed) return;
    node.size = { width: layout.width, height: layout.height };
    this.placeNode(entry);
    entry.measured = true;
    this.emitter.emit('layout', { id, layout });
  }

  private assertAlive(): void {
    if (this.disposed) throw new InvalidOptionError('The target registry has been disposed.');
  }
}
