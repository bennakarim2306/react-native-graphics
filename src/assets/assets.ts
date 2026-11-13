import { Emitter, rethrowAsync } from '../runtime/emitter';
import type { ErrorReporter, Unsubscribe } from '../runtime/emitter';
import { DisposedError, InvalidOptionError } from '../runtime/errors';

/** What an image loader returns: a platform image (for example an `SkImage`) and its size. */
export interface LoadedImage {
  readonly native: unknown;
  readonly width: number;
  readonly height: number;
}

/**
 * Platform boundary for decoding images. The React Native integration provides a Skia
 * implementation; tests can provide their own. `release` frees the native image.
 */
export interface ImageLoader {
  load(source: unknown, id: string): Promise<LoadedImage>;
  release(native: unknown): void;
}

export type AssetState = 'registered' | 'loading' | 'loaded' | 'error';

/** A loaded image. Holders call `retain`/`release` so the cache never frees an image in use. */
export interface ImageAsset {
  readonly kind: 'image';
  readonly id: string;
  readonly width: number;
  readonly height: number;
  /** Platform image for renderers. Undefined once the asset was unloaded. */
  readonly native: unknown;
  /** Estimated decoded size in bytes (width × height × 4). */
  readonly byteSize: number;
  readonly disposed: boolean;
  readonly refCount: number;
  retain(): void;
  release(): void;
}

