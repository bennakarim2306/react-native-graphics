import packageJson from '../package.json';
import publicApi from '../scripts/public-api.json';
import * as core from './core';
import { SDK_VERSION } from './version';

describe('package entry points', () => {
  it('exports a version that matches package.json', () => {
    expect(SDK_VERSION).toBe(packageJson.version);
  });

  it('exports exactly the public names listed in scripts/public-api.json from ./core', () => {
    // A deliberate API change regenerates the list: node scripts/public-api.mjs --write
    expect(Object.keys(core).sort()).toEqual(publicApi.core.values);
  });

  it('keeps internal helpers out of ./core', () => {
    for (const internal of ['rethrowAsync', 'LocalTimer', 'ParticlePool', 'ParticleBuffers', 'createShapeSampler', 'resolveCurve', 'burnFront', 'BurnAwayInstance', 'FireBorderInstance']) {
      expect(core).not.toHaveProperty(internal);
    }
  });

  it('exposes the platform-independent engine from ./core', () => {
    expect(typeof core.createEngine).toBe('function');
    expect(typeof core.VirtualClock).toBe('function');
    expect(core.particleBurst.name).toBe('particle-burst');
    expect(core.builtInEffects.map((e) => e.name)).toEqual([
      'particle-burst',
      'glow-border',
      'energy-border',
      'fire-border',
      'particles',
      'flash',
      'shockwave',
      'screen-shake',
      'confetti',
      'golden-sparks',
      'smoke',
      'trail',
      'glow-pulse',
      'explosion',
      'victory',
      'burn-away',
    ]);
  });

  it('runs the Phase 2 runtime end to end through ./core only (no React Native)', async () => {
    const clock = new core.VirtualClock();
    const engine = core.createEngine({ clock });
    const ball = engine.scene.createNode({ x: 50, y: 400 });
    const impacts: number[] = [];
    const playback = engine
      .timeline()
      .add(engine.animate(ball, { y: 100, duration: 300, easing: 'easeOutQuad' }))
      .add(engine.animate(ball, { y: 400, duration: 300, easing: 'easeInQuad' }))
      .mark('impact')
      .play();
    playback.onMarker('impact', () => impacts.push(ball.y));
    clock.advance(700, { frameMs: 16 });
    await expect(playback.finished).resolves.toEqual({ status: 'completed' });
    expect(impacts).toEqual([400]);
    for (const name of ['Timeline', 'Tween', 'KeyframeAnimation', 'Scene', 'SceneNode', 'cubicBezier', 'objectTarget', 'createHostViewBinding']) {
      expect(name in core).toBe(true);
    }
    engine.dispose();
  });
});
