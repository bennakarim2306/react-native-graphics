# Performance

**No device measurements exist yet.** Phases 1 to 4 have run in Node (Jest), real Skia through CanvasKit (Jest), Chromium (web build) and, for Phases 1 to 3, an Android 17 emulator in Expo Go without timing. None of this says anything about frame times on Android or iOS, so no device FPS, memory or GPU numbers are reported. Phase 4 adds the tools to take them: the same benchmark scenarios as buttons in the showcase with a live frame meter (procedure below).

## Phase 4 effect scenarios: engine-side cost in Node (not a device)

What it measures: the JavaScript work per frame before Skia draws, for the seven scenarios of the Phase 4 brief. That is playbacks, effect updates (particle simulation, shader uniforms), attachments and the display list. It does **not** include recording the Skia picture, GPU rasterization or shader execution, and a phone CPU is slower than this server CPU by an amount not measured here.

Method: `npm run bench` (`scripts/effects.bench.ts`). A `VirtualClock` advances 60 FPS frames (16.7 ms) and each frame is timed with `performance.now()`. The first 30 frames are excluded as warm-up except in the explosion rows (measured from the trigger). Targets are 60 × 90 point cards; quality `high` unless stated. Seed 7.

Environment: Node 22.23.4, Linux x64 cloud container, 4 vCPU Intel Xeon @ 2.10 GHz, 2026-11-13.

| Scenario | Frames | Average | p95 | Max | Peak live particles | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 1 fire border (high) | 600 | 0.035 ms | 0.051 ms | 0.230 ms | 8 | shader flames; particles are sparks only |
| 10 fire borders (high) | 600 | 0.233 ms | 0.373 ms | 2.441 ms | 67 | |
| 10 fire borders (low) | 600 | 1.476 ms | 2.105 ms | 2.891 ms | 513 | no shader: particle flames |
| 1 explosion of 150 particles (high) | 150 | 0.180 ms | 0.623 ms | 1.472 ms | 231 | all layers ended within 2.5 s |
| 5 explosions of 150 particles (high) | 150 | 0.612 ms | 1.809 ms | 2.358 ms | 1155 | all ended within 2.5 s |
| 5 explosions of 150 particles (low) | 150 | 0.109 ms | 0.391 ms | 0.468 ms | 290 | |
| 50 sprites, 10 trails, 10 glow pulses | 600 | 1.090 ms | 1.273 ms | 3.258 ms | 283 | every sprite animates frames and rotation |
| 500 create/destroy cycles (3 frames each, per frame) | 1500 | 0.872 ms | 1.109 ms | 3.062 ms | 0 | engine idle afterwards; particle buffers allocated 18, reused 982 |
| Continuous, minute 1 | 3600 | 0.371 ms | 0.681 ms | 2.757 ms | 346 | 3 fire borders, smoke, an explosion every 2 s, confetti every 5 s; process heap 66 MiB |
| Continuous, minute 2 | 3600 | 0.427 ms | 0.869 ms | 2.146 ms | 344 | heap 55 MiB |
| Continuous, minute 3 | 3600 | 0.398 ms | 0.804 ms | 2.644 ms | 345 | heap 60 MiB |

Reading:
- Engine work stays far below a 16.7 ms frame in every scenario on this CPU. The likely costs on a phone are elsewhere and unmeasured: recording the picture (one Skia call per particle, see below), GPU fill of shaders and blurred glows, and saveLayer passes for node effects.
- The continuous run shows no growth over three simulated minutes (stable frame cost, stable particle count, heap not growing; heap includes Jest and is not GC-forced, so it is a trend only). The create/destroy run ends idle with pooled buffers reused.
- **Open question for devices:** `low` quality turns the fire-border shader into about 50 CPU particles per border. That costs roughly 6× more JavaScript time than `high` (1.5 ms vs 0.23 ms for 10 borders here) but removes per-pixel shader work. Which is cheaper on a low-end phone must be measured there (section F of the showcase, `10 fire borders` on `low` vs `high`).
- Particles are drawn one Skia primitive per particle (image particles use one `drawAtlas` per emitter). 1155 particles mean about 1155 draw calls recorded per frame in the 5-explosion scenario. If devices show picture recording as the bottleneck, batching vector particles (atlas of pre-rendered dots) is the first optimization to try.

## Measuring on a device or emulator (procedure)

The showcase's **Effects** tab, section **F · Performance scenarios**, has one button per scenario above (`1 fire border`, `10 fire borders`, `1 explosion (150)`, `5 explosions`, `50 sprites + effects`, `create/destroy ×100`, `continuous 2 min`) and a meter that updates twice a second:
- **Frames, interval avg / p95 / worst, ≈ FPS**: time between engine frames on the JavaScript thread (the effects loop). Gaps after a frame with nothing running are counted separately as idle gaps, not as slow frames.
- **JS work per frame (engine + picture)**: time from the start of an engine frame until the meter's listener runs, which includes the overlay recording the Skia picture.
- **Particles** now and peak; active effects; current quality.

Steps (Windows PowerShell, one command per line):
1. `npm run example:install`
2. `cd example`
3. `npx expo start --clear`, then press `a` to open the Android emulator in Expo Go.
4. Open the **Effects** tab, scroll to **F**, pick the quality chip at the top, press a scenario, wait 10 s (or the full 2 min for `continuous`), and write down the three meter lines. Press **Stop** between scenarios.
5. For the UI/render thread (where Skia draws): `adb shell dumpsys gfxinfo host.exp.exponent reset`, run the scenario for 10 s, then `adb shell dumpsys gfxinfo host.exp.exponent` and record "Janky frames" and the 50th/90th/95th/99th percentiles. On Android you can also enable the in-app Perf Monitor from the Expo developer menu.
6. For memory: Android Studio's profiler, or `adb shell dumpsys meminfo host.exp.exponent` before and after `continuous 2 min`.

Record: device or emulator model, OS version, Expo Go or development build, debug or release, quality level, and the numbers above. `npx expo start` serves development JavaScript (extra checks, slower); `npx expo start --no-dev --minify` serves production JavaScript to Expo Go and gives more representative JS numbers. A release development build is the reference.

## Engine-side frame cost in Node (Phase 3 sprites, not a device)

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
- Phase 4: emitter buffers come from a shared pool keyed by capacity (reused across effects, see the create/destroy row), `maxParticles` caps each emitter (default 500), quality profiles scale counts, and compiled shaders are cached by source.

Known costs not yet measured: one shader object per shader node per frame, one picture per frame, and `measureInWindow` per frame for targets with `trackEveryFrame`.

## Recording a device measurement

Record: device or simulator, OS version, build mode (debug or release), scene (for example "Effects tab, F, 10 fire borders, high"), method (the section F meter, `dumpsys gfxinfo`, or the Perf Monitor), and average and p95 frame time or FPS. The first device baseline is still open: it needs the owner's Android 17 emulator run (section F) and, later, one physical device in a release build.
