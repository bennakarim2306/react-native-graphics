import { glowBorder } from '../effects/border';
import { energyShader } from '../graphics/shader';
import { VirtualClock } from '../runtime/clock';
import { InvalidOptionError } from '../runtime/errors';
import { LocalTimer } from '../runtime/timer';
import { Scene } from '../scene/scene';
import { TargetRegistry } from '../scene/targets';
import { createEngine } from './engine';

describe('LocalTimer rate', () => {
  it('keeps local time continuous across rate changes, pauses and seeks', () => {
    const timer = new LocalTimer(1000);
    expect(timer.local(1100)).toBe(100);
    timer.setRate(1100, 3);
    expect(timer.local(1100)).toBe(100);
    expect(timer.local(1200)).toBe(400);
    timer.pause(1200);
    timer.setRate(1300, 0.5); // while paused: no jump
    expect(timer.local(5000)).toBe(400);
    timer.resume(1400);
    expect(timer.local(1600)).toBe(500);
    timer.seek(1600, 0);
    expect(timer.local(1800)).toBe(100);
    expect(timer.rate).toBe(0.5);
    expect(() => { timer.setRate(0, NaN); }).toThrow(InvalidOptionError);
  });
});

describe('Playback speed', () => {
  it('scales tweens and timelines, including marker timing', () => {
    const clock = new VirtualClock();
    const engine = createEngine({ clock });
    const node = engine.scene.createNode();
    const tl = engine.timeline();
    tl.add(engine.animate(node, { x: 100, duration: 1000 }));
    tl.mark('half', 500);
    const playback = tl.play();
    const markerTimes: number[] = [];
    playback.onMarker('half', () => markerTimes.push(clock.now()));
    playback.speed = 2;
    clock.advance(200);
    expect(node.x).toBe(40);
    clock.advance(100);
    expect(markerTimes).toEqual([300]);
    playback.speed = 0.25;
    clock.advance(400);
    expect(node.x).toBe(70);
  });
});

describe('Engine frames for animated graphics', () => {
  it('keeps requesting frames while a shader-filled node is visible', () => {
    const clock = new VirtualClock();
    const engine = createEngine({ clock });
    const node = engine.scene.createNode({ shape: { type: 'rect', width: 10, height: 10, fill: { type: 'shader', shader: energyShader } } });
    clock.advance(16);
    clock.advance(16);
    expect(clock.subscriberCount).toBe(1);
    node.visible = false;
    clock.advance(16);
    clock.advance(16);
    expect(clock.subscriberCount).toBe(0);
  });

  it('publishes empty groups only when they draw something', () => {
    const clock = new VirtualClock();
    const engine = createEngine({ clock });
    engine.scene.createNode({ effects: [{ type: 'blur', radius: 2 }] });
    clock.advance(16);
    // A layer group with nothing inside is still a (cheap) command list.
    expect(engine.drawables).toHaveLength(1);
  });

  it('attach() resolves target ids and nodes', () => {
    const clock = new VirtualClock();
    const engine = createEngine({ clock, effects: [glowBorder] });
    const node = engine.targets.register('badge');
    engine.targets.updateWindowLayout('badge', { x: 0, y: 0, width: 20, height: 20 });
    expect(engine.attach('badge', 'glow-border', {}).status).toBe('playing');
    expect(engine.attach(node, glowBorder, { color: '#F00' }).status).toBe('playing');
    expect(engine.scene.attachmentCount).toBe(2);
    expect(() => engine.attach('nope', 'glow-border', {})).toThrow(InvalidOptionError);
    engine.dispose();
    expect(engine.targets.ids).toEqual([]);
  });
});

describe('TargetRegistry', () => {
  it('converts window rects to overlay coordinates and applies known transforms', () => {
    const scene = new Scene();
    const targets = new TargetRegistry(scene);
    const layouts: string[] = [];
    targets.on('layout', (e) => layouts.push(e.id));
    const node = targets.register('a');
    expect(targets.isMeasured('a')).toBe(false);
    expect(targets.layout('a')).toBeUndefined();
    targets.setOrigin({ x: 10, y: 20 });
    targets.updateWindowLayout('a', { x: 60, y: 120, width: 40, height: 20 }, { rotation: 15, scaleX: 2, scaleY: 2 });
    expect(targets.layout('a')).toEqual({ x: 50, y: 100, width: 40, height: 20, rotation: 15, scaleX: 2, scaleY: 2 });
    expect(node.getWorldPosition()).toEqual({ x: 70, y: 110 });
    expect(node.rotation).toBe(15);
    expect(node.size).toEqual({ width: 40, height: 20 });
    targets.setOrigin({ x: 0, y: 0 });
    expect(node.getWorldPosition()).toEqual({ x: 80, y: 130 });
    expect(layouts).toEqual(['a', 'a']);
  });

  it('ignores invalid measurements and unknown ids, rejects duplicates', () => {
    const targets = new TargetRegistry(new Scene());
    targets.register('a');
    targets.updateWindowLayout('a', { x: NaN, y: 0, width: 1, height: 1 });
    targets.updateWindowLayout('b', { x: 0, y: 0, width: 1, height: 1 });
    expect(targets.isMeasured('a')).toBe(false);
    expect(() => targets.register('a')).toThrow('already registered');
    expect(() => targets.register('')).toThrow(InvalidOptionError);
    expect(() => { targets.setOrigin({ x: Infinity, y: 0 }); }).toThrow(InvalidOptionError);
  });

  it('destroys proxy nodes on unregister so attachments end', () => {
    const scene = new Scene();
    const targets = new TargetRegistry(scene);
    const node = targets.register('a');
    const reasons: string[] = [];
    node.attach({ update: () => undefined, onDetach: (r) => reasons.push(r) });
    const removed: string[] = [];
    targets.on('removed', (e) => removed.push(e.id));
    targets.unregister('a');
    targets.unregister('a');
    expect(node.destroyed).toBe(true);
    expect(reasons).toEqual(['targetDestroyed']);
    expect(removed).toEqual(['a']);
    targets.dispose();
    expect(() => targets.register('b')).toThrow('disposed');
  });

  it('broadcasts remeasure requests', () => {
    const targets = new TargetRegistry(new Scene());
    const ids: (string | null)[] = [];
    targets.on('remeasure', (e) => ids.push(e.id));
    targets.requestRemeasure();
    targets.requestRemeasure('x');
    expect(ids).toEqual([null, 'x']);
  });
});
