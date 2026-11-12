import type { Drawable } from '../runtime/effect';
import { InvalidOptionError } from '../runtime/errors';
import type { AttachmentState, DetachReason } from './attachment';
import type { Matrix2D } from './matrix';
import { AttachmentRecord, SceneNode } from './node';
import type { NodeOptions, SceneHost } from './node';
import type { NodeShape } from './shape';
import type { BlendMode } from '../graphics/paint';
import type { NodeEffect } from '../graphics/effects';

/** One shape to draw, already in scene coordinates. */
export interface SceneDrawItem {
  readonly nodeId: number;
  readonly matrix: Matrix2D;
  /** World opacity in [0, 1]. */
  readonly opacity: number;
  readonly shape: NodeShape;
  /** Blend mode of the shape. `normal` when the node composites through its own layer. */
  readonly blendMode: BlendMode;
}

/**
 * Opens a group around a node's own shape and its same-layer descendants: optionally clips to
 * the node's shape outline, optionally draws into an offscreen layer that is filtered by
 * `effects` and composited with `blendMode`.
 */
export interface SceneGroupCommand {
  readonly op: 'begin-group';
  readonly nodeId: number;
  /** Clip outline in the node's local space, placed by `clipMatrix`. */
  readonly clip: NodeShape | null;
  readonly clipMatrix: Matrix2D;
  /** True when the group needs an offscreen layer (effects, group flag or a layer blend mode). */
  readonly layer: boolean;
  readonly effects: readonly NodeEffect[];
  readonly blendMode: BlendMode;
}

/** Display-list command. Every `begin-group` is closed by an `end-group`. */
export type SceneCommand =
  | { readonly op: 'draw'; readonly item: SceneDrawItem }
  | SceneGroupCommand
  | { readonly op: 'end-group'; readonly nodeId: number };

/** Drawable produced by the scene each frame. */
export interface SceneDrawable extends Drawable {
  readonly kind: 'scene';
  /** Engine time in ms, used for animated (shader) fills. */
  readonly time: number;
  /** Visible shapes in draw order (without grouping information). */
  readonly items: readonly SceneDrawItem[];
  /** Display list: shapes plus clip and layer groups, in draw order. Renderers draw this. */
  readonly commands: readonly SceneCommand[];
}

function usesShader(shape: NodeShape): boolean {
  if (shape.type === 'image') return false;
  const fill = shape.fill;
  return (
    (typeof fill === 'object' && fill.type === 'shader') ||
    (shape.stroke !== undefined && typeof shape.stroke.fill === 'object' && shape.stroke.fill.type === 'shader')
  );
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
  private animated = false;

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

  /**
   * @internal Adds a node built outside `createNode` (for example a sprite) to `parent` or the
   * root; null leaves it detached.
   */
  insert<T extends SceneNode>(node: T, parent: SceneNode | null | undefined): T {
    if (this.disposed) throw new InvalidOptionError('The scene has been disposed.');
    const target = parent === undefined ? this.root : parent;
    if (target) target.addChild(node);
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
    return this.drawable().items as SceneDrawItem[];
  }

  /**
   * True when the last drawable contained a shader fill, which changes with time and therefore
   * needs a new frame even when nothing else moves.
   */
  get hasAnimatedContent(): boolean {
    return this.animated;
  }

  /** The scene as one drawable: display list plus the flat list of shapes. */
  drawable(time = 0): SceneDrawable {
    const buckets = new Map<string, SceneCommand[]>();
    const bucketFor = (layer: string): SceneCommand[] => {
      let bucket = buckets.get(layer);
      if (!bucket) {
        bucket = [];
        buckets.set(layer, bucket);
      }
      return bucket;
    };
    let animated = false;
    const visit = (node: SceneNode, opacity: number, layer: string): void => {
      if (!node.visible) return;
      const worldOpacity = opacity * Math.min(1, Math.max(0, node.opacity));
      if (worldOpacity <= 0) return;
      const nodeLayer = node.layer ?? layer;
      const bucket = bucketFor(nodeLayer);
      const shape = node.shape;
      const effects = node.effects;
      const needsLayer = effects.length > 0 || node.group;
      const clip = node.clipChildren && shape ? shape : null;
      const grouped = needsLayer || clip !== null;
      if (grouped) {
        bucket.push({
          op: 'begin-group',
          nodeId: node.id,
          clip,
          clipMatrix: node.worldMatrix,
          layer: needsLayer,
          effects,
          blendMode: needsLayer ? node.blendMode : 'normal',
        });
      }
      if (shape) {
        if (usesShader(shape)) animated = true;
        bucket.push({
          op: 'draw',
          item: {
            nodeId: node.id,
            matrix: node.worldMatrix,
            opacity: worldOpacity,
            shape,
            blendMode: needsLayer ? 'normal' : node.blendMode,
          },
        });
      }
      const children = node.children;
      if (children.length > 0) {
        const sorted = [...children].sort((a, b) => a.zIndex - b.zIndex || a.order - b.order);
        for (const child of sorted) visit(child, worldOpacity, nodeLayer);
      }
      if (grouped) bucket.push({ op: 'end-group', nodeId: node.id });
    };
    visit(this.root, 1, this.root.layer ?? 'default');
    const commands: SceneCommand[] = [];
    const items: SceneDrawItem[] = [];
    for (const layer of this.layerNames) {
      for (const command of buckets.get(layer) ?? []) {
        commands.push(command);
        if (command.op === 'draw') items.push(command.item);
      }
    }
    this.animated = animated;
    return { kind: 'scene', time, items, commands };
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
      const bounds = node.getLocalBounds();
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
        width: bounds?.width ?? 0,
        height: bounds?.height ?? 0,
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
