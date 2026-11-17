/**
 * Public entry point of the SDK (React Native). Everything in `react-native-graphics/core`
 * (the platform-independent engine) plus the React Native integration and the Skia renderer.
 * Every exported name is listed explicitly; see docs/API.md, "Public and internal API".
 */
export * from './core';

// --- React Native integration --------------------------------------------------------------
export {
  createDefaultClock,
  createSkiaImageLoader,
  GameFXOverlay,
  GameFXProvider,
  GameFXTarget,
  useGameFX,
  useGameFXAssets,
  useGameFXEngine,
} from './react-native';
export type {
  AssetsStatus,
  AttachableEffect,
  AttachEffectSpec,
  CustomEffectName,
  GameFX,
  GameFXAssetsState,
  GameFXOverlayProps,
  GameFXProviderProps,
  GameFXTargetProps,
  ImageSource,
} from './react-native';

// --- Skia renderer -------------------------------------------------------------------------
export { SkiaEffectsRenderer } from './renderer/skia/SkiaEffectsRenderer';
export type { CameraTransform, DrawStats, RendererCapabilities, RendererWarning, SkiaFactory } from './renderer/skia/SkiaEffectsRenderer';
