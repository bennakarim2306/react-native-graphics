// G. Quality levels and reduced motion, set through the provider props by app settings.
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GameFXTarget, QUALITY_PROFILES, useGameFX } from 'react-native-graphics';
import type { EffectHandle, QualityLevel } from 'react-native-graphics';
import { StatsPanel } from '../diagnostics';
import { useRemeasureAfterTransition } from '../navigation';
import { useSettings } from '../settings';
import { Button, Choice, Note, Row, Screen, Section, styles as ui } from '../ui';

const LEVELS: readonly QualityLevel[] = ['low', 'medium', 'high'];
const MOTION = ['system', 'on', 'off'] as const;
type MotionChoice = (typeof MOTION)[number];

export function QualityScreen() {
  useRemeasureAfterTransition();
  const fx = useGameFX();
  const settings = useSettings();
  const fire = useRef<EffectHandle | null>(null);
  const motionChoice: MotionChoice = settings.reducedMotion === 'system' ? 'system' : settings.reducedMotion ? 'on' : 'off';
  const profile = QUALITY_PROFILES[settings.quality];

  // Restart the fire when the level changes: quality applies to effects started afterwards.
  const startFire = () => {
    fire.current?.cancel();
    fire.current = fx.attach('q-card', 'fire-border', { intensity: 1 });
  };
  useEffect(() => {
    if (!fire.current || fire.current.status !== 'playing') return undefined;
    // The provider applies the new props in its own effect, which runs after this one.
    const timer = setTimeout(startFire, 50);
    return () => { clearTimeout(timer); };
  }, [settings.quality, settings.reducedMotion]);
  // The provider applies prop changes after this render; refresh the readout shortly after.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => { setTick((n) => n + 1); }, 500);
    return () => { clearInterval(timer); };
  }, []);
  useEffect(() => () => { fire.current?.cancel(); }, []);

  return (
    <Screen testID="quality-screen">
      <Section title="Quality (provider prop)">
        <Choice options={LEVELS} value={settings.quality} onChange={settings.setQuality} />
        <Text style={ui.mono} testID="quality-profile">
          {`fx.quality = ${fx.quality}\nparticles ×${String(profile.particleScale)} · shaders ${profile.shaders ? profile.shaderDetail ?? 'full' : 'off'} · glow ${profile.glow ? 'on' : 'off'} · details ${profile.details ? 'on' : 'off'}`}
        </Text>
        <Note>Running effects keep the level they started with; new effects use the new one. The fire restarts here so you can compare.</Note>
      </Section>

      <Section title="Reduced motion (provider prop)">
        <Choice
          options={MOTION}
          value={motionChoice}
          onChange={(v) => { settings.setReducedMotion(v === 'system' ? 'system' : v === 'on'); }}
        />
        <Text style={ui.mono} testID="reduced-motion">{`fx.reducedMotion = ${String(fx.reducedMotion)}`}</Text>
        <Note>"system" follows the device setting (Android: Settings › Accessibility › Remove animations). Reduced motion turns shakes off, makes flashes smaller and emits fewer particles.</Note>
      </Section>

      <Section title="Try it">
        <View style={[ui.stage, local.stage]}>
          <GameFXTarget id="q-card" style={ui.playingCard}>
            <Text style={ui.playingCardText}>J♣</Text>
          </GameFXTarget>
        </View>
        <Row>
          <Button label="Fire border" tone="primary" onPress={startFire} testID="q-fire" />
          <Button label="Stop fire" onPress={() => fire.current?.stop()} />
          <Button label="Explosion + shake" onPress={() => fx.play('explosion', { target: 'q-card', follow: false, screenShake: { scope: ['q-card'] } })} testID="q-explosion" />
          <Button label="Confetti" onPress={() => fx.play('confetti', { target: 'q-card', offset: { x: 0, y: -40 } })} testID="q-confetti" />
        </Row>
      </Section>

      <Section title="Engine">
        <StatsPanel />
      </Section>
    </Screen>
  );
}

const local = StyleSheet.create({
  stage: { height: 240 },
});
