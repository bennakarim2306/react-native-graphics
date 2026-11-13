import type { AnimationTarget } from '../animation/target';
import { validateNodeEffect } from '../graphics/effects';
import type { NodeEffect } from '../graphics/effects';
import { validateBlendMode } from '../graphics/paint';
import type { BlendMode } from '../graphics/paint';
import { DisposedError, InvalidOptionError } from '../runtime/errors';
import type { AttachOptions, Attachment, AttachmentHandle, DetachReason } from './attachment';
import { applyToPoint, composeTransform, invert, multiply, rotationOf, scaleOf } from './matrix';
import type { Matrix2D, Point } from './matrix';
import { shapeBounds, validateShape } from './shape';
import type { NodeShape } from './shape';

export type { NodeShape } from './shape';

/** Properties of a node that animations can drive. `scale` sets both axes. */
export type NodeProperty = 'x' | 'y' | 'rotation' | 'scale' | 'scaleX' | 'scaleY' | 'opacity';

const NODE_PROPERTIES: ReadonlySet<string> = new Set<NodeProperty>([
  'x',
  'y',
  'rotation',
  'scale',
  'scaleX',
  'scaleY',
  'opacity',
]);

export interface NodeOptions {
  readonly name?: string;
  /** Position of the node's origin in its parent's coordinates. Default 0. */
  readonly x?: number;
  readonly y?: number;
  /** Degrees, clockwise on screen. Default 0. */
  readonly rotation?: number;
  /** Sets scaleX and scaleY. */
  readonly scale?: number;
  readonly scaleX?: number;
  readonly scaleY?: number;
  /** 0 to 1, multiplied with the parent's. Default 1. */
  readonly opacity?: number;
  /** Hidden nodes and their children are not drawn. Default true. */
  readonly visible?: boolean;
  /** Draw order among siblings; higher draws on top. Equal values keep insertion order. Default 0. */
  readonly zIndex?: number;
  /** Layer name; inherits the parent's layer when omitted. */
  readonly layer?: string;
  /** What the node draws: rect, circle, ellipse, path or image. */
  readonly shape?: NodeShape;
  /** How the node composites onto what is below it. Default `normal`. */
  readonly blendMode?: BlendMode;
  /**
   * Filters applied to the node and its subtree (glow, blur, drop shadow, color matrix). The
   * subtree is drawn into an offscreen layer that the filters process.
   */
  readonly effects?: readonly NodeEffect[];
  /**
   * Draws the subtree into its own layer so children's blend modes only mix inside the group.
   * Use with a child whose blend mode is `dst-in` to mask the group. Default false.
   */
  readonly group?: boolean;
  /** Clips the node's children to the node's shape outline. Default false. */
  readonly clipChildren?: boolean;
  /**
   * Logical size in points, for nodes without a shape (for example a proxy that mirrors a React
   * Native view). Used for bounds and passed to attachments.
   */
  readonly size?: { readonly width: number; readonly height: number };
  /** Parent node. Defaults to the scene root. Pass null to create a detached node. */
  readonly parent?: SceneNode | null;
}

export interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What a node needs from its scene. */
export interface SceneHost {
  markDirty(): void;
  readonly root: SceneNode;
  hasLayer(name: string): boolean;
  attachmentAdded(record: AttachmentRecord): void;
  attachmentRemoved(record: AttachmentRecord): void;
}

/** @internal */
export class AttachmentRecord implements AttachmentHandle {
  attached = true;

  constructor(
    readonly target: SceneNode,
    readonly attachment: Attachment,
    readonly options: AttachOptions,
    private readonly onDetached: (record: AttachmentRecord, reason: DetachReason) => void,
  ) {}

  detach(): void {
    this.end('detached');
  }

  end(reason: DetachReason): void {
    if (!this.attached) return;
    this.attached = false;
    this.onDetached(this, reason);
  }
}

function finite(value: number, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new InvalidOptionError(`Node ${name} must be a finite number, got ${String(value)}.`);
  }
  return value;
}

let nextNodeId = 1;

