import { AssetManager } from '../assets/assets';
import { energyShader } from '../graphics/shader';
import { PathData } from '../graphics/path';
import { InvalidOptionError } from '../runtime/errors';
import { Scene } from './scene';
import type { SceneCommand } from './scene';

const ops = (commands: readonly SceneCommand[]) =>
  commands.map((c) => (c.op === 'draw' ? `draw:${String(c.item.nodeId)}` : `${c.op}:${String(c.nodeId)}`));

describe('Scene display list', () => {
  it('wraps a node with effects, its shape and same-layer children in one layer group', () => {
    const scene = new Scene({ layers: ['default', 'top'] });
    const parent = scene.createNode({
      effects: [{ type: 'glow', color: '#FFF', radius: 5 }],
      blendMode: 'screen',
      shape: { type: 'rect', width: 10, height: 10, color: '#F00' },
    });
    const child = scene.createNode({ parent, shape: { type: 'circle', radius: 2, color: '#0F0' } });
    const escaping = scene.createNode({ parent, layer: 'top', shape: { type: 'circle', radius: 2, color: '#00F' } });
    const sibling = scene.createNode({ shape: { type: 'circle', radius: 2, color: '#00F' } });
    const { commands } = scene.drawable();
    expect(ops(commands)).toEqual([
      `begin-group:${String(parent.id)}`,
      `draw:${String(parent.id)}`,
      `draw:${String(child.id)}`,
      `end-group:${String(parent.id)}`,
      `draw:${String(sibling.id)}`,
      `draw:${String(escaping.id)}`, // other layer: drawn above, outside the group
    ]);
    const group = commands[0];
    expect(group).toMatchObject({ op: 'begin-group', layer: true, blendMode: 'screen', clip: null });
    // The layer composites with the blend mode; the shape inside draws normally.
    expect(commands[1]).toMatchObject({ item: { blendMode: 'normal' } });
  });

  it('emits clip groups without layers and uses blend modes on plain shapes', () => {
    const scene = new Scene();
    const shape = { type: 'circle', radius: 10, color: '#FFF' } as const;
    const window = scene.createNode({ x: 5, clipChildren: true, shape });
    scene.createNode({ blendMode: 'multiply', shape });
    const { commands } = scene.drawable();
    expect(commands[0]).toMatchObject({ op: 'begin-group', layer: false, clip: shape, clipMatrix: window.worldMatrix });
    expect(commands.at(-1)).toMatchObject({ op: 'draw', item: { blendMode: 'multiply' } });
    // clipChildren without a shape has nothing to clip to.
    const scene2 = new Scene();
    scene2.createNode({ clipChildren: true });
    expect(scene2.drawable().commands).toEqual([]);
  });

  it('skips hidden and fully transparent subtrees and multiplies opacity', () => {
    const scene = new Scene();
    const shape = { type: 'rect', width: 1, height: 1, color: '#FFF' } as const;
    const hidden = scene.createNode({ visible: false, shape });
    scene.createNode({ parent: hidden, shape });
    scene.createNode({ opacity: 0, effects: [{ type: 'blur', radius: 2 }], shape });
    const half = scene.createNode({ opacity: 0.5, shape });
    scene.createNode({ parent: half, opacity: 0.5, shape });
    const { items, commands } = scene.drawable();
    expect(items.map((i) => i.opacity)).toEqual([0.5, 0.25]);
    expect(commands).toHaveLength(2);
  });

  it('reports animated content for shader fills and strokes, and carries the frame time', () => {
    const scene = new Scene();
    scene.createNode({ shape: { type: 'rect', width: 1, height: 1, color: '#FFF' } });
    expect(scene.drawable(42).time).toBe(42);
    expect(scene.hasAnimatedContent).toBe(false);
    const node = scene.createNode({ shape: { type: 'rect', width: 1, height: 1, stroke: { fill: { type: 'shader', shader: energyShader }, width: 1 } } });
    scene.drawable();
    expect(scene.hasAnimatedContent).toBe(true);
    node.visible = false;
    scene.drawable();
    expect(scene.hasAnimatedContent).toBe(false);
  });
});

