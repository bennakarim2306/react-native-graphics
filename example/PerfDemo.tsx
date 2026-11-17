/**
 * F. Performance scenarios, to measure on a device or emulator.
 *
 * Each button starts one of the Phase 4 benchmark scenarios (the same ones `npm run bench`
 * runs in Node). The meter listens to the engine's `frame` event and reports, since the
 * scenario started: the interval between frames on the JS thread (FPS of the effects loop),
 * the JS work per frame (engine update plus the overlay's Skia picture recording, because the
 * overlay subscribes to `frame` before the meter does) and particle counts. It re-renders twice a second, never
 * per frame. These are JS-thread numbers; the UI/render thread is measured separately (for
 * example `adb shell dumpsys gfxinfo host.exp.exponent` on Android).
 */
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GameFXTarget, useGameFX, useGameFXAssets, useGameFXEngine } from 'react-native-graphics';
import type { EffectHandle, Engine, Playback, SceneNode, SpriteSheet } from 'react-native-graphics';
import { Button } from './ui';

type Scenario = '1 fire border' | '10 fire borders' | '1 explosion (150)' | '5 explosions' | '50 sprites + effects' | 'create/destroy ×100' | 'continuous 2 min';
const SCENARIOS: readonly Scenario[] = ['1 fire border', '10 fire borders', '1 explosion (150)', '5 explosions', '50 sprites + effects', 'create/destroy ×100', 'continuous 2 min'];
const CARDS = Array.from({ length: 10 }, (_, i) => `perf-${String(i)}`);

interface Stats {
  frames: number;
  intervals: number[];
  work: number[];
  particlesNow: number;
  particlesPeak: number;
  idleGaps: number;
  lastFrame: number | null;
  /** Whether the engine still had work after the last frame (else the next gap is idle time). */
  lastBusy: boolean;
  startedAt: number;
}

const newStats = (): Stats => ({ frames: 0, intervals: [], work: [], particlesNow: 0, particlesPeak: 0, idleGaps: 0, lastFrame: null, lastBusy: false, startedAt: performance.now() });

function summary(values: readonly number[]) {
  if (values.length === 0) return { avg: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    avg: values.reduce((a, b) => a + b, 0) / values.length,
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
  };
}

/** Everything a scenario started, so Stop (or the next scenario) can end all of it. */
interface Running {
  handles: EffectHandle[];
  playbacks: Playback[];
  nodes: SceneNode[];
  timers: ReturnType<typeof setInterval>[];
}

function useSheets(engine: Engine | null): { coin: SpriteSheet; slime: SpriteSheet } | null {
  const { status, assets } = useGameFXAssets(['coin', 'slime']);
  const [sheets, setSheets] = useState<{ coin: SpriteSheet; slime: SpriteSheet } | null>(null);
  useEffect(() => {
    if (!engine || status !== 'ready' || !assets) return;
    setSheets({
      coin: engine.createSpriteSheet({ image: assets.coin, grid: { frameWidth: 64, frameHeight: 64 }, animations: { spin: { frames: { from: 0, to: 7 }, fps: 12, loop: true } } }),
      slime: engine.createSpriteSheet({ image: assets.slime, grid: { frameWidth: 64, frameHeight: 64 }, animations: { wobble: { frames: { from: 0, to: 5 }, fps: 10, loop: true, direction: 'alternate' } } }),
    });
  }, [engine, status, assets]);
  return sheets;
}

