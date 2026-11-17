import type { Point } from './matrix';
import type { SceneNode } from './node';

/** Where an attached effect should be this frame, in scene (overlay) coordinates. */
export interface AttachmentState {
  /** Engine time in ms. */
  readonly time: number;
  /** World position of the attachment point (node origin plus the transformed offset). */
  readonly x: number;
  readonly y: number;
  /** World rotation of the target in degrees. 0 when `inheritRotation` is false. */
  readonly rotation: number;
  /** World scale of the target. 1 when `inheritScale` is false. */
  readonly scaleX: number;
  readonly scaleY: number;
  /** Product of the opacities from the target up to the root. */
  readonly opacity: number;
  /** False when the target or any ancestor is hidden. */
  readonly visible: boolean;
  /** False when the target was removed from the scene (but not destroyed). */
  readonly inScene: boolean;
  /**
   * Size of the target in its local units (shape bounds, else its explicit `size`, else 0),
   * before `scaleX`/`scaleY`. Lets effects such as borders fit the target.
   */
  readonly width: number;
  readonly height: number;
}

/** Why an attachment ended. */
export type DetachReason = 'detached' | 'targetDestroyed' | 'engineDisposed';

/**
 * Something that follows a scene node, such as a future fire, glow or trail effect. The engine
 * calls `update` once per frame after animations ran, so the state is the node's final
 * transform for that frame.
 *
 * What to do when the target is hidden or leaves the scene is up to the attachment (for
 * example stop emitting but let existing particles finish).
 */
export interface Attachment {
  onAttach?(target: SceneNode): void;
  update(state: AttachmentState): void;
  /** Called exactly once. The attachment should release its resources. */
  onDetach?(reason: DetachReason): void;
}

export interface AttachOptions {
  /** Attachment point in the target's local coordinates (rotates and scales with it). */
  readonly offset?: Point;
  /** Default true. */
  readonly inheritRotation?: boolean;
  /** Default true. */
  readonly inheritScale?: boolean;
}

export interface AttachmentHandle {
  readonly target: SceneNode;
  readonly attached: boolean;
  /** Stops following. Calls `onDetach('detached')`. Idempotent. */
  detach(): void;
}
