import { DisposedError, InvalidOptionError } from '../runtime/errors';
import type { Attachment, AttachmentState, DetachReason } from './attachment';
import { createHostViewBinding, syncNodeToLayout } from './host';
import { composeTransform, invert, multiply } from './matrix';
import { Scene } from './scene';

const rect = (color = '#fff') => ({ type: 'rect' as const, width: 20, height: 10, color });

function close(p: { x: number; y: number }, x: number, y: number) {
  expect(p.x).toBeCloseTo(x, 9);
  expect(p.y).toBeCloseTo(y, 9);
}

describe('matrix', () => {
  it('composes translate · rotate · scale and inverts', () => {
    const m = composeTransform(10, 20, 90, 2, 3);
    const inv = invert(m);
    expect(inv).not.toBeNull();
    const id = multiply(m, inv ?? m);
    [1, 0, 0, 1, 0, 0].forEach((v, i) => {
      expect(id[i]).toBeCloseTo(v, 12);
    });
    expect(invert(composeTransform(0, 0, 0, 0, 1))).toBeNull();
  });
});

describe('Scene hierarchy', () => {
  it('creates nodes under the root and manages parents and children', () => {
    const scene = new Scene();
    const a = scene.createNode({ name: 'a' });
    const b = scene.createNode({ name: 'b', parent: a });
    const loose = scene.createNode({ name: 'loose', parent: null });
    expect(a.parent).toBe(scene.root);
    expect(b.parent).toBe(a);
    expect(loose.inScene).toBe(false);
    expect(scene.nodeCount).toBe(2);
    expect(scene.findByName('b')).toBe(b);
    a.addChild(loose);
    expect(loose.inScene).toBe(true);
    expect(a.children).toEqual([b, loose]);
    b.removeFromParent();
    expect(b.parent).toBeNull();
    expect(b.inScene).toBe(false);
    expect(() => b.addChild(b)).toThrow(InvalidOptionError);
    b.addChild(a); // moves a (and loose) under the detached b
    expect(a.inScene).toBe(false);
    expect(() => a.addChild(b)).toThrow('descendant');
    expect(() => { scene.root.destroy(); }).toThrow(InvalidOptionError);
    expect(() => new Scene().root.addChild(a)).toThrow('different scenes');
  });

  it('destroys subtrees, ends their attachments and rejects further use', () => {
    const scene = new Scene();
    const parent = scene.createNode();
    const child = scene.createNode({ parent });
    const reasons: DetachReason[] = [];
    child.attach({ update: () => undefined, onDetach: (r) => reasons.push(r) });
    parent.destroy();
    parent.destroy();
    expect(parent.destroyed && child.destroyed).toBe(true);
    expect(reasons).toEqual(['targetDestroyed']);
    expect(scene.nodeCount).toBe(0);
    expect(scene.attachmentCount).toBe(0);
    expect(() => parent.addChild(scene.createNode())).toThrow(DisposedError);
    child.x = 5; // property writes on destroyed nodes are harmless
    child.setProperty('x', 9);
    expect(child.x).toBe(5);
  });

  it('validates node options', () => {
    const scene = new Scene();
    expect(() => scene.createNode({ x: Number.NaN })).toThrow(InvalidOptionError);
    expect(() => scene.createNode({ layer: 'nope' })).toThrow('Unknown layer');
    expect(() => scene.createNode({ shape: { type: 'rect', width: -1, height: 1, color: 'red' } })).toThrow(InvalidOptionError);
    expect(() => scene.createNode({ shape: { type: 'blob' } as never })).toThrow(InvalidOptionError);
    expect(() => new Scene({ layers: ['a', 'a'] })).toThrow(InvalidOptionError);
  });
});

