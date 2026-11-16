import type { NodeEffect } from '../graphics/effects';
import { isParticleDrawable } from '../particles/burst';
import type { Drawable } from '../runtime/effect';
import { applyToPoint, invert, multiply } from '../scene/matrix';
import type { Matrix2D } from '../scene/matrix';
import type { SceneNode } from '../scene/node';
import { isSceneDrawable } from '../scene/scene';
import { shapeBounds } from '../scene/shape';
import type { TargetRegistry } from '../scene/targets';

/*
 * Local effects layers.
 *
 * The overlay draws every effect in one canvas above the app, positioned from measurements and
 * the transform binding on the JavaScript thread. The platform moves native views on its own
 * schedule (transforms on the UI thread, scrolling natively, Skia surfaces composited a frame
 * later), so an effect drawn in the overlay can trail a moving view by a frame or more.
 *
 * Drawables that move rigidly with a target carry `anchor` (see `Drawable.anchor`). A host that
 * renders a canvas inside the target's own view (its local layer) draws them there, in the
 * view's untransformed coordinates. The platform then moves the view and its effects in the
 * same frame: no lag behind transforms, scrolling or animations of parent views. These helpers
 * are renderer-independent so they can be tested without a device.
 */

/** Drawables rigidly attached to `node`, in draw order. */
export function anchoredTo(drawables: readonly Drawable[], node: SceneNode): Drawable[] {
  const out: Drawable[] = [];
  for (const d of drawables) if (d.anchor === node) out.push(d);
  return out;
}

/** What the overlay draws: everything except the drawables a target's local layer draws. */
export function overlayDrawables(drawables: readonly Drawable[], targets: TargetRegistry): readonly Drawable[] {
  if (targets.localLayerCount === 0) return drawables;
  return drawables.filter((d) => d.anchor === undefined || !targets.drawsLocally(d.anchor));
}

/**
 * Maps overlay coordinates to a target's local layer. `layerX`/`layerY` is the layer's top-left
 * corner in the view's own untransformed coordinates (negative when the layer extends beyond
 * the view), so the view's transform, applied by the platform, moves the layer with the view.
 * Null when the target's transform cannot be inverted (scale 0).
 */
export function localLayerMatrix(node: SceneNode, layerX: number, layerY: number): Matrix2D | null {
  const toLocal = invert(node.worldMatrix);
  if (!toLocal) return null;
  const box = node.getLocalBounds();
  const halfW = box ? box.width / 2 : 0;
  const halfH = box ? box.height / 2 : 0;
  return multiply([1, 0, 0, 1, halfW - layerX, halfH - layerY], toLocal);
}

function effectExtent(effects: readonly NodeEffect[]): number {
  let extent = 0;
  for (const e of effects) {
    if (e.type === 'glow' || e.type === 'blur') extent += e.radius * 1.5;
    else if (e.type === 'drop-shadow') extent += Math.max(Math.abs(e.dx), Math.abs(e.dy)) + e.radius * 1.5;
    else if (e.type === 'distort') extent += e.amount * 2;
  }
  return extent;
}

/**
 * How far `drawables` reach beyond the target's untransformed box, in the target's local
 * units (points before its scale). The host sizes its local layer from this. 0 when everything
 * is inside the box or the transform cannot be inverted.
 */
export function localOverflow(drawables: readonly Drawable[], node: SceneNode): number {
  const toLocal = invert(node.worldMatrix);
  if (!toLocal) return 0;
  const box = node.getLocalBounds();
  const halfW = box ? box.width / 2 : 0;
  const halfH = box ? box.height / 2 : 0;
  let overflow = 0;
  const include = (m: Matrix2D, x: number, y: number, pad: number) => {
    const p = applyToPoint(m, { x, y });
    overflow = Math.max(overflow, Math.abs(p.x) - halfW + pad, Math.abs(p.y) - halfH + pad);
  };
  for (const d of drawables) {
    if (isSceneDrawable(d)) {
      let groupPad = 0;
      const pads: number[] = [];
      for (const c of d.commands) {
        if (c.op === 'begin-group') {
          const pad = effectExtent(c.effects);
          pads.push(pad);
          groupPad += pad;
        } else if (c.op === 'end-group') {
          groupPad -= pads.pop() ?? 0;
        } else {
          const item = c.item;
          const b = shapeBounds(item.shape);
          const stroke = item.shape.type !== 'image' && item.shape.stroke ? item.shape.stroke.width / 2 : 0;
          const m = multiply(toLocal, item.matrix);
          const pad = groupPad + stroke * Math.hypot(m[0], m[1]);
          include(m, b.x, b.y, pad);
          include(m, b.x + b.width, b.y, pad);
          include(m, b.x, b.y + b.height, pad);
          include(m, b.x + b.width, b.y + b.height, pad);
        }
      }
    } else if (isParticleDrawable(d)) {
      const m = d.matrix ? multiply(toLocal, d.matrix) : toLocal;
      const scale = Math.hypot(m[0], m[1]);
      for (let i = 0; i < d.count; i++) {
        if (d.alive[i] !== 1) continue;
        const streak = d.vx && d.vy ? Math.hypot(d.vx[i] ?? 0, d.vy[i] ?? 0) * (d.stretch ?? 0) : 0;
        include(m, d.x[i] ?? 0, d.y[i] ?? 0, ((d.radius[i] ?? 0) * 2 + streak) * scale);
      }
    }
  }
  return Math.max(0, overflow);
}