export class AssetLoadError extends Error {
  constructor(
    readonly assetId: string,
    override readonly cause: unknown,
  ) {
    super(`Could not load asset "${assetId}": ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'AssetLoadError';
  }
}

export interface AssetEvents {
  load: { readonly asset: ImageAsset };
  error: { readonly id: string; readonly error: AssetLoadError };
  unload: { readonly id: string; readonly reason: 'unload' | 'evicted' | 'disposed' };
}

export interface AssetManagerOptions {
  readonly loader?: ImageLoader;
  /**
   * Soft budget for decoded images in bytes. When exceeded, unreferenced images are unloaded,
   * least recently used first. Images in use are never evicted. Default 64 MiB.
   */
  readonly maxBytes?: number;
  readonly onError?: ErrorReporter;
}

interface Entry {
  readonly id: string;
  source: unknown;
  state: AssetState;
  promise: Promise<ImageAsset> | null;
  asset: ImageAssetImpl | null;
  error: AssetLoadError | null;
  lastUsed: number;
  /** Bumped by unload so a load that finishes afterwards is discarded. */
  generation: number;
  /** Added with `addImage`: cannot be reloaded, so it is forgotten when freed. */
  manual: boolean;
}

class ImageAssetImpl implements ImageAsset {
  readonly kind = 'image';
  refs = 0;
  isDisposed = false;
  private nativeImage: unknown;

  constructor(
    readonly id: string,
    loaded: LoadedImage,
    private readonly onRefsChanged: (asset: ImageAssetImpl) => void,
  ) {
    this.nativeImage = loaded.native;
    this.width = loaded.width;
    this.height = loaded.height;
    this.byteSize = Math.max(0, Math.round(loaded.width * loaded.height * 4));
  }

  readonly width: number;
  readonly height: number;
  readonly byteSize: number;

  get native(): unknown {
    return this.isDisposed ? undefined : this.nativeImage;
  }

  get disposed(): boolean {
    return this.isDisposed;
  }

  get refCount(): number {
    return this.refs;
  }

  retain(): void {
    if (this.isDisposed) throw new DisposedError(`Image asset "${this.id}"`);
    this.refs++;
    this.onRefsChanged(this);
  }

  release(): void {
    if (this.refs === 0) return;
    this.refs--;
    this.onRefsChanged(this);
  }

  /** @internal */
  takeNative(): unknown {
    const native = this.nativeImage;
    this.nativeImage = undefined;
    this.isDisposed = true;
    return native;
  }
}

const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

/**
 * Registers, loads, caches and frees image assets by stable string ids.
 *
 * - Loading the same id twice shares one in-flight request and one decoded image.
 * - `load` rejects with `AssetLoadError` on failure; the id can be loaded again later.
 * - Holders (sprites, image nodes) retain assets. Unreferenced assets are evicted
 *   least-recently-used first when the byte budget is exceeded, and on `unload`/`dispose`.
 */
export class AssetManager {
  private readonly entries = new Map<string, Entry>();
  private readonly emitter: Emitter<AssetEvents>;
  private readonly maxBytes: number;
  private loader: ImageLoader | null;
  private clock = 0;
  private isDisposed = false;

  constructor(options: AssetManagerOptions = {}) {
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    if (!(Number.isFinite(maxBytes) && maxBytes > 0)) {
      throw new InvalidOptionError(`maxBytes must be a finite number > 0, got ${String(maxBytes)}.`);
    }
    this.maxBytes = maxBytes;
    this.loader = options.loader ?? null;
    this.emitter = new Emitter<AssetEvents>(options.onError ?? rethrowAsync);
  }

  /** Sets the platform loader (the React Native provider does this). */
  setLoader(loader: ImageLoader): void {
    this.assertAlive();
    this.loader = loader;
  }

  on<K extends keyof AssetEvents>(type: K, listener: (event: AssetEvents[K]) => void): Unsubscribe {
    return this.emitter.on(type, listener);
  }

  /** Registers a source (for example `require('./hero.png')` or a URI) under `id`. */
  register(id: string, source: unknown): void {
    this.assertAlive();
    if (typeof id !== 'string' || id.length === 0) throw new InvalidOptionError('Asset ids must be non-empty strings.');
    if (source === undefined || source === null) throw new InvalidOptionError(`Asset "${id}" needs a source.`);
    const existing = this.entries.get(id);
    if (existing) {
      if (existing.source === source) return;
      if (existing.state === 'loaded' || existing.state === 'loading') {
        throw new InvalidOptionError(`Asset "${id}" is already registered with another source. Unload it first.`);
      }
      existing.source = source;
      existing.state = 'registered';
      existing.error = null;
      return;
    }
    this.entries.set(id, {
      id,
      source,
      state: 'registered',
      promise: null,
      asset: null,
      error: null,
      lastUsed: 0,
      generation: 0,
      manual: false,
    });
  }

  /**
   * Loads several images. Pass ids that were registered, or a map of `id → source` to
   * register and load in one call. Resolves to the assets by id; rejects on the first failure.
   */
  async load<K extends string>(request: readonly K[] | Readonly<Record<K, unknown>>): Promise<Record<K, ImageAsset>> {
    this.assertAlive();
    const ids: K[] = Array.isArray(request) ? [...(request as readonly K[])] : (Object.keys(request) as K[]);
    if (!Array.isArray(request)) {
      for (const id of ids) this.register(id, (request as Readonly<Record<K, unknown>>)[id]);
    }
    const assets = await Promise.all(ids.map((id) => this.loadImage(id)));
    const out = {} as Record<K, ImageAsset>;
    ids.forEach((id, i) => {
      out[id] = assets[i] as ImageAsset;
    });
    return out;
  }

  /** Loads one registered image, sharing any request already in flight. */
  loadImage(id: string): Promise<ImageAsset> {
    this.assertAlive();
    const entry = this.entries.get(id);
    if (!entry) return Promise.reject(new InvalidOptionError(`Unknown asset "${id}". Register it first.`));
    entry.lastUsed = ++this.clock;
    if (entry.state === 'loaded' && entry.asset) return Promise.resolve(entry.asset);
    if (entry.promise) return entry.promise;
    const loader = this.loader;
    if (!loader) return Promise.reject(new InvalidOptionError('No image loader is configured.'));

    entry.state = 'loading';
    entry.error = null;
    const generation = entry.generation;
    const promise = (async () => {
      let loaded: LoadedImage;
      try {
        loaded = await loader.load(entry.source, id);
        if (!(loaded.width > 0 && loaded.height > 0)) throw new Error('decoded image has no size');
      } catch (cause) {
        const error = cause instanceof AssetLoadError ? cause : new AssetLoadError(id, cause);
        if (entry.generation === generation && !this.isDisposed) {
          entry.state = 'error';
          entry.error = error;
          entry.promise = null;
          this.emitter.emit('error', { id, error });
        }
        throw error;
      }
      if (entry.generation !== generation || this.isDisposed) {
        // Unloaded or disposed while loading: free the result right away.
        loader.release(loaded.native);
        throw new AssetLoadError(id, new Error('the asset was unloaded while loading'));
      }
      const asset = new ImageAssetImpl(id, loaded, () => {
        entry.lastUsed = ++this.clock;
        this.enforceBudget();
      });
      entry.asset = asset;
      entry.state = 'loaded';
      entry.promise = null;
      this.emitter.emit('load', { asset });
      this.enforceBudget(asset);
      return asset;
    })();
    entry.promise = promise;
    return promise;
  }

  /**
   * Adds an image that was decoded elsewhere (for example drawn procedurally). It is then
   * managed like a loaded asset.
   */
  addImage(id: string, image: LoadedImage): ImageAsset {
    this.assertAlive();
    if (this.entries.has(id)) throw new InvalidOptionError(`Asset "${id}" already exists.`);
    const entry: Entry = {
      id,
      source: image,
      state: 'loaded',
      promise: null,
      asset: null,
      error: null,
      lastUsed: ++this.clock,
      generation: 0,
      manual: true,
    };
    entry.asset = new ImageAssetImpl(id, image, () => {
      entry.lastUsed = ++this.clock;
      this.enforceBudget();
    });
    this.entries.set(id, entry);
    this.emitter.emit('load', { asset: entry.asset });
    this.enforceBudget(entry.asset);
    return entry.asset;
  }

  /** The loaded asset, or throws if it is not loaded. */
  get(id: string): ImageAsset {
    const asset = this.peek(id);
    if (!asset) throw new InvalidOptionError(`Asset "${id}" is not loaded (state: ${this.state(id) ?? 'unknown'}).`);
    return asset;
  }

  /** The loaded asset, or undefined. */
  peek(id: string): ImageAsset | undefined {
    const entry = this.entries.get(id);
    if (entry?.state !== 'loaded' || !entry.asset) return undefined;
    entry.lastUsed = ++this.clock;
    return entry.asset;
  }

  state(id: string): AssetState | undefined {
    return this.entries.get(id)?.state;
  }

  error(id: string): AssetLoadError | null {
    return this.entries.get(id)?.error ?? null;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /**
   * Frees a loaded image (and cancels a pending load) but keeps the registration, so it can be
   * loaded again. Throws if the image is still retained, unless `force` is true.
   */
  unload(id: string, options: { force?: boolean } = {}): void {
    this.assertAlive();
    const entry = this.entries.get(id);
    if (!entry) return;
    if (entry.asset && entry.asset.refCount > 0 && !options.force) {
      throw new InvalidOptionError(`Asset "${id}" is still in use (${String(entry.asset.refCount)} holders).`);
    }
    this.free(entry, 'unload');
  }

  /** Unloads and forgets an asset. */
  remove(id: string, options: { force?: boolean } = {}): void {
    this.unload(id, options);
    this.entries.delete(id);
  }

  get stats(): { readonly registered: number; readonly loaded: number; readonly loading: number; readonly bytes: number } {
    let loaded = 0;
    let loading = 0;
    let bytes = 0;
    for (const entry of this.entries.values()) {
      if (entry.state === 'loaded' && entry.asset) {
        loaded++;
        bytes += entry.asset.byteSize;
      } else if (entry.state === 'loading') {
        loading++;
      }
    }
    return { registered: this.entries.size, loaded, loading, bytes };
  }

  /** Frees every image (in use or not) and rejects later calls. Idempotent. */
  dispose(): void {
    if (this.isDisposed) return;
    for (const entry of this.entries.values()) this.free(entry, 'disposed');
    this.isDisposed = true;
    this.entries.clear();
    this.emitter.clear();
  }

  private free(entry: Entry, reason: 'unload' | 'evicted' | 'disposed'): void {
    entry.generation++;
    entry.promise = null;
    const asset = entry.asset;
    entry.asset = null;
    const wasLoaded = entry.state === 'loaded';
    entry.state = 'registered';
    entry.error = null;
    if (asset && !asset.disposed) {
      const native = asset.takeNative();
      try {
        this.loader?.release(native);
      } catch (error) {
        rethrowAsync(error);
      }
    }
    if (entry.manual) this.entries.delete(entry.id);
    if (wasLoaded) this.emitter.emit('unload', { id: entry.id, reason });
  }

  private enforceBudget(keep?: ImageAsset): void {
    if (this.isDisposed) return;
    let bytes = this.stats.bytes;
    if (bytes <= this.maxBytes) return;
    const candidates = [...this.entries.values()]
      .filter((e) => e.state === 'loaded' && e.asset && e.asset.refCount === 0 && e.asset !== keep)
      .sort((a, b) => a.lastUsed - b.lastUsed);
    for (const entry of candidates) {
      if (bytes <= this.maxBytes) break;
      bytes -= entry.asset?.byteSize ?? 0;
      this.free(entry, 'evicted');
    }
  }

  private assertAlive(): void {
    if (this.isDisposed) throw new DisposedError('AssetManager');
  }
}
