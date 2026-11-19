// Validates the SDK tarball, not just the build: packs it, checks what is inside, installs it
// into an empty project outside the repository and loads it from there.
//
//   node scripts/verify-package.mjs [--keep] [--report <file.json>]
//
// Fails (exit code 1) when an entry point is missing, a test, screenshot or secret would ship,
// a file in lib/ imports something that is neither in the tarball nor a peer dependency, the
// exported names differ from scripts/public-api.json, or `react-native-graphics/core` cannot be
// loaded in plain Node (CommonJS and ES module import) without React Native installed.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { basename, dirname, join, posix } from 'node:path';
import { buildSdk, packSdk, repoRoot, run } from './sdk-pack.mjs';
import { listExports } from './public-api.mjs';

const keep = process.argv.includes('--keep');
const reportIndex = process.argv.indexOf('--report');
const reportFile = reportIndex > 0 ? process.argv[reportIndex + 1] : undefined;
const problems = [];
const fail = (message) => problems.push(message);
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const expected = JSON.parse(readFileSync(join(repoRoot, 'scripts/public-api.json'), 'utf8'));

buildSdk();
const work = mkdtempSync(join(tmpdir(), 'gamefx-pack-'));
const { tarball, info } = packSdk(join(work, 'pack'));
const files = new Set(info.files.map((f) => f.path));
console.log(`${info.filename}: ${String(info.entryCount)} files, ${(info.size / 1024).toFixed(0)} KiB packed, ${(info.unpackedSize / 1024).toFixed(0)} KiB unpacked`);

