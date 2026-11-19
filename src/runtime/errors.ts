/** Thrown when an engine, playback or node is used after it was disposed or destroyed. */
export class DisposedError extends Error {
  constructor(what: string) {
    super(`${what} has been disposed and can no longer be used.`);
    this.name = 'DisposedError';
  }
}

/** Thrown synchronously when an animation, node or engine option is invalid. */
export class InvalidOptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidOptionError';
  }
}

/**
 * Thrown by `useGameFX()` methods that need the engine before the provider has created it
 * (only possible during the provider's very first render). Check `fx.ready`, or call from an
 * event handler or effect.
 */
export class NotReadyError extends Error {
  constructor() {
    super('GameFX is not ready yet. Call play() from an event handler or effect, not during the first render.');
    this.name = 'NotReadyError';
  }
}

export function assertFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new InvalidOptionError(`${name} must be a finite number >= 0, got ${String(value)}.`);
  }
}

export function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new InvalidOptionError(`${name} must be a finite number, got ${String(value)}.`);
  }
}