/**
 * A node of the scene graph. Its transform (position, rotation, scale) is relative to its
 * parent; world values combine all ancestors. It is renderer-independent: a renderer only
 * reads the draw list the scene produces.
 *
 * Nodes are animation targets: `engine.animate(node, { x: 100, rotation: 90 })`.
 */
export class SceneNode implements AnimationTarget<NodeProperty> {
  readonly id = nextNodeId++;
  name: string;
  private px = 0;
  private py = 0;
  private rot = 0;
  private sx = 1;
  private sy = 1;
  private alpha = 1;
  private isVisible = true;
  private z = 0;
  private ownLayer: string | undefined;
  private ownShape: NodeShape | undefined;
  private blend: BlendMode = 'normal';
  private nodeEffects: readonly NodeEffect[] = [];
  private isGroup = false;
  private clips = false;
  private ownSize: { readonly width: number; readonly height: number } | null = null;
  private parentNode: SceneNode | null = null;
  private readonly childNodes: SceneNode[] = [];
  private isDestroyed = false;
  private worldCache: Matrix2D | null = null;
  /** @internal */
  readonly attachments = new Set<AttachmentRecord>();
  /** @internal Insertion order among siblings, for stable z ordering. */
  order = 0;

  /** @internal Use `scene.createNode`. */
  constructor(
    private readonly host: SceneHost | null,
    options: NodeOptions = {},
  ) {
    this.name = options.name ?? '';
    if (options.x !== undefined) this.px = finite(options.x, 'x');
    if (options.y !== undefined) this.py = finite(options.y, 'y');
    if (options.rotation !== undefined) this.rot = finite(options.rotation, 'rotation');
    if (options.scale !== undefined) this.sx = this.sy = finite(options.scale, 'scale');
    if (options.scaleX !== undefined) this.sx = finite(options.scaleX, 'scaleX');
    if (options.scaleY !== undefined) this.sy = finite(options.scaleY, 'scaleY');
    if (options.opacity !== undefined) this.alpha = finite(options.opacity, 'opacity');
    if (options.visible !== undefined) this.isVisible = options.visible;
    if (options.zIndex !== undefined) this.z = finite(options.zIndex, 'zIndex');
    if (options.layer !== undefined) this.layer = options.layer;
    if (options.blendMode !== undefined) this.blendMode = options.blendMode;
    if (options.effects !== undefined) this.effects = options.effects;
    if (options.group !== undefined) this.isGroup = options.group;
    if (options.clipChildren !== undefined) this.clips = options.clipChildren;
    if (options.size !== undefined) this.size = options.size;
    this.shape = options.shape;
  }

  get destroyed(): boolean {
    return this.isDestroyed;
  }

  get parent(): SceneNode | null {
    return this.parentNode;
  }

  get children(): readonly SceneNode[] {
    return this.childNodes;
  }

  get isRoot(): boolean {
    return this.host !== null && this.host.root === this;
  }

  // --- Transform and appearance -------------------------------------------------------

  get x(): number {
    return this.px;
  }
  set x(value: number) {
    this.setTransform('px', value, 'x');
  }
  get y(): number {
    return this.py;
  }
  set y(value: number) {
    this.setTransform('py', value, 'y');
  }
  get rotation(): number {
    return this.rot;
  }
  set rotation(value: number) {
    this.setTransform('rot', value, 'rotation');
  }
  get scaleX(): number {
    return this.sx;
  }
  set scaleX(value: number) {
    this.setTransform('sx', value, 'scaleX');
  }
  get scaleY(): number {
    return this.sy;
  }
  set scaleY(value: number) {
    this.setTransform('sy', value, 'scaleY');
  }
  /** Reads scaleX; writing sets both axes. */
  get scale(): number {
    return this.sx;
  }
  set scale(value: number) {
    finite(value, 'scale');
    if (this.sx === value && this.sy === value) return;
    this.sx = value;
    this.sy = value;
    this.transformChanged();
  }

