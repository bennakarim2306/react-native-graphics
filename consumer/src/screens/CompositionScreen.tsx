// E. Composition: a synchronized multi-stage timeline, and several effects stacked on one view.
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GameFXTarget, useGameFX } from 'react-native-graphics';
import type { EffectHandle, Playback } from 'react-native-graphics';
import { StatsPanel } from '../diagnostics';
import { useRemeasureAfterTransition } from '../navigation';
import { Button, colors, Note, Row, Screen, Section, styles as ui } from '../ui';

export function CompositionScreen() {
  useRemeasureAfterTransition();
  const fx = useGameFX();
  const sequence = useRef<Playback | null>(null);
  const stacked = useRef<EffectHandle[]>([]);
  const [stage, setStage] = useState('Ready');
  // Every stage the last run passed through, in order. "Reward" lasts only 150 ms, so a glance
  // (or a test polling the stage text) can miss it; the path shows that each stage really ran.
  const [path, setPath] = useState<string[]>([]);
  const [stackCount, setStackCount] = useState(0);

  /**
   * Move → impact → explosion + shake → reward glow and sparks → return, on one clock.
   * The cues start their effects at exact timeline moments (not JavaScript timers), and the
   * single playback cancels or skips the whole composition.
   */
  const playSequence = () => {
    const engine = fx.engine;
    const mover = fx.getTarget('c-mover');
    if (!engine || !mover) return;
    sequence.current?.cancel();
    mover.motion.reset();
    const enter = (name: string) => {
      setStage(name);
      setPath((p) => [...p, name]);
    };
    setPath([]);
    const trail = fx.cue('trail', { target: 'c-mover', rate: 80, size: 5 });
    const tl = fx.timeline();
    tl.add(trail, 0)
      .call(() => { enter('Move'); }, 0)
      .add(engine.animate(mover.motion, { x: 150, rotation: 180, duration: 700, easing: 'easeInQuad' }), 0)
      .mark('impact')
      .call(() => { enter('Impact'); }, 'impact')
      .add(fx.cue('explosion', { target: 'c-goal', follow: false, intensity: 0.6 }), 'impact')
      .add(fx.cue('screen-shake', { scope: ['c-goal'], amplitude: 6, duration: 300 }), 'impact')
      .call(() => { enter('Reward'); }, 'impact+=350')
      .add(fx.cue('glow-pulse', { target: 'c-badge', pulses: 2, shape: 'circle' }), 'impact+=350')
      .add(fx.cue('golden-sparks', { target: 'c-badge', count: 60 }), 'impact+=350')
      .call(() => {
        enter('Settle');
        for (const h of trail.handles) h.stop();
      }, 'impact+=500')
      .add(engine.animate(mover.motion, { x: 0, rotation: 360, duration: 600, easing: 'easeOutBack' }), 'impact+=500');
    const playback = tl.play();
    sequence.current = playback;
    void playback.finished.then((result) => {
      if (sequence.current !== playback) return;
      if (result.status !== 'completed') mover.motion.reset();
      enter(result.status === 'completed' ? 'Done' : `Cancelled (${result.status})`);
    });
  };

  const stack = () => {
    for (const h of stacked.current) h.cancel();
    stacked.current = [
      fx.attach('c-goal', 'fire-border', { intensity: 0.8 }),
      fx.attach('c-goal', 'glow-pulse', { color: '#7FDBFF' }, { zIndex: -1 }),
      fx.attach('c-goal', 'golden-sparks', { count: 0, rate: 30 }, { zIndex: 2 }),
    ];
    setStackCount(3);
    for (const h of stacked.current) {
      void h.finished.then(() => {
        setStackCount(stacked.current.filter((x) => x.status === 'playing' || x.status === 'paused').length);
      });
    }
  };
  const unstack = () => {
    for (const h of stacked.current) h.stop();
  };

  useEffect(
    () => () => {
      sequence.current?.cancel();
      for (const h of stacked.current) h.cancel();
    },
    [],
  );

  return (
    <Screen testID="composition-screen">
      <Section title="Multi-stage sequence">
        <View style={[ui.stage, local.stage]}>
          <GameFXTarget id="c-mover" style={local.mover}>
            <Text style={local.moverText}>★</Text>
          </GameFXTarget>
          <GameFXTarget id="c-goal" style={[ui.playingCard, local.goal]}>
            <Text style={ui.playingCardText}>Q♦</Text>
          </GameFXTarget>
          <GameFXTarget id="c-badge" style={local.badge}>
            <Text style={local.badgeText}>+50</Text>
          </GameFXTarget>
        </View>
        <Row>
          <Button label="Play sequence" tone="primary" onPress={playSequence} testID="sequence-play" />
          <Button label="Skip to end" onPress={() => sequence.current?.finish()} testID="sequence-skip" />
          <Button label="Cancel" tone="danger" onPress={() => sequence.current?.cancel()} testID="sequence-cancel" />
        </Row>
        <Text testID="sequence-stage">{stage}</Text>
        <Text testID="sequence-path" style={local.path}>{path.length > 0 ? path.join(' › ') : ' '}</Text>
        <Note>Stages: move with a trail, impact (explosion and shake of the card view), reward (glow and sparks on the badge), settle. One playback controls all of it.</Note>
      </Section>

      <Section title="Several effects on one view">
        <Row>
          <Button label="Fire + glow + sparks" onPress={stack} testID="stack" />
          <Button label="Stop (graceful)" onPress={unstack} testID="unstack" />
          <Button label="Cancel all" tone="danger" onPress={() => { fx.cancelAll(); }} />
        </Row>
        <Text testID="stack-count">Running on the card: {String(stackCount)}</Text>
        <Note>Each effect has its own handle and z-order (glow behind, sparks in front). Play the sequence while they run: they follow the shaking card.</Note>
      </Section>

      <Section title="Engine">
        <StatsPanel />
      </Section>
    </Screen>
  );
}

const local = StyleSheet.create({
  stage: { height: 260, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 24 },
  mover: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFD54A', alignItems: 'center', justifyContent: 'center' },
  moverText: { fontSize: 22, color: '#5A3B00' },
  goal: { marginLeft: 40 },
  badge: { position: 'absolute', top: 18, right: 18, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, backgroundColor: '#2A2F4A' },
  badgeText: { color: '#FFD54A', fontWeight: '800' },
  path: { color: colors.muted, fontSize: 12 },
});
