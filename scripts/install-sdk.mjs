// Builds and packs the SDK, then installs the tarball into an app in this repository
// (the showcase: `node scripts/install-sdk.mjs example`). With --pack-only it only packs.
import { join, relative, resolve } from 'node:path';
import { buildSdk, packSdk, repoRoot, run } from './sdk-pack.mjs';

const [appArg, flag] = process.argv.slice(2);
if (!appArg) throw new Error('Usage: node scripts/install-sdk.mjs <app-folder> [--pack-only]');
const app = resolve(repoRoot, appArg);
buildSdk();
const { tarball } = packSdk(join(app, 'vendor'));
console.log(`Packed ${relative(repoRoot, tarball)}`);
if (flag !== '--pack-only') {
  // Installing the tarball by path refreshes its integrity entry in the app's lockfile.
  run('npm', ['install', '--no-audit', '--no-fund', `./${relative(app, tarball).split('\\').join('/')}`], { cwd: app });
}