  /** Own opacity; values outside [0, 1] are clamped when drawing. */
  get opacity(): number {
    return this.alpha;
  }
  set opacity(value: number) {
    finite(value, 'opacity');
    if (this.alpha === value) return;
    this.alpha = value;
    this.changed();
  }

  get visible(): boolean {
    return this.isVisible;
  }
  set visible(value: boolean) {
    if (this.isVisible === value) return;
    this.isVisible = value;
    this.changed();
  }

  get zIndex(): number {
    return this.z;
  }
  set zIndex(value: number) {
    finite(value, 'zIndex');
    if (this.z === value) return;
    this.z = value;
    this.changed();
  }

  /** Own layer name, or undefined to inherit. */
  get layer(): string | undefined {
    return this.ownLayer;
  }
  set layer(value: string | undefined) {
    if (value !== undefined && this.host && !this.host.hasLayer(value)) {
      throw new InvalidOptionError(`Unknown layer "${value}". Add it with scene.setLayers([...]) first.`);
    }
    if (this.ownLayer === value) return;
    this.ownLayer = value;
    this.changed();
  }

  /** Layer used for drawing: own layer or the nearest ancestor's, else `default`. */
  get effectiveLayer(): string {
    for (const node of this.selfAndAncestors()) {
      if (node.ownLayer !== undefined) return node.ownLayer;
    }
    return 'default';
  }

  get shape(): NodeShape | undefined {
    return this.ownShape;
  }
  /**
   * Replaces the shape. An image shape retains its image asset while the node uses it, so the
   * asset cache never frees an image that is on screen.
   */
  set shape(value: NodeShape | undefined) {
    if (this.isDestroyed) throw new DisposedError(`Scene node ${this.name || String(this.id)}`);
    const next = validateShape(value);
    const previous = this.ownShape;
    const nextImage = next?.type === 'image' ? next.image : undefined;
    const previousImage = previous?.type === 'image' ? previous.image : undefined;
    if (nextImage !== previousImage) nextImage?.retain();
    this.ownShape = next;
    if (nextImage !== previousImage) previousImage?.release();
    this.changed();
  }

  get blendMode(): BlendMode {
    return this.blend;
  }
  set blendMode(value: BlendMode) {
    validateBlendMode(value);
    if (this.blend === value) return;
    this.blend = value;
    this.changed();
  }

  get effects(): readonly NodeEffect[] {
    return this.nodeEffects;
  }
  set effects(value: readonly NodeEffect[]) {
    const list: unknown = value;
    if (!Array.isArray(list)) throw new InvalidOptionError('effects must be an array.');
    for (const effect of value) validateNodeEffect(effect);
    this.nodeEffects = [...value];
    this.changed();
  }

  get group(): boolean {
    return this.isGroup;
  }
  set group(value: boolean) {
    if (this.isGroup === value) return;
    this.isGroup = value;
    this.changed();
  }

  get clipChildren(): boolean {
    return this.clips;
  }
  set clipChildren(value: boolean) {
    if (this.clips === value) return;
    this.clips = value;
    this.changed();
  }

  /** Explicit logical size, or null. */
  get size(): { readonly width: number; readonly height: number } | null {
    return this.ownSize;
  }
  set size(value: { readonly width: number; readonly height: number } | null) {
    if (value !== null) {
      if (!(Number.isFinite(value.width) && value.width >= 0 && Number.isFinite(value.height) && value.height >= 0)) {
        throw new InvalidOptionError('Node size needs finite width and height >= 0.');
      }
      if (this.ownSize?.width === value.width && this.ownSize.height === value.height) return;
      this.ownSize = { width: value.width, height: value.height };
    } else {
      if (this.ownSize === null) return;
      this.ownSize = null;
    }
    this.changed();
  }

  // --- AnimationTarget ------------------------------------------------------------------

  hasProperty(name: string): name is NodeProperty {
    return NODE_PROPERTIES.has(name);
  }

  getProperty(name: NodeProperty): number {
    return this[name];
  }

  setProperty(name: NodeProperty, value: number): void {
    if (this.isDestroyed) return;
    this[name] = value;
  }

