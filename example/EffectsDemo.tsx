/**
 * Phase 4 "GameFX Effects Showcase": demos A–H for the composable effects system.
 *
 * A. Fire border on an ordinary view: on/off, intensity, flame height, color, move, rotate, scale.
 * B. Throw & Explode: the real view is thrown, explodes at the impact, shakes, then settles.
 * C. Particle playground: count, speed, gravity, color, lifetime, direction, size.
 * D. Effects gallery: every preset on one button each.
 * E. Combined effects on several targets: many effects per target, keys, staggered timelines.
 * F. Performance scenarios (PerfDemo.tsx).
 * G. Emitter lab (EmitterLab.tsx, Phase 4A): four emitters at once, live changes, per-handle
 *    pause/resume/stop/cancel, emitters on moving scene nodes, cleanup when the target goes.
 * H. Visual quality comparison (QualityLab.tsx, Phase 4.5): low / medium / high side by side,
 *    the fire border and Throw & Explode with every visual parameter, a combined finale.
 *
 * Only the public `react-native-graphics` entry point is used. Views move through their
 * transform binding (`fx.getTarget(id).motion`), so effects stay attached while they fly,
 * spin and shake. Effects fixed to a card (fire, glow pulses) are drawn inside the card's own
 * view (`GameFXTarget`'s local effects layer), so the phone moves them with the card in the
 * same frame, also while the list scrolls. React state changes only on button presses, never
 * per frame.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { GameFXTarget, useGameFX, useGameFXEngine } from 'react-native-graphics';
import { EmitterLab } from './EmitterLab';
import { PerfDemo } from './PerfDemo';
import { QualityLab } from './QualityLab';
import { Button, Card, Chips, Stepper } from './ui';
import type { EffectHandle, GameFX, Playback, QualityLevel, ThrowAndExplodeSequence } from 'react-native-graphics';

const FIRE_COLORS = { Orange: '#FF6A00', Blue: '#2E7DFF', Green: '#28D17C', Violet: '#B04DFF' } as const;
type FireColor = keyof typeof FIRE_COLORS;

/** Toggles a transform animation on a target's motion (yoyo back to where it was). */
function wiggle(fx: GameFX, id: string, vars: Record<string, number>, duration = 450) {
  const motion = fx.getTarget(id)?.motion;
  const engine = fx.engine;
  if (!motion || !engine) return;
  engine.animate(motion, { ...vars, duration, easing: 'easeInOutCubic', yoyo: true, repeat: 1 }).play();
}

// --- A. Fire border ---------------------------------------------------------------------------

function FireBorderDemo() {
  const fx = useGameFX();
  const [on, setOn] = useState(false);
  const [intensity, setIntensity] = useState(0.9);
  const [flameHeight, setFlameHeight] = useState(26);
  const [color, setColor] = useState<FireColor>('Orange');
  const handle = useRef<EffectHandle | null>(null);

  const start = () => {
    handle.current = fx.attach(
      'fire-card',
      { effect: 'fire-border', intensity, flameHeight, color: FIRE_COLORS[color], glow: true, sparks: true },
      { key: 'fire-card' },
    );
  };
  const update = (patch: Record<string, unknown>) => {
    if (handle.current?.status === 'playing') handle.current.update(patch);
  };
  useEffect(() => () => handle.current?.cancel(), []);

  return (
    <Card title="A · Fire border" subtitle="Procedural shader flames around an ordinary View; follows move, rotate and scale.">
      <View style={styles.stageTall}>
        <GameFXTarget id="fire-card" style={styles.playingCard}>
          <Text style={styles.cardFace}>A♠</Text>
          <Text style={styles.cardHint}>a plain RN View</Text>
        </GameFXTarget>
      </View>
      <View style={styles.row}>
        <Button
          label={on ? 'Disable fire' : 'Enable fire'}
          tone={on ? 'danger' : 'accent'}
          onPress={() => {
            if (on) handle.current?.stop();
            else start();
            setOn(!on);
          }}
        />
        <Button label="Move" onPress={() => { wiggle(fx, 'fire-card', { x: 80 }); }} />
        <Button label="Rotate" onPress={() => { wiggle(fx, 'fire-card', { rotation: 90 }, 600); }} />
        <Button label="Scale" onPress={() => { wiggle(fx, 'fire-card', { scale: 1.35 }); }} />
      </View>
      <Stepper label="Intensity" value={intensity} step={0.1} min={0.1} max={2} format={(v) => v.toFixed(1)} onChange={(v) => { setIntensity(v); update({ intensity: v }); }} />
      <Stepper label="Flame height" value={flameHeight} step={4} min={8} max={60} onChange={(v) => { setFlameHeight(v); update({ flameHeight: v }); }} />
      <Chips options={Object.keys(FIRE_COLORS) as FireColor[]} value={color} onChange={(c) => { setColor(c); update({ color: FIRE_COLORS[c] }); }} />
    </Card>
  );
}

