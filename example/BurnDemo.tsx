/**
 * I. Burn away: an ordinary card view burns away and stays gone. On iOS and Android the target
 * takes a picture of the view, hides it, and the engine burns the picture (charred, glowing,
 * ragged edge, flames, embers, smoke, ash). On the web views cannot be captured: the card chars
 * and fades instead. Cancel brings the card back at any moment; Restore fades it in again after
 * it burned.
 *
 * Only the public `react-native-graphics` entry point is used.
 */
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { GameFXTarget, useGameFX } from 'react-native-graphics';
import type { BurnOrigin, EffectHandle, GameFX, Playback } from 'react-native-graphics';
import { Button, Card, Chips, Stepper } from './ui';

const ORIGINS = { Bottom: 'bottom', Corner: 'bottom-right', Centre: 'center', Top: 'top', Random: 'random' } as const satisfies Record<string, BurnOrigin>;
type Origin = keyof typeof ORIGINS;
const COLORS = { Orange: '#FF7A1A', Blue: '#3D8BFF', Green: '#2BD67B', Violet: '#B04DFF' } as const;
type BurnColor = keyof typeof COLORS;
const HAND = ['burn-hand-1', 'burn-hand-2', 'burn-hand-3'] as const;

/** Shows a burned (hidden) card again with a short fade. */
function restore(fx: GameFX, id: string) {
  const motion = fx.getTarget(id)?.motion;
  if (!motion || motion.opacity === 1) return;
  fx.animate(id, { opacity: 1, duration: 350, easing: 'easeOutQuad' });
}

