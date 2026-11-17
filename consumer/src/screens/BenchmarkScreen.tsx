/**
 * H. Performance scenarios to measure on a phone or emulator.
 *
 * Each scenario runs for a fixed time, then stops everything it started and reports:
 *  - frame interval on the JS thread while the engine had work (average, p95, worst, frames
 *    slower than 25 ms): this is the rate of the effects loop, not of the UI/render thread;
 *  - JS work per frame (engine update plus the overlay's Skia picture recording, measured from
 *    the frame's start to this meter's listener, which subscribes after the overlay);
 *  - peak particle count;
 *  - whether the engine counters returned to their starting values afterwards (leaks), and
 *    how long the graceful endings took.
 * Results appear on screen and in the Metro terminal as one `[gamefx-bench]` JSON line each.
 * In Expo Go the JavaScript runs in development mode, which is slower than a release build:
 * the `dev` field says which one was measured.
 */
import { useNavigation } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { GameFXTarget, isParticleDrawable, useGameFX, useGameFXAssets } from 'react-native-graphics';
import type { EffectHandle, Engine, EngineStats, Playback, SceneNode, SpriteSheet } from 'react-native-graphics';
import type { Navigation } from '../navigation';
import { useRemeasureAfterTransition } from '../navigation';
import { useSettings } from '../settings';
import { Button, Note, Row, Screen, Section, colors, styles as ui } from '../ui';

type ScenarioId = 'fire-1' | 'fire-10' | 'throw-1' | 'explosions-5' | 'sprites-50' | 'emitters' | 'cancel-replay' | 'continuous' | 'navigation';

const SCENARIOS: readonly { id: ScenarioId; label: string }[] = [
  { id: 'fire-1', label: '1 · One fire border (10 s)' },
  { id: 'fire-10', label: '2 · Ten fire borders (10 s)' },
  { id: 'throw-1', label: '3 · One throw & explode (4 s)' },
  { id: 'explosions-5', label: '4 · Five explosions (5 s)' },
  { id: 'sprites-50', label: '5 · Fifty animated sprites (10 s)' },
  { id: 'emitters', label: '6 · Six continuous emitters (10 s)' },
  { id: 'cancel-replay', label: '7 · Cancel + replay ×40 (9 s)' },
  { id: 'continuous', label: '8 · Continuous mix (3 min)' },
  { id: 'navigation', label: '9 · Navigate ×5 while active' },
];
/** "Run 1–7" skips the long and the navigating scenario. */
const QUICK: readonly ScenarioId[] = ['fire-1', 'fire-10', 'throw-1', 'explosions-5', 'sprites-50', 'emitters', 'cancel-replay'];
const CARDS = Array.from({ length: 10 }, (_, i) => `bench-${String(i)}`);
const LONG_FRAME_MS = 25;

interface Meter {
  frames: number;
  intervals: number[];
  work: number[];
  particlesPeak: number;
  lastFrame: number | null;
  lastBusy: boolean;
  startedAt: number;
}

export interface BenchResult {
  readonly scenario: ScenarioId;
  readonly platform: string;
  readonly osVersion: string;
  readonly dev: boolean;
  readonly quality: string;
  readonly reducedMotion: boolean;
  readonly seconds: number;
  readonly frames: number;
  readonly fps: number;
  readonly intervalAvgMs: number;
  readonly intervalP95Ms: number;
  readonly intervalMaxMs: number;
  readonly longFramePct: number;
  readonly jsWorkAvgMs: number;
  readonly jsWorkP95Ms: number;
  readonly particlesPeak: number;
  /** The engine counters returned to their values from before the scenario. */
  readonly cleanAfter: boolean;
  /** How long that took after the scenario ended (graceful endings), in ms. */
  readonly settleMs: number;
}

/** Everything a scenario started, so it can all be ended. */
interface Running {
  handles: EffectHandle[];
  playbacks: Playback[];
  nodes: SceneNode[];
  timers: ReturnType<typeof setTimeout>[];
}

const round = (v: number, digits = 1) => Number(v.toFixed(digits));
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function summary(values: readonly number[]) {
  if (values.length === 0) return { avg: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    avg: values.reduce((a, b) => a + b, 0) / values.length,
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
  };
}

