/**
 * Structure-of-arrays storage for up to `capacity` particles. Inputs (birth state) and
 * outputs (state at the current time, read by renderers) live in typed arrays that are
 * allocated once and reused.
 */
export class ParticleBuffers {
  // Birth state.
  readonly birth: Float64Array;
  readonly life: Float32Array;
  readonly x0: Float32Array;
  readonly y0: Float32Array;
  readonly vx0: Float32Array;
  readonly vy0: Float32Array;
  readonly size: Float32Array;
  readonly rotation0: Float32Array;
  readonly spin: Float32Array;
  readonly paletteIndex: Uint16Array;
  readonly frame: Uint16Array;
  // Current state.
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly radius: Float32Array;
  readonly opacity: Float32Array;
  readonly rotation: Float32Array;
  readonly red: Float32Array;
  readonly green: Float32Array;
  readonly blue: Float32Array;
  readonly alive: Uint8Array;
  /** Indices of free slots (a stack). */
  readonly free: Int32Array;

  constructor(readonly capacity: number) {
    this.birth = new Float64Array(capacity);
    this.life = new Float32Array(capacity);
    this.x0 = new Float32Array(capacity);
    this.y0 = new Float32Array(capacity);
    this.vx0 = new Float32Array(capacity);
    this.vy0 = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.rotation0 = new Float32Array(capacity);
    this.spin = new Float32Array(capacity);
    this.paletteIndex = new Uint16Array(capacity);
    this.frame = new Uint16Array(capacity);
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.radius = new Float32Array(capacity);
    this.opacity = new Float32Array(capacity);
    this.rotation = new Float32Array(capacity);
    this.red = new Float32Array(capacity);
    this.green = new Float32Array(capacity);
    this.blue = new Float32Array(capacity);
    this.alive = new Uint8Array(capacity);
    this.free = new Int32Array(capacity);
  }

  /** Marks every slot dead and free. */
  reset(): void {
    this.alive.fill(0);
    this.opacity.fill(0);
  }
}

export interface PoolStats {
  /** Buffers created because none of the right size was free. */
  readonly allocated: number;
  /** Acquisitions served by a released buffer. */
  readonly reused: number;
  /** Buffers waiting in the pool. */
  readonly idle: number;
}

/**
 * Recycles particle buffers between emitters, so repeated bursts (100 explosions in a row)
 * do not allocate new typed arrays each time. Capacities are rounded up to a power of two
 * (at least 64) so buffers fit many emitter sizes. Keeps at most `maxIdlePerSize` idle
 * buffers per size; the rest is left to the garbage collector.
 */
export class ParticlePool {
  private readonly idle = new Map<number, ParticleBuffers[]>();
  private allocatedCount = 0;
  private reusedCount = 0;

  constructor(private readonly maxIdlePerSize = 8) {}

  static bucket(capacity: number): number {
    let size = 64;
    while (size < capacity) size *= 2;
    return size;
  }

  acquire(capacity: number): ParticleBuffers {
    const size = ParticlePool.bucket(capacity);
    const list = this.idle.get(size);
    const reused = list?.pop();
    if (reused) {
      this.reusedCount++;
      return reused;
    }
    this.allocatedCount++;
    return new ParticleBuffers(size);
  }

  release(buffers: ParticleBuffers): void {
    buffers.reset();
    let list = this.idle.get(buffers.capacity);
    if (!list) {
      list = [];
      this.idle.set(buffers.capacity, list);
    }
    if (list.length < this.maxIdlePerSize && !list.includes(buffers)) list.push(buffers);
  }

  get stats(): PoolStats {
    let idle = 0;
    for (const list of this.idle.values()) idle += list.length;
    return { allocated: this.allocatedCount, reused: this.reusedCount, idle };
  }

  /** Drops every idle buffer. */
  clear(): void {
    this.idle.clear();
  }
}

/** Pool shared by all emitters unless one is passed explicitly. */
export const sharedParticlePool = new ParticlePool();
