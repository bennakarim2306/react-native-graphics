// Web only: React Native Skia renders with CanvasKit (WebAssembly), which must be loaded before
// anything imports Skia. `npm run web:prepare` copies canvaskit.wasm to public/.
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web';
import { registerRootComponent } from 'expo';

void LoadSkiaWeb({ locateFile: (file: string) => `/${file}` }).then(async () => {
  const { default: App } = await import('./App');
  registerRootComponent(App);
});