function startMeter(engine: Engine): { meter: Meter; off: () => void } {
  const meter: Meter = { frames: 0, intervals: [], work: [], particlesPeak: 0, lastFrame: null, lastBusy: false, startedAt: performance.now() };
  const off = engine.on('frame', (e) => {
    const now = performance.now();
    // The engine stops requesting frames when nothing runs: a gap after an idle frame is
    // waiting, a gap after a busy frame is a (possibly slow) frame.
    if (meter.lastFrame !== null && meter.lastBusy) meter.intervals.push(now - meter.lastFrame);
    meter.lastFrame = now;
    meter.lastBusy = e.activeCount > 0 || engine.playbackCount > 0;
    meter.frames++;
    meter.work.push(engine.now() - e.time);
    let particles = 0;
    for (const d of e.drawables) if (isParticleDrawable(d)) particles += d.aliveCount;
    meter.particlesPeak = Math.max(meter.particlesPeak, particles);
  });
  return { meter, off };
}

function cleanAgain(now: EngineStats, before: EngineStats): boolean {
  return now.activeEffects === 0 && now.playbacks === 0 && now.sceneNodes === before.sceneNodes && now.targets === before.targets;
}

function useCoinSheet(engine: Engine | null): SpriteSheet | null {
  const { status, assets } = useGameFXAssets(['coin']);
  const [sheet, setSheet] = useState<SpriteSheet | null>(null);
  useEffect(() => {
    if (!engine || status !== 'ready' || !assets) return;
    setSheet(engine.createSpriteSheet({ image: assets.coin, grid: { frameWidth: 64, frameHeight: 64 }, animations: { spin: { frames: { from: 0, to: 7 }, fps: 12, loop: true } } }));
  }, [engine, status, assets]);
  return sheet;
}