describe('Scene transforms and coordinates', () => {
  it('combines parent and child transforms', () => {
    const scene = new Scene();
    const parent = scene.createNode({ x: 100, y: 50, rotation: 90, scale: 2 });
    const child = scene.createNode({ parent, x: 10, y: 0 });
    // child's local (10, 0) → rotate 90° → (0, 10) → scale 2 → (0, 20) → + (100, 50)
    close(child.getWorldPosition(), 100, 70);
    expect(child.getWorldRotation()).toBeCloseTo(90, 9);
    expect(child.getWorldScale().scaleX).toBeCloseTo(2, 9);
    close(child.localToWorld({ x: 5, y: 0 }), 100, 80);
    close(child.worldToLocal({ x: 100, y: 80 }), 5, 0);
    const other = scene.createNode({ x: 100, y: 100 });
    close(child.localToNode({ x: 0, y: 0 }, other), 0, -30);
  });

  it('updates cached world matrices when an ancestor moves', () => {
    const scene = new Scene();
    const a = scene.createNode({ x: 10 });
    const b = scene.createNode({ parent: a, x: 10 });
    const c = scene.createNode({ parent: b, x: 10 });
    close(c.getWorldPosition(), 30, 0);
    a.x = 100;
    close(c.getWorldPosition(), 120, 0);
    b.rotation = 180;
    close(c.getWorldPosition(), 100, 0);
    a.removeChild(b);
    close(c.getWorldPosition(), 0, 0);
  });

  it('computes world opacity, visibility and bounds', () => {
    const scene = new Scene();
    const a = scene.createNode({ opacity: 0.5 });
    const b = scene.createNode({ parent: a, opacity: 0.5, x: 100, y: 100, rotation: 90, shape: rect() });
    expect(b.worldOpacity).toBe(0.25);
    expect(b.worldVisible).toBe(true);
    a.visible = false;
    expect(b.worldVisible).toBe(false);
    const bounds = b.getWorldBounds();
    expect(bounds?.x).toBeCloseTo(95, 9);
    expect(bounds?.y).toBeCloseTo(90, 9);
    expect(bounds?.width).toBeCloseTo(10, 9);
    expect(bounds?.height).toBeCloseTo(20, 9);
    expect(a.getWorldBounds()).toBeNull();
  });

  it('throws from worldToLocal when scale 0 makes it undefined', () => {
    const scene = new Scene();
    const node = scene.createNode({ scale: 0 });
    expect(() => node.worldToLocal({ x: 1, y: 1 })).toThrow(InvalidOptionError);
  });

  it('syncs a node to a host view layout', () => {
    const scene = new Scene();
    const binding = createHostViewBinding(scene.createNode());
    binding.update({ x: 10, y: 20, width: 100, height: 40, rotation: 15 });
    close(binding.node.getWorldPosition(), 60, 40);
    expect(binding.node.rotation).toBe(15);
    binding.dispose();
    expect(binding.node.destroyed).toBe(true);
    binding.update({ x: 0, y: 0, width: 0, height: 0 }); // ignored after dispose
    syncNodeToLayout(scene.createNode(), { x: 0, y: 0, width: 2, height: 2, scaleX: 3, scaleY: 4 });
  });
});

