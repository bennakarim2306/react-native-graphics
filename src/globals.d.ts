// Globals available in React Native (Hermes) and Node that are not in the ES2022 lib.
// Declared narrowly instead of pulling in the DOM lib.
declare function queueMicrotask(callback: () => void): void;
declare const performance: { now(): number };