// --- B. Throw & Explode -------------------------------------------------------------------------

function ThrowDemo() {
  const fx = useGameFX();
  const [status, setStatus] = useState('Ready');
  const [after, setAfter] = useState<'return' | 'vanish'>('return');
  const [fire, setFire] = useState(false);
  const seq = useRef<ThrowAndExplodeSequence | null>(null);
  const fireHandle = useRef<EffectHandle | null>(null);

  const toggleFire = () => {
    if (fireHandle.current) {
      fireHandle.current.stop();
      fireHandle.current = null;
    } else {
      fireHandle.current = fx.attach('throw-card', { effect: 'fire-border', flameHeight: 16, intensity: 1, cornerRadius: 10 }, { key: 'throw-fire' });
    }
    setFire(fireHandle.current !== null);
  };

  const play = () => {
    seq.current?.playback.cancel();
    const s = fx.throwAndExplode('throw-card', {
      throw: { height: 125, distance: 150, drop: 0, duration: 1000, rotation: 540 },
      explosion: { intensity: 1, particles: 150, debris: true },
      shake: { amplitude: 9, duration: 380 },
      afterImpact: after,
    });
    seq.current = s;
    setStatus('Launch');
    s.playback.onMarker('peak', () => { setStatus('Peak'); });
    s.playback.onMarker('impact', () => { setStatus('Impact! Explosion, sparks, smoke, shockwave, shake'); });
    void s.playback.finished.then((r) => {
      if (seq.current === s) setStatus(r.status === 'completed' ? 'Settled (consistent state)' : 'Cancelled: card restored');
    });
  };
  useEffect(
    () => () => {
      seq.current?.playback.cancel();
      fireHandle.current?.cancel();
    },
    [],
  );

  return (
    <Card title="B · Throw & Explode" subtitle="The real view is launched, rotates, peaks, falls faster, explodes at the impact, then settles. Turn on fire to see it ride along.">
      <View style={styles.stageTall}>
        <View style={styles.table} />
        <GameFXTarget id="throw-card" style={[styles.playingCard, styles.throwStart]}>
          <Text style={styles.cardFace}>K♥</Text>
        </GameFXTarget>
      </View>
      <Text style={styles.status}>{status}</Text>
      <View style={styles.row}>
        <Button label="Throw & Explode" tone="accent" onPress={play} />
        <Button label="Replay" onPress={play} />
        <Button label="Cancel" tone="danger" onPress={() => seq.current?.playback.cancel()} />
      </View>
      <View style={styles.row}>
        <Chips options={['return', 'vanish'] as const} value={after} onChange={setAfter} />
        <Button small label={fire ? 'Fire off' : 'Fire on card'} tone={fire ? 'on' : 'normal'} onPress={toggleFire} />
      </View>
    </Card>
  );
}

// --- C. Particle playground ---------------------------------------------------------------------

const PALETTES = {
  Fire: ['#FFF3C4', '#FFD54A', '#FF7043', '#E53935'],
  Ice: ['#E1F5FE', '#81D4FA', '#29B6F6', '#FFFFFF'],
  Candy: ['#FF4D6D', '#FFD54A', '#4DD0E1', '#7C4DFF'],
} as const;
type Palette = keyof typeof PALETTES;

