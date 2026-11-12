# Performance

**No device measurements exist yet.** The Phase 1 particle burst has only run in Node (Jest), real Skia via CanvasKit (Jest) and Chromium (web build). None of these says anything about frame times on Android or iOS, so no FPS or memory numbers are reported.

Design choices that should help, but are **unmeasured**:
- No React re-render per frame. Frames are recorded into an `SkPicture` and handed to Skia through a shared value.
- Particle state uses typed arrays allocated once per burst. There is no per-frame allocation in the simulation (the renderer allocates one picture per frame).
- The engine does no frame work while idle.
- Bounded load: at most 2000 particles per burst and 32 concurrent effects by default.

When measuring, record: device or simulator, OS version, build mode (debug/release), scene (for example "5 bursts × 40 particles"), method (for example the Perf Monitor or a frame-callback timing log), and average and p95 frame time or FPS. The first baseline is planned once the showcase runs on a device.
