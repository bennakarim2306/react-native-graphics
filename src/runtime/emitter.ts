export type Listener<T> = (event: T) => void;
export type Unsubscribe = () => void;

/** Called when a listener throws. Errors never interrupt dispatch to other listeners. */
export type ErrorReporter = (error: unknown) => void;

/** Default reporter: rethrow on a microtask so the error stays visible without breaking the frame. */
export const rethrowAsync: ErrorReporter = (error) => {
  queueMicrotask(() => {
    throw error;
  });
};

/**
 * Small typed event emitter.
 *
 * - Listeners run in subscription order.
 * - Listeners added during a dispatch are not called for that dispatch.
 * - Listeners removed during a dispatch are not called if they have not run yet.
 * - A throwing listener is reported through `onError` and does not stop the others.
 */
export class Emitter<Events extends object> {
  private readonly listeners = new Map<keyof Events, Set<Listener<never>>>();

  constructor(private readonly onError: ErrorReporter = rethrowAsync) {}

  on<K extends keyof Events>(type: K, listener: Listener<Events[K]>): Unsubscribe {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
    return () => { this.off(type, listener); };
  }

  once<K extends keyof Events>(type: K, listener: Listener<Events[K]>): Unsubscribe {
    const off = this.on(type, (event) => {
      off();
      listener(event);
    });
    return off;
  }

  off<K extends keyof Events>(type: K, listener: Listener<Events[K]>): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit<K extends keyof Events>(type: K, event: Events[K]): void {
    const set = this.listeners.get(type);
    if (!set || set.size === 0) return;
    for (const listener of [...set]) {
      if (!set.has(listener)) continue;
      try {
        (listener as Listener<Events[K]>)(event);
      } catch (error) {
        this.onError(error);
      }
    }
  }

  listenerCount(type: keyof Events): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  clear(): void {
    this.listeners.clear();
  }
}