function PlaygroundDemo() {
  const fx = useGameFX();
  const [count, setCount] = useState(120);
  const [speed, setSpeed] = useState(260);
  const [gravity, setGravity] = useState(300);
  const [lifetime, setLifetime] = useState(1200);
  const [direction, setDirection] = useState(-90);
  const [size, setSize] = useState(4);
  const [palette, setPalette] = useState<Palette>('Fire');
  const [look, setLook] = useState<'circle' | 'spark' | 'square' | 'soft'>('spark');
  const fountain = useRef<EffectHandle | null>(null);
  const [fountainOn, setFountainOn] = useState(false);

  const config = () => ({
    target: 'playground',
    follow: false,
    speed: { min: speed * 0.4, max: speed },
    gravity,
    drag: 0.6,
    lifetime: { min: lifetime * 0.6, max: lifetime },
    direction,
    spread: 70,
    size: { min: size * 0.6, max: size },
    colors: PALETTES[palette],
    look,
    blendMode: look === 'square' ? ('normal' as const) : ('plus' as const),
    opacity: { from: 1, to: 0 },
  });

  return (
    <Card title="C · Particle playground" subtitle="One generic emitter: bursts or a continuous fountain, deterministic per seed.">
      <GameFXTarget id="playground" style={styles.stage} />
      <View style={styles.row}>
        <Button label="Burst" tone="accent" onPress={() => { fx.play('particles', { ...config(), bursts: [{ count }], maxParticles: Math.max(count, 1) }); }} />
        <Button
          label={fountainOn ? 'Stop fountain' : 'Fountain'}
          onPress={() => {
            if (fountain.current) {
              fountain.current.stop();
              fountain.current = null;
            } else {
              fountain.current = fx.play('particles', { ...config(), follow: true, rate: count, maxParticles: 2000 }, { key: 'fountain' });
            }
            setFountainOn(fountain.current !== null);
          }}
        />
      </View>
      <Stepper label="Count / rate" value={count} step={20} min={20} max={600} onChange={setCount} />
      <Stepper label="Speed" value={speed} step={40} min={0} max={800} onChange={setSpeed} />
      <Stepper label="Gravity" value={gravity} step={100} min={-400} max={1200} onChange={setGravity} />
      <Stepper label="Lifetime ms" value={lifetime} step={200} min={200} max={4000} onChange={setLifetime} />
      <Stepper label="Direction °" value={direction} step={30} min={-180} max={180} onChange={setDirection} />
      <Stepper label="Size" value={size} step={1} min={1} max={14} onChange={setSize} />
      <Chips options={Object.keys(PALETTES) as Palette[]} value={palette} onChange={setPalette} />
      <Chips options={['spark', 'circle', 'square', 'soft'] as const} value={look} onChange={setLook} />
    </Card>
  );
}

// --- D. Effects gallery -------------------------------------------------------------------------

function GalleryDemo() {
  const fx = useGameFX();
  const engine = useGameFXEngine();
  const comet = useRef<{ loop: Playback; trail: EffectHandle } | null>(null);
  const glow = useRef<EffectHandle | null>(null);
  const at = { target: 'gallery', follow: false } as const;

  const toggleTrail = () => {
    if (comet.current) {
      comet.current.loop.cancel();
      comet.current.trail.stop();
      fx.getTarget('comet')?.motion.reset();
      comet.current = null;
      return;
    }
    const motion = fx.getTarget('comet')?.motion;
    if (!motion || !engine) return;
    const loop = engine
      .keyframes(motion, {
        duration: 2400,
        repeat: Infinity,
        keyframes: [
          { at: 0, x: 0, y: 0 },
          { at: 0.25, x: 120, y: -50, easing: 'easeInOutSine' },
          { at: 0.5, x: 0, y: -90, easing: 'easeInOutSine' },
          { at: 0.75, x: -120, y: -50, easing: 'easeInOutSine' },
          { at: 1, x: 0, y: 0, easing: 'easeInOutSine' },
        ],
      })
      .play();
    const trail = fx.attach('comet', 'trail', { rate: 90, size: 6, lifetime: 600 });
    comet.current = { loop, trail };
  };
  useEffect(
    () => () => {
      comet.current?.loop.cancel();
      glow.current?.cancel();
    },
    [],
  );

  return (
    <Card title="D · Effects gallery" subtitle="Every preset, configurable and cancellable, through fx.play / fx.attach.">
      <GameFXTarget id="gallery" style={styles.stageTall}>
        <GameFXTarget id="comet" style={styles.comet} />
        <GameFXTarget id="badge" style={styles.badge}>
          <Text style={styles.badgeText}>★</Text>
        </GameFXTarget>
      </GameFXTarget>
      <View style={styles.grid}>
        <Button small label="Confetti" onPress={() => fx.play('confetti', { ...at, count: 140 })} />
        <Button small label="Golden sparks" onPress={() => fx.play('golden-sparks', { ...at, count: 80 })} />
        <Button small label="Smoke 3 s" onPress={() => fx.play('smoke', { ...at, duration: 3000, rate: 16 })} />
        <Button
          small
          label="Glow pulse"
          onPress={() => {
            glow.current?.cancel();
            glow.current = fx.attach('badge', 'glow-pulse', { pulses: 4, color: '#FFD54A', shape: 'circle' });
          }}
        />
        <Button small label="Trail on/off" onPress={toggleTrail} />
        <Button small label="Shockwave" onPress={() => fx.play('shockwave', { ...at, radius: 130 })} />
        <Button small label="Flash" onPress={() => fx.play('flash', { ...at, radius: 110 })} />
        <Button small label="Screen shake" onPress={() => fx.play('screen-shake', { scope: ['overlay', 'gallery'], amplitude: 10, duration: 450 })} />
        <Button small label="Explosion" tone="accent" onPress={() => fx.play('explosion', { ...at, screenShake: { scope: ['overlay', 'gallery'] } })} />
        <Button small label="Victory" tone="accent" onPress={() => fx.play('victory', { ...at, width: 260 })} />
      </View>
    </Card>
  );
}

