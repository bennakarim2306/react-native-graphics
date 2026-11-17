/**
 * Deterministic visual scenes for before/after comparisons (Phase 4.5).
 *
 * Every scene builds an engine on a `VirtualClock` with a fixed seed and quality, places a
 * card-sized scene node where the showcase has its React Native card, starts effects through
 * the public engine API and lists the engine times to capture. The runner steps the clock in
 * 60 FPS frames and draws `engine.drawables` with the real Skia renderer (CanvasKit, CPU
 * raster). Same commit + same scene = the same pixels.
 *
 * Scenes only use parameters that exist since Phase 4, so the same file renders the Phase 4
 * code (before) and the current code (after). Scenes that need newer options say so in
 * `since` and are skipped where those options do not exist.
 */
import { builtInEffects } from '../../src/effects';
import { createEngine } from '../../src/engine/engine';
import type { Engine } from '../../src/engine/engine';
import { throwAndExplode } from '../../src/engine/sequences';
import { VirtualClock } from '../../src/runtime/clock';
import type { EffectCapabilities } from '../../src/runtime/effect';
import type { QualityLevel } from '../../src/runtime/quality';
import type { SceneNode } from '../../src/scene/node';

export const FRAME_MS = 1000 / 60;
/** The showcase stage colour. */
export const BACKGROUND = '#100E1C';

export interface VisualScene {
  readonly name: string;
  /** What the scene shows, for the report. */
  readonly description: string;
  readonly width: number;
  readonly height: number;
  readonly quality: QualityLevel;
  /** Engine times (ms) to capture, ascending. */
  readonly times: readonly number[];
  /** Device pixel ratios to render at. Default [2]. */
  readonly densities?: readonly number[];
  /** Starts the effects. Called at engine time 0. */
  setup(engine: Engine, clock: VirtualClock): void;
  /** Called before each frame at engine time `t` (to start effects later on the clock). */
  onFrame?(engine: Engine, t: number): void;
}

/** The showcase's playing card (96 × 136, radius 12, ivory), drawn by the engine as a node. */
export function card(engine: Engine, x: number, y: number, extra: { rotation?: number; scale?: number } = {}): SceneNode {
  return engine.scene.createNode({
    name: 'card',
    x,
    y,
    rotation: extra.rotation ?? 0,
    scale: extra.scale ?? 1,
    size: { width: 96, height: 136 },
    shape: { type: 'rect', width: 96, height: 136, cornerRadius: 12, fill: '#F4EFE6', stroke: { fill: '#D9CFBE', width: 2 } },
  });
}

/** The table strip of the showcase's throw stage: its top edge is where the card lands. */
export function table(engine: Engine, top: number, width: number): SceneNode {
  return engine.scene.createNode({ name: 'table', x: width / 2, y: top + 9, shape: { type: 'rect', width, height: 18, fill: '#3B2A1E' } });
}

/** The showcase's section A fire parameters. */
const FIRE_A = { intensity: 0.9, flameHeight: 26, color: '#FF6A00', glow: true, sparks: true } as const;

function fireScene(name: string, description: string, quality: QualityLevel, extra: Partial<VisualScene> = {}, place: (e: Engine) => SceneNode = (e) => card(e, 180, 160)): VisualScene {
  return {
    name,
    description,
    width: 360,
    height: 320,
    quality,
    times: [1000, 1000 + FRAME_MS, 1600],
    setup(engine) {
      const node = place(engine);
      engine.play('fire-border', { target: node, ...FIRE_A });
    },
    ...extra,
  };
}

