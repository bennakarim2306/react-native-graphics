// Builds the SDK into lib/:
//   lib/module      ES modules for bundlers (Metro, webpack); also type-checks the sources
//   lib/commonjs    CommonJS for Node and Jest (per-file transpilation of the same sources)
//   lib/typescript  declarations (with declaration maps into src/)
// lib/ is removed first, so files of deleted sources never ship.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ts = require('typescript');
const tsc = require.resolve('typescript/bin/tsc');

rmSync(join(root, 'lib'), { recursive: true, force: true });
for (const project of ['tsconfig.build.json', 'tsconfig.build.types.json']) {
  execFileSync(process.execPath, [tsc, '-p', project], { stdio: 'inherit', cwd: root });
}

const isSource = (file) => /\.tsx?$/.test(file) && !/\.d\.ts$/.test(file) && !/\.test\.tsx?$/.test(file);
function sources(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path);
    return isSource(name) ? [path] : [];
  });
}

let count = 0;
for (const file of sources(join(root, 'src'))) {
  const out = join(root, 'lib/commonjs', relative(join(root, 'src'), file)).replace(/\.tsx?$/, '.js');
  mkdirSync(dirname(out), { recursive: true });
  const result = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: relative(dirname(out), file),
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
      isolatedModules: true,
      sourceMap: true,
    },
  });
  if (result.diagnostics?.length) {
    throw new Error(`${file}: ${ts.flattenDiagnosticMessageText(result.diagnostics[0].messageText, '\n')}`);
  }
  writeFileSync(out, result.outputText);
  const map = JSON.parse(result.sourceMapText);
  map.sources = [relative(dirname(out), file).split('\\').join('/')];
  writeFileSync(`${out}.map`, JSON.stringify(map));
  count++;
}
console.log(`lib/module, lib/typescript and lib/commonjs (${count} files) built`);
