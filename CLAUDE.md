# React Native GameFX Engine — Claude Code Project Context

## Product mission (non-negotiable)
Build **a reusable, embeddable 2D game-effects engine for existing React Native applications**. This is a framework/SDK with its own runtime, effect composition, scene representation, rendering integration, and developer-facing APIs — **not** a collection of app-specific `Animated.View` examples or wrappers around `withTiming`.

An app developer should be able to install the package, mount a nonintrusive rendering surface, and trigger sophisticated game-like effects (particles, sprites, explosions, celebrations, card movements, transitions) without implementing the animation internals.

The first potential consumer is **Belote Tunisienne**, but its rules, assets, UI, terminology, and architecture must **not** determine the engine's core design. Build and test the engine independently before attempting any Belote integration.

**Scope distinction:** We are building a **2D animation/effects game engine embedded in React Native**, not a general-purpose game engine for simulation, physics, networking, multiplayer, AI, level design, or gameplay rules. Don't implement a Unity replacement. If a task would cross that boundary, document it and seek scope approval.

## Definition of success
A developer can, within a normal React Native app:
1. Install the SDK with documented, compatible peer dependencies.
2. Mount `<GameFXProvider>` / `<GameFXCanvas>` (names illustrative; finalize through an architecture decision).
3. Trigger and control effects using a typed API such as `fx.play('confetti', { position, duration })`.
4. Compose simultaneous/sequential effects, sprites, keyframes, camera-like transforms, and particle emitters.
5. Optionally anchor an effect to an existing native view without replacing the entire app's UI.
6. Stop, pause, skip, or dispose effects safely; navigate/unmount without leaks.
7. Run on supported Android and iOS versions with verified setup and observable performance.

## Critical engineering principles
- **Framework-first:** Maintain an independent repository/package, demo app, tests, and public API. Do not put core engine logic into Belote-specific components.
- **Own the engine semantics:** Implement scene/layer organization, scheduling, effects, resource lifecycle, and composition in our code. Reanimated and Skia are **infrastructure**, not the product.
- **Leverage rather than reinvent:** Use mature native/graphics libraries for rendering, scheduling integration, drawing, and GPU features where justified. Do not write a GPU rasterizer or duplicate Skia.
- **Pluggable backends:** Keep the engine model, pure animation math, assets, and effect descriptions separate from renderer-specific code. Start with one proven rendering backend; implement further adapters only when needed and tested.
- **Easy host integration:** Default to a transparent, non-touch-blocking FX overlay. Offer explicit interaction/input options. Respect safe areas, z-order, clipping, coordinate spaces, and host-view scrolling/measurement.
- **Game state is external:** The SDK animates visual representations of events; it must never own application business logic or make an app action depend on completing an animation.
- **Type-safe and extensible:** Version a small public API; support custom effects and preset registration without consumers modifying the engine internals.
- **Performance by evidence:** Aim for smooth 60 FPS on representative mid-range devices but never claim FPS, GPU behavior, or memory safety without actual measurements.
- **Reusability over demos:** A visually impressive demo does not count as a reusable framework unless the same effect works from a separate consumer app through public exports.

## Technical direction — audit and validate before adoption
- Primary language: **TypeScript (strict)** for public APIs, pure algorithms, orchestration, and tests.
- **React Native Skia** is the leading candidate for a 2D rendering adapter (Canvas, paths, images, sprites, shaders as supported).
- **React Native Reanimated / Worklets** may coordinate UI-thread animations and shared values when compatible with the actual RN architecture and Expo SDK. Check installed versions and official requirements; don't force incompatible upgrades.
- React Native components and hooks are host integrations, not the engine's internal scene representation.
- Use a deterministic virtual clock and seeded RNG for core simulations/tests; a real frame clock adapter for running animations.
- Choose the **thread ownership** of updates and rendering explicitly. Prove it with a minimal device-executable vertical slice; don't assume arbitrary TypeScript code runs on the UI thread.
- Treat native dependencies as **peer dependencies** when packaging. Document Expo managed workflow vs development-build limitations. Do not promise Expo Go support unless verified.
- Prefer an MVP without C++ or custom native modules. Consider native code only after a measured bottleneck and a documented decision.
- Optional libraries (Rive, Lottie, gesture libraries) must remain optional integrations, not core prerequisites without demonstrated need.