describe('Scene node graphics properties', () => {
  it('validates shapes, paints, blend modes, effects and sizes', () => {
    const scene = new Scene();
    expect(() => scene.createNode({ shape: { type: 'rect', width: 1, height: 1 } })).toThrow('color, fill or stroke');
    expect(() => scene.createNode({ shape: { type: 'ellipse', width: -1, height: 1, color: '#FFF' } })).toThrow(InvalidOptionError);
    expect(() => scene.createNode({ shape: { type: 'path', path: 'M 0 0' as never, color: '#FFF' } })).toThrow('PathData');
    expect(() => scene.createNode({ shape: { type: 'star' } as never })).toThrow('Unknown shape type');
    expect(() => scene.createNode({ blendMode: 'nope' as never })).toThrow('Unknown blend mode');
    expect(() => scene.createNode({ effects: [{ type: 'blur', radius: -2 }] })).toThrow('radius');
    expect(() => scene.createNode({ size: { width: -1, height: 0 } })).toThrow('size');
  });

  it('computes local bounds for every shape type and for explicit sizes', () => {
    const scene = new Scene();
    const path = new PathData().moveTo(0, 0).lineTo(10, 20);
    expect(scene.createNode({ shape: { type: 'path', path, color: '#FFF' } }).getLocalBounds()).toEqual({ x: 0, y: 0, width: 10, height: 20 });
    expect(scene.createNode({ shape: { type: 'ellipse', width: 8, height: 4, color: '#FFF' } }).getLocalBounds()).toEqual({
      x: -4,
      y: -2,
      width: 8,
      height: 4,
    });
    const proxy = scene.createNode({ x: 100, y: 50, size: { width: 40, height: 20 } });
    expect(proxy.getLocalBounds()).toEqual({ x: -20, y: -10, width: 40, height: 20 });
    expect(proxy.getWorldBounds()).toEqual({ x: 80, y: 40, width: 40, height: 20 });
    proxy.size = null;
    expect(proxy.getLocalBounds()).toBeNull();
  });

  it('retains image assets while a node shows them and releases on change and destroy', () => {
    const assets = new AssetManager();
    const a = assets.addImage('a', { native: {}, width: 10, height: 10 });
    const b = assets.addImage('b', { native: {}, width: 20, height: 10 });
    const scene = new Scene();
    const node = scene.createNode({ shape: { type: 'image', image: a, anchor: { x: 0, y: 0 } } });
    expect(a.refCount).toBe(1);
    expect(node.getLocalBounds()).toEqual({ x: 0, y: 0, width: 10, height: 10 });
    node.shape = { type: 'image', image: b, source: { x: 10, y: 0, width: 10, height: 10 }, width: 30 };
    expect([a.refCount, b.refCount]).toEqual([0, 1]);
    expect(node.getLocalBounds()).toEqual({ x: -15, y: -5, width: 30, height: 10 });
    expect(() => (node.shape = { type: 'image', image: b, source: { x: 15, y: 0, width: 10, height: 10 } })).toThrow('outside the image');
    node.destroy();
    expect(b.refCount).toBe(0);
    assets.unload('a');
    expect(() => scene.createNode({ shape: { type: 'image', image: a } })).toThrow('unloaded');
  });

  it('passes the target size to attachments', () => {
    const scene = new Scene();
    const node = scene.createNode({ size: { width: 40, height: 20 }, scale: 2 });
    const states: { width: number; height: number; scaleX: number }[] = [];
    node.attach({ update: (s) => states.push({ width: s.width, height: s.height, scaleX: s.scaleX }) });
    scene.updateAttachments(0, () => undefined);
    expect(states).toEqual([{ width: 40, height: 20, scaleX: 2 }]);
  });
});