// --- E. Combined effects on multiple targets ----------------------------------------------------

const MULTI = ['multi-1', 'multi-2', 'multi-3'] as const;

function CombinedDemo() {
  const fx = useGameFX();
  const playback = useRef<Playback | null>(null);
  const flips = useRef<Playback | null>(null);
  return (
    <Card title="E · Combined effects" subtitle="Several effects per target, replacement keys, z-order and staggered timelines.">
      <View style={[styles.stage, styles.multiRow]}>
        {MULTI.map((id, i) => (
          <GameFXTarget key={id} id={id} style={styles.miniCard}>
            <Text style={styles.cardFace}>{['Q♦', 'J♣', '10♠'][i]}</Text>
          </GameFXTarget>
        ))}
      </View>
      <View style={styles.grid}>
        <Button
          small
          label="Fire on all"
          onPress={() => {
            // One fire per card: the key replaces a running one instead of stacking.
            MULTI.forEach((id, i) => fx.attach(id, { effect: 'fire-border', color: Object.values(FIRE_COLORS)[i], flameHeight: 18 }, { key: `fire:${id}` }));
          }}
        />
        <Button
          small
          label="Glow + sparks on middle"
          onPress={() => {
            fx.attach('multi-2', 'glow-pulse', { pulses: 3 }, { zIndex: -1 });
            fx.attach('multi-2', 'golden-sparks', { rate: 40, duration: 1500, count: 0 }, { zIndex: 2 });
          }}
        />
        <Button
          small
          label="Explode in sequence"
          onPress={() => {
            playback.current?.cancel();
            const tl = fx.timeline();
            MULTI.forEach((id, i) => tl.add(fx.cue('explosion', { target: id, follow: false, intensity: 0.7 }), i * 260));
            tl.add(fx.cue('screen-shake', { scope: [...MULTI], amplitude: 6 }), 2 * 260);
            playback.current = tl.play();
          }}
        />
        <Button small label="Spin all" onPress={() => { MULTI.forEach((id, i) => { wiggle(fx, id, { rotation: 180 }, 400 + i * 120); }); }} />
        <Button
          small
          label="Flip all"
          onPress={() => {
            // A fast hop with a full turn, staggered on one timeline: fire must stay on each card.
            const engine = fx.engine;
            if (!engine) return;
            flips.current?.cancel();
            const tl = fx.timeline();
            const motions = MULTI.map((id) => fx.getTarget(id)?.motion);
            motions.forEach((motion, i) => {
              if (!motion) return;
              tl.add(
                engine.keyframes(motion, {
                  duration: 700,
                  keyframes: [
                    { at: 0, y: 0, rotation: 0 },
                    { at: 0.5, y: -42, rotation: 180, easing: 'easeOutQuad' },
                    { at: 1, y: 0, rotation: 360, easing: 'easeInQuad' },
                  ],
                }),
                i * 140,
              );
            });
            const playback = tl.play();
            flips.current = playback;
            // 360° looks like 0°: reset so the views count as untransformed again (re-measurable).
            playback.on('end', () => {
              for (const motion of motions) if (motion && !motion.destroyed) motion.rotation = 0;
            });
          }}
        />
        <Button small label="Victory on middle" onPress={() => fx.play('victory', { target: 'multi-2', width: 220 })} />
        <Button
          small
          label="Clear all"
          tone="danger"
          onPress={() => {
            playback.current?.cancel();
            flips.current?.cancel();
            fx.cancelAll();
          }}
        />
      </View>
    </Card>
  );
}

