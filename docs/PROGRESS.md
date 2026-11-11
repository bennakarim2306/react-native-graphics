# Progress

## Phase 1: Repository audit and architecture

**Status: done** (2026-11-11), with one open input needed before Phase 3: the Belote Tunisienne app's versions (see Pending decisions).

### What the audit found

| Item | Finding |
| --- | --- |
| GitHub repository `bennakarim2306/react-native-graphics` | **Empty.** No commits, no branches, no code. |
| Local copy on the owner's PC | Contained only `CLAUDE.md` (uncommitted). It is now committed unchanged. |
| Existing code, tests, CI, lint, package manager | None. Everything in this phase is new; there were no conventions to follow or baseline failures to preserve. |
| Belote Tunisienne app | **Not available** in this repository or environment. Its React Native / Expo / Reanimated / Skia versions, architecture (New Architecture or not), and Expo Go vs. dev client are unknown. |

**Build environment used** (Linux cloud container): Node 22.23.4, npm 10.9.9 (yarn 1.22.22, pnpm 10.28.0, bun 1.4.4 also present). No Android SDK, `adb`, Xcode, emulator or physical device is available, so **no native build or on-device check was possible** in this phase.

**Current upstream versions checked on the npm registry** (2026-11-11), relevant for later phases:

| Package | Latest | Relevant peer requirements |
| --- | --- | --- |
| `react-native` | 0.88.1 | `react ^19.3.0` |
| `expo` | 58.0.23 | |
| `react-native-reanimated` | 4.7.1 | `react-native 0.86 - 0.88`, `react-native-worklets 0.13.x` (New Architecture only) |
| `@shopify/react-native-skia` | 2.14.0 | `react >=19`, `react-native >=0.78`, `react-native-reanimated >=4`, `react-native-worklets >=0.7` |
| `typescript` | 7.0.2 | Not usable yet: `ts-jest` needs `<7`, `typescript-eslint` needs `<6.1.0` |

If the Belote app is on an older React Native, Reanimated 3 / Skia 1.x may be required instead. This must be checked against the app, not assumed.

### Finished tasks

1. Audited the repository, the local folder and the toolchain (above).
2. Created a minimal TypeScript package skeleton. It is deliberately game-agnostic and has **no runtime or peer dependencies** yet, because RN/Reanimated/Skia versions must match the Belote app.
   - npm as package manager (no prior choice existed; it is the default for RN library templates).
   - TypeScript 5.9 in strict mode, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`.
   - Jest 30 with `babel-jest` (Babel 7, matching `@react-native/babel-preset`, so Phase 3 can switch presets without changing test runners).
   - ESLint 10 with `typescript-eslint` strict type-checked rules, and a `no-restricted-imports` rule that stops `src/core` from importing React, React Native or renderer code.
   - `private: true` in `package.json` to prevent accidental publishing.
   - GitHub Actions CI running typecheck, lint, test and build on pull requests and `main`.
3. Wrote the architecture proposal: module boundaries, spec/handle semantics, clocks, renderer adapters, lifecycle, game-event reconciliation and test strategy ([ARCHITECTURE.md](ARCHITECTURE.md)).
4. Wrote `README.md` with development commands.

### Verification (commands actually run, in the container)

| Command | Result |
| --- | --- |
| `npm install` (dev deps) | OK, 450 packages |
| `npm run typecheck` (`tsc --noEmit`) | Pass, exit 0 |
| `npm run lint` (`eslint .`) | Pass, exit 0, no warnings |
| `npm test` (`jest`) | Pass: 1 suite, 1 test (entry point exports version matching `package.json`) |
| `npm run build` (`tsc -p tsconfig.build.json`) | Pass, emits `lib/index.js`, `lib/index.d.ts` and maps |
| `npx eslint src/core/probe.ts` with a temporary `import 'react-native'` | **Fails as intended** with `no-restricted-imports`. Probe file deleted afterwards. |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `npm audit` (incl. dev) | 28 advisories (1 low, 27 moderate), all transitive through Jest 30 (`deepmerge`, `glob`). The only automatic fix downgrades to Jest 25, so it was not applied. Dev-only, not shipped. |

Not run: native Android/iOS builds, device or emulator tests, performance measurements. None are meaningful before Phase 3, and the environment cannot run them.

The GitHub Actions workflow has been added but its result on the pull request is reported separately once it runs.

### Changed files

All new: `CLAUDE.md`, `README.md`, `package.json`, `package-lock.json`, `.gitignore`, `.nvmrc`, `tsconfig.json`, `tsconfig.build.json`, `babel.config.js`, `jest.config.js`, `eslint.config.mjs`, `.github/workflows/ci.yml`, `src/index.ts`, `src/index.test.ts`, `docs/ARCHITECTURE.md`, `docs/PROGRESS.md`.

### Assumptions

- The SDK lives in its own repository and the Belote app consumes it as a dependency (for example via a git or local path dependency during development). The Belote app code is not modified in Phases 1 to 4.
- The Belote app can run the New Architecture, since Reanimated 4 requires it. To be confirmed.
- Single package with internal modules is enough until a second consumer needs the core without React Native.

### Known failures

None in the checks above.

### Pending decisions

1. **Belote app versions (needed before Phase 3).** Please share the app's `package.json` (and `app.json`/`app.config.*` if it uses Expo), or give access to its repository. This decides the Reanimated/Skia major versions and whether a custom dev client is required.
2. **Handle/promise semantics.** Proposal: `play()` returns a handle with `finished: Promise<{ status }>` that resolves on cancel instead of rejecting (details in ARCHITECTURE.md). Phase 2 will implement this unless you prefer otherwise.
3. **Formatter.** No Prettier was added (minimizing dependencies). Recommended to add one before the codebase grows.
4. **License.** Set to `UNLICENSED` for now.

### Next phase

**Phase 2: Core engine** (not started). Platform-independent `src/core`: `Clock`/`VirtualClock`, easing and cubic Bezier, interpolation, keyframes, timeline with delay/repeat, `sequence`/`parallel`/`stagger`, pause/resume/seek/cancel/finish, seeded RNG, all covered by deterministic unit tests. It does not depend on the pending Belote versions.