## Required modules / boundaries
1. **Core runtime:** clock, scheduler, update lifecycle, effect handles, state machine, cancellation, pause/resume, repeat, seek where meaningful, deterministic simulation.
2. **Animation model:** timelines, keyframes, easing, interpolation, motion paths, transforms, sequencing, parallel/staggered groups.
3. **Scene model:** nodes, parent/child transforms, draw order, layers, opacity, bounds, coordinate transforms; keep the initial model minimal and testable.
4. **Renderer adapter:** render scene/effects efficiently, manage native graphics resources, expose capability information; do not leak Skia internals into stable core APIs.
5. **Particles and sprites:** emitters, motion, lifetimes, colors, alpha, blending, asset atlases/sprite-sheet playback, pooling only when measured or warranted.
6. **Effects and presets:** typed registry, reusable parameterized presets (confetti, sparks, explosion, glow, pulse, floating score, trail, celebration, shake).
7. **React Native integration:** provider/canvas, hooks, ref/target anchoring where supported, overlays, mounting/unmounting, resize/orientation, reduced motion.
8. **Tooling:** dedicated demo/showcase, test harness, benchmark scenarios, documentation, and distributable package artifacts.

## Illustrative consumer API (not frozen)
```tsx
import { GameFXProvider, GameFXCanvas, useGameFX } from '@react-native-gamefx/core';

function Screen() {
  return (
    <GameFXProvider>
      <MyExistingAppUI />
      <GameFXCanvas pointerEvents="none" />
    </GameFXProvider>
  );
}

function WinButton() {
  const fx = useGameFX();
  return <Button title="Celebrate" onPress={() => {
    const handle = fx.play('confetti', {
      position: { x: 200, y: 300 },
      count: 100,
      duration: 1200,
    });
    // handle.cancel(), handle.finished, etc. once API is finalized
  }} />;
}
```
The public API must define whether coordinates are screen-, canvas-, world-, or target-relative; how effects are disposed; how errors and completion behave; how overlays interact with touches; and how cancellation is surfaced. Do not present illustrative code as working API until implemented and tested.

## MVP product requirements
- One embeddable overlay usable within an **otherwise ordinary React Native app**.
- Runtime able to start, progress, stop, and dispose at least one effect safely.
- Deterministic timeline/keyframe math and a basic compositional scene model.
- A visually verifiable **particle burst** and at least one **animated sprite or image** effect.
- Two reusable presets through a public typed registry and consumer parameters.
- Correct visual positioning in portrait and landscape; resizing and safe-area behavior documented.
- A completely separate example app that imports the built package via its public entry point.
- Working unit/integration tests and repeatable Android/iOS verification steps.
- No reliance on Belote-specific code, assets, or naming.

## Explicitly deferred until after MVP
3D rendering; advanced physics; multiplayer/game networking; game rules; level editor; visual timeline editor; asset marketplace; audio engine; complex shader authoring GUI; generic ECS; custom native renderer. Consider them only when usage evidence justifies complexity.

## Execution plan and hard acceptance gates
**Phase 0 — Repository audit and migration:** Inspect current Git state, packages, code, tests, docs, and previous Claude work. Compare against this revised framework-first mission. Record what is reusable, what needs refactoring, and what is out of scope. Preserve existing work; do not delete or rewrite it blindly. Update `docs/ARCHITECTURE.md` and `docs/PROGRESS.md`. Run baseline checks.

**Phase 1 — End-to-end vertical slice:** Prove one reusable effect from a standalone **consumer app** via installed/local package exports: a transparent FX canvas and a tap-triggered particle burst. Verify mounting, coordinate mapping, removal, and cleanup on supported devices/simulators. This gate prevents building a large abstract core that cannot actually render in RN.

**Phase 2 — Runtime and scene composition:** Build clock/scheduler, stateful handles, lifecycle, timelines, interpolation, nodes/layers, deterministic composition. Test virtual-clock playback, events, cancel, pause, timing, boundaries, and teardown. Keep renderer separation clear.

**Phase 3 — Particle/sprite systems and assets:** Emitter simulation, seeded randomness, configurable bursts, sprites/atlases, image lifecycle, bounded memory/resource usage. Demonstrate in separate consumer app and validate asset loading and cleanup.

