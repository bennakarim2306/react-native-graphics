/**
 * Platform-independent part of the SDK: runtime, animation model, scene graph, engine,
 * graphics descriptions (paints, paths, shaders, node effects), assets, sprites, particle
 * simulation, motion helpers and effect definitions.
 * Importable without React Native (for example in Node tests or tools):
 * `import { createEngine } from 'react-native-graphics/core'`.
 *
 * Every name exported here is public API, listed explicitly. Modules may export more for the
 * SDK's own use (the particle pool's buffers, shape samplers, curve resolvers, the event
 * emitter, the burn-away geometry helpers, effect instance classes); those are internal and
 * may change in any release. See docs/API.md, "Public and internal API".
 */

// --- Engine, effect handles and composition --------------------------------------------
export { createEngine, EffectCue, Engine, throwAndExplode } from './engine';
export type {
  AttachSpec,
  CueHost,
  CueOptions,
  CueParams,
  EffectHandle,
  EffectResult,
  EffectStatus,
  EngineEvents,
  EngineOptions,
  EngineState,
  EngineStats,
  FrameEvent,
  PlayOptions,
  TargetParams,
  ThrowAndExplodeOptions,
  ThrowAndExplodeSequence,
} from './engine';

// --- Runtime: clocks, errors, randomness, quality, custom effects -----------------------
export {
  AdaptiveQuality,
  contextQuality,
  createRandom,
  DEFAULT_QUALITY,
  defineEffect,
  DisposedError,
  FrameClock,
  InvalidOptionError,
  NotReadyError,
  QUALITY_PROFILES,
  resolveQuality,
  VirtualClock,
} from './runtime';
export type {
  AdaptiveQualityOptions,
  Clock,
  Drawable,
  EffectCapabilities,
  EffectContext,
  EffectDefinition,
  EffectInstance,
  EffectServices,
  ErrorReporter,
  FrameSchedulerFunctions,
  Listener,
  QualityLevel,
  QualityProfile,
  Random,
  TargetConcealment,
  TargetSnapshot,
  TransformOffset,
  Unsubscribe,
} from './runtime';

// --- Built-in effects and effect building blocks ---------------------------------------
export {
  builtInEffects,
  burnAway,
  CONFETTI_COLORS,
  confetti,
  DEFAULT_BURST_COLORS,
  defineComposite,
  energyBorder,
  EXPLOSION_COLORS,
  explosion,
  fireBorder,
  flash,
  GOLD_COLORS,
  glowBorder,
  glowPulse,
  goldenSparks,
  particleBurst,
  particles,
  Placement,
  resolveBurstParams,
  screenShake,
  shockwave,
  SMOKE_COLORS,
  smoke,
  trail,
  victory,
} from './effects';
export type {
  BorderParams,
  BuiltInEffects,
  BurnAwayParams,
  BurnOrigin,
  CompositeDefinition,
  CompositeLayer,
  ConfettiParams,
  ExplosionParams,
  FireBorderParams,
  FireBorderShape,
  FlashParams,
  FromTo,
  GlowBorderParams,
  GlowPulseParams,
  GoldenSparksParams,
  ParticleBurstParams,
  ParticlesParams,
  ParticlesUpdate,
  PlacementParams,
  Range,
  ScreenShakeParams,
  ShaderBorderParams,
  ShockwaveParams,
  SmokeParams,
  TrailParams,
  VictoryParams,
} from './effects';

// --- Animation: tweens, keyframes, timelines, playbacks ---------------------------------
export {
  cubicBezier,
  easings,
  isAnimationTarget,
  KeyframeAnimation,
  keyframes,
  objectTarget,
  parallel,
  Playable,
  PropertyAnimation,
  resolveEasing,
  sequence,
  stagger,
  Timeline,
  timeline,
  Tween,
  tween,
  Wait,
  wait,
} from './animation';
export type {
  AnimationTarget,
  Easing,
  EasingFunction,
  EasingName,
  Keyframe,
  KeyframeOptions,
  MarkerEvent,
  MarkerInfo,
  Overwrite,
  PlayableOptions,
  PlayableRunner,
  Playback,
  PlaybackEvents,
  PlaybackResult,
  PlaybackStatus,
  PropertyAnimationOptions,
  TargetProperty,
  TimelinePosition,
  TweenOptions,
  TweenVars,
} from './animation';

