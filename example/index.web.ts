// Web only: React Native Skia needs CanvasKit (WebAssembly) loaded before the app imports Skia.
// canvaskit.wasm is copied to public/ by `npm run web:prepare`.
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web';
import { registerRootComponent } from 'expo';

void LoadSkiaWeb({ locateFile: (file: string) => `/${file}` }).then(async () => {
  const { default: App } = await import('./App');
  registerRootComponent(App);
});
