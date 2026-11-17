/**
 * H. Visual quality comparison (Phase 4.5).
 *
 * - Side by side: the same fire border on three cards at `low`, `medium` and `high`, and the
 *   same explosion on each, so the profiles can be compared on the device in one frame.
 * - Fire border: every visual parameter (intensity, flame height, speed, glow strength, spark
 *   density, color) changed live on a running fire, at the selected profile, while the card
 *   moves, rotates and scales.
 * - Throw & Explode: explosion intensity, particle density and glow, an optional trail and fire
 *   on the card, with Throw / Replay / Cancel, at the selected profile.
 * - Combined finale: fire on the card, the throw with a trail, and at the impact marker the
 *   explosion plus golden sparks, confetti and a victory burst.
 *
 * Public API only: the profile is a per-effect `quality` option (`PlayOptions.quality`,
 * `ThrowAndExplodeOptions.quality`); the engine's own profile (the bar at the top) is not
 * changed. Effects start on button presses and on the timeline's `impact` marker, never on
 * JavaScript timers.
 */
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GameFXTarget, QUALITY_PROFILES, useGameFX } from 'react-native-graphics';
import { Button, Card, Chips, Stepper } from './ui';
import type { EffectHandle, GameFX, QualityLevel, ThrowAndExplodeSequence } from 'react-native-graphics';

const LEVELS = ['low', 'medium', 'high'] as const;
const FIRE_COLORS = { Orange: '#FF6A00', Blue: '#2E7DFF', Green: '#28D17C', Violet: '#B04DFF' } as const;
type FireColor = keyof typeof FIRE_COLORS;
const THROW = { height: 125, distance: 150, drop: 0, duration: 1000, rotation: 540 } as const;

function describeProfile(level: QualityLevel): string {
  const p = QUALITY_PROFILES[level];
  return `particles ×${String(p.particleScale)} · shader ${p.shaderDetail ?? 'full'} · glow ${p.glow ? 'on' : 'off'} · details ${p.details ? 'on' : 'off'}`;
}

/** Moves, turns or scales a target and back (engine tween on its transform binding). */
function wiggle(fx: GameFX, id: string, vars: Record<string, number>, duration = 500) {
  const motion = fx.getTarget(id)?.motion;
  if (!motion || !fx.engine) return;
  fx.engine.animate(motion, { ...vars, duration, easing: 'easeInOutCubic', yoyo: true, repeat: 1 }).play();
}

// --- Side by side ------------------------------------------------------------------------------

function SideBySide() {
  const fx = useGameFX();
  const [on, setOn] = useState(false);
  const handles = useRef<EffectHandle[]>([]);
  const stopAll = () => {
    for (const h of handles.current) h.cancel();
    handles.current = [];
  };
  useEffect(() => stopAll, []);

  const toggleFire = () => {
    if (on) {
      for (const h of handles.current) h.stop();
      handles.current = [];
    } else {
      handles.current = LEVELS.map((level) =>
        fx.attach(`ql-cmp-${level}`, { effect: 'fire-border', flameHeight: 16, intensity: 0.9, cornerRadius: 10 }, { key: `ql-cmp-${level}`, quality: level }),
      );
    }
    setOn(!on);
  };

  return (
    <Card title="H · Quality side by side" subtitle="The same effects at low, medium and high. Timing is identical; only the detail changes.">
      <View style={[styles.stageTall, styles.sideBySide]}>
        {LEVELS.map((level) => (
          <View key={level} style={styles.slot}>
            <GameFXTarget id={`ql-cmp-${level}`} style={styles.miniCard}>
              <Text style={styles.miniFace}>Q♦</Text>
            </GameFXTarget>
            <Text style={styles.slotLabel}>{level}</Text>
          </View>
        ))}
      </View>
      <View style={styles.row}>
        <Button label={on ? 'Fire off' : 'Fire on'} tone={on ? 'danger' : 'accent'} onPress={toggleFire} />
        <Button
          label="Explode all"
          onPress={() => {
            for (const level of LEVELS) {
              fx.play('explosion', { target: `ql-cmp-${level}`, follow: false, radius: 46, intensity: 0.8, particles: 90, debris: true }, { quality: level, zIndex: 1 });
            }
          }}
        />
        <Button label="Rotate" onPress={() => { LEVELS.forEach((l) => { wiggle(fx, `ql-cmp-${l}`, { rotation: 90 }, 600); }); }} />
        <Button label="Scale" onPress={() => { LEVELS.forEach((l) => { wiggle(fx, `ql-cmp-${l}`, { scale: 1.3 }); }); }} />
      </View>
      {LEVELS.map((level) => (
        <Text key={level} style={styles.note}>
          {level}: {describeProfile(level)}
        </Text>
      ))}
    </Card>
  );
}

// --- Fire border at the selected profile ----------------------------------------------------------