// --- Motion ------------------------------------------------------------------------------
export { ThrowMotion } from './motion';
export type { ThrowOptions, ThrowTarget } from './motion';

// --- Scene graph, targets and coordinates ------------------------------------------------
export {
  applyToPoint,
  composeTransform,
  createHostViewBinding,
  IDENTITY,
  imageSize,
  invert,
  isSceneDrawable,
  isTargetHandle,
  multiply,
  rotationOf,
  scaleOf,
  Scene,
  SceneNode,
  shapeBounds,
  syncNodeToLayout,
  TargetMotion,
  TargetRegistry,
  validateShape,
} from './scene';
export type {
  AttachOptions,
  Attachment,
  AttachmentHandle,
  AttachmentState,
  Bounds,
  CircleShape,
  DetachReason,
  EllipseShape,
  HostLayout,
  HostViewBinding,
  ImageShape,
  Matrix2D,
  NodeOptions,
  NodeProperty,
  NodeShape,
  PathShape,
  Point,
  RectShape,
  SceneCommand,
  SceneDrawable,
  SceneDrawItem,
  SceneGroupCommand,
  SceneOptions,
  TargetEvents,
  TargetHandle,
  TargetMotionProperty,
  TargetRef,
  TargetSnapshotter,
  TargetTransform,
  TargetViewTransform,
  WindowRect,
} from './scene';

// --- Graphics: paints, paths, shaders, node effects, colors ------------------------------
export {
  BLEND_MODES,
  brightness,
  burnCharShader,
  burnGlowShader,
  burnPaperShader,
  composeShader,
  defineShader,
  displacementShader,
  energyShader,
  fireShader,
  flameBorderLiteShader,
  flameBorderShader,
  formatColor,
  grayscale,
  mixColor,
  parseColor,
  PathData,
  SHADER_CHUNKS,
  shaderUniformValues,
  validateBlendMode,
  validateFill,
  validateNodeEffect,
  validateStroke,
  withAlpha,
} from './graphics';
export type {
  BlendMode,
  Color,
  ComposeShaderOptions,
  Fill,
  LinearGradient,
  NodeEffect,
  RadialGradient,
  Rect,
  RGBA,
  ShaderChunk,
  ShaderDefinition,
  ShaderFill,
  ShaderImageChild,
  ShaderOptions,
  ShaderUniform,
  Stroke,
} from './graphics';

// --- Assets and sprites --------------------------------------------------------------------
export { AssetLoadError, AssetManager } from './assets';
export type { AssetEvents, AssetManagerOptions, AssetState, ImageAsset, ImageLoader, LoadedImage } from './assets';
export { createSpriteSheet, FrameAnimation, Sprite, SpriteSheet } from './sprites';
export type {
  FrameDirection,
  FrameEventSpec,
  SpriteAnimation,
  SpriteAnimationSpec,
  SpriteGrid,
  SpriteOptions,
  SpritePlayOptions,
  SpriteSheetOptions,
} from './sprites';

// --- Particles ---------------------------------------------------------------------------
export {
  DEFAULT_EMITTER_COLORS,
  EMITTER_UPDATE_KEYS,
  isParticleDrawable,
  MAX_BURST_PARTICLES,
  MAX_EMITTER_PARTICLES,
  ParticleBurst,
  ParticleEmitter,
  resolveEmitterConfig,
  sharedParticlePool,
} from './particles';
export type {
  BurstConfig,
  CurveFunction,
  EmitterBurst,
  EmitterConfig,
  EmitterShape,
  EmitterUpdate,
  ParticleDrawable,
  ParticleLook,
  ParticleLookKind,
  PoolStats,
  Spread,
  ValueCurve,
} from './particles';

export { SDK_VERSION } from './version';
