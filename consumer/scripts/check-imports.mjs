// Proves that this app uses the SDK like any third-party app:
//  - its code imports only the documented entry points `react-native-graphics` and
//    `react-native-graphics/core`, never files inside the package or the SDK's sources;
//  - no relative import leaves the app folder;
//  - no TypeScript path alias, Metro or Babel setting points into the SDK repository;
//  - the SDK in node_modules is a real installed copy of a packed tarball, not a link.
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';

const root = resolve('.');
const require = createRequire(join(root, 'package.json'));
const ts = require('typescript');
const problems = [];
const skip = new Set(['node_modules', 'vendor', '.expo', 'public', 'web-smoke-out']);
const allowedSdk = new Set(['react-native-graphics', 'react-native-graphics/core']);

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (skip.has(entry.name) || entry.name.startsWith('dist-')) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /\.(tsx?|jsx?|mjs|cjs)$/.test(entry.name) ? [path] : [];
  });
}

let sdkImports = 0;
const used = new Set();
const files = walk(root);
for (const file of files) {
  const { importedFiles } = ts.preProcessFile(readFileSync(file, 'utf8'), true, true);
  for (const { fileName: spec } of importedFiles) {
    const where = relative(root, file);
    if (spec.startsWith('.')) {
      const target = resolve(dirname(file), spec);
      if (target !== root && !target.startsWith(root + sep)) problems.push(`${where}: "${spec}" leaves the app folder`);
    } else if (spec.startsWith('/') || /^[A-Za-z]:[\\/]/.test(spec)) {
      problems.push(`${where}: absolute import "${spec}"`);
    } else if (spec === 'react-native-graphics' || spec.startsWith('react-native-graphics/')) {
      sdkImports++;
      used.add(spec);
      if (!allowedSdk.has(spec)) problems.push(`${where}: "${spec}" is not a documented entry point`);
    }
  }
}

const tsconfig = readFileSync('tsconfig.json', 'utf8');
if (/"paths"\s*:|"baseUrl"\s*:|"rootDirs"\s*:/.test(tsconfig)) problems.push('tsconfig.json defines path aliases');
for (const config of ['metro.config.js', 'babel.config.js', 'metro.config.cjs', 'babel.config.cjs']) {
  if (existsSync(config) && /\.\.[\\/]|watchFolders|extraNodeModules|module-resolver/.test(readFileSync(config, 'utf8'))) {
    problems.push(`${config} points outside the app or aliases modules`);
  }
}

const installed = join(root, 'node_modules', 'react-native-graphics');
let version = 'missing';
if (!existsSync(installed)) problems.push('react-native-graphics is not installed (run npm run consumer:install in the SDK repository)');
else {
  if (lstatSync(installed).isSymbolicLink()) problems.push('node_modules/react-native-graphics is a symlink, not an installed package');
  version = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8')).version;
  const lock = existsSync('package-lock.json') ? JSON.parse(readFileSync('package-lock.json', 'utf8')) : null;
  const resolved = lock?.packages?.['node_modules/react-native-graphics']?.resolved ?? '';
  if (!/^file:vendor\/react-native-graphics-.*\.tgz$/.test(resolved)) problems.push(`the lockfile resolves the SDK to "${resolved}", not a tarball in vendor/`);
}

console.log(`${String(files.length)} files scanned, ${String(sdkImports)} SDK imports (${[...used].sort().join(', ')}), installed SDK ${version}`);
if (problems.length) {
  console.error(`Import boundary violated:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log('OK: only public entry points, nothing outside the app, SDK installed from a packed tarball.');
