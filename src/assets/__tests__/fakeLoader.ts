import type { ImageLoader, LoadedImage } from '../assets';

/** @internal Test helper: a platform loader whose results the test controls. Not exported publicly. */
export interface FakeNative {
  readonly source: unknown;
  readonly serial: number;
  released: boolean;
}

/** @internal */
export class FakeLoader implements ImageLoader {
  loads = 0;
  releases = 0;
  readonly live = new Set<FakeNative>();
  /** When true, loads wait until `flush()`. */
  manual = false;
  private pending: (() => void)[] = [];

  constructor(private readonly sizes: (source: unknown) => { width: number; height: number } | Error = () => ({ width: 8, height: 8 })) {}

  load(source: unknown): Promise<LoadedImage> {
    this.loads++;
    const run = (): LoadedImage => {
      const size = this.sizes(source);
      if (size instanceof Error) throw size;
      const native: FakeNative = { source, serial: this.loads, released: false };
      this.live.add(native);
      return { native, ...size };
    };
    if (!this.manual) return Promise.resolve().then(run);
    return new Promise<LoadedImage>((resolve, reject) => {
      this.pending.push(() => {
        try {
          resolve(run());
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
  }

  release(native: unknown): void {
    const n = native as FakeNative;
    if (n.released) throw new Error('released twice');
    n.released = true;
    this.live.delete(n);
    this.releases++;
  }

  flush(): void {
    const pending = this.pending;
    this.pending = [];
    for (const run of pending) run();
  }
}

/** @internal Lets queued promise callbacks run. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}
