import { createEngine } from '../engine/engine';
import { builtInEffects } from '../effects';
import { VirtualClock } from '../runtime/clock';
import { throwAndExplode } from '../engine/sequences';
import type { TargetViewTransform } from './targets';

function setup() {
  const clock = new VirtualClock(0);
  const engine = createEngine({ clock, effects: builtInEffects });
  engine.targets.setOrigin({ x: 0, y: 40 });
  engine.targets.register('card');
  engine.targets.updateWindowLayout('card', { x: 100, y: 240, width: 80, height: 120 });
  return { clock, engine };
}

const IDENTITY: TargetViewTransform = { translateX: 0, translateY: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 };

describe('target transform binding (TargetMotion)', () => {
  it('places the proxy node at the layout centre plus the motion and reports the view transform', () => {
    const { engine } = setup();
    const handle = engine.getTarget('card');
    expect(handle?.id).toBe('card');
    const node = handle?.node;
    expect([node?.x, node?.y]).toEqual([140, 260]);
    const events: TargetViewTransform[] = [];
    engine.targets.on('transform', (e) => events.push(e.transform));
    const motion = handle?.motion;
    if (!motion) throw new Error('no motion');
    motion.x = 30;
    motion.y = -20;
    motion.rotation = 45;
    motion.scale = 2;
    motion.opacity = 1.7;
    expect([node?.x, node?.y, node?.rotation, node?.scaleX, node?.scaleY, node?.opacity]).toEqual([170, 240, 45, 2, 2, 1]);
    expect(events.at(-1)).toEqual({ translateX: 30, translateY: -20, rotation: 45, scaleX: 2, scaleY: 2, opacity: 1 });
    // Layout is untouched by the motion.
    expect(engine.targets.layout('card')).toMatchObject({ x: 100, y: 200, width: 80, height: 120 });
    // A new measurement keeps the motion on top of the new layout.
    engine.targets.updateWindowLayout('card', { x: 0, y: 40, width: 80, height: 120 });
    expect([node?.x, node?.y]).toEqual([70, 40]);
    motion.reset();
    expect(engine.targets.viewTransform('card')).toEqual(IDENTITY);
    expect([node?.x, node?.y]).toEqual([40, 60]);
  });

  it('combines with rotation/scale props of the view (measured transform)', () => {
    const { engine } = setup();
    engine.targets.updateWindowLayout('card', { x: 100, y: 240, width: 80, height: 120 }, { rotation: 10, scaleX: 1.5, scaleY: 1.5 });
    const handle = engine.getTarget('card');
    if (!handle) throw new Error('no target');
    handle.motion.rotation = 20;
    handle.motion.scale = 2;
    expect(handle.node.rotation).toBe(30);
    expect(handle.node.scaleX).toBe(3);
  });

  it('is animatable with tweens like any target', () => {
    const { clock, engine } = setup();
    const motion = engine.getTarget('card')?.motion;
    if (!motion) throw new Error('no motion');
    engine.animate(motion, { x: 100, rotation: 90, scale: 0.5, duration: 200 }).play();
    clock.advance(100, { frameMs: 16 });
    expect(motion.x).toBeCloseTo(50, 9);
    clock.advance(120, { frameMs: 16 });
    expect(engine.targets.viewTransform('card')).toEqual({ translateX: 100, translateY: 0, rotation: 90, scaleX: 0.5, scaleY: 0.5, opacity: 1 });
  });

  it('offsets add to the motion and removing one restores exactly; ignores non-finite values', () => {
    const { engine } = setup();
    const motion = engine.getTarget('card')?.motion;
    if (!motion) throw new Error('no motion');
    motion.x = 10;
    const offset = engine.targets.addOffset('card');
    if (!offset) throw new Error('no offset');
    offset.x = 5;
    offset.rotation = 3;
    expect(engine.targets.viewTransform('card')).toMatchObject({ translateX: 15, rotation: 3 });
    offset.remove();
    offset.remove();
    expect(engine.targets.viewTransform('card')).toMatchObject({ translateX: 10, rotation: 0 });
    motion.x = Number.NaN;
    expect(motion.x).toBe(10);
    expect(engine.targets.addOffset('nope')).toBeNull();
  });

  it('unregistering kills the motion and offsets; a new registration starts from identity', () => {
    const { engine } = setup();
    const old = engine.getTarget('card');
    if (!old) throw new Error('no target');
    old.motion.x = 50;
    const offset = engine.targets.addOffset('card');
    engine.targets.unregister('card');
    expect(old.motion.destroyed).toBe(true);
    old.motion.x = 70;
    if (offset) offset.x = 9;
    expect(old.node.destroyed).toBe(true);
    expect(engine.getTarget('card')).toBeUndefined();
    engine.targets.register('card');
    expect(engine.targets.viewTransform('card')).toEqual(IDENTITY);
    expect(engine.targets.idOf(engine.targets.node('card') ?? old.node)).toBe('card');
    expect(engine.targets.idOf(old.node)).toBeUndefined();
  });

  it('a target handle works wherever a target id does', () => {
    const { clock, engine } = setup();
    const handle = engine.getTarget('card');
    if (!handle) throw new Error('no target');
    expect(engine.resolveTarget(handle)).toBe(handle.node);
    const fire = engine.attach(handle, { effect: 'fire-border' });
    const sparks = engine.play('golden-sparks', { target: handle, follow: true });
    expect(engine.activeCount).toBe(2);
    const seq = throwAndExplode(engine, handle, { throw: { duration: 300 }, settleDelay: 0, returnDuration: 0 });
    clock.advance(150, { frameMs: 16 });
    expect(engine.targets.viewTransform('card')?.translateY).toBeLessThan(0);
    clock.advance(3000, { frameMs: 16 });
    expect(seq.playback.status).toBe('completed');
    expect(engine.targets.viewTransform('card')).toEqual(IDENTITY);
    expect(sparks.status).toBe('completed');
    // Unmounting ends what was attached through the handle.
    // The shader flames vanish with the view at once (nothing is drawn for a destroyed node);
    // sparks already emitted in world space burn out, then the handle completes.
    engine.targets.unregister('card');
    clock.advance(16);
    expect(engine.drawables.every((d) => d.kind === 'particles')).toBe(true);
    clock.advance(1500, { frameMs: 16 });
    expect(fire.status).toBe('completed');
    expect(engine.activeCount).toBe(0);
    expect(() => engine.attach(handle, 'glow-border', {})).toThrow(/destroyed/);
  });
});