function FireTuning({ quality }: { quality: QualityLevel }) {
  const fx = useGameFX();
  const [on, setOn] = useState(false);
  const [intensity, setIntensity] = useState(0.9);
  const [flameHeight, setFlameHeight] = useState(26);
  const [speed, setSpeed] = useState(1);
  const [glowStrength, setGlowStrength] = useState(1);
  const [sparkDensity, setSparkDensity] = useState(1);
  const [color, setColor] = useState<FireColor>('Orange');
  const handle = useRef<EffectHandle | null>(null);

  const start = () => {
    handle.current = fx.attach(
      'ql-fire',
      { effect: 'fire-border', intensity, flameHeight, speed, glowStrength, sparkDensity, color: FIRE_COLORS[color] },
      { key: 'ql-fire', quality },
    );
  };
  const update = (patch: Record<string, unknown>) => {
    if (handle.current?.status === 'playing') handle.current.update(patch);
  };
  // The profile is chosen when an effect starts: restart a running fire at the new one.
  useEffect(() => {
    if (handle.current?.status === 'playing') start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quality]);
  useEffect(() => () => handle.current?.cancel(), []);

  return (
    <Card title={`H · Fire border (${quality})`} subtitle="Every visual parameter changes live on the running fire. Move, rotate and scale the card while it burns.">
      <View style={styles.stageTall}>
        <GameFXTarget id="ql-fire" style={styles.playingCard}>
          <Text style={styles.cardFace}>J♣</Text>
        </GameFXTarget>
      </View>
      <View style={styles.row}>
        <Button
          label={on ? 'Fire off' : 'Fire on'}
          tone={on ? 'danger' : 'accent'}
          onPress={() => {
            if (on) handle.current?.stop();
            else start();
            setOn(!on);
          }}
        />
        <Button label="Move" onPress={() => { wiggle(fx, 'ql-fire', { x: 80 }); }} />
        <Button label="Rotate" onPress={() => { wiggle(fx, 'ql-fire', { rotation: 120 }, 700); }} />
        <Button label="Scale" onPress={() => { wiggle(fx, 'ql-fire', { scale: 1.35 }); }} />
      </View>
      <Stepper label="Intensity" value={intensity} step={0.1} min={0.1} max={2} format={(v) => v.toFixed(1)} onChange={(v) => { setIntensity(v); update({ intensity: v }); }} />
      <Stepper label="Flame height" value={flameHeight} step={4} min={8} max={60} onChange={(v) => { setFlameHeight(v); update({ flameHeight: v }); }} />
      <Stepper label="Speed" value={speed} step={0.25} min={0.25} max={3} format={(v) => v.toFixed(2)} onChange={(v) => { setSpeed(v); update({ speed: v }); }} />
      <Stepper label="Glow strength" value={glowStrength} step={0.25} min={0} max={2} format={(v) => v.toFixed(2)} onChange={(v) => { setGlowStrength(v); update({ glowStrength: v }); }} />
      <Stepper label="Spark density" value={sparkDensity} step={0.5} min={0} max={3} format={(v) => v.toFixed(1)} onChange={(v) => { setSparkDensity(v); update({ sparkDensity: v }); }} />
      <Chips options={Object.keys(FIRE_COLORS) as FireColor[]} value={color} onChange={(c) => { setColor(c); update({ color: FIRE_COLORS[c] }); }} />
      {quality === 'low' ? <Text style={styles.note}>low draws the lite shader without the halo, so glow strength has no effect.</Text> : null}
    </Card>
  );
}

// --- Throw & Explode at the selected profile, and the combined finale ------------------------------