export function createScenes(): VisualScene[] {
  const scenes: VisualScene[] = [
    fireScene('fire-border-high', 'Fire border, section A parameters, quality high. Two consecutive frames (1000 ms and +1 frame) show temporal continuity.', 'high', {
      densities: [1, 2, 3],
    }),
    fireScene('fire-border-medium', 'Fire border, section A parameters, quality medium.', 'medium', { times: [1000] }),
    fireScene('fire-border-low', 'Fire border, section A parameters, quality low (particle flames, no shader).', 'low', { times: [1000] }),
    fireScene('fire-border-rotated', 'Fire border on a card rotated by 30 degrees.', 'high', { times: [1000] }, (e) => card(e, 180, 160, { rotation: 30 })),
    fireScene('fire-border-scaled', 'Fire border on a card scaled by 1.35.', 'high', { times: [1000] }, (e) => card(e, 180, 160, { scale: 1.35 })),
    {
      name: 'fire-border-rotating',
      description: 'Fire border while the card rotates 0 to 90 degrees over 600 ms (engine tween, like the showcase Rotate button), captured mid-rotation.',
      width: 360,
      height: 320,
      quality: 'high',
      times: [1300, 1450],
      setup(engine) {
        const node = card(engine, 180, 160);
        engine.play('fire-border', { target: node, ...FIRE_A });
        const tween = engine.animate(node, { rotation: 90, duration: 600, easing: 'easeInOutCubic', delay: 1000 });
        tween.play();
      },
    },
    {
      name: 'fire-border-scaling',
      description: 'Fire border while the card scales 1 to 1.35 over 450 ms, captured mid-scale.',
      width: 360,
      height: 320,
      quality: 'high',
      times: [1225],
      setup(engine) {
        const node = card(engine, 180, 160);
        engine.play('fire-border', { target: node, ...FIRE_A });
        engine.animate(node, { scale: 1.35, duration: 450, easing: 'easeInOutCubic', delay: 1000 }).play();
      },
    },
    {
      name: 'fire-border-colors',
      description: 'Fire border colours (orange, blue, green, violet) on four small cards.',
      width: 480,
      height: 240,
      quality: 'high',
      times: [1000],
      setup(engine) {
        ['#FF6A00', '#2E7DFF', '#28D17C', '#B04DFF'].forEach((color, i) => {
          const node = engine.scene.createNode({
            x: 70 + i * 113,
            y: 120,
            size: { width: 64, height: 92 },
            shape: { type: 'rect', width: 64, height: 92, cornerRadius: 10, fill: '#F4EFE6' },
          });
          engine.play('fire-border', { target: node, color, flameHeight: 18 });
        });
      },
    },
    {
      name: 'throw',
      description: 'Throw & Explode with the showcase section B parameters (height 125, distance 150, 1000 ms, 540 degrees, explosion 150 particles with debris, shake 9). Flight, impact (1000 ms) and aftermath.',
      width: 400,
      height: 420,
      quality: 'high',
      times: [150, 350, 550, 750, 900, 1000, 1033, 1067, 1117, 1200, 1350, 1600, 2000, 2600],
      setup(engine) {
        table(engine, 298, 400);
        const node = card(engine, 110, 230);
        throwAndExplode(engine, node, {
          throw: { height: 125, distance: 150, drop: 0, duration: 1000, rotation: 540 },
          explosion: { intensity: 1, particles: 150, debris: true },
          shake: { amplitude: 9, duration: 380 },
          afterImpact: 'return',
        });
      },
    },
    {
      name: 'throw-medium',
      description: 'Throw & Explode, quality medium, impact progression.',
      width: 400,
      height: 420,
      quality: 'medium',
      times: [1033, 1117, 1350],
      setup(engine) {
        table(engine, 298, 400);
        const node = card(engine, 110, 230);
        throwAndExplode(engine, node, {
          throw: { height: 125, distance: 150, drop: 0, duration: 1000, rotation: 540 },
          explosion: { intensity: 1, particles: 150, debris: true },
          shake: false,
        });
      },
    },
    {
      name: 'throw-low',
      description: 'Throw & Explode, quality low, impact progression.',
      width: 400,
      height: 420,
      quality: 'low',
      times: [1033, 1117, 1350],
      setup(engine) {
        table(engine, 298, 400);
        const node = card(engine, 110, 230);
        throwAndExplode(engine, node, {
          throw: { height: 125, distance: 150, drop: 0, duration: 1000, rotation: 540 },
          explosion: { intensity: 1, particles: 150, debris: true },
          shake: false,
        });
      },
    },
    {
      name: 'explosion',
      description: 'Explosion preset with defaults at the stage centre: progression from the first frame to the smoke tail.',
      width: 360,
      height: 320,
      quality: 'high',
      times: [17, 50, 100, 200, 350, 600, 1000, 1600, 2200],
      setup(engine) {
        engine.play('explosion', { position: { x: 180, y: 170 }, screenShake: false });
      },
    },
    {
      name: 'smoke',
      description: 'Smoke preset with defaults.',
      width: 300,
      height: 320,
      quality: 'high',
      times: [600, 1500, 2500],
      setup(engine) {
        engine.play('smoke', { position: { x: 150, y: 250 } });
      },
    },
    {
      name: 'confetti',
      description: 'Confetti preset with defaults.',
      width: 360,
      height: 360,
      quality: 'high',
      times: [300, 900, 1800],
      setup(engine) {
        engine.play('confetti', { position: { x: 180, y: 220 } });
      },
    },
    {
      name: 'golden-sparks',
      description: 'Golden sparks preset with defaults.',
      width: 320,
      height: 300,
      quality: 'high',
      times: [120, 400, 800],
      setup(engine) {
        engine.play('golden-sparks', { position: { x: 160, y: 150 } });
      },
    },
    {
      name: 'glow-pulse',
      description: 'Glow pulse on a card.',
      width: 300,
      height: 300,
      quality: 'high',
      times: [250, 600],
      setup(engine) {
        const node = card(engine, 150, 150);
        engine.play('glow-pulse', { target: node });
      },
    },
    {
      name: 'trail',
      description: 'Trail following a small node moving along an arc (engine tween).',
      width: 360,
      height: 260,
      quality: 'high',
      times: [700],
      setup(engine) {
        const node = engine.scene.createNode({ x: 40, y: 200, shape: { type: 'circle', radius: 7, fill: '#FFE082' } });
        engine.play('trail', { target: node });
        engine
          .keyframes(node, {
            duration: 900,
            keyframes: [
              { at: 0, x: 40, y: 200 },
              { at: 0.5, x: 180, y: 60, easing: 'easeOutQuad' },
              { at: 1, x: 320, y: 200, easing: 'easeInQuad' },
            ],
          })
          .play();
      },
    },
    {
      name: 'victory',
      description: 'Victory composite with defaults.',
      width: 400,
      height: 360,
      quality: 'high',
      times: [200, 700, 1400],
      setup(engine) {
        engine.play('victory', { position: { x: 200, y: 200 } });
      },
    },
    {
      name: 'combined',
      description: 'Combined: fire border on a card, an explosion beside it, golden sparks and confetti on one clock.',
      width: 420,
      height: 340,
      quality: 'high',
      times: [1300],
      setup(engine) {
        const node = card(engine, 130, 180);
        engine.play('fire-border', { target: node, ...FIRE_A });
      },
      onFrame(engine, t) {
        if (Math.abs(t - 1000) < FRAME_MS / 2) {
          engine.play('explosion', { position: { x: 300, y: 200 }, radius: 70, screenShake: false });
          engine.play('golden-sparks', { position: { x: 300, y: 120 } });
          engine.play('confetti', { position: { x: 210, y: 300 } });
        }
      },
    },
  ];
  return scenes;
}

/** Builds the engine for a scene: virtual clock at 0, seed 7, the scene's quality. */
export function sceneEngine(scene: VisualScene, capabilities: EffectCapabilities): { engine: Engine; clock: VirtualClock } {
  const clock = new VirtualClock(0);
  const engine = createEngine({ clock, effects: builtInEffects, seed: 7, quality: scene.quality, maxActiveEffects: 64 });
  engine.setRendererCapabilities(capabilities);
  return { engine, clock };
}
