// D. Particle effects: touch bursts, several bursts at once, presets placed on targets.
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import { GameFXTarget, useGameFX } from 'react-native-graphics';
import { StatsPanel } from '../diagnostics';
import { useRemeasureAfterTransition } from '../navigation';
import { Button, Choice, Note, Row, Screen, Section, colors, styles as ui } from '../ui';

const PALETTES = {
  Gold: ['#FFF6D5', '#FFD54A', '#FFB300', '#FF8F00'],
  Ice: ['#E0F7FF', '#7FDBFF', '#3A9BFF', '#1F5BFF'],
  Candy: ['#FF4D6D', '#FF9EBB', '#C77DFF', '#FFFFFF'],
} as const;
type Palette = keyof typeof PALETTES;

export function ParticlesScreen() {
  useRemeasureAfterTransition();
  const fx = useGameFX();
  const [palette, setPalette] = useState<Palette>('Gold');
  const [taps, setTaps] = useState(0);

  // Touches report window coordinates (pageX/pageY); effects use overlay coordinates.
  const burstAt = (e: GestureResponderEvent) => {
    setTaps((n) => n + 1);
    fx.play('particle-burst', {
      position: fx.fromWindow({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }),
      count: 70,
      duration: 900,
      colors: PALETTES[palette],
    });
  };

  const fiveBursts = (e: GestureResponderEvent) => {
    const { pageX, pageY } = e.nativeEvent;
    for (let i = 0; i < 5; i++) {
      fx.play('particle-burst', {
        position: fx.fromWindow({ x: pageX + (i - 2) * 50, y: pageY - 80 }),
        count: 40,
        duration: 1100,
        speed: { min: 60, max: 200 },
        colors: PALETTES[palette],
      });
    }
  };

  return (
    <Screen testID="particles-screen">
      <Section title="Tap the area">
        <Pressable onPress={burstAt} style={local.tapArea} testID="tap-area">
          <Text style={local.tapText}>Tap anywhere here ({String(taps)})</Text>
        </Pressable>
        <Choice options={Object.keys(PALETTES) as Palette[]} value={palette} onChange={setPalette} />
        <Row>
          <Button label="5 bursts at once" onPress={fiveBursts} testID="five-bursts" />
          <Button label="Cancel all" tone="danger" onPress={() => { fx.cancelAll(); }} testID="cancel-all" />
        </Row>
        <Note>Each tap is an independent effect. Tap quickly: bursts overlap and each one ends by itself.</Note>
      </Section>

      <Section title="Presets on views">
        <View style={[ui.stage, local.row]}>
          <GameFXTarget id="p-left" style={local.chip}>
            <Text style={local.chipText}>Left</Text>
          </GameFXTarget>
          <GameFXTarget id="p-mid" style={local.chip}>
            <Text style={local.chipText}>Middle</Text>
          </GameFXTarget>
          <GameFXTarget id="p-right" style={local.chip}>
            <Text style={local.chipText}>Right</Text>
          </GameFXTarget>
        </View>
        <Row>
          <Button label="Confetti (left)" onPress={() => fx.play('confetti', { target: 'p-left', offset: { x: 0, y: -30 }, count: 120 })} testID="confetti" />
          <Button label="Sparks (middle)" onPress={() => fx.play('golden-sparks', { target: 'p-mid', count: 80 })} testID="sparks" />
          <Button label="Explosion (right)" onPress={() => fx.play('explosion', { target: 'p-right', follow: false, intensity: 0.7 })} testID="explosion" />
        </Row>
        <Row>
          <Button
            label="All three"
            tone="primary"
            onPress={() => {
              fx.play('confetti', { target: 'p-left', offset: { x: 0, y: -30 }, count: 120 });
              fx.play('golden-sparks', { target: 'p-mid', count: 80 });
              fx.play('explosion', { target: 'p-right', follow: false, intensity: 0.7 });
            }}
            testID="all-three"
          />
        </Row>
        <Note>`target` places an effect on a view; `offset` is in the view's own coordinates. Positions come from measuring the views, so the effects line up in portrait and landscape.</Note>
      </Section>

      <Section title="Engine">
        <StatsPanel />
      </Section>
    </Screen>
  );
}

const local = StyleSheet.create({
  tapArea: { height: 200, borderRadius: 12, backgroundColor: colors.stage, alignItems: 'center', justifyContent: 'center' },
  tapText: { color: '#C9CEE6' },
  row: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  chip: { width: 84, height: 56, borderRadius: 10, backgroundColor: '#2A2F4A', alignItems: 'center', justifyContent: 'center' },
  chipText: { color: '#FFFFFF', fontWeight: '600' },
});
