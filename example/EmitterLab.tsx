/**
 * G. Emitter lab (Phase 4A): several particle emitters at once, changed while they run.
 *
 * Four `particles` effects with different emission shapes and spaces:
 * - Trail (point, world space): left behind an orb that orbits a hub (a scene node the engine
 *   animates).
 * - Halo (circle, local space): moves and rotates with the orb.
 * - Fountain (line, world space): along a line at the bottom of the stage, falling under gravity.
 * - Snow (rect, world space): falls from a box that slides from side to side.
 *
 * Each emitter has its own handle: start, pause, resume, stop, cancel, and live changes with
 * `handle.update` (rate, speed, spread, gravity, size, colors). "Remove orb" destroys the scene
 * node: the trail and halo stop emitting at once, their particles disappear, and the effects
 * end and give their storage back to the particle pool (see the counters). "Add orb" brings it
 * back with new emitters, served from the pool.
 *
 * Only the public `react-native-graphics` entry point is used; nothing here animates particles
 * itself. React re-renders on button presses and twice a second for the counters, never per frame.
 */
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GameFXTarget, sharedParticlePool, useGameFX, useGameFXEngine } from 'react-native-graphics';
import type { EffectHandle, ParticlesParams, ParticlesUpdate, Playback, SceneNode } from 'react-native-graphics';
import { Button } from './ui';

type EmitterId = 'Trail' | 'Halo' | 'Fountain' | 'Snow';
const EMITTER_IDS: readonly EmitterId[] = ['Trail', 'Halo', 'Fountain', 'Snow'];

const KINDS: Record<EmitterId, string> = {
  Trail: 'point emitter, world space, on the orb',
  Halo: 'circle emitter, local space, on the orb',
  Fountain: 'line emitter, world space, with gravity',
  Snow: 'rect emitter, world space, on the sliding box',
};

const PALETTES = {
  Gold: ['#FFD54A', '#FFB300', '#FF7043', '#FFF3C4'],
  Ice: ['#4FC3F7', '#B3E5FC', '#FFFFFF'],
  Violet: ['#B388FF', '#7C4DFF', '#E1D5FF'],
  Lime: ['#C6FF00', '#76FF03', '#F4FF81'],
} as const;
type Palette = keyof typeof PALETTES;

/** What the steppers change (live, through `handle.update`). */
interface Settings {
  rate: number;
  speed: number;
  spread: number;
  gravity: number;
  size: number;
  palette: Palette;
}

const INITIAL: Record<EmitterId, Settings> = {
  Trail: { rate: 70, speed: 25, spread: 360, gravity: 0, size: 4, palette: 'Gold' },
  Halo: { rate: 70, speed: 25, spread: 20, gravity: 0, size: 4, palette: 'Violet' },
  Fountain: { rate: 60, speed: 270, spread: 15, gravity: 400, size: 3, palette: 'Ice' },
  Snow: { rate: 30, speed: 45, spread: 30, gravity: 0, size: 3, palette: 'Ice' },
};

/** Slowest particle as a fraction of `speed` (a fountain needs a narrow range to look like one). */
const SPEED_RANGE: Record<EmitterId, number> = { Trail: 0.4, Halo: 0.4, Fountain: 0.8, Snow: 0.4 };

/** The emitter properties the steppers control, as `handle.update` takes them. */
function live(id: EmitterId, s: Settings): ParticlesUpdate {
  return {
    rate: s.rate,
    speed: { min: s.speed * SPEED_RANGE[id], max: s.speed },
    spread: s.spread,
    gravity: s.gravity,
    size: { min: s.size * 0.5, max: s.size },
    colors: PALETTES[s.palette],
  };
}

interface LabNodes {
  pivot: SceneNode;
  orb: SceneNode | null;
  box: SceneNode;
  playbacks: Playback[];
}

