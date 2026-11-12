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

export interface TargetEvents {
  /** A target was registered (its proxy node exists, maybe not measured yet). */
  added: { readonly id: string; readonly node: SceneNode };
  /** A target got its first or a new layout. */
  layout: { readonly id: string; readonly layout: HostLayout };
  removed: { readonly id: string };
  /** Hosts should measure their views again (for example after scrolling). Empty id = all. */
  remeasure: { readonly id: string | null };
}

interface TargetEntry {
  readonly binding: HostViewBinding;
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
    this.entries.set(id, { binding: createHostViewBinding(node), window: null, transform: {}, measured: false });
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
    entry.binding.dispose();
    this.emitter.emit('removed', { id });
  }

  /** The proxy node of a target, or undefined. */
  node(id: string): SceneNode | undefined {
    return this.entries.get(id)?.binding.node;
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

  private sync(id: string, entry: TargetEntry): void {
    if (!entry.window) return;
    const layout = this.toLayout(entry);
    const node = entry.binding.node;
    if (node.destroyed) return;
    entry.binding.update(layout);
    node.size = { width: layout.width, height: layout.height };
    entry.measured = true;
    this.emitter.emit('layout', { id, layout });
  }

  private assertAlive(): void {
    if (this.disposed) throw new InvalidOptionError('The target registry has been disposed.');
  }
}