export function BurnDemo() {
  const fx = useGameFX();
  const [origin, setOrigin] = useState<Origin>('Bottom');
  const [color, setColor] = useState<BurnColor>('Orange');
  const [duration, setDuration] = useState(1800);
  const [roughness, setRoughness] = useState(0.6);
  const [fireFirst, setFireFirst] = useState(false);
  const [moving, setMoving] = useState(false);
  const [status, setStatus] = useState('Ready');
  const burn = useRef<EffectHandle | null>(null);
  const fire = useRef<EffectHandle | null>(null);
  const motion = useRef<Playback | null>(null);
  const delay = useRef<Playback | null>(null);
  const hand = useRef<Playback | null>(null);

  const clear = () => {
    delay.current?.cancel();
    delay.current = null;
    burn.current?.cancel();
    fire.current?.cancel();
    motion.current?.cancel();
  };

  const startBurn = () => {
    fire.current?.stop();
    const handle = fx.play('burn-away', {
      target: 'burn-card',
      from: ORIGINS[origin],
      duration,
      roughness,
      color: COLORS[color],
    });
    burn.current = handle;
    setStatus('Burning…');
    if (moving) {
      // The burning picture follows the view's motion (here a drift and a turn).
      motion.current = fx.animate('burn-card', { x: 60, rotation: 25, duration: duration * 0.9, easing: 'easeInOutQuad' });
    }
    void handle.finished.then((r) => {
      if (burn.current !== handle) return;
      setStatus(r.status === 'completed' ? 'Burned away. The view stays hidden until Restore.' : 'Cancelled: card restored');
    });
  };

  const play = () => {
    clear();
    const m = fx.getTarget('burn-card')?.motion;
    if (m) m.reset();
    if (fireFirst) {
      fire.current = fx.attach('burn-card', { effect: 'fire-border', flameHeight: 18, intensity: 1, color: COLORS[color] }, { key: 'burn-fire' });
      setStatus('On fire…');
      // On the engine clock, so the fire burns for 900 ms of effect time (pauses and slow motion included).
      delay.current = fx.timeline().call(startBurn, 900).play();
    } else {
      startBurn();
    }
  };

  const burnHand = () => {
    hand.current?.cancel();
    HAND.forEach((id) => fx.getTarget(id)?.motion.reset());
    const tl = fx.timeline();
    const from: BurnOrigin[] = ['top-left', 'bottom', 'top-right'];
    HAND.forEach((id, i) => tl.add(fx.cue('burn-away', { target: id, from: from[i] ?? 'bottom', duration: 1400, color: COLORS[color] }), i * 220));
    hand.current = tl.play();
  };

  useEffect(
    () => () => {
      clear();
      hand.current?.cancel();
    },
    [],
  );

  return (
    <Card title="I · Burn away" subtitle="A plain card view catches fire and burns away: charred, glowing ragged edge, flames, embers, smoke and ash. It stays hidden afterwards.">
      <View style={styles.stage}>
        <GameFXTarget id="burn-card" style={styles.card}>
          <Text style={styles.face}>Q♦</Text>
          <Text style={styles.hint}>a plain RN View</Text>
        </GameFXTarget>
      </View>
      <Text style={styles.status}>{status}</Text>
      {Platform.OS === 'web' ? <Text style={styles.note}>On the web views cannot be captured, so the card chars and fades instead.</Text> : null}
      <View style={styles.row}>
        <Button label="Burn" tone="accent" onPress={play} />
        <Button
          label="Cancel"
          tone="danger"
          onPress={() => {
            clear();
            fx.getTarget('burn-card')?.motion.reset();
          }}
        />
        <Button
          label="Restore"
          onPress={() => {
            clear();
            burn.current = null; // the last smoke may still be drifting: no "Cancelled" status for it
            const m = fx.getTarget('burn-card')?.motion;
            if (m) {
              m.x = 0;
              m.rotation = 0;
            }
            restore(fx, 'burn-card');
            setStatus('Ready');
          }}
        />
      </View>
      <Chips options={Object.keys(ORIGINS) as Origin[]} value={origin} onChange={setOrigin} />
      <Chips options={Object.keys(COLORS) as BurnColor[]} value={color} onChange={setColor} />
      <Stepper label="Duration" value={duration} step={200} min={600} max={4000} format={(v) => `${String(v)} ms`} onChange={setDuration} />
      <Stepper label="Roughness" value={roughness} step={0.1} min={0} max={1} format={(v) => v.toFixed(1)} onChange={setRoughness} />
      <View style={styles.row}>
        <Button small label={fireFirst ? 'Fire first: on' : 'Fire first: off'} tone={fireFirst ? 'on' : 'normal'} onPress={() => { setFireFirst(!fireFirst); }} />
        <Button small label={moving ? 'Move while burning: on' : 'Move while burning: off'} tone={moving ? 'on' : 'normal'} onPress={() => { setMoving(!moving); }} />
      </View>
      <View style={[styles.handStage]}>
        {HAND.map((id, i) => (
          <GameFXTarget key={id} id={id} style={styles.mini}>
            <Text style={styles.miniFace}>{['7♣', '8♥', '9♠'][i]}</Text>
          </GameFXTarget>
        ))}
      </View>
      <View style={styles.row}>
        <Button small label="Burn the hand (staggered)" onPress={burnHand} />
        <Button
          small
          label="Restore hand"
          onPress={() => {
            hand.current?.cancel();
            HAND.forEach((id) => {
              restore(fx, id);
            });
          }}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  stage: { height: 230, borderRadius: 12, backgroundColor: '#100E1C', borderWidth: 1, borderColor: '#2E2950', alignItems: 'center', justifyContent: 'center' },
  card: { width: 104, height: 146, borderRadius: 12, backgroundColor: '#F4EFE6', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#D9CFBE' },
  face: { fontSize: 34, fontWeight: '700', color: '#B3261E' },
  hint: { fontSize: 10, color: '#6B6255', marginTop: 4 },
  status: { color: '#FFD54A' },
  note: { color: '#9A92C4', fontSize: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  handStage: { height: 130, borderRadius: 12, backgroundColor: '#100E1C', borderWidth: 1, borderColor: '#2E2950', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly' },
  mini: { width: 64, height: 92, borderRadius: 9, backgroundColor: '#F4EFE6', alignItems: 'center', justifyContent: 'center' },
  miniFace: { fontSize: 22, fontWeight: '700', color: '#1E1B2E' },
});