/** Full parameters of one emitter: fixed look and shape, plus the live settings. */
function paramsFor(id: EmitterId, nodes: LabNodes, s: Settings): ParticlesParams | null {
  const settings = live(id, s);
  switch (id) {
    case 'Trail':
      if (!nodes.orb) return null;
      return { ...settings, target: nodes.orb, lifetime: { min: 400, max: 900 }, look: 'soft', blendMode: 'plus', scale: { from: 1, to: 0.3 }, maxParticles: 800 };
    case 'Halo':
      if (!nodes.orb) return null;
      return {
        ...settings,
        target: nodes.orb,
        space: 'local',
        shape: { type: 'circle', radius: 16, edge: true },
        directionMode: 'normal',
        lifetime: 450,
        look: 'spark',
        blendMode: 'plus',
        maxParticles: 600,
      };
    case 'Fountain':
      return {
        ...settings,
        target: 'lab-stage',
        offset: { x: 0, y: 100 },
        shape: { type: 'line', from: { x: -70, y: 0 }, to: { x: 70, y: 0 } },
        direction: -90,
        lifetime: { min: 900, max: 1300 },
        look: 'spark',
        blendMode: 'plus',
        maxParticles: 1200,
      };
    case 'Snow':
      return { ...settings, target: nodes.box, shape: { type: 'rect', width: 120, height: 10 }, direction: 90, lifetime: { min: 1200, max: 1800 }, look: 'soft', maxParticles: 800 };
  }
}

function statusOf(handle: EffectHandle | null, stopping: boolean): string {
  if (!handle) return 'off';
  switch (handle.status) {
    case 'playing':
      return stopping ? 'stopping' : 'running';
    case 'paused':
      return 'paused';
    case 'completed':
      return 'ended';
    case 'cancelled':
      return 'cancelled';
  }
}

/** A labelled − value + control (React Native has no built-in slider). */
function Stepper({ label, value, onChange, step, min, max }: { label: string; value: number; onChange: (v: number) => void; step: number; min: number; max: number }) {
  const set = (v: number) => {
    onChange(Math.min(max, Math.max(min, Math.round(v / step) * step)));
  };
  return (
    <View style={styles.stepper}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <Button small label="−" onPress={() => { set(value - step); }} />
      <Text style={styles.stepperValue}>{String(value)}</Text>
      <Button small label="+" onPress={() => { set(value + step); }} />
    </View>
  );
}

