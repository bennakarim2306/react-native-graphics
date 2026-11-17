// Creates (or refreshes) the independent consumer app OUTSIDE this repository and installs the
// SDK there from a freshly packed tarball, like a third-party app would.
//
//   node scripts/install-consumer.mjs [target-folder]
//
// The default target is ../gamefx-consumer-test next to this repository. The app's sources
// come from consumer/ in this repository; node_modules is never shared with the SDK, so
// nothing can resolve into the SDK's sources or its dev dependencies.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { buildSdk, packSdk, repoRoot, run } from './sdk-pack.mjs';

const target = resolve(process.argv[2] ?? join(repoRoot, '..', 'gamefx-consumer-test'));
const inside = target === repoRoot || target.startsWith(repoRoot + sep);
if (inside) throw new Error(`The consumer must live outside the SDK repository (got ${target}).`);

const template = join(repoRoot, 'consumer');
const skip = new Set(['node_modules', 'vendor', '.expo', 'dist-web', 'dist-android', 'dist-ios', 'public', 'web-smoke-out']);
mkdirSync(target, { recursive: true });
cpSync(template, target, {
  recursive: true,
  filter: (source) => !skip.has(relative(template, source).split(sep)[0] ?? ''),
});
console.log(`Consumer sources copied to ${target}`);

buildSdk();
const { tarball, info } = packSdk(join(target, 'vendor'));
console.log(`Packed ${info.filename} (${String(info.entryCount)} files, ${String(Math.round(info.unpackedSize / 1024))} KiB unpacked)`);
const spec = `./${relative(target, tarball).split(sep).join('/')}`;
run('npm', ['install', '--no-audit', '--no-fund', spec], { cwd: target });
if (!existsSync(join(target, 'node_modules', 'react-native-graphics', 'package.json'))) {
  throw new Error('The SDK was not installed into the consumer.');
}
console.log(`\nDone. Next:\n  cd ${target}\n  npx expo start`);