// 1. Contents: nothing that does not belong in an installed SDK.
const forbidden = [
  [/\.test\.tsx?$|\.test\.js$/, 'test file'],
  [/(^|\/)__tests__\//, 'test fixture'],
  [/\.(png|jpe?g|gif|webp|mp4|mov)$/i, 'image or video'],
  [/(^|\/)\.env/, 'environment file'],
  [/\.tsbuildinfo$/, 'build cache'],
  [/^(example|consumer|docs|scripts|coverage|node_modules|visual-out)\//, 'repository-only folder'],
  [/\.(pem|key|p12|keystore)$/i, 'key material'],
];
for (const file of files) {
  for (const [pattern, what] of forbidden) if (pattern.test(file)) fail(`${what} in the package: ${file}`);
}
if (pkg.private !== true) fail('package.json must stay "private": true until the owner approves publishing');

// 2. Every entry point the manifest names exists.
const targets = [pkg.main, pkg.module, pkg.types, pkg['react-native']];
const walk = (value) => {
  if (typeof value === 'string') targets.push(value);
  else if (value && typeof value === 'object') Object.values(value).forEach(walk);
};
walk(pkg.exports);
walk(pkg.typesVersions);
for (const target of targets) {
  const path = posix.normalize(target);
  if (!files.has(path)) fail(`entry point missing from the package: ${target}`);
}
for (const required of ['package.json', 'README.md', 'CHANGELOG.md']) if (!files.has(required)) fail(`${required} missing`);

// 3. Each ES module has a CommonJS twin, a declaration and source maps whose sources ship.
const modules = [...files].filter((f) => f.startsWith('lib/module/') && f.endsWith('.js'));
for (const file of modules) {
  const rest = file.slice('lib/module/'.length);
  for (const twin of [`lib/commonjs/${rest}`, `lib/typescript/${rest.replace(/\.js$/, '.d.ts')}`, `${file}.map`, `lib/commonjs/${rest}.map`]) {
    if (!files.has(twin)) fail(`${twin} missing (counterpart of ${file})`);
  }
}

// 4. Imports inside lib/ resolve to packaged files or to declared peer dependencies.
const peers = new Set(Object.keys(pkg.peerDependencies ?? {}));
const allowedBare = (spec) => {
  const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
  return peers.has(name);
};
// A bare file name: GNU tar (Git for Windows) reads `C:\...` as a remote host, Windows' tar does not.
run('tar', ['-xzf', basename(tarball)], { cwd: dirname(tarball) });
const packageDir = join(work, 'pack', 'package');
// TypeScript's pre-processor finds real imports, requires and dynamic imports (not comments).
const ts = createRequire(import.meta.url)('typescript');
for (const file of [...files].filter((f) => /^lib\/.*\.(js|d\.ts)$/.test(f))) {
  const text = readFileSync(join(packageDir, file), 'utf8');
  const specs = ts.preProcessFile(text, true, true).importedFiles.map((f) => f.fileName);
  for (const spec of specs) {
    if (spec.startsWith('.')) {
      const base = posix.normalize(posix.join(posix.dirname(file), spec));
      const candidates = file.endsWith('.d.ts')
        ? [`${base}.d.ts`, `${base}/index.d.ts`, base]
        : [base, `${base}.js`, `${base}/index.js`];
      if (!candidates.some((c) => files.has(c))) fail(`${file}: "${spec}" does not resolve inside the package`);
    } else if (!allowedBare(spec)) {
      fail(`${file}: imports "${spec}", which is not a peer dependency`);
    }
  }
}
for (const file of [...files].filter((f) => f.endsWith('.map'))) {
  const map = JSON.parse(readFileSync(join(packageDir, file), 'utf8'));
  for (const source of map.sources ?? []) {
    const path = posix.normalize(posix.join(posix.dirname(file), source));
    if (!files.has(path)) fail(`${file}: source ${source} is not in the package`);
  }
}

// 5. The declared public API is exactly scripts/public-api.json.
const [indexApi, coreApi] = listExports([join(packageDir, 'lib/typescript/index.d.ts'), join(packageDir, 'lib/typescript/core.d.ts')]);
const diff = (label, actual, wanted) => {
  const extra = actual.filter((n) => !wanted.includes(n));
  const missing = wanted.filter((n) => !actual.includes(n));
  if (extra.length || missing.length) {
    fail(`${label}: unexpected [${extra.join(', ')}], missing [${missing.join(', ')}] (run node scripts/public-api.mjs --write after a deliberate change)`);
  }
};
diff('index values', indexApi.values, expected.index.values);
diff('index types', indexApi.types, expected.index.types);
diff('core values', coreApi.values, expected.core.values);
diff('core types', coreApi.types, expected.core.types);

// 6. Install into an empty project (peers not installed) and load ./core in plain Node.
const project = join(work, 'project');
mkdirSync(project, { recursive: true });
run('npm', ['init', '-y'], { cwd: project, capture: true });
run('npm', ['install', '--no-audit', '--no-fund', '--legacy-peer-deps', '--ignore-scripts', tarball], { cwd: project, capture: true });
const probe = `
const core = require('react-native-graphics/core');
const keys = Object.keys(core).filter((k) => k !== '__esModule').sort();
let blocked = false;
try { require('react-native-graphics/lib/commonjs/core.js'); } catch (e) { blocked = e.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED'; }
const clock = new core.VirtualClock();
const engine = core.createEngine({ clock, effects: core.builtInEffects });
const handle = engine.play('particle-burst', { position: { x: 10, y: 10 }, count: 12 });
clock.advance(3000, { frameMs: 16 });
engine.dispose();
process.stdout.write(JSON.stringify({ keys, blocked, version: core.SDK_VERSION, status: handle.status, resolved: require.resolve('react-native-graphics/core') }));
`;
const cjs = JSON.parse(run(process.execPath, ['-e', probe], { cwd: project, capture: true }));
diff('core runtime (require)', cjs.keys, expected.core.values);
if (!cjs.blocked) fail('deep imports into lib/ are not blocked by the exports map');
if (cjs.version !== pkg.version) fail(`SDK_VERSION ${String(cjs.version)} differs from package.json ${String(pkg.version)}`);
if (cjs.status !== 'completed') fail(`a particle burst played through the installed ./core ended as ${String(cjs.status)}`);
if (!/lib[\\/]commonjs[\\/]core\.js$/.test(cjs.resolved)) fail(`Node resolved ./core to ${String(cjs.resolved)}, expected the CommonJS build`);
const esm = JSON.parse(
  run(process.execPath, ['--input-type=module', '-e', "import * as core from 'react-native-graphics/core'; process.stdout.write(JSON.stringify(Object.keys(core).filter((k) => k !== 'default' && k !== '__esModule').sort()));"], {
    cwd: project,
    capture: true,
  }),
);
diff('core runtime (import)', esm, expected.core.values);

const report = {
  tarball: info.filename,
  version: pkg.version,
  files: info.entryCount,
  packedKiB: Math.round(info.size / 1024),
  unpackedKiB: Math.round(info.unpackedSize / 1024),
  entryPoints: [...new Set(targets)].sort(),
  publicApi: { indexValues: indexApi.values.length, indexTypes: indexApi.types.length, coreValues: coreApi.values.length, coreTypes: coreApi.types.length },
  nodeRequireStatus: cjs.status,
  problems,
};
if (reportFile) writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
if (keep) console.log(`Kept ${work}`);
else rmSync(work, { recursive: true, force: true });
if (problems.length) {
  console.error(`\n${String(problems.length)} problem(s):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`Package OK: ${String(report.entryPoints.length)} entry points present, public API matches (${String(indexApi.values.length)} values, ${String(indexApi.types.length)} types), ./core loads in Node via require and import, deep imports blocked.`);
