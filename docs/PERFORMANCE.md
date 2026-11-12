# Performance

**No device measurements exist yet.** Phases 1 to 3 have run in Node (Jest), real Skia through CanvasKit (Jest), Chromium (web build) and, for Phases 1 and 2 only, an Android 17 emulator in Expo Go without timing. None of this says anything about frame times on Android or iOS, so no FPS, memory or GPU numbers are reported.

## Engine-side frame cost in Node (Phase 3, not a device)

What it measures: the JavaScript work the engine does per frame before Skia draws. That is advancing playbacks (sprite frame animations and tweens), updating attachments (one `glow-border`) and building the scene display list. It does **not** include recording the Skia picture, native drawing, image decoding, and a phone CPU is slower than this server CPU by an amount not measured here.

Method: `npm run bench` (`scripts/engine.bench.ts`). A virtual clock advances 600 frames of 16.7 ms. Each sprite plays an 8-frame animation at a different speed and z-index; every tenth sprite also rotates with an endless tween. Timings are `performance.now()` around each `clock.advance`.

Environment: Node 22.23.4, Linux x64 cloud container, 4-core Intel Xeon @ 2.30 GHz, 2026-11-12.

| Sprites | Average | p95 | Max |
| --- | --- | --- | --- |
| 10 | 0.070 ms | 0.107 ms | 7.873 ms (first frames, JIT warm-up) |
| 100 | 0.223 ms | 0.314 ms | 1.974 ms |
| 500 | 1.101 ms | 1.682 ms | 2.905 ms |

Reading: the engine side grows roughly linearly with sprite count and stays far below a 16.7 ms frame in Node. Whether 100 sprites run at 60 FPS on a mid-range phone is **unknown** until it is measured on one.

## Design choices that should help (unmeasured)

- No React re-render per frame. Frames are recorded into an `SkPicture` and handed to Skia through a shared value.
- Sprite frame shapes are cached per frame, so playing an animation allocates no new shapes. Sprites of one sheet share one decoded image.
- Gradients, paths and compiled runtime effects are cached by the renderer. Layer groups (`saveLayer`) are only emitted for nodes that need them.
- Images are decoded once per asset id and deduplicated across concurrent loads; unreferenced images are evicted above a byte budget.
- Particle state uses typed arrays allocated once per burst.
- The engine does no frame work while idle; visible shader fills keep frames coming, hidden ones do not.
- Bounded load: at most 2000 particles per burst and 32 concurrent effects by default.

Known costs not yet measured: one shader object per shader node per frame, one picture per frame, and `measureInWindow` per frame for targets with `trackEveryFrame`.

## Recording a device measurement

Record: device or simulator, OS version, build mode (debug or release), scene (for example "Graphics tab, Spawn 100 pressed twice"), method (for example the Perf Monitor or a frame-callback timing log), and average and p95 frame time or FPS. The first device baseline is planned for Phase 4, on the Android 17 emulator and one physical device, in a release build.