  expandProperty(name: NodeProperty): readonly NodeProperty[] {
    return name === 'scale' ? ['scaleX', 'scaleY'] : [name];
  }

  // --- Hierarchy ------------------------------------------------------------------------

  /** Adds `child` as the last child, moving it from its previous parent. */
  addChild(child: SceneNode): this {
    this.assertAlive();
    child.assertAlive();
    if (child.host !== this.host) throw new InvalidOptionError('Nodes from different scenes cannot be combined.');
    if (child.isRoot) throw new InvalidOptionError('The scene root cannot be added to another node.');
    for (const node of this.selfAndAncestors()) {
      if (node === child) throw new InvalidOptionError('A node cannot be added to itself or its own descendant.');
    }
    child.detachFromParent();
    child.parentNode = this;
    child.order = this.childNodes.reduce((max, c) => Math.max(max, c.order), 0) + 1;
    this.childNodes.push(child);
    child.transformChanged();
    return this;
  }

  /** Removes a direct child. It stays alive and can be added again. */
  removeChild(child: SceneNode): this {
    if (child.parentNode !== this) throw new InvalidOptionError('The node is not a child of this node.');
    child.detachFromParent();
    child.transformChanged();
    this.changed();
    return this;
  }

  /** Removes this node from its parent, if any. */
  removeFromParent(): this {
    this.parentNode?.removeChild(this);
    return this;
  }

  /** True when the node is connected to the scene root. */
  get inScene(): boolean {
    if (!this.host) return false;
    let top: SceneNode | undefined;
    for (const node of this.selfAndAncestors()) top = node;
    return top === this.host.root;
  }

  /**
   * Destroys this node and its descendants: removes them from the scene, ends their
   * attachments with `targetDestroyed`, and makes animations skip them. Idempotent.
   */
  destroy(): void {
    if (this.isDestroyed) return;
    if (this.isRoot) throw new InvalidOptionError('The scene root cannot be destroyed. Dispose the engine instead.');
    this.destroyTree('targetDestroyed');
  }

  /** @internal */
  destroyTree(reason: DetachReason): void {
    for (const child of [...this.childNodes]) child.destroyTree(reason);
    for (const record of [...this.attachments]) record.end(reason);
    const parent = this.parentNode;
    this.detachFromParent();
    const shape = this.ownShape;
    this.ownShape = undefined;
    if (shape?.type === 'image') shape.image.release();
    this.onDestroy();
    this.isDestroyed = true;
    if (parent) parent.changed();
  }

  /** Visits this node and its descendants depth-first. Return false to skip a node's children. */
  traverse(visit: (node: SceneNode) => unknown): void {
    if (visit(this) === false) return;
    for (const child of [...this.childNodes]) child.traverse(visit);
  }

  // --- Coordinates ----------------------------------------------------------------------

  get localMatrix(): Matrix2D {
    return composeTransform(this.px, this.py, this.rot, this.sx, this.sy);
  }

  /** Transform from this node's local coordinates to scene coordinates. Cached. */
  get worldMatrix(): Matrix2D {
    if (!this.worldCache) {
      const local = this.localMatrix;
      this.worldCache = this.parentNode ? multiply(this.parentNode.worldMatrix, local) : local;
    }
    return this.worldCache;
  }

  localToWorld(point: Point): Point {
    return applyToPoint(this.worldMatrix, point);
  }

  /** Converts a scene point to local coordinates. Throws when a scale of 0 makes it impossible. */
  worldToLocal(point: Point): Point {
    const inverse = invert(this.worldMatrix);
    if (!inverse) throw new InvalidOptionError('worldToLocal is undefined while the node or an ancestor has scale 0.');
    return applyToPoint(inverse, point);
  }

  /** Converts a point from this node's local space to `other`'s local space. */
  localToNode(point: Point, other: SceneNode): Point {
    return other.worldToLocal(this.localToWorld(point));
  }

  getWorldPosition(): Point {
    const m = this.worldMatrix;
    return { x: m[4], y: m[5] };
  }

  getWorldRotation(): number {
    return rotationOf(this.worldMatrix);
  }

