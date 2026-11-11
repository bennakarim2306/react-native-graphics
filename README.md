# react-native-graphics

A game-agnostic 2D animation SDK for React Native games: timelines, keyframes, card animation presets, particles and effects. The first consumer is the mobile card game Belote Tunisienne, but the SDK contains no game rules.

> **Status: Phase 1 (repository audit and architecture) only.** There is no usable animation API yet. See [docs/PROGRESS.md](docs/PROGRESS.md).

## Compatibility

Not decided yet. The target React Native, Expo, Reanimated and Skia versions depend on the Belote Tunisienne app, which has not been inspected. See the "Pending decisions" section of [docs/PROGRESS.md](docs/PROGRESS.md).

## Development

Requires Node 22 (see `.nvmrc`) and npm.

```sh
npm ci
npm run check      # typecheck + lint + test + build
```

| Script | What it does |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` in strict mode |
| `npm run lint` | ESLint with `typescript-eslint` strict type-checked rules |
| `npm test` | Jest unit tests (`src/**/*.test.ts`) |
| `npm run build` | Emits JS and `.d.ts` to `lib/` |

The package is marked `private` so it cannot be published by accident.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): proposed module boundaries, clocks, render adapters, lifecycle and game-state reconciliation.
- [docs/PROGRESS.md](docs/PROGRESS.md): phase status and verification evidence.
- [CLAUDE.md](CLAUDE.md): project rules and phase plan.