describe('Scene draw order', () => {
  it('orders by layer, then depth-first with zIndex and insertion order among siblings', () => {
    const scene = new Scene({ layers: ['background', 'default', 'fx'] });
    const a = scene.createNode({ name: 'a', shape: rect() });
    const b = scene.createNode({ name: 'b', shape: rect(), zIndex: -1 });
    const a1 = scene.createNode({ name: 'a1', parent: a, shape: rect() });
    const c = scene.createNode({ name: 'c', shape: rect(), layer: 'fx' });
    const d = scene.createNode({ name: 'd', shape: rect(), layer: 'background' });
    const c1 = scene.createNode({ name: 'c1', parent: c, shape: rect() }); // inherits fx
    const e = scene.createNode({ name: 'e', shape: rect() });
    const names = () => scene.drawItems().map((item) => [a, b, a1, c, d, c1, e].find((n) => n.id === item.nodeId)?.name);
    expect(names()).toEqual(['d', 'b', 'a', 'a1', 'e', 'c', 'c1']);
    e.zIndex = -5;
    a.zIndex = 10;
    expect(names()).toEqual(['d', 'e', 'b', 'a', 'a1', 'c', 'c1']);
  });

  it('skips hidden and fully transparent subtrees and multiplies opacity', () => {
    const scene = new Scene();
    const group = scene.createNode({ opacity: 0.5 });
    scene.createNode({ parent: group, shape: rect(), opacity: 0.5 });
    const hidden = scene.createNode({ visible: false });
    scene.createNode({ parent: hidden, shape: rect() });
    scene.createNode({ opacity: 0, shape: rect() });
    const items = scene.drawItems();
    expect(items).toHaveLength(1);
    expect(items[0]?.opacity).toBe(0.25);
  });

  it('marks itself dirty on changes and notifies once until cleaned', () => {
    const onChange = jest.fn();
    const scene = new Scene({}, onChange);
    scene.markClean();
    const node = scene.createNode();
    node.x = 5;
    node.y = 6;
    expect(onChange).toHaveBeenCalledTimes(1);
    scene.markClean();
    node.x = 5; // no change
    expect(scene.isDirty).toBe(false);
    node.opacity = 0.3;
    expect(scene.isDirty).toBe(true);
  });

  it('refuses to remove a layer that is still in use', () => {
    const scene = new Scene({ layers: ['fx'] });
    scene.createNode({ layer: 'fx' });
    expect(() => {
      scene.setLayers(['default']);
    }).toThrow('still used');
    expect(scene.layers).toEqual(['default', 'fx']);
  });
});

describe('Attachments', () => {
  function recorder() {
    const states: AttachmentState[] = [];
    const reasons: DetachReason[] = [];
    const attachment: Attachment = {
      update: (s) => states.push(s),
      onDetach: (r) => reasons.push(r),
    };
    return { attachment, states, reasons };
  }

  it('reports the world transform of the attachment point, following rotation', () => {
    const scene = new Scene();
    const parent = scene.createNode({ x: 100, y: 100 });
    const node = scene.createNode({ parent, rotation: 90 });
    const { attachment, states } = recorder();
    node.attach(attachment, { offset: { x: 10, y: 0 } });
    scene.updateAttachments(16, () => undefined);
    parent.x = 200;
    node.visible = false;
    scene.updateAttachments(32, () => undefined);
    expect(states).toHaveLength(2);
    close(states[0] ?? { x: 0, y: 0 }, 100, 110);
    expect(states[0]?.rotation).toBeCloseTo(90, 9);
    close(states[1] ?? { x: 0, y: 0 }, 200, 110);
    expect(states[1]?.visible).toBe(false);
    expect(states[1]?.time).toBe(32);
  });

  it('can ignore rotation and scale, and reports leaving the scene', () => {
    const scene = new Scene();
    const node = scene.createNode({ rotation: 45, scale: 3 });
    const { attachment, states } = recorder();
    node.attach(attachment, { inheritRotation: false, inheritScale: false });
    node.removeFromParent();
    scene.updateAttachments(0, () => undefined);
    expect(states[0]).toMatchObject({ rotation: 0, scaleX: 1, scaleY: 1, inScene: false });
  });

  it('detaches once, and reports errors from update without stopping others', () => {
    const scene = new Scene();
    const node = scene.createNode();
    const good = recorder();
    const handle = node.attach({ update: () => { throw new Error('boom'); } });
    node.attach(good.attachment);
    const errors: unknown[] = [];
    scene.updateAttachments(0, (e) => errors.push(e));
    expect(errors).toHaveLength(1);
    expect(good.states).toHaveLength(1);
    handle.detach();
    handle.detach();
    expect(handle.attached).toBe(false);
    scene.dispose();
    expect(good.reasons).toEqual(['engineDisposed']);
    expect(node.destroyed).toBe(true);
  });

  it('rejects invalid attachments', () => {
    const node = new Scene().createNode();
    expect(() => node.attach({} as Attachment)).toThrow(InvalidOptionError);
    expect(() => node.attach({ update: () => undefined }, { offset: { x: Number.NaN, y: 0 } })).toThrow(InvalidOptionError);
  });
});
