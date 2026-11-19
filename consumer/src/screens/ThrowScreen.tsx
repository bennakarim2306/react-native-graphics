// C. Throw & Explode on an existing view: throw, rotation, fall, impact, explosion, replay, cancel.
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GameFXTarget, useGameFX } from 'react-native-graphics';
import type { ThrowAndExplodeSequence } from 'react-native-graphics';
import { StatsPanel } from '../diagnostics';
import { useRemeasureAfterTransition } from '../navigation';
import { Button, Choice, Note, Row, Screen, Section, styles as ui } from '../ui';

type After = 'return' | 'vanish' | 'stay';

export function ThrowScreen() {
  useRemeasureAfterTransition();
  const fx = useGameFX();
  const seq = useRef<ThrowAndExplodeSequence | null>(null);
  const [after, setAfter] = useState<After>('return');
  const [status, setStatus] = useState('Ready');

  const play = () => {
    seq.current?.playback.cancel();
    const s = fx.throwAndExplode('throw-card', {
      throw: { height: 130, distance: 140, duration: 1000, rotation: 540 },
      explosion: { particles: 150, debris: true },
      shake: { amplitude: 8, duration: 350 },
      afterImpact: after,
    });
    seq.current = s;
    setStatus('Launch');
    s.playback.onMarker('peak', () => { setStatus('Peak'); });
    s.playback.onMarker('impact', () => { setStatus('Impact: explosion'); });
    void s.playback.finished.then((result) => {
      if (seq.current === s) setStatus(result.status === 'completed' ? 'Settled' : 'Cancelled: card restored');
    });
  };

  useEffect(() => () => { seq.current?.playback.cancel(); }, []);

  return (
    <Screen testID="throw-screen">
      <Section title="Throw an ordinary view">
        <View style={[ui.stage, local.stage]}>
          <View style={local.table} />
          <GameFXTarget id="throw-card" style={[ui.playingCard, local.card]}>
            <Text style={ui.playingCardText}>K♠</Text>
          </GameFXTarget>
        </View>
        <Row>
          <Button label="Throw & Explode" tone="primary" onPress={play} testID="throw" />
          <Button label="Replay" onPress={play} testID="replay" />
          <Button label="Cancel" tone="danger" onPress={() => seq.current?.playback.cancel()} testID="throw-cancel" />
        </Row>
        <Choice options={['return', 'vanish', 'stay'] as const} value={after} onChange={setAfter} />
        <Text testID="throw-status">{status}</Text>
        <Note>One handle controls the whole sequence: Cancel at any moment puts the card back where it was and ends the explosion, smoke and shake.</Note>
      </Section>
      <Section title="Engine">
        <StatsPanel />
      </Section>
    </Screen>
  );
}

const local = StyleSheet.create({
  stage: { height: 320, justifyContent: 'flex-end', paddingBottom: 40 },
  table: { position: 'absolute', left: 16, right: 16, bottom: 36, height: 2, backgroundColor: '#3A3F5C' },
  card: { marginRight: 120 },
});
