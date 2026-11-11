# React Native 2D Game Animation SDK — Claude Code Project Instructions

## Mission
Build a reusable, maintainable, production-oriented 2D animation SDK for React Native applications. The first consumer is **Belote Tunisienne**, a mobile card game for Android and iOS, but the SDK must remain game-agnostic and usable in other 2D games.

The SDK should provide elegant, fluid card animations, timelines, keyframes, particles, scene composition, and effect presets. Its public API should be pleasant to use from TypeScript and React Native. **Do not build a general-purpose Unity replacement or a visual animation editor in the initial scope.**

## Non-negotiable rules
1. **Inspect before changing.** Read the actual repository, package manager, Expo SDK, React Native version, dependencies, tests, and architecture before proposing installs or code edits. Never assume version compatibility.
2. **Protect the existing game.** Never alter Belote rules, scoring, server authority, authentication, networking contracts, or existing user data to accommodate animation behavior.
3. **Separate state and presentation.** Animations visualize authoritative game events; animation completion must never determine whether a game action is valid or committed. Handle interruption, skipped animations, reconnection, duplicate events, and navigation safely.
4. **Work incrementally.** Finish one coherent, independently testable slice before beginning the next. Do not implement every requested phase in one unreviewable change.
5. **Test what you build.** Run actual commands, fix failing tests, and clearly distinguish tests executed from tests merely recommended. Do not fabricate benchmarks, screenshots, simulator/device results, or success claims.
6. **Do not weaken checks.** Never hide failures by disabling tests, ignoring TypeScript errors, lowering coverage thresholds, or adding broad `any`/`@ts-ignore` workarounds without justification.
7. **No unauthorized release actions.** Do not deploy, publish packages, upload to app stores, rotate credentials, delete user data, force-push, or modify production infrastructure without explicit approval.
8. **Protect secrets and privacy.** Do not commit API keys, Apple credentials, tokens, personal data, `.env` files, or diagnostic output containing secrets. Use synthetic demo data.
9. **Minimize dependencies and native changes.** Prefer stable existing libraries, justify every new dependency, and document any required custom dev client or native rebuild.
10. **Keep work reversible.** Use a dedicated feature branch when Git is available; inspect the worktree before changes and never discard unrelated work.

## Proposed technical direction — verify against the repository
- Primary language: **TypeScript**, strict mode, typed public interfaces.
- Core: platform-independent timeline, animation clock, keyframes, easing, interpolation, composition, cancellation, replay, and deterministic simulation.
- Rendering: **React Native Reanimated** for UI-thread-friendly transforms; **React Native Skia** for custom 2D drawing, particles, and visual effects where appropriate.
- Optional asset adapters: sprite sheets or Rive only when justified. Do not impose Rive, Skia, or native modules on features that do not need them.
- Support Android and iOS; document the actual supported React Native / Expo / Reanimated / Skia versions after inspection.
- Keep animation descriptions and scene coordinates independent of screen resolution. Separate logical coordinates from pixel scaling and safe areas.
- Avoid React state updates each animation frame. Profile render-thread and JS-thread work before optimizing.
- Define clear ownership of clocks, handles, assets, cleanup, lifecycle, and asynchronous completion.
- Prefer small composable modules to a monolithic engine. Preserve public API compatibility once consumers depend on it.

## Public API principles
Offer high-level, declarative operations such as:

```ts
await animations.sequence([
  animations.moveCard({ cardId: 'ace-spades', from: { x: 0, y: 0 }, to: { x: 200, y: 140 }, duration: 450 }),
  animations.effect('gold-sparks', { x: 200, y: 140, duration: 600 }),
]).play();
```

This is a **design illustration, not a frozen contract**. Decide whether constructors return handles or promises, keep semantics consistent, and document cancellation and errors. Do not expose renderer-specific implementation details unnecessarily.

## Initial feature scope
**Core:** timelines; sequential/parallel/staggered composition; keyframes; easing; cubic Bézier paths; transform interpolation; delays/repeats; pause/resume/seek/cancel; lifecycle-safe callbacks; deterministic virtual clock.

**Card presets:** deal, fan, shuffle, flip, move, rotate, select/highlight, stack, and collect. Support ordered overlap, orientation, dynamic start/end locations, and responsive layouts.

**Effects:** configurable score popup, glow/pulse, confetti, particles, golden sparks, celebration, and subtle screen shake. Use bounded particle lifetimes, pooling/cleanup when warranted, and accessible quality settings.

