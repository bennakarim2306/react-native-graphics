# Release process

Nothing has been published. `package.json` keeps `"private": true` and `"license": "UNLICENSED"`,
and no git tag or GitHub release exists. Publishing, choosing a license, tagging and creating a
GitHub release each need the owner's explicit approval.

## Version: `0.1.0-rc.0`

- **0.x:** the public API is still allowed to change between minor versions, as semantic
  versioning permits before 1.0. 1.0 should wait for device measurements, an iOS run and a period
  of use in a real app (the Belote integration is Phase 6).
- **0.1.0:** the first version with a defined, pinned public surface (`scripts/public-api.json`),
  a distributable build and a changelog. The earlier `0.0.0` was a development placeholder.
- **`-rc.0`:** a release candidate: complete for review, not validated on devices yet. Later
  candidates are `rc.1`, `rc.2`, ...; the final `0.1.0` drops the suffix.
- `SDK_VERSION` in `src/version.ts` must equal `package.json`'s version (checked by
  `pack:verify`).

After 0.1.0: patch versions for fixes, minor versions for additions and (before 1.0) breaking
changes, each listed in CHANGELOG.md with a migration note.

## Package name (decision needed)

The working name is `react-native-graphics`. On 2026-11-17 the npm registry reported it as
"unpublished on 2022-08-19": an earlier package used the name and was removed. npm normally lets
an unpublished name be reused after 24 hours, but the registry decides when you publish, and the
old package's history can confuse users. The name also says little about game effects.

Alternatives that were free on the same day: `react-native-gamefx`, `react-native-game-fx`,
`rn-gamefx`, and the scope `@react-native-gamefx` (for example `@react-native-gamefx/core`, the
name used in the project brief; the scope would have to be created as an npm organization).
Renaming means changing `name` in `package.json`, the imports in `example/` and `consumer/`,
the install scripts and the docs. `scripts/public-api.json` is unaffected (it lists export names
only).

## Producing a release candidate archive

From the repository root (PowerShell: one line at a time):

```sh
npm ci
npm run check
npm pack
```

`npm run check` ends with `pack:verify`, which builds the package, packs it into a temporary
folder and validates it (see [TESTING.md](TESTING.md#package-validation)). `npm pack` then writes
`react-native-graphics-0.1.0-rc.0.tgz` in the repository root (ignored by git). `npm pack --dry-run`
lists the files without writing the archive. The archive is what apps install (see
[INSTALLATION.md](INSTALLATION.md)).

## Release checklist

Before tagging or publishing anything:

1. CI is green on the release commit (`check`, `example`, `consumer`, `windows`).
2. `npm run check` passes locally, and `npm pack --dry-run` lists only `lib/`, `src/` (without
   tests), `README.md`, `CHANGELOG.md` and `package.json`.
3. The consumer app, installed with `npm run consumer:install`, runs on an Android device or
   emulator: screens A to H, both self-tests on F print PASS, and the benchmark results are
   recorded in [PERFORMANCE.md](PERFORMANCE.md) with device, OS and build mode.
4. iOS: the same on a simulator or device, or the release notes say iOS is unverified.
5. CHANGELOG.md: the version's section is complete (breaking changes with migration notes).
6. `version` in `package.json` and `SDK_VERSION` updated together.
7. Owner decisions recorded: package name, license, registry and access (public, restricted or a
   private registry).
8. Only then, with approval: remove `"private": true`, set the license, `npm publish` (with
   `--tag next` for release candidates), create the git tag `v<version>` and the GitHub release.

## What is not automated on purpose

CI does not publish, tag or create releases. There is no `prepublishOnly` or install script in
the package; installing it runs no code.