// --- Screen -------------------------------------------------------------------------------------

function QualityBar() {
  const fx = useGameFX();
  const engine = useGameFXEngine();
  const [quality, setQuality] = useState<QualityLevel>(fx.quality);
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!engine) return undefined;
    const sync = () => { setActive(engine.activeCount); };
    const a = engine.on('effectStart', sync);
    const b = engine.on('effectEnd', sync);
    return () => { a(); b(); };
  }, [engine]);
  return (
    <View style={styles.qualityBar}>
      <Chips
        options={['low', 'medium', 'high'] as const}
        value={quality}
        onChange={(q) => {
          fx.setQuality(q);
          setQuality(q);
        }}
      />
      <Text style={styles.counter}>
        Active: {active}
        {fx.reducedMotion ? ' · reduced motion' : ''}
      </Text>
    </View>
  );
}

export function EffectsDemo() {
  const fx = useGameFX();
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>GameFX Effects Showcase</Text>
      <QualityBar />
      <ScrollList
        onSettled={() => {
          if (fx.ready) fx.remeasure();
        }}
      >
        <FireBorderDemo />
        <ThrowDemo />
        <PlaygroundDemo />
        <GalleryDemo />
        <CombinedDemo />
        <PerfDemo />
        <EmitterLab />
        <QualityLab />
      </ScrollList>
    </View>
  );
}


function ScrollList({ children, onSettled }: { children: ReactNode; onSettled: () => void }) {
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      scrollEventThrottle={32}
      // Scrolling moves views without a layout event: targets measure again (cheap, async).
      onScroll={onSettled}
      onMomentumScrollEnd={onSettled}
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  title: { color: 'white', fontSize: 22, fontWeight: '700', paddingHorizontal: 20, paddingTop: 10 },
  content: { padding: 16, gap: 16, paddingBottom: 80 },
  card: { backgroundColor: '#1C1930', borderRadius: 16, padding: 14, gap: 10 },
  cardTitle: { color: 'white', fontSize: 18, fontWeight: '700' },
  cardSubtitle: { color: '#9A92C4', fontSize: 13 },
  stage: { height: 170, borderRadius: 12, backgroundColor: '#100E1C', borderWidth: 1, borderColor: '#2E2950' },
  stageTall: { height: 260, borderRadius: 12, backgroundColor: '#100E1C', borderWidth: 1, borderColor: '#2E2950', alignItems: 'center', justifyContent: 'center' },
  playingCard: { width: 96, height: 136, borderRadius: 12, backgroundColor: '#F4EFE6', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#D9CFBE' },
  throwStart: { position: 'absolute', left: 24, bottom: 18, width: 72, height: 100 },
  table: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 18, backgroundColor: '#3B2A1E', borderBottomLeftRadius: 12, borderBottomRightRadius: 12 },
  cardFace: { fontSize: 30, fontWeight: '700', color: '#B3261E' },
  cardHint: { fontSize: 10, color: '#6B6255', marginTop: 4 },
  miniCard: { width: 70, height: 100, borderRadius: 10, backgroundColor: '#F4EFE6', alignItems: 'center', justifyContent: 'center' },
  multiRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly' },
  comet: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: '#FFE082', bottom: 30 },
  badge: { position: 'absolute', top: 16, right: 16, width: 44, height: 44, borderRadius: 22, backgroundColor: '#5B4A9E', alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#FFD54A', fontSize: 22 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepperLabel: { color: '#CFC8F0', width: 110 },
  stepperValue: { color: 'white', width: 56, textAlign: 'center', fontVariant: ['tabular-nums'] },
  status: { color: '#FFD54A' },
  qualityBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 6 },
  counter: { color: '#FFD54A', fontVariant: ['tabular-nums'] },
});
