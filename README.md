# react-native-graphics

An embeddable 2D game-effects engine for existing React Native apps. Mount one transparent overlay and trigger particles, sprites, celebrations and motion effects through a typed API, without writing animation internals. Game rules and app state stay in your app.

> **Status: Phase 0 (audit and architecture) only.** There is no usable effects API yet. See [docs/PROGRESS.md](docs/PROGRESS.md).

## Compatibility

Not verified yet. The proposed baseline is Expo SDK 58: React Native 0.88 (New Architecture), React 19.3, `@shopify/react-native-skia` 2.14, `react-native-reanimated` 4.7 and `react-native-worklets` 0.13. These will be peer dependencies. No platform has been tested yet.

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

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): module boundaries, thread model, coordinate spaces, lifecycle.
- [docs/API.md](docs/API.md): public API (none yet).
- [docs/PERFORMANCE.md](docs/PERFORMANCE.md): measured performance (none yet).
- [docs/PROGRESS.md](docs/PROGRESS.md): phase status and verification evidence.
- [CLAUDE.md](CLAUDE.md): project rules and phase plan.
