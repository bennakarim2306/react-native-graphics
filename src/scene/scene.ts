import type { Drawable } from '../runtime/effect';
import { InvalidOptionError } from '../runtime/errors';
import type { AttachmentState, DetachReason } from './attachment';
import type { Matrix2D } from './matrix';
import { AttachmentRecord, SceneNode } from './node';
import type { NodeOptions, NodeShape, SceneHost } from './node';

/** One shape to draw, already in scene coordinates. */
export interface SceneDrawItem {
  readonly nodeId: number;
  readonly matrix: Matrix2D;
  /** World opacity in [0, 1]. */
  readonly opacity: number;
  readonly shape: NodeShape;
}

/** Drawable produced by the scene each frame: its visible shapes in draw order. */
export interface SceneDrawable extends Drawable {
  readonly kind: 'scene';
  readonly items: readonly SceneDrawItem[];
}

export function isSceneDrawable(drawable: Drawable): drawable is SceneDrawable {
  return drawable.kind === 'scene';
}

export interface SceneOptions {
  /** Layer names from bottom to top. Default `['default']`. `default` is always present. */
  readonly layers?: readonly string[];
}

/**
 * A renderer-independent 2D scene graph. Coordinates are overlay pixels: (0, 0) is the
 * overlay's top-left corner, x grows right, y grows down, rotations are clockwise degrees.
 *
 * Draw order: layers from bottom to top; within a layer, depth-first (parents below
 * children), siblings by `zIndex` then insertion order.
 */
export class Scene implements SceneHost {
  readonly root: SceneNode;
  private layerNames: string[];
  private dirty = true;
  private readonly records = new Set<AttachmentRecord>();
  private disposed = false;

  constructor(
    options: SceneOptions = {},
    private readonly onChange: () => void = () => undefined,
  ) {
    this.layerNames = Scene.validateLayers(options.layers ?? ['default']);
    this.root = new SceneNode(this, { name: 'root' });
  }

  get layers(): readonly string[] {
    return this.layerNames;
  }

  /** Replaces the layer order. Nodes on removed layers must be moved first. */
  setLayers(layers: readonly string[]): void {
    const next = Scene.validateLayers(layers);
    this.root.traverse((node) => {
      if (node.layer !== undefined && !next.includes(node.layer)) {
        throw new InvalidOptionError(`Layer "${node.layer}" is still used by node ${node.name || String(node.id)}.`);
      }
    });
    this.layerNames = next;
    this.markDirty();
  }

  hasLayer(name: string): boolean {
    return this.layerNames.includes(name);
  }

  /** True when something changed since the last `markClean`. */
  get isDirty(): boolean {
    return this.dirty;
  }

  markDirty(): void {
    if (this.dirty || this.disposed) return;
    this.dirty = true;
    this.onChange();
  }

  markClean(): void {
    this.dirty = false;
  }

  /** Creates a node, added to `options.parent` or the root (null leaves it detached). */
  createNode(options: NodeOptions = {}): SceneNode {
    if (this.disposed) throw new InvalidOptionError('The scene has been disposed.');
    const node = new SceneNode(this, options);
    const parent = options.parent === undefined ? this.root : options.parent;
    if (parent) parent.addChild(node);
    return node;
  }

  /** Number of nodes connected to the root, excluding the root. */
  get nodeCount(): number {
    let count = -1;
    this.root.traverse(() => {
      count++;
    });
    return count;
  }

  findByName(name: string): SceneNode | undefined {
    let found: SceneNode | undefined;
    this.root.traverse((node) => {
      if (found) return false;
      if (node.name === name) found = node;
      return !found;
    });
    return found;
  }

  /** Visible shapes in draw order. */
  drawItems(): SceneDrawItem[] {
    const buckets = new Map<string, SceneDrawItem[]>();
    const visit = (node: SceneNode, opacity: number, layer: string): void => {
      if (!node.visible) return;
      const worldOpacity = opacity * Math.min(1, Math.max(0, node.opacity));
      if (worldOpacity <= 0) return;
      const nodeLayer = node.layer ?? layer;
      const shape = node.shape;
      if (shape) {
        let bucket = buckets.get(nodeLayer);
        if (!bucket) {
          bucket = [];
          buckets.set(nodeLayer, bucket);
        }
        bucket.push({ nodeId: node.id, matrix: node.worldMatrix, opacity: worldOpacity, shape });
      }
      const children = node.children;
      if (children.length === 0) return;
      const sorted = [...children].sort((a, b) => a.zIndex - b.zIndex || a.order - b.order);
      for (const child of sorted) visit(child, worldOpacity, nodeLayer);
    };
    visit(this.root, 1, this.root.layer ?? 'default');
    const items: SceneDrawItem[] = [];
    for (const layer of this.layerNames) items.push(...(buckets.get(layer) ?? []));
    return items;
  }

  /** The scene as one drawable. */
  drawable(): SceneDrawable {
    return { kind: 'scene', items: this.drawItems() };
  }

  get attachmentCount(): number {
    return this.records.size;
  }

  /** Sends every attachment the current state of its target. */
  updateAttachments(time: number, onError: (error: unknown) => void): void {
    for (const record of [...this.records]) {
      if (!record.attached) continue;
      const node = record.target;
      const { offset, inheritRotation = true, inheritScale = true } = record.options;
      const point = node.localToWorld(offset ?? { x: 0, y: 0 });
      const scale = inheritScale ? node.getWorldScale() : { scaleX: 1, scaleY: 1 };
      const state: AttachmentState = {
        time,
        x: point.x,
        y: point.y,
        rotation: inheritRotation ? node.getWorldRotation() : 0,
        scaleX: scale.scaleX,
        scaleY: scale.scaleY,
        opacity: node.worldOpacity,
        visible: node.worldVisible,
        inScene: node.inScene,
      };
      try {
        record.attachment.update(state);
      } catch (error) {
        onError(error);
      }
    }
  }

  /** @internal */
  attachmentAdded(record: AttachmentRecord): void {
    this.records.add(record);
  }

  /** @internal */
  attachmentRemoved(record: AttachmentRecord): void {
    this.records.delete(record);
  }

  /** Destroys every node and ends every attachment with `reason`. */
  dispose(reason: DetachReason = 'engineDisposed'): void {
    if (this.disposed) return;
    for (const record of [...this.records]) record.end(reason);
    for (const child of [...this.root.children]) child.destroyTree(reason);
    this.disposed = true;
  }

  private static validateLayers(input: readonly string[]): string[] {
    const list: unknown = input;
    if (!Array.isArray(list) || (list as unknown[]).some((l) => typeof l !== 'string' || l.length === 0)) {
      throw new InvalidOptionError('Layers must be an array of non-empty names.');
    }
    const layers = list as string[];
    if (new Set(layers).size !== layers.length) throw new InvalidOptionError('Layer names must be unique.');
    return layers.includes('default') ? [...layers] : ['default', ...layers];
  }
}
