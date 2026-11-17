// B. Fire border on an existing View: start/stop, intensity, color, move, rotate, scale, cleanup.
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { GameFXTarget, useGameFX } from 'react-native-graphics';
import type { EffectHandle } from 'react-native-graphics';
import { StatsPanel } from '../diagnostics';
import { useRemeasureAfterTransition } from '../navigation';
import { Button, Choice, Note, Row, Screen, Section, Stepper, styles } from '../ui';

const COLORS = { Orange: '#FF6A00', Blue: '#2F7BFF', Green: '#22C55E', Violet: '#A855F7' } as const;
type ColorName = keyof typeof COLORS;

export function FireBorderScreen() {
  useRemeasureAfterTransition();
  const fx = useGameFX();
  const fire = useRef<EffectHandle | null>(null);
  const [burning, setBurning] = useState(false);
  const [intensity, setIntensity] = useState(1);
  const [color, setColor] = useState<ColorName>('Orange');
  const [pressed, setPressed] = useState(0);

  const start = () => {
    fire.current?.cancel();
    const handle = fx.attach('fire-card', 'fire-border', { intensity, color: COLORS[color] });
    fire.current = handle;
    setBurning(true);
    void handle.finished.then(() => {
      if (fire.current === handle) setBurning(false);
    });
  };
  // Graceful: no new flames, the effect completes once the last ones faded.
  const stop = () => { fire.current?.stop(); };

  // Live changes go to the running effect; no restart.
  useEffect(() => { fire.current?.setIntensity(intensity); }, [intensity]);
  useEffect(() => { fire.current?.update({ color: COLORS[color] }); }, [color]);
  // Leaving the screen unmounts the target, which ends the fire anyway; this is explicit.
  useEffect(() => () => { fire.current?.cancel(); }, []);

  const motion = () => fx.getTarget('fire-card')?.motion;
  return (
    <Screen testID="fire-screen">
      <Section title="An ordinary card view with flames">
        <View style={[styles.stage, { height: 260 }]}>
          <GameFXTarget id="fire-card" style={styles.playingCard}>
            <Text style={styles.playingCardText}>A♥</Text>
            <Button label={`Tap me (${String(pressed)})`} onPress={() => { setPressed((n) => n + 1); }} testID="card-button" />
          </GameFXTarget>
        </View>
        <Note>The flames are drawn inside the card's own view, so they move with it in the same frame. The button inside still takes touches.</Note>
        <Row>
          <Button label="Start fire" tone="primary" onPress={start} testID="fire-start" />
          <Button label="Stop" onPress={stop} testID="fire-stop" />
          <Button label="Cancel" tone="danger" onPress={() => { fire.current?.cancel(); }} />
        </Row>
        <Text testID="fire-status">{burning ? 'Burning' : 'No fire'}</Text>
        <Stepper label="Intensity" value={intensity} step={0.2} min={0.2} max={2} onChange={setIntensity} />
        <Choice options={Object.keys(COLORS) as ColorName[]} value={color} onChange={setColor} />
        <Row>
          <Button label="Move" onPress={() => { const m = motion(); fx.animate('fire-card', { x: m && m.x !== 0 ? 0 : 70, duration: 600, easing: 'easeInOutQuad' }); }} testID="fire-move" />
          <Button label="Rotate" onPress={() => { const m = motion(); fx.animate('fire-card', { rotation: (m?.rotation ?? 0) + 90, duration: 600, easing: 'easeInOutQuad' }); }} testID="fire-rotate" />
          <Button label="Scale" onPress={() => { const m = motion(); fx.animate('fire-card', { scale: m && m.scaleX > 1.1 ? 1 : 1.35, duration: 500, easing: 'easeOutBack' }); }} testID="fire-scale" />
          <Button label="Reset" onPress={() => { motion()?.reset(); }} />
        </Row>
      </Section>
      <Section title="Engine">
        <StatsPanel />
        <Note>Go back while it burns: the effect ends with the screen and the counters return to zero (check on the lifecycle screen).</Note>
      </Section>
    </Screen>
  );
}