function ThrowTuning({ quality }: { quality: QualityLevel }) {
  const fx = useGameFX();
  const [status, setStatus] = useState('Ready');
  const [intensity, setIntensity] = useState(1);
  const [particles, setParticles] = useState(150);
  const [glow, setGlow] = useState(1);
  const [trail, setTrail] = useState(true);
  const [fire, setFire] = useState(false);
  const seq = useRef<ThrowAndExplodeSequence | null>(null);
  const fireHandle = useRef<EffectHandle | null>(null);
  const extras = useRef<EffectHandle[]>([]);

  const attachFire = () => {
    fireHandle.current = fx.attach('ql-throw', { effect: 'fire-border', flameHeight: 16, intensity: 1, cornerRadius: 10 }, { key: 'ql-throw-fire', quality });
  };
  const setFireOn = (value: boolean) => {
    if (value && !fireHandle.current) attachFire();
    if (!value && fireHandle.current) {
      fireHandle.current.stop();
      fireHandle.current = null;
    }
    setFire(value);
  };
  const cancelExtras = () => {
    for (const h of extras.current) h.cancel();
    extras.current = [];
  };
  useEffect(() => {
    if (fireHandle.current) attachFire();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quality]);
  useEffect(
    () => () => {
      seq.current?.playback.cancel();
      fireHandle.current?.cancel();
      cancelExtras();
    },
    [],
  );

  const play = (finale: boolean) => {
    seq.current?.playback.cancel();
    cancelExtras();
    if (finale) setFireOn(true);
    const s = fx.throwAndExplode('ql-throw', {
      throw: THROW,
      explosion: { intensity, particles, glow, debris: true },
      shake: { amplitude: 9, duration: 380 },
      trail: trail || finale,
      quality,
    });
    seq.current = s;
    setStatus(`Launch (${quality})`);
    s.playback.onMarker('impact', () => {
      setStatus(finale ? 'Impact: explosion, golden sparks, confetti, victory' : 'Impact: flash, fireball, shockwave, sparks, debris, smoke');
      if (!finale) return;
      extras.current = [
        fx.play('golden-sparks', { target: 'ql-throw', count: 40, rate: 30, duration: 900 }, { quality, zIndex: 2 }),
        fx.play('confetti', { target: 'ql-stage', follow: false, count: 90 }, { quality, zIndex: 2 }),
        fx.play('victory', { target: 'ql-stage', follow: false }, { quality }),
      ];
    });
    void s.playback.finished.then((r) => {
      if (seq.current !== s) return;
      if (r.status !== 'completed') cancelExtras();
      setStatus(r.status === 'completed' ? 'Settled' : 'Cancelled: card restored, effects stopped');
    });
  };

  return (
    <Card title={`H · Throw & Explode (${quality})`} subtitle="Explosion intensity, particle density and glow; the impact effects start on the timeline's impact marker.">
      <GameFXTarget id="ql-stage" style={styles.stageTall}>
        <View style={styles.table} />
        <GameFXTarget id="ql-throw" style={[styles.playingCard, styles.throwStart]}>
          <Text style={styles.cardFace}>K♥</Text>
        </GameFXTarget>
      </GameFXTarget>
      <Text style={styles.status}>{status}</Text>
      <View style={styles.row}>
        <Button label="Throw" tone="accent" onPress={() => { play(false); }} />
        <Button label="Replay" onPress={() => { play(false); }} />
        <Button label="Cancel" tone="danger" onPress={() => seq.current?.playback.cancel()} />
        <Button label="Combined finale" tone="accent" onPress={() => { play(true); }} />
      </View>
      <Stepper label="Explosion" value={intensity} step={0.2} min={0.2} max={2} format={(v) => v.toFixed(1)} onChange={setIntensity} />
      <Stepper label="Particles" value={particles} step={30} min={30} max={300} onChange={setParticles} />
      <Stepper label="Glow" value={glow} step={0.25} min={0} max={2} format={(v) => v.toFixed(2)} onChange={setGlow} />
      <View style={styles.row}>
        <Button small label={trail ? 'Trail on' : 'Trail off'} tone={trail ? 'on' : 'normal'} onPress={() => { setTrail(!trail); }} />
        <Button small label={fire ? 'Fire on card' : 'No fire'} tone={fire ? 'on' : 'normal'} onPress={() => { setFireOn(!fire); }} />
      </View>
      {quality !== 'high' ? <Text style={styles.note}>Glow halos are drawn on high only; {quality} keeps the same timing with fewer layers.</Text> : null}
    </Card>
  );
}

export function QualityLab() {
  const [quality, setQuality] = useState<QualityLevel>('high');
  return (
    <>
      <SideBySide />
      <View style={styles.selector}>
        <Text style={styles.selectorLabel}>Profile for the two demos below</Text>
        <Chips options={LEVELS} value={quality} onChange={setQuality} />
        <Text style={styles.note}>{describeProfile(quality)}</Text>
      </View>
      <FireTuning quality={quality} />
      <ThrowTuning quality={quality} />
    </>
  );
}

const styles = StyleSheet.create({
  stageTall: { height: 260, borderRadius: 12, backgroundColor: '#100E1C', borderWidth: 1, borderColor: '#2E2950', alignItems: 'center', justifyContent: 'center' },
  sideBySide: { flexDirection: 'row', justifyContent: 'space-evenly' },
  slot: { alignItems: 'center', gap: 30 },
  slotLabel: { color: '#CFC8F0', fontSize: 12 },
  miniCard: { width: 58, height: 84, borderRadius: 10, backgroundColor: '#F4EFE6', alignItems: 'center', justifyContent: 'center' },
  miniFace: { fontSize: 20, fontWeight: '700', color: '#B3261E' },
  playingCard: { width: 96, height: 136, borderRadius: 12, backgroundColor: '#F4EFE6', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#D9CFBE' },
  throwStart: { position: 'absolute', left: 24, bottom: 18, width: 72, height: 100 },
  table: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 18, backgroundColor: '#3B2A1E', borderBottomLeftRadius: 12, borderBottomRightRadius: 12 },
  cardFace: { fontSize: 30, fontWeight: '700', color: '#B3261E' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  status: { color: '#FFD54A' },
  note: { color: '#9A92C4', fontSize: 12 },
  selector: { backgroundColor: '#1C1930', borderRadius: 16, padding: 14, gap: 8, borderWidth: 1, borderColor: '#5B4A9E' },
  selectorLabel: { color: 'white', fontSize: 15, fontWeight: '700' },
});