**Phase 4 — General-purpose FX library and customization:** Effect registry/presets, parameter validation, sequencing, compositing, custom effects, accessibility and quality modes. Demonstrate explosion, confetti, glow, score popup, motion trail, and image/card movement without relying on card-specific architecture.

**Phase 5 — SDK packaging and hardening:** Stable typed exports, documented peer dependencies, version matrix, RN/Expo integration guide, sample app, CI, regression tests, profiling and reproducible benchmarks; test actual Android/iOS builds where available. Prepare release candidate; do not publish without approval.

**Phase 6 — Optional Belote Tunisienne adapter:** Only after the standalone framework is demonstrated. Integrate as an external consumer behind a feature flag. Never change game rules/networking/scoring to accommodate graphics. Keep integration reversible.

Complete phases **one at a time**. A phase is NOT complete just because code exists: it must satisfy its documented acceptance tests. Do not implement the entire roadmap in one massive change.

## Testing and verification (mandatory)
- Inspect available package manager, scripts, CI, Expo/RN versions, and test tools before selecting dependencies.
- **Pure core:** unit tests using virtual time/seeded RNG; exact positions at timestamps; interpolation; repeat; cancel; pause; large deltas; invalid inputs; resource teardown.
- **Rendering:** integration tests for scene order, coordinate spaces, resize, mount/unmount, target anchoring (when implemented), overlay pointer behavior, missing assets, and renderer capability fallback.
- **Effects:** tests for particle count/lifetime, deterministic emission, overlapping effects, effect cancellation, repeated trigger, memory/resource cleanup.
- **Consumer contract:** package builds and a separate sample app imports **public exports only**; no private source paths or repository-only aliases.
- **Platforms:** smoke-test actual supported Android and iOS debug/release builds when possible. Label unverified platforms honestly; web/Node tests do not prove native graphics.
- **Performance:** test with controlled scenes and report device/simulator, OS, build mode, average/p95 frame duration or FPS if measurable, memory/CPU where available, and reproduction method. Never invent results.
- Run typecheck, lint, targeted tests, complete suite, and builds relevant to changes. Fix root causes; never disable tests to report green.
- Use genuine rendered screenshots/video for visual proof, not AI-generated mockups or reconstructed screenshots.

## Security, Git, and change control
- Work in a feature branch when Git is available. Inspect dirty worktree; never discard unrelated changes, force-push, rewrite history, or overwrite an existing remote branch without authorization.
- If GitHub push returns 403, preserve all local work, report authentication/installation scope, and **do not claim a branch or PR was pushed**.
- Do not publish to npm, change app-store releases, ship to production, or delete project data without explicit permission.
- Never commit tokens, API keys, credentials, `.env` files, or user data. Use synthetic demo assets and verify asset licenses; do not copy Candy Crush/other proprietary game code or graphics.
- Avoid large dependency upgrades, native project regeneration, or breaking API changes without surfacing tradeoffs and obtaining approval if disruptive.

## Documentation and continuity
Maintain:
- `README.md` — install, demo, usage, supported platforms.
- `docs/ARCHITECTURE.md` — module boundaries, decisions, thread model, coordinate system, lifecycle.
- `docs/API.md` — documented public API, effects, extensibility, error/cancel semantics.
- `docs/PROGRESS.md` — each phase's status, exact executed commands/results, changed files, blockers, and next action.
- `docs/PERFORMANCE.md` — real benchmarking methodology/results and device matrix.

At the start of each session, read these files and inspect the repository before changing it. Correct stale documentation when implementation diverges.

## Claude's workflow for every task
1. Summarize the exact scope and inspect the worktree/environment.
2. Explain the smallest verifiable plan and acceptance criteria.
3. Implement an end-to-end, independently testable slice; prefer tests alongside code.
4. Execute checks, diagnose failures, iterate, and inspect the final diff.
5. Update progress and architecture notes from actual evidence.
6. Report: **implemented / tested with exact commands / not verified / risks / next step**.

**Default starting action:** Perform Phase 0 with special attention to any code written under the former card-animation-SDK specification. Propose a migration path to this framework-first architecture, run baseline tests, and stop with a concrete Phase 1 plan. Do not assume previous phases are complete.