export function EmitterLab() {
  const fx = useGameFX();
  const engine = useGameFXEngine();
  const nodes = useRef<LabNodes | null>(null);
  const handles = useRef<Record<EmitterId, EffectHandle | null>>({ Trail: null, Halo: null, Fountain: null, Snow: null });
  const stopping = useRef(new Set<EmitterId>());
  const particleCount = useRef(0);
  const [settings, setSettings] = useState<Record<EmitterId, Settings>>(INITIAL);
  const [selected, setSelected] = useState<EmitterId>('Trail');
  const [labOn, setLabOn] = useState(false);
  const [orbiting, setOrbiting] = useState(true);
  const [message, setMessage] = useState('');
  const [, setTick] = useState(0);
  const refresh = () => {
    setTick((t) => t + 1);
  };

  // Counters: one frame listener (no React work per frame) and a re-render twice a second.
  useEffect(() => {
    if (!engine || !labOn) return undefined;
    const off = engine.on('frame', (e) => {
      let n = 0;
      for (const d of e.drawables) if (d.kind === 'particles') n += (d as unknown as { aliveCount: number }).aliveCount;
      particleCount.current = n;
    });
    const timer = setInterval(refresh, 500);
    return () => {
      off();
      clearInterval(timer);
    };
  }, [engine, labOn]);

  const isActive = (id: EmitterId) => {
    const h = handles.current[id];
    return h !== null && (h.status === 'playing' || h.status === 'paused');
  };

  const start = (id: EmitterId, s: Settings = settings[id]) => {
    const n = nodes.current;
    if (!n) return;
    const params = paramsFor(id, n, s);
    if (!params) {
      setMessage('The orb is gone: press "Add orb" first.');
      return;
    }
    handles.current[id]?.cancel();
    stopping.current.delete(id);
    const handle = fx.play('particles', params);
    handle.onEnd(refresh);
    handles.current[id] = handle;
  };

  const createOrb = (pivot: SceneNode) =>
    engine?.scene.createNode({ parent: pivot, x: 80, y: 0, shape: { type: 'circle', radius: 11, color: '#7C4DFF', stroke: { fill: '#E1D5FF', width: 2 } } }) ?? null;

  const startLab = () => {
    const stage = engine?.targets.node('lab-stage');
    if (!engine || !stage) return;
    const pivot = engine.scene.createNode({ parent: stage, x: 0, y: -8 });
    engine.scene.createNode({ parent: pivot, shape: { type: 'circle', radius: 80, stroke: { fill: '#2E2950', width: 1 } } });
    engine.scene.createNode({ parent: pivot, shape: { type: 'circle', radius: 5, color: '#3D3470' } });
    const box = engine.scene.createNode({ parent: stage, x: 0, y: -92, shape: { type: 'rect', width: 124, height: 12, color: '#2F2A55', cornerRadius: 6 } });
    nodes.current = {
      pivot,
      box,
      orb: createOrb(pivot),
      playbacks: [
        engine.animate(pivot, { rotation: 360, duration: 4000, repeat: Infinity, easing: 'linear' }).play(),
        engine
          .keyframes(box, {
            duration: 3000,
            repeat: Infinity,
            keyframes: [{ at: 0, x: 0 }, { at: 0.25, x: 70, easing: 'easeInOutSine' }, { at: 0.75, x: -70, easing: 'easeInOutSine' }, { at: 1, x: 0, easing: 'easeInOutSine' }],
          })
          .play(),
      ],
    };
    for (const id of EMITTER_IDS) start(id);
    setOrbiting(true);
    setLabOn(true);
    setMessage('');
  };

  const endLab = () => {
    for (const id of EMITTER_IDS) {
      handles.current[id]?.cancel();
      handles.current[id] = null;
    }
    const n = nodes.current;
    if (n) {
      for (const p of n.playbacks) p.cancel();
      // Destroying the pivot destroys its children (orb, ring, hub).
      if (!n.pivot.destroyed) n.pivot.destroy();
      if (!n.box.destroyed) n.box.destroy();
    }
    nodes.current = null;
    stopping.current.clear();
    setLabOn(false);
    refresh();
  };
  useEffect(() => endLab, []);

  /** Changes one setting of the selected emitter and sends it to its handle if it runs. */
  const change = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    const next = { ...settings[selected], [key]: value };
    setSettings({ ...settings, [selected]: next });
    const handle = handles.current[selected];
    if (handle && isActive(selected)) {
      try {
        handle.update(live(selected, next));
        setMessage(`${selected}: ${key} → ${String(value)} (live)`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    }
  };

  const removeOrb = () => {
    const n = nodes.current;
    if (!n?.orb) return;
    n.orb.destroy(); // the trail and halo stop emitting and end when their particles are gone
    n.orb = null;
    setMessage('Orb removed: its emitters stop and end, their storage goes back to the pool.');
    refresh();
  };

  const addOrb = () => {
    const n = nodes.current;
    if (!n || n.orb) return;
    n.orb = createOrb(n.pivot);
    start('Trail');
    start('Halo');
    setMessage('Orb added with a new trail and halo (buffers reused from the pool).');
    refresh();
  };

  const all = (action: 'pause' | 'resume' | 'stop' | 'cancel') => {
    for (const id of EMITTER_IDS) {
      const h = handles.current[id];
      if (!h) continue;
      if (action === 'stop' && h.status === 'playing') stopping.current.add(id);
      h[action]();
    }
    refresh();
  };

  const toggleOrbit = () => {
    const spin = nodes.current?.playbacks[0];
    if (!spin) return;
    if (orbiting) spin.pause();
    else spin.resume();
    setOrbiting(!orbiting);
  };

  const pool = sharedParticlePool.stats;
  const s = settings[selected];
  const handle = handles.current[selected];
  const statuses = EMITTER_IDS.map((id) => `${id} ${statusOf(handles.current[id], stopping.current.has(id))}`).join(' · ');

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>G · Emitter lab</Text>
      <Text style={styles.cardSubtitle}>Four emitters at once (point, circle, line, rect; world and local space), each with its own handle. Change them while they run.</Text>
      <GameFXTarget id="lab-stage" style={styles.stage} />
      {labOn ? (
        <Text style={styles.report}>
          {`${statuses}\n`}
          {`Live particles ${String(particleCount.current)} · engine effects ${String(engine?.activeCount ?? 0)}\n`}
          {`Particle pool: allocated ${String(pool.allocated)} · reused ${String(pool.reused)} · idle ${String(pool.idle)}`}
        </Text>
      ) : (
        <Text style={styles.report}>Start the lab to create the orb, the box and four emitters.</Text>
      )}
      <View style={styles.row}>
        {labOn ? <Button label="End lab" tone="danger" onPress={endLab} /> : <Button label="Start lab" tone="accent" onPress={startLab} />}
        {labOn ? <Button label={nodes.current?.orb ? 'Remove orb' : 'Add orb'} onPress={nodes.current?.orb ? removeOrb : addOrb} /> : null}
        {labOn ? <Button label={orbiting ? 'Pause orbit' : 'Resume orbit'} onPress={toggleOrbit} /> : null}
      </View>
      {labOn ? (
        <>
          <View style={styles.row}>
            {EMITTER_IDS.map((id) => (
              <Button key={id} small label={id} tone={id === selected ? 'on' : 'normal'} onPress={() => { setSelected(id); }} />
            ))}
          </View>
          <Text style={styles.editing}>
            {selected}: {KINDS[selected]} · {statusOf(handle, stopping.current.has(selected))}
          </Text>
          <View style={styles.row}>
            {isActive(selected) ? (
              <>
                <Button small label={handle?.status === 'paused' ? 'Resume' : 'Pause'} onPress={() => { if (handle?.status === 'paused') handle.resume(); else handle?.pause(); refresh(); }} />
                <Button small label="Stop" onPress={() => { stopping.current.add(selected); handle?.stop(); refresh(); }} />
                <Button small label="Cancel" tone="danger" onPress={() => { handle?.cancel(); refresh(); }} />
              </>
            ) : (
              <Button small label="Start" tone="accent" onPress={() => { start(selected); refresh(); }} />
            )}
          </View>
          <Stepper label="Rate /s" value={s.rate} step={10} min={0} max={300} onChange={(v) => { change('rate', v); }} />
          <Stepper label="Speed" value={s.speed} step={15} min={0} max={450} onChange={(v) => { change('speed', v); }} />
          <Stepper label="Spread °" value={s.spread} step={15} min={0} max={360} onChange={(v) => { change('spread', v); }} />
          <Stepper label="Gravity" value={s.gravity} step={100} min={-600} max={900} onChange={(v) => { change('gravity', v); }} />
          <Stepper label="Size" value={s.size} step={1} min={1} max={10} onChange={(v) => { change('size', v); }} />
          <View style={styles.row}>
            {(Object.keys(PALETTES) as Palette[]).map((p) => (
              <Button key={p} small label={p} tone={p === s.palette ? 'on' : 'normal'} onPress={() => { change('palette', p); }} />
            ))}
          </View>
          <View style={styles.row}>
            <Button small label="Pause all" onPress={() => { all('pause'); }} />
            <Button small label="Resume all" onPress={() => { all('resume'); }} />
            <Button small label="Stop all" onPress={() => { all('stop'); }} />
            <Button small label="Cancel all" tone="danger" onPress={() => { all('cancel'); }} />
          </View>
          {message ? <Text style={styles.message}>{message}</Text> : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#1C1930', borderRadius: 16, padding: 14, gap: 10 },
  cardTitle: { color: 'white', fontSize: 18, fontWeight: '700' },
  cardSubtitle: { color: '#9A92C4', fontSize: 13 },
  stage: { height: 230, borderRadius: 12, backgroundColor: '#100E1C', borderWidth: 1, borderColor: '#2E2950' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  report: { color: '#FFD54A', fontSize: 12, fontVariant: ['tabular-nums'] },
  editing: { color: 'white', fontWeight: '600' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepperLabel: { color: '#CFC8F0', width: 110 },
  stepperValue: { color: 'white', width: 56, textAlign: 'center', fontVariant: ['tabular-nums'] },
  message: { color: '#CFC8F0', fontSize: 12 },
});
