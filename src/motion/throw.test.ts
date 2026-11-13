import { createEngine } from '../engine/engine';
import { builtInEffects } from '../effects';
import { VirtualClock } from '../runtime/clock';
import { objectTarget } from '../animation/target';
import { ThrowMotion } from './throw';

function setup() {
  const clock = new VirtualClock(0);
  const errors: unknown[] = [];
  const engine = createEngine({ clock, effects: builtInEffects, onError: (e) => errors.push(e) });
  return { clock, engine, errors };
}

describe('ThrowMotion (analytical ballistic flight)', () => {
  it('rises to the peak, stops there, falls faster and lands at distance/drop', () => {
    const { engine } = setup();
    const node = engine.scene.createNode({ x: 100, y: 300 });
    const motion = engine.motion.throw(node, { height: 200, distance: 120, drop: 50, duration: 1000, rotation: 540 });
    expect(motion.offsetAt(0)).toEqual({ x: 0, y: -0, rotation: 0 });
    const peak = motion.offsetAt(motion.peakTime);
    expect(peak.y).toBeCloseTo(-200, 9);
    const end = motion.offsetAt(1000);
    expect(end.x).toBeCloseTo(120, 9);
    expect(end.y).toBeCloseTo(50, 9);
    expect(end.rotation).toBeCloseTo(540, 9);
    expect(motion.landingOffset).toEqual({ x: 120, y: 50 });
    // Up and down are one parabola under constant gravity: the second difference is constant.
    const y = (t: number) => motion.offsetAt(t).y;
    const h = 10;
    const accel = (t: number) => (y(t + h) - 2 * y(t) + y(t - h)) / (h / 1000) ** 2;
    expect(accel(100)).toBeCloseTo(motion.gravity, 3);
    expect(accel(800)).toBeCloseTo(motion.gravity, 3);
    // Zero vertical speed at the peak; faster at the impact than at the launch (it lands lower).
    const speed = (t: number) => Math.abs(y(t + 0.5) - y(t - 0.5));
    expect(speed(motion.peakTime)).toBeLessThan(1e-6);
    expect(speed(999.5)).toBeGreaterThan(speed(0.5));
    // The peak comes before the middle because the landing is below the start.
    expect(motion.peakTime).toBeLessThan(500);
  });

  it('takes its duration from gravity when gravity is given', () => {
    const { engine } = setup();
    const node = engine.scene.createNode();
    const motion = engine.motion.throw(node, { height: 100, gravity: 2000 });
    // Up and down from 100 pt at 2000 pt/s²: 2·sqrt(2·100/2000) s.
    expect(motion.duration).toBeCloseTo(2 * Math.sqrt(0.1) * 1000, 6);
    expect(motion.gravity).toBe(2000);
  });

  it('delivers launch, peak and impact markers with the object at those exact positions', () => {
    const { clock, engine } = setup();
    const node = engine.scene.createNode({ x: 50, y: 400, rotation: 10 });
    const seen: string[] = [];
    const playback = engine.motion.throw(node, { height: 150, distance: 80, duration: 900, rotation: 360 }).play();
    for (const name of ['launch', 'peak', 'impact']) {
      playback.onMarker(name, () => seen.push(`${name}:${node.x.toFixed(2)},${node.y.toFixed(2)}`));
    }
    clock.advance(1000, { frameMs: 33 });
    expect(seen[0]).toBe('launch:50.00,400.00');
    expect(seen[1]?.endsWith(',250.00')).toBe(true);
    expect(seen[2]).toBe('impact:130.00,400.00');
    expect(node.rotation).toBeCloseTo(370, 9);
  });

  it('is frame-rate independent', () => {
    const finals: string[] = [];
    for (const frameMs of [7, 16, 33, 250]) {
      const { clock, engine } = setup();
      const node = engine.scene.createNode({ x: 0, y: 0 });
      engine.motion.throw(node, { height: 90, distance: 40, drop: 20, duration: 700 }).play();
      clock.advance(350, { frameMs });
      finals.push(`${node.x.toFixed(6)},${node.y.toFixed(6)}`);
    }
    expect(new Set(finals).size).toBe(1);
  });

  it('cancel restores the start by default; restoreOnCancel: false keeps the current state; stop restores', () => {
    const { clock, engine } = setup();
    const a = engine.scene.createNode({ x: 10, y: 20, rotation: 5 });
    const b = engine.scene.createNode({ x: 10, y: 20 });
    const c = engine.scene.createNode({ x: 10, y: 20 });
    const pa = engine.motion.throw(a, { height: 100, duration: 500 }).play();
    const pb = engine.motion.throw(b, { height: 100, duration: 500, restoreOnCancel: false }).play();
    const pc = engine.motion.throw(c, { height: 100, duration: 500 }).play();
    clock.advance(200, { frameMs: 16 });
    pa.cancel();
    pb.cancel();
    pc.stop();
    expect([a.x, a.y, a.rotation]).toEqual([10, 20, 5]);
    expect(b.y).toBeLessThan(20);
    expect([c.x, c.y, c.rotation]).toEqual([10, 20, 0]);
  });

  it('validates its options and the target', () => {
    const { engine } = setup();
    const node = engine.scene.createNode();
    expect(() => engine.motion.throw(node, { height: 0 })).toThrow('height');
    expect(() => engine.motion.throw(node, { height: 10, drop: -20 })).toThrow('drop');
    expect(() => engine.motion.throw(node, { duration: 0 })).toThrow('duration');
    expect(() => engine.motion.throw(node, { gravity: -1 })).toThrow('gravity');
    expect(() => engine.motion.throw(node, { distance: Number.NaN })).toThrow('distance');
    expect(() => engine.motion.throw('missing', {})).toThrow('Unknown target "missing"');
    expect(() => new ThrowMotion(objectTarget({ x: 0, y: 0 }), {})).toThrow('"rotation"');
  });

  it('moves a host target through its transform binding (the proxy node follows)', () => {
    const { clock, engine } = setup();
    engine.targets.register('card');
    engine.targets.updateWindowLayout('card', { x: 100, y: 500, width: 60, height: 90 });
    const transforms: number[] = [];
    engine.targets.on('transform', (e) => transforms.push(e.transform.translateY));
    engine.motion.throw('card', { height: 200, distance: 100, duration: 800 }).play();
    clock.advance(400, { frameMs: 16 });
    const view = engine.targets.viewTransform('card');
    const node = engine.targets.node('card');
    expect(view?.translateY).toBeLessThan(-100);
    expect(node?.x).toBeCloseTo(130 + (view?.translateX ?? 0), 9);
    expect(node?.y).toBeCloseTo(545 + (view?.translateY ?? 0), 9);
    expect(node?.rotation).toBeCloseTo(view?.rotation ?? 0, 9);
    expect(transforms.length).toBeGreaterThan(10);
    // Layout stays what was measured: the transform is separate.
    expect(engine.targets.layout('card')).toMatchObject({ x: 100, y: 500, width: 60, height: 90 });
  });
});