**Integration:** simple React hooks/components, feature flags, reduced-motion support, safe animation reconciliation with authoritative game events, and isolated demo scenes.

**Out of initial scope:** full physics simulation, 3D engine, multiplayer transport, game-rule implementation, visual editor, asset store, and generic scene scripting language.

## Development phases and completion gates
Follow the separate phase-specific implementation prompts. Never assume a phase is complete based solely on existing files.

1. **Repository audit and architecture:** inspect dependencies/constraints, run baseline checks, propose package boundaries, create documented plan. Do not redesign unrelated production code.
2. **Core engine:** build deterministic timing/interpolation/composition APIs with unit tests and a virtual clock.
3. **React Native rendering + cards:** integrate compatible renderers, implement card primitives, provide an isolated demo and integration tests.
4. **Effects:** implement particles, presets, resource cleanup, stress tests, and measured optimization.
5. **Belote Tunisienne integration:** wire real game events behind a feature flag, without changing game rules/networking, with regression and interruption tests.
6. **Stabilization and packaging:** audit memory/performance, test on available platforms, document API/peer dependencies, and prepare a release candidate without publishing it.

At the end of each phase, update `docs/PROGRESS.md` with: finished tasks, exact test commands and outcomes, changed files, known failures, assumptions, next phase, and pending decisions. Create this document on the first phase if missing. Only mark a phase done when its acceptance criteria are demonstrated.

## Testing policy
- Discover and use the project's actual package manager, scripts, test framework, lint rules, and CI conventions. Do not invent or silently replace them.
- Write focused tests alongside each feature. Use a fake/virtual clock to verify deterministic positions at specific timestamps, not real-time sleeps.
- Test zero/negative durations, invalid values, cancellation, completion callbacks, repeat logic, unmount, concurrent animations, screen resizing, and reduced motion.
- Test card ordering/stacking, interruptions, reconnection, duplicate game events, and state synchronization where applicable.
- Run targeted tests during development, then type-check, lint, all relevant tests, and supported builds at phase boundaries.
- If an environment cannot run iOS/Android or GPU profiling, state that explicitly. Unit tests and web previews are **not** proof of native device performance.
- Aim for smooth 60 FPS on representative supported devices, but report only **measured** FPS, device, build mode, scene, and method. Record baseline before claiming improvements.
- Use screenshot tests only for actual rendered output; avoid AI-recreated screenshots as evidence of visual correctness.

## Code quality and structure
- Maintain a stable, typed public API and clear module exports; document deprecations if contracts change.
- Prefer pure functions for interpolation/math and dependency injection for time, randomness, and rendering.
- Use consistent naming and existing formatter/linter conventions; do not introduce a new style system unless needed.
- Keep business logic, animation orchestration, and rendering adapters in separate modules.
- Limit per-frame allocations; cancel subscriptions, worklets, timers, effects, and resources on teardown.
- Validate incoming configuration, fail predictably, and avoid unhandled promise rejections.
- Track dependency constraints as peer dependencies if publishing a reusable package.
- Do not copy proprietary assets, code, or engine internals from Candy Crush or other commercial games.

## Preferred documentation
Keep documents concise and maintained as features become real:
- `README.md`: installation, compatibility, quick start.
- `docs/ARCHITECTURE.md`: module boundaries, clocks, render adapters, lifecycle, game-state reconciliation.
- `docs/PROGRESS.md`: phase status and exact verification evidence.
- `docs/API.md`: public API, examples, lifecycle, cancellation/error semantics.
- `docs/PERFORMANCE.md`: reproducible benchmarks, devices, and limitations.

If names or locations conflict with existing project conventions, adapt them and document the decision.

## Working procedure for every coding task
1. Restate the goal and scope in a few sentences.
2. Inspect relevant files and repository status; identify constraints and baseline failures.
3. State a short implementation plan and acceptance criteria.
4. Make the smallest coherent implementation, preferably with tests first.
5. Execute relevant tests/checks and fix root causes where possible.
6. Review the diff for unrelated changes, new dependencies, secrets, and resource leaks.
7. Report **what changed**, **what was actually verified**, **what failed or could not run**, and **what comes next**.

Avoid asking for confirmation on routine reversible coding decisions. Ask before breaking API changes, substantial dependency upgrades, native configuration changes, deleting data, publishing, or deploying.

## Phase status at project creation
No implementation phase is assumed complete. Begin with repository inspection and Phase 1. Update progress only from observed evidence.
