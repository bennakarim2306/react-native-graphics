import type { SceneNode } from './node';

/**
 * Layout of a host (React Native) view, in the same coordinate space as the scene: overlay
 * pixels relative to the overlay's top-left corner.
 */
export interface HostLayout {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Rotation of the host view in degrees, if the host knows it. */
  readonly rotation?: number;
  readonly scaleX?: number;
  readonly scaleY?: number;
}

/**
 * Connects a host view to a scene node so effects can follow the view. Phase 2 defines the
 * contract only; the React Native implementation (measuring views relative to the overlay,
 * following Reanimated-driven transforms) is planned for a later phase. See
 * docs/ARCHITECTURE.md, "Effects attached to React Native views".
 */
export interface HostViewBinding {
  /** Proxy node that mirrors the host view. Attach effects to it. */
  readonly node: SceneNode;
  /** Pushes a new layout, for example from `onLayout` or a measurement. */
  update(layout: HostLayout): void;
  /** Stops syncing and destroys the proxy node (its attachments end with `targetDestroyed`). */
  dispose(): void;
}

/**
 * Moves `node` so its origin is the centre of `layout` and copies rotation and scale when
 * given. Pure helper shared by host bindings and tests.
 */
export function syncNodeToLayout(node: SceneNode, layout: HostLayout): void {
  node.x = layout.x + layout.width / 2;
  node.y = layout.y + layout.height / 2;
  if (layout.rotation !== undefined) node.rotation = layout.rotation;
  if (layout.scaleX !== undefined) node.scaleX = layout.scaleX;
  if (layout.scaleY !== undefined) node.scaleY = layout.scaleY;
}

/** Creates a binding around a proxy node. Host integrations call `update` when the view moves. */
export function createHostViewBinding(node: SceneNode): HostViewBinding {
  let disposed = false;
  return {
    node,
    update(layout) {
      if (!disposed && !node.destroyed) syncNodeToLayout(node, layout);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      node.destroy();
    },
  };
}
