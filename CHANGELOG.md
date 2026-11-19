# Changelog

All notable changes to `react-native-graphics`. The package is private and unpublished; versions
here are release-candidate labels for locally packed tarballs (see [docs/RELEASE.md](docs/RELEASE.md)).

## 0.1.0-rc.0 (unreleased release candidate, Phase 5)

First packaged release candidate. Everything from Phases 1 to 4.5 (overlay, runtime, scene
graph, timelines, graphics, sprites, assets, shaders, particle and effect systems, sixteen
built-in effects, Throw & Explode, `burn-away`) is included unchanged in behaviour, except where
listed under "Breaking changes".

### Breaking changes

- **Entry points are explicit.** `package.json` `exports` allows only `react-native-graphics`,
  `react-native-graphics/core` and `react-native-graphics/package.json`. Deep imports such as
  `react-native-graphics/lib/...` or `react-native-graphics/src/...` no longer resolve.
  *Migration:* import from one of the two entry points.
- **Internal helpers are no longer exported.** The entry points list their exports explicitly
  instead of re-exporting whole modules. Removed from both entry points: `BurnAwayInstance`,
  `CompositeInstance`, `Emitter`, `FireBorderInstance`, `LocalTimer`, `ParticleBuffers`,
  `ParticlePool`, `ParticlesInstance`, `burnField`, `burnFront`, `burnGeometry`, `burnNoise`,
  `burnProgress`, `burnRange`, `createShapeSampler`, `resolveCurve`, `resolveSpread`,
  `rethrowAsync`, `validateBurstConfig`, and the types `BurnGeometry`, `ShapeSample`,
  `ShapeSampler`. These were implementation details of effects and particles that leaked through
  `export *`. *Migration:* none expected for apps; effect authors use `defineEffect`,
  `defineComposite`, `ParticleEmitter`/`ParticleBurst` and `sharedParticlePool`, which remain.
  The exact export list is pinned in `scripts/public-api.json` and checked by tests and by
  `npm run pack:verify`.
- **Peer dependency ranges match what was tested:** `react >=19.3.0` (was `>=19.0.0`),
  `react-native >=0.88.0` (was `>=0.86.0`), `react-native-reanimated ^4.7.1` (was `^4.7.0`).
  `@shopify/react-native-skia ^2.14.0` is unchanged. Older versions were never run.
- **Animations of a destroyed object end.** A tween or keyframe animation whose object is
  destroyed (scene node `destroy()`, or `<GameFXTarget>` unmounted) now ends with
  `{ status: 'cancelled', reason: 'targetDestroyed' }` on the next frame. Before, it kept running
  without writing anything until its end, and an endless one (`repeat: Infinity`) never ended,
  which kept the frame loop running after a screen was left. Timelines are unchanged: they keep
  running (they can animate other objects and fire cues) and end by themselves or by `cancel()`.
  *Migration:* code that awaited `finished` and expected `completed` after its view unmounted
  now receives `cancelled`; nothing should depend on the view in that case anyway.
- **Effect parameters of built-in names are always type-checked.** `fx.play`, `fx.attach` and
  `fx.cue` with a built-in effect name no longer fall back to the untyped custom-effect
  overload, so a misspelled or wrongly typed parameter is a compile error instead of being
  ignored at runtime. Custom effect names still accept any parameters (validated at runtime).
  *Migration:* fix the reported parameters. Passing a union of names
  (`fx.attach(id, isFire ? 'fire-border' : 'energy-border', {...})`) accepts parameters of
  either effect.

### Added

- **Distributable build.** `npm run build` writes ES modules (`lib/module`, used by Metro and
  bundlers through the `react-native`, `browser` and `module` conditions), CommonJS
  (`lib/commonjs`, for Node, Jest and `require`) and declarations with declaration maps
  (`lib/typescript`). Source maps point into the shipped `src/`. `sideEffects: false`.
- **Package validation:** `npm run pack:verify` builds, packs and checks the tarball's
  contents (no tests, fixtures, screenshots, demos, secrets), entry points, declaration exports
  against `scripts/public-api.json`, resolvable imports and source maps, then installs it in an
  empty project and loads `./core` with `require` and `import`.
- **Independent consumer app** (`consumer/`, installed outside the repository by
  `npm run consumer:install`) with eight demo screens, an automated navigation and remount
  self-test, a benchmark screen and a headless web smoke test.
- `engine.stats` (`EngineStats`): effects, playbacks, scene nodes, targets, local layers,
  frame-loop state and image cache counters, for leak checks and diagnostics.
- `<GameFXProvider pauseInBackground>` (default `true`): pauses the engine while the app is in the
  background and resumes it when it is active again, so effects continue where they were.
- `NotReadyError` is exported (thrown by `useGameFX()` methods before the engine exists).
- `DEFAULT_QUALITY` (`'medium'`) and the `CustomEffectName` type are exported.
- `SDK_VERSION` is `0.1.0-rc.0`.
- Tests: ten release lifecycle scenarios with real components (`lifecycle.test.tsx`), a public
  API contract test, a type-level API test, regression tests for the destroyed-object fix.
- CI: package validation job, consumer job (typecheck, import isolation, Android/iOS/web
  bundles, web smoke test), npm caching per lockfile.

### Fixed

- Endless animations of a `<GameFXTarget>` kept the engine's frame loop running after the target
  unmounted (found by the consumer's navigation self-test; see "Breaking changes").
- `fx.quality` reported `high` before the engine was ready although the engine default is
  `medium`.
- `<GameFXTarget>`'s animated styles carry explicit `'worklet'` directives, so they do not depend
  on the app's Babel setup transforming them automatically.

### Known issues (not addressed in this release candidate)

- On the owner's Android device (Phase 4.5 check): the fire border reads as a soft, even halo
  with little flame detail; a card at the moment of impact looks washed out grey; some particles
  leave the demo boxes.
- No measurements on a phone or emulator yet; iOS has never been run.
- See [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) and
  [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).
