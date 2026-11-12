import { FrameClock } from '../runtime/clock';
import type { Clock } from '../runtime/clock';

/**
 * Clock driven by React Native's `requestAnimationFrame` on the JS thread, using
 * `performance.now()` for time. Frames are only requested while effects are running.
 */
export function createDefaultClock(): Clock {
  return new FrameClock({
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (handle) => {
      cancelAnimationFrame(handle);
    },
    now: () => performance.now(),
  });
}
