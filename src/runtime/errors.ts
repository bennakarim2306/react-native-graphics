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