export function PerfDemo() {
  const fx = useGameFX();
  const engine = useGameFXEngine();
  const sheets = useSheets(engine);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [report, setReport] = useState('Pick a scenario. Numbers accumulate until you pick another one or press Stop.');
  const stats = useRef<Stats>(newStats());
  const running = useRef<Running>({ handles: [], playbacks: [], nodes: [], timers: [] });

  // The meter: one listener on the engine's frame event; React updates twice a second.
  useEffect(() => {
    if (!engine || !scenario) return undefined;
    const off = engine.on('frame', (e) => {
      const s = stats.current;
      const now = performance.now();
      // The engine stops requesting frames when nothing runs: a gap after an idle frame is
      // waiting time, a gap after a busy frame is a (possibly slow) frame.
      if (s.lastFrame !== null) {
        if (s.lastBusy) s.intervals.push(now - s.lastFrame);
        else s.idleGaps++;
      }
      s.lastFrame = now;
      s.lastBusy = e.activeCount > 0 || engine.playbackCount > 0 || engine.scene.attachmentCount > 0;
      s.frames++;
      s.work.push(engine.now() - e.time);
      let particles = 0;
      for (const d of e.drawables) if (d.kind === 'particles') particles += (d as unknown as { aliveCount: number }).aliveCount;
      s.particlesNow = particles;
      s.particlesPeak = Math.max(s.particlesPeak, particles);
    });
    const timer = setInterval(() => {
      const s = stats.current;
      const interval = summary(s.intervals);
      const work = summary(s.work);
      const seconds = (performance.now() - s.startedAt) / 1000;
      setReport(
        [
          `${scenario} · ${seconds.toFixed(1)} s · quality ${fx.quality} · active effects ${String(engine.activeCount)}`,
          `Frames ${String(s.frames)} · interval avg ${interval.avg.toFixed(1)} ms, p95 ${interval.p95.toFixed(1)} ms, worst ${interval.max.toFixed(1)} ms · ≈ ${interval.avg > 0 ? (1000 / interval.avg).toFixed(1) : '–'} FPS`,
          `JS work per frame (engine + picture) avg ${work.avg.toFixed(2)} ms, p95 ${work.p95.toFixed(2)} ms · particles ${String(s.particlesNow)} (peak ${String(s.particlesPeak)})${s.idleGaps ? ` · idle gaps ${String(s.idleGaps)}` : ''}`,
        ].join('\n'),
      );
    }, 500);
    return () => {
      off();
      clearInterval(timer);
    };
  }, [engine, scenario, fx.quality]);

  const stop = () => {
    const r = running.current;
    for (const t of r.timers) clearInterval(t);
    for (const p of r.playbacks) p.cancel();
    for (const h of r.handles) h.cancel();
    for (const n of r.nodes) if (!n.destroyed) n.destroy();
    running.current = { handles: [], playbacks: [], nodes: [], timers: [] };
  };
  useEffect(() => stop, []);

  const start = (name: Scenario) => {
    if (!engine) return;
    stop();
    stats.current = newStats();
    setScenario(name);
    const r = running.current;
    const stage = engine.targets.node('perf-stage');
    switch (name) {
      case '1 fire border':
        r.handles.push(fx.attach('perf-0', { effect: 'fire-border' }));
        break;
      case '10 fire borders':
        for (const id of CARDS) r.handles.push(fx.attach(id, { effect: 'fire-border' }));
        break;
      case '1 explosion (150)':
        r.handles.push(fx.play('explosion', { target: 'perf-stage', follow: false, particles: 150, debris: true }));
        break;
      case '5 explosions':
        CARDS.filter((_, i) => i % 2 === 0).forEach((id, i) => {
          r.handles.push(fx.play('explosion', { target: id, follow: false, particles: 150, debris: true, screenShake: i === 0 ? { scope: ['overlay', 'perf-stage'] } : false }));
        });
        break;
      case '50 sprites + effects': {
        if (!stage || !sheets) {
          setReport('Sprite sheets are still loading. Try again in a moment.');
          return;
        }
        const root = engine.scene.createNode({ parent: stage });
        r.nodes.push(root);
        for (let i = 0; i < 50; i++) {
          const sprite = engine.createSprite({
            sheet: i % 3 === 0 ? sheets.coin : sheets.slime,
            parent: root,
            x: ((i % 10) - 4.5) * 32,
            y: (Math.floor(i / 10) - 2) * 40,
            scale: 0.45,
            zIndex: i % 5,
          });
          sprite.play(i % 3 === 0 ? 'spin' : 'wobble', { speed: 0.5 + (i % 4) * 0.25 });
          r.playbacks.push(engine.animate(sprite, { rotation: 360, duration: 1500 + (i % 7) * 200, repeat: Infinity }).play());
          if (i % 5 === 0) {
            r.playbacks.push(
              engine
                .keyframes(sprite, { duration: 2000, repeat: Infinity, keyframes: [{ at: 0, y: sprite.y }, { at: 0.5, y: sprite.y - 40, easing: 'easeInOutSine' }, { at: 1, y: sprite.y, easing: 'easeInOutSine' }] })
                .play(),
            );
            r.handles.push(fx.attach(sprite, 'trail', { rate: 60 }));
          }
          if (i % 5 === 2) r.handles.push(fx.attach(sprite, 'glow-pulse', { shape: 'circle' }));
        }
        break;
      }
      case 'create/destroy ×100': {
        if (!stage) return;
        let cycle = 0;
        const timer = setInterval(() => {
          if (cycle >= 100) {
            clearInterval(timer);
            return;
          }
          const node = engine.scene.createNode({ parent: stage, x: ((cycle % 5) - 2) * 60, y: 0, shape: { type: 'rect', width: 44, height: 64, color: '#F4EFE6', cornerRadius: 6 } });
          fx.attach(node, { effect: 'fire-border' });
          fx.attach(node, 'glow-pulse', {});
          fx.play('golden-sparks', { target: node, count: 30 });
          setTimeout(() => {
            node.destroy(); // ends the attached effects with it
          }, 50);
          cycle++;
        }, 60);
        r.timers.push(timer);
        break;
      }
      case 'continuous 2 min': {
        for (const id of CARDS.slice(0, 3)) r.handles.push(fx.attach(id, { effect: 'fire-border' }));
        r.handles.push(fx.play('smoke', { target: 'perf-stage', follow: false }));
        let ticks = 0;
        const timer = setInterval(() => {
          ticks++;
          if (ticks > 120) {
            stop();
            return;
          }
          if (ticks % 2 === 0) fx.play('explosion', { target: CARDS[(ticks / 2) % 10] ?? 'perf-0', follow: false, particles: 120 });
          if (ticks % 5 === 0) fx.play('confetti', { target: 'perf-stage', follow: false });
        }, 1000);
        r.timers.push(timer);
        break;
      }
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>F · Performance scenarios</Text>
      <Text style={styles.cardSubtitle}>Measure on your device or emulator. Switch quality at the top and run a scenario again to compare.</Text>
      <GameFXTarget id="perf-stage" style={styles.stage}>
        {CARDS.map((id) => (
          <GameFXTarget key={id} id={id} style={styles.mini} />
        ))}
      </GameFXTarget>
      <Text style={styles.report}>{report}</Text>
      <View style={styles.grid}>
        {SCENARIOS.map((s) => (
          <Button key={s} small label={s} tone={s === scenario ? 'on' : 'normal'} onPress={() => { start(s); }} />
        ))}
        <Button
          small
          label="Stop"
          tone="danger"
          onPress={() => {
            stop();
            setScenario(null);
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#1C1930', borderRadius: 16, padding: 14, gap: 10 },
  cardTitle: { color: 'white', fontSize: 18, fontWeight: '700' },
  cardSubtitle: { color: '#9A92C4', fontSize: 13 },
  stage: { height: 260, borderRadius: 12, backgroundColor: '#100E1C', borderWidth: 1, borderColor: '#2E2950', flexDirection: 'row', flexWrap: 'wrap', alignContent: 'center', justifyContent: 'center', gap: 14 },
  mini: { width: 48, height: 70, borderRadius: 6, backgroundColor: '#F4EFE6' },
  report: { color: '#FFD54A', fontSize: 12, fontVariant: ['tabular-nums'], minHeight: 48 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