  getWorldScale(): { scaleX: number; scaleY: number } {
    return scaleOf(this.worldMatrix);
  }

  /** Product of own and ancestor opacities, clamped to [0, 1]. */
  get worldOpacity(): number {
    let value = 1;
    for (const node of this.selfAndAncestors()) {
      value *= Math.min(1, Math.max(0, node.alpha));
    }
    return value;
  }

  /** False when this node or an ancestor is hidden. */
  get worldVisible(): boolean {
    for (const node of this.selfAndAncestors()) {
      if (!node.isVisible) return false;
    }
    return true;
  }

  /**
   * Bounds of the shape in local coordinates (strokes excluded), else of the explicit `size`
   * centred on the origin, else null.
   */
  getLocalBounds(): Bounds | null {
    const shape = this.ownShape;
    if (shape) return shapeBounds(shape);
    if (this.ownSize) {
      const { width, height } = this.ownSize;
      return { x: -width / 2, y: -height / 2, width, height };
    }
    return null;
  }

  /** Axis-aligned bounds of the transformed shape in scene coordinates, or null without a shape. */
  getWorldBounds(): Bounds | null {
    const b = this.getLocalBounds();
    if (!b) return null;
    const corners = [
      this.localToWorld({ x: b.x, y: b.y }),
      this.localToWorld({ x: b.x + b.width, y: b.y }),
      this.localToWorld({ x: b.x, y: b.y + b.height }),
      this.localToWorld({ x: b.x + b.width, y: b.y + b.height }),
    ];
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
  }

  // --- Attachments ----------------------------------------------------------------------

  /** Makes `attachment` follow this node every frame until detached or the node is destroyed. */
  attach(attachment: Attachment, options: AttachOptions = {}): AttachmentHandle {
    this.assertAlive();
    if (typeof attachment.update !== 'function') {
      throw new InvalidOptionError('An attachment needs an update(state) method.');
    }
    if (options.offset) {
      finite(options.offset.x, 'offset.x');
      finite(options.offset.y, 'offset.y');
    }
    const host = this.host;
    const record = new AttachmentRecord(this, attachment, options, (r, reason) => {
      this.attachments.delete(r);
      host?.attachmentRemoved(r);
      try {
        attachment.onDetach?.(reason);
      } finally {
        host?.markDirty();
      }
    });
    this.attachments.add(record);
    host?.attachmentAdded(record);
    attachment.onAttach?.(this);
    host?.markDirty();
    return record;
  }

  // --- Internals ------------------------------------------------------------------------

  /** Hook for subclasses (sprites) to release what they hold. Called once, before destruction completes. */
  protected onDestroy(): void {
    // Nothing by default.
  }

  /** @internal Marks the scene dirty; for subclasses that change what they draw. */
  protected changed(): void {
    if (!this.isDestroyed) this.host?.markDirty();
  }

  private *selfAndAncestors(): Generator<SceneNode> {
    yield this;
    for (let node = this.parentNode; node; node = node.parentNode) yield node;
  }

  private setTransform(key: 'px' | 'py' | 'rot' | 'sx' | 'sy', value: number, name: string): void {
    finite(value, name);
    if (this[key] === value) return;
    this[key] = value;
    this.transformChanged();
  }

  private detachFromParent(): void {
    const parent = this.parentNode;
    if (!parent) return;
    const index = parent.childNodes.indexOf(this);
    if (index >= 0) parent.childNodes.splice(index, 1);
    this.parentNode = null;
  }

  /** Invalidates cached world matrices of this subtree. */
  private transformChanged(): void {
    this.invalidateWorld();
    this.changed();
  }

  private invalidateWorld(): void {
    // A clean node implies clean ancestors, so a dirty node's subtree is already dirty.
    if (this.worldCache === null) return;
    this.worldCache = null;
    for (const child of this.childNodes) child.invalidateWorld();
  }

  private assertAlive(): void {
    if (this.isDestroyed) throw new DisposedError(`Scene node ${this.name || String(this.id)}`);
  }
}
