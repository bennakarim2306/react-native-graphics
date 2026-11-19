// Lists the names a declaration or source entry point exports, split into runtime values and
// type-only names, with the TypeScript checker. Used by the package verification and to
// regenerate scripts/public-api.json after a deliberate API change:
//   node scripts/public-api.mjs --write
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { repoRoot } from './sdk-pack.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');

/** `{ values, types }` exported by each file (sorted). */
export function listExports(files) {
  const program = ts.createProgram(files, {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    types: [],
  });
  const checker = program.getTypeChecker();
  return files.map((file) => {
    const source = program.getSourceFile(file);
    if (!source) throw new Error(`Not found: ${file}`);
    const symbol = checker.getSymbolAtLocation(source);
    const values = [];
    const types = [];
    for (const item of symbol ? checker.getExportsOfModule(symbol) : []) {
      const target = item.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(item) : item;
      (target.flags & ts.SymbolFlags.Value ? values : types).push(item.name);
    }
    return { values: values.sort(), types: types.sort() };
  });
}

if (process.argv.includes('--write')) {
  const [index, core] = listExports([join(repoRoot, 'src/index.ts'), join(repoRoot, 'src/core.ts')]);
  const file = join(repoRoot, 'scripts/public-api.json');
  writeFileSync(file, `${JSON.stringify({ index, core }, null, 2)}\n`);
  console.log(`Wrote ${file}: index ${String(index.values.length)} values + ${String(index.types.length)} types, core ${String(core.values.length)} + ${String(core.types.length)}`);
}