export function BenchmarkScreen() {
  useRemeasureAfterTransition();
  const fx = useGameFX();
  const navigation = useNavigation<Navigation>();
  const settings = useSettings();
  const sheet = useCoinSheet(fx.engine);
  const [current, setCurrent] = useState<string | null>(null);
  const [results, setResults] = useState<BenchResult[]>([]);
  const running = useRef<Running>({ handles: [], playbacks: [], nodes: [], timers: [] });
  const token = useRef(0);
  const nav = useRef<{ left: number; done: () => void } | null>(null);

  const endAll = () => {
    const r = running.current;
    for (const t of r.timers) clearTimeout(t);
    for (const p of r.playbacks) p.cancel();
    for (const h of r.handles) h.cancel();
    for (const n of r.nodes) if (!n.destroyed) n.destroy();
    running.current = { handles: [], playbacks: [], nodes: [], timers: [] };
  };
  useEffect(
    () => () => {
      token.current++;
      endAll();
    },
    [],
  );

  // Scenario 9: open the busy screen again each time this screen is focused.
  useEffect(
    () =>
      navigation.addListener('focus', () => {
        const n = nav.current;
        if (!n) return;
        if (n.left > 0) {
          n.left--;
          navigation.navigate('Busy', { auto: true });
        } else {
          nav.current = null;
          n.done();
        }
      }),
    [navigation],
  );

  /** Starts a scenario; resolves when its measured part is over. */
  const start = (id: ScenarioId, engine: Engine, r: Running): Promise<void> => {
    const every = (ms: number, fn: () => void) => { r.timers.push(setInterval(fn, ms)); };
    switch (id) {
      case 'fire-1':
        r.handles.push(fx.attach('bench-0', 'fire-border', {}));
        return wait(10000);
      case 'fire-10':
        for (const c of CARDS) r.handles.push(fx.attach(c, 'fire-border', {}));
        return wait(10000);
      case 'throw-1': {
        const s = fx.throwAndExplode('bench-throw', { throw: { height: 90, distance: 120, duration: 900, rotation: 540 }, explosion: { particles: 150, debris: true } });
        r.playbacks.push(s.playback);
        return wait(4000);
      }
      case 'explosions-5':
        CARDS.filter((_, i) => i % 2 === 0).forEach((c, i) => {
          r.handles.push(fx.play('explosion', { target: c, follow: false, particles: 150, debris: true, screenShake: i === 0 ? { scope: ['bench-stage'] } : false }));
        });
        return wait(5000);
      case 'sprites-50': {
        const stage = fx.getTarget('bench-stage');
        if (!stage || !sheet) return Promise.reject(new Error('Sprite sheet still loading, try again in a moment.'));
        const root = engine.scene.createNode({ parent: stage.node });
        r.nodes.push(root);
        for (let i = 0; i < 50; i++) {
          const sprite = engine.createSprite({ sheet, parent: root, x: ((i % 10) - 4.5) * 30, y: (Math.floor(i / 10) - 2) * 40, scale: 0.45, zIndex: i % 5 });
          sprite.play('spin', { speed: 0.5 + (i % 4) * 0.25 });
          r.playbacks.push(engine.animate(sprite, { rotation: 360, duration: 1500 + (i % 7) * 200, repeat: Infinity }).play());
          if (i % 10 === 0) r.handles.push(fx.attach(sprite, 'trail', { rate: 40 }));
        }
        return wait(10000);
      }
      case 'emitters':
        for (const c of CARDS.slice(0, 3)) r.handles.push(fx.attach(c, 'golden-sparks', { count: 0, rate: 40 }));
        for (const c of CARDS.slice(5, 8)) r.handles.push(fx.attach(c, 'smoke', { rate: 12 }));
        return wait(10000);
      case 'cancel-replay': {
        let cycles = 0;
        let last: Playback | null = null;
        every(150, () => {
          if (cycles >= 40) return;
          cycles++;
          last?.cancel();
          last = fx.throwAndExplode('bench-throw', { throw: { height: 60, distance: 80, duration: 500 }, explosion: { particles: 80 } }).playback;
          r.playbacks.push(last);
        });
        return wait(9000);
      }
      case 'continuous': {
        for (const c of CARDS.slice(0, 3)) r.handles.push(fx.attach(c, 'fire-border', {}));
        r.handles.push(fx.play('smoke', { target: 'bench-stage', follow: false, rate: 10 }));
        let ticks = 0;
        every(1000, () => {
          ticks++;
          if (ticks % 2 === 0) r.handles.push(fx.play('explosion', { target: CARDS[(ticks / 2) % 10] ?? 'bench-0', follow: false, particles: 120 }));
          if (ticks % 5 === 0) r.handles.push(fx.play('confetti', { target: 'bench-stage', follow: false, count: 100 }));
          // Drop finished handles so the list stays short over minutes.
          r.handles = r.handles.filter((h) => h.status === 'playing' || h.status === 'paused');
        });
        return wait(180000);
      }
      case 'navigation':
        for (const c of CARDS.slice(0, 3)) r.handles.push(fx.attach(c, 'fire-border', {}));
        r.handles.push(fx.attach('bench-5', 'golden-sparks', { count: 0, rate: 30 }));
        return new Promise<void>((resolve) => {
          nav.current = { left: 4, done: resolve };
          navigation.navigate('Busy', { auto: true });
        }).then(() => wait(1500));
    }
  };

  const run = async (id: ScenarioId, my: number): Promise<BenchResult | null> => {
    const engine = fx.engine;
    if (!engine || token.current !== my) return null;
    endAll();
    await wait(400);
    const baseline = engine.stats;
    setCurrent(`Running ${id}…`);
    const { meter, off } = startMeter(engine);
    try {
      await start(id, engine, running.current);
    } catch (error) {
      off();
      setCurrent(String(error instanceof Error ? error.message : error));
      return null;
    }
    off();
    if (token.current !== my) return null;
    const seconds = (performance.now() - meter.startedAt) / 1000;
    endAll();
    // Cancelling ends what the scenario holds; effects started by finished sequences or bound
    // to unmounted views end by themselves once their particles faded. Wait up to 6 s for the
    // counters to return to their starting values.
    const settleStart = performance.now();
    let clean = cleanAgain(engine.stats, baseline);
    while (!clean && performance.now() - settleStart < 6000 && token.current === my) {
      await wait(100);
      clean = cleanAgain(engine.stats, baseline);
    }
    const settleMs = Math.round(performance.now() - settleStart);
    const interval = summary(meter.intervals);
    const work = summary(meter.work);
    const result: BenchResult = {
      scenario: id,
      platform: Platform.OS,
      osVersion: String(Platform.Version),
      dev: __DEV__,
      quality: fx.quality,
      reducedMotion: fx.reducedMotion,
      seconds: round(seconds),
      frames: meter.frames,
      fps: interval.avg > 0 ? round(1000 / interval.avg) : 0,
      intervalAvgMs: round(interval.avg),
      intervalP95Ms: round(interval.p95),
      intervalMaxMs: round(interval.max),
      longFramePct: meter.intervals.length ? round((100 * meter.intervals.filter((v) => v > LONG_FRAME_MS).length) / meter.intervals.length) : 0,
      jsWorkAvgMs: round(work.avg, 2),
      jsWorkP95Ms: round(work.p95, 2),
      particlesPeak: meter.particlesPeak,
      cleanAfter: clean,
      settleMs,
    };
    console.log(`[gamefx-bench] ${JSON.stringify(result)}`);
    setResults((list) => [...list.filter((x) => x.scenario !== id), result]);
    return result;
  };

  const runOne = (id: ScenarioId) => {
    const my = ++token.current;
    void run(id, my).then((r) => { if (token.current === my) setCurrent(r ? `Finished ${id}` : null); });
  };
  const runQuick = async () => {
    const my = ++token.current;
    for (const id of QUICK) {
      if (token.current !== my) return;
      await run(id, my);
    }
    if (token.current === my) setCurrent('Finished scenarios 1–7');
  };
  const stop = () => {
    token.current++;
    nav.current = null;
    endAll();
    setCurrent('Stopped');
  };

  return (
    <Screen testID="bench-screen">
      <Section title="Stage">
        <GameFXTarget id="bench-stage" style={local.stage}>
          {CARDS.map((id) => (
            <GameFXTarget key={id} id={id} style={local.mini} />
          ))}
          <GameFXTarget id="bench-throw" style={[local.mini, local.thrown]} />
        </GameFXTarget>
        <Text style={ui.mono} testID="bench-status">{`${current ?? 'Idle'} · quality ${settings.quality} (change it on screen G)`}</Text>
      </Section>
      <Section title="Scenarios">
        <Row>
          <Button label="Run 1–7 (≈70 s)" tone="primary" onPress={() => { void runQuick(); }} testID="bench-quick" />
          <Button label="Stop" tone="danger" onPress={stop} testID="bench-stop" />
        </Row>
        {SCENARIOS.map((s) => (
          <Button key={s.id} label={s.label} onPress={() => { runOne(s.id); }} testID={`bench-${s.id}`} />
        ))}
      </Section>
      <Section title="Results">
        <Text selectable style={ui.mono} testID="bench-results">
          {results.length === 0
            ? 'No results yet.'
            : results
                .map((r) => `${r.scenario}: ${String(r.fps)} FPS · avg ${String(r.intervalAvgMs)} / p95 ${String(r.intervalP95Ms)} / max ${String(r.intervalMaxMs)} ms · >${String(LONG_FRAME_MS)} ms ${String(r.longFramePct)}% · JS ${String(r.jsWorkAvgMs)} ms · particles ${String(r.particlesPeak)} · ${r.cleanAfter ? `clean after ${(r.settleMs / 1000).toFixed(1)} s` : 'NOT CLEAN after 6 s'}`)
                .join('\n')}
        </Text>
        <Note>{`Each result is also printed as a "[gamefx-bench] {...}" line in the terminal running Expo. ${__DEV__ ? 'This is a development build (Expo Go): numbers are pessimistic compared to a release build.' : 'Release build.'} For the UI/render thread on Android: adb shell dumpsys gfxinfo host.exp.exponent`}</Note>
      </Section>
    </Screen>
  );
}

const local = StyleSheet.create({
  stage: { height: 260, borderRadius: 12, backgroundColor: colors.stage, flexDirection: 'row', flexWrap: 'wrap', alignContent: 'center', justifyContent: 'center', gap: 14 },
  mini: { width: 44, height: 64, borderRadius: 6, backgroundColor: '#F4EFE6' },
  thrown: { backgroundColor: '#FFD54A' },
});
