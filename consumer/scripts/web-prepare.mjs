// Copies CanvasKit's WebAssembly next to the web build (React Native Skia on the web needs it).
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
mkdirSync('public', { recursive: true });
copyFileSync(require.resolve('canvaskit-wasm/bin/full/canvaskit.wasm'), 'public/canvaskit.wasm');
console.log('public/canvaskit.wasm ready');
