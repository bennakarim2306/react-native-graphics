import { DisposedError, InvalidOptionError } from '../runtime/errors';
import { AssetLoadError, AssetManager } from './assets';
import { FakeLoader, settle } from './__tests__/fakeLoader';

const MB = 1024 * 1024;

function setup(options: { maxBytes?: number; sizes?: ConstructorParameters<typeof FakeLoader>[0] } = {}) {
  const loader = new FakeLoader(options.sizes);
  const errors: unknown[] = [];
  const assets = new AssetManager({ loader, onError: (e) => errors.push(e), ...(options.maxBytes ? { maxBytes: options.maxBytes } : {}) });
  return { loader, assets, errors };
}

describe('AssetManager', () => {
  it('registers, loads and returns images by stable id', async () => {
    const { assets, loader } = setup();
    assets.register('hero', 'hero.png');
    expect(assets.state('hero')).toBe('registered');
    const promise = assets.loadImage('hero');
    expect(assets.state('hero')).toBe('loading');
    const hero = await promise;
    expect(hero).toMatchObject({ kind: 'image', id: 'hero', width: 8, height: 8, byteSize: 256, disposed: false });
    expect(assets.state('hero')).toBe('loaded');
    expect(assets.get('hero')).toBe(hero);
    expect(loader.loads).toBe(1);
  });

  it('loads several assets from an id → source map in one call', async () => {
    const { assets } = setup();
    const loaded = await assets.load({ a: 'a.png', b: 'b.png' });
    expect(Object.keys(loaded)).toEqual(['a', 'b']);
    expect(loaded.a.id).toBe('a');
    expect(assets.stats).toEqual({ registered: 2, loaded: 2, loading: 0, bytes: 512 });
  });

  it('dedupes concurrent loads and reuses the cached image afterwards', async () => {
    const { assets, loader } = setup();
    loader.manual = true;
    assets.register('x', 'x.png');
    const p1 = assets.loadImage('x');
    const p2 = assets.loadImage('x');
    const p3 = assets.load(['x']);
    expect(p1).toBe(p2);
    loader.flush();
    const [a, b, c] = await Promise.all([p1, p2, p3]);
    expect(a).toBe(b);
    expect(c.x).toBe(a);
    expect(await assets.loadImage('x')).toBe(a);
    expect(loader.loads).toBe(1);
  });

  it('rejects with AssetLoadError, records the error, and can retry', async () => {
    let fail = true;
    const { assets, loader, errors } = setup({ sizes: () => (fail ? new Error('404') : { width: 2, height: 2 }) });
    const events: string[] = [];
    assets.on('error', (e) => events.push(`${e.id}:${e.error.message}`));
    assets.register('bad', 'bad.png');
    await expect(assets.loadImage('bad')).rejects.toBeInstanceOf(AssetLoadError);
    expect(assets.state('bad')).toBe('error');
    expect(assets.error('bad')?.message).toBe('Could not load asset "bad": 404');
    expect(events).toEqual(['bad:Could not load asset "bad": 404']);
    fail = false;
    await expect(assets.loadImage('bad')).resolves.toMatchObject({ width: 2 });
    expect(assets.error('bad')).toBeNull();
    expect(loader.loads).toBe(2);
    expect(errors).toEqual([]);
  });

  it('rejects images without a size and unknown ids', async () => {
    const { assets } = setup({ sizes: () => ({ width: 0, height: 0 }) });
    assets.register('empty', 'e.png');
    await expect(assets.loadImage('empty')).rejects.toThrow('decoded image has no size');
    await expect(assets.loadImage('nope')).rejects.toBeInstanceOf(InvalidOptionError);
    expect(() => assets.get('nope')).toThrow('not loaded');
  });

  it('fails clearly without a loader', async () => {
    const assets = new AssetManager();
    assets.register('a', 'a.png');
    await expect(assets.loadImage('a')).rejects.toThrow('No image loader');
  });

  it('validates registrations', () => {
    const { assets } = setup();
    expect(() => { assets.register('', 'x'); }).toThrow(InvalidOptionError);
    expect(() => { assets.register('a', null); }).toThrow(InvalidOptionError);
    assets.register('a', 'a.png');
    assets.register('a', 'a.png'); // same source: no-op
    expect(() => new AssetManager({ maxBytes: 0 })).toThrow(InvalidOptionError);
  });

  it('refuses to re-register a loaded id with another source', async () => {
    const { assets } = setup();
    await assets.load({ a: 'a.png' });
    expect(() => { assets.register('a', 'other.png'); }).toThrow('already registered');
    assets.unload('a');
    assets.register('a', 'other.png');
    expect((await assets.loadImage('a')).id).toBe('a');
  });

  it('never frees retained images on unload unless forced', async () => {
    const { assets, loader } = setup();
    const { a } = await assets.load({ a: 'a.png' });
    a.retain();
    expect(() => { assets.unload('a'); }).toThrow('still in use (1 holders)');
    a.release();
    a.release(); // extra releases are ignored
    expect(a.refCount).toBe(0);
    assets.unload('a');
    expect(a.disposed).toBe(true);
    expect(a.native).toBeUndefined();
    expect(() => { a.retain(); }).toThrow(DisposedError);
    expect(loader.releases).toBe(1);
    expect(assets.state('a')).toBe('registered');
    // Loads again after unload.
    expect((await assets.loadImage('a')).disposed).toBe(false);
    expect(loader.loads).toBe(2);
  });

  it('force-unloads images in use and remove() forgets the id', async () => {
    const { assets, loader } = setup();
    const { a } = await assets.load({ a: 'a.png' });
    a.retain();
    assets.remove('a', { force: true });
    expect(a.disposed).toBe(true);
    expect(assets.has('a')).toBe(false);
    expect(loader.live.size).toBe(0);
  });

  it('discards and frees a load that finishes after unload', async () => {
    const { assets, loader } = setup();
    loader.manual = true;
    assets.register('slow', 'slow.png');
    const promise = assets.loadImage('slow');
    assets.unload('slow');
    loader.flush();
    await expect(promise).rejects.toThrow('unloaded while loading');
    expect(loader.loads).toBe(1);
    expect(loader.releases).toBe(1);
    expect(loader.live.size).toBe(0);
    expect(assets.state('slow')).toBe('registered');
  });

  it('evicts unreferenced images least-recently-used first when over budget', async () => {
    // 512x512 RGBA = 1 MiB per image, budget 2.5 MiB.
    const { assets, loader } = setup({ maxBytes: 2.5 * MB, sizes: () => ({ width: 512, height: 512 }) });
    const unloaded: string[] = [];
    assets.on('unload', (e) => unloaded.push(`${e.id}:${e.reason}`));
    const { a } = await assets.load({ a: 'a' });
    await assets.load({ b: 'b' });
    a.retain(); // in use: never evicted
    await assets.load({ c: 'c' }); // 3 MiB: evict the least recently used unreferenced image
    expect(unloaded).toEqual(['b:evicted']);
    await assets.load({ d: 'd' }); // 3 MiB again: c is the only candidate (d was just loaded)
    expect(unloaded).toEqual(['b:evicted', 'c:evicted']);
    expect(assets.state('a')).toBe('loaded');
    expect(assets.stats.bytes).toBe(2 * MB);
    a.release(); // a becomes evictable; releasing counts as a use
    await assets.load({ e: 'e' }); // d is now older than a
    expect(unloaded).toEqual(['b:evicted', 'c:evicted', 'd:evicted']);
    expect(assets.stats.bytes).toBe(2 * MB);
    expect(loader.live.size).toBe(2);
  });

  it('manages images added from elsewhere and forgets them once freed', () => {
    const { assets, loader } = setup();
    const native = { source: 'procedural', serial: 0, released: false };
    loader.live.add(native);
    const asset = assets.addImage('gen', { native, width: 4, height: 4 });
    expect(assets.get('gen')).toBe(asset);
    expect(() => assets.addImage('gen', { native, width: 1, height: 1 })).toThrow('already exists');
    assets.unload('gen');
    expect(assets.has('gen')).toBe(false);
    expect(native.released).toBe(true);
  });

  it('disposes every image, including retained ones, and rejects later calls', async () => {
    const { assets, loader } = setup();
    const { a } = await assets.load({ a: 'a', b: 'b' });
    a.retain();
    assets.dispose();
    assets.dispose(); // idempotent
    expect(a.disposed).toBe(true);
    expect(loader.live.size).toBe(0);
    expect(() => { assets.register('c', 'c'); }).toThrow(DisposedError);
    expect(() => assets.loadImage('a')).toThrow(DisposedError);
  });

  it('stress: 200 load/unload cycles leave no native image behind', async () => {
    const { assets, loader } = setup();
    assets.register('cycle', 'cycle.png');
    for (let i = 0; i < 200; i++) {
      const asset = await assets.loadImage('cycle');
      asset.retain();
      asset.release();
      assets.unload('cycle');
    }
    expect(loader.loads).toBe(200);
    expect(loader.releases).toBe(200);
    expect(loader.live.size).toBe(0);
    await settle();
  });

  it('stress: repeated scene-style usage of 50 assets keeps one decode per asset', async () => {
    const { assets, loader } = setup();
    const ids = Array.from({ length: 50 }, (_, i) => `img${String(i)}`);
    for (const id of ids) assets.register(id, `${id}.png`);
    for (let round = 0; round < 10; round++) {
      const loaded = await assets.load(ids);
      const held = ids.map((id) => loaded[id]);
      for (const asset of held) asset?.retain();
      for (const asset of held) asset?.release();
    }
    expect(loader.loads).toBe(50);
    expect(assets.stats.loaded).toBe(50);
  });
});
