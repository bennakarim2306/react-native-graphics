/**
 * Phase 2 demo: scene graph, hierarchical transforms, tweens, keyframes, timelines and
 * markers, all driven by the engine through the public `react-native-graphics` API.
 *
 * Scene nodes are drawn by the same overlay as the particle effects. Their coordinates are
 * overlay pixels, so the stage area is measured in window coordinates.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useGameFX } from 'react-native-graphics';
import type { Engine, Playback, SceneNode } from 'react-native-graphics';

interface Stage {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface DemoScene {
  readonly group: SceneNode;
  readonly card: SceneNode;
  readonly floorY: number;
  /** Card x positions on the left and right side of the stage. */
  readonly lanes: readonly [number, number];
  readonly loops: Playback[];
}

const CARD_HEIGHT = 64;

/** At least one full turn, ending upright (a multiple of 360°) even after a cancelled throw. */
function uprightAfterSpin(rotation: number): number {
  return Math.ceil(rotation / 360) * 360 + 360;
}

/** Builds the scene inside the stage and starts the ambient loops. */
function buildScene(engine: Engine, stage: Stage): DemoScene {
  const { scene } = engine;
  // One group node per demo, so cleanup is a single destroy().
  const group = scene.createNode({ name: 'motion-demo', x: stage.x, y: stage.y });

  // Hierarchical transforms: a sun with an orbiting planet that has its own moon.
  const sun = scene.createNode({
    parent: group,
    x: 80,
    y: 90,
    shape: { type: 'circle', radius: 18, color: '#FFB300' },
  });
  const planetArm = scene.createNode({ parent: sun, x: 0, y: 0 });
  const planet = scene.createNode({
    parent: planetArm,
    x: 56,
    shape: { type: 'circle', radius: 9, color: '#29B6F6' },
  });
  scene.createNode({ parent: planet, x: 18, shape: { type: 'circle', radius: 4, color: '#E1F5FE' } });
  const loops = [
    engine.animate(planetArm, { rotation: 360, duration: 4000, repeat: Infinity }).play(),
    engine.animate(planet, { rotation: 360, duration: 1100, repeat: Infinity }).play(),
  ];

  // Several objects moving at once: staggered bouncing squares that also rotate.
  const squares = [0, 1, 2, 3, 4].map((i) =>
    scene.createNode({
      parent: group,
      x: stage.width - 150 + i * 28,
      y: 110,
      shape: { type: 'rect', width: 18, height: 18, color: ['#F4FF81', '#C6FF00', '#76FF03', '#FF7043', '#FFD54A'][i] ?? '#fff', cornerRadius: 4 },
    }),
  );
  loops.push(
    engine
      .stagger(
        squares.map((node) =>
          engine.keyframes(node, {
            duration: 900,
            keyframes: [
              { at: 0.5, y: 50, rotation: 90, easing: 'easeOutQuad' },
              { at: 1, y: 110, rotation: 180, easing: 'easeInQuad' },
            ],
          }),
        ),
        120,
        { repeat: Infinity },
      )
      .play(),
  );

  // Floor and the card that gets thrown.
  const floorY = stage.height - 24;
  scene.createNode({
    parent: group,
    x: stage.width / 2,
    y: floorY + 2,
    shape: { type: 'rect', width: stage.width - 24, height: 4, color: '#4B437A', cornerRadius: 2 },
  });
  const lanes = [70, stage.width - 70] as const;
  const card = scene.createNode({
    parent: group,
    name: 'card',
    x: lanes[0],
    y: floorY - CARD_HEIGHT / 2,
    zIndex: 10,
    shape: { type: 'rect', width: 44, height: CARD_HEIGHT, color: '#F5F0FF', cornerRadius: 6 },
  });
  return { group, card, floorY, lanes, loops };
}

export function MotionDemo() {
  const fx = useGameFX();
  const engine = fx.engine;
  const stageRef = useRef<ComponentRef<typeof View>>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const demo = useRef<DemoScene | null>(null);
  const throwPlayback = useRef<Playback | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);

  const addLog = useCallback((line: string) => {
    setLog((lines) => [line, ...lines].slice(0, 6));
  }, []);

  const measure = useCallback(() => {
    stageRef.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) setStage({ x, y, width, height });
    });
  }, []);

  useEffect(() => {
    if (!engine || !stage) return undefined;
    const built = buildScene(engine, stage);
    demo.current = built;
    return () => {
      // Cancelling first keeps "end" events honest; destroy() removes every node of the demo.
      for (const loop of built.loops) loop.cancel();
      throwPlayback.current?.cancel();
      throwPlayback.current = null;
      built.group.destroy();
      demo.current = null;
    };
  }, [engine, stage]);

  // Leaving the demo must not leave the shared engine paused.
  useEffect(
    () => () => {
      if (engine?.state === 'paused') engine.resume();
    },
    [engine],
  );

  const throwCard = () => {
    const current = demo.current;
    if (!engine || !current) return;
    throwPlayback.current?.cancel();
    const { card, floorY, lanes } = current;
    const restY = floorY - CARD_HEIGHT / 2;
    // Throw to the other side, so rewinding (back to the start) and skipping (to the
    // landing spot) end in visibly different places.
    const targetX = card.x < (lanes[0] + lanes[1]) / 2 ? lanes[1] : lanes[0];
    const timeline = engine
      .timeline()
      // Rise and spin, then fall: two sequential stages with parallel properties.
      .add(engine.animate(card, { y: restY - 230, rotation: uprightAfterSpin(card.rotation), duration: 520, easing: 'easeOutQuad' }))
      .add(engine.animate(card, { y: restY, duration: 560, easing: 'easeInQuad' }))
      // Sideways motion across both stages, in parallel from time 0.
      .add(engine.animate(card, { x: targetX, duration: 1080 }), 0)
      // The impact is defined as the end of the fall: exactly when the card touches the floor.
      .mark('impact')
      .add(
        engine.keyframes(card, {
          duration: 260,
          keyframes: [
            { at: 0.3, scaleX: 1.3, scaleY: 0.7, easing: 'easeOutQuad' },
            { at: 1, scaleX: 1, scaleY: 1, easing: 'easeOutBack' },
          ],
        }),
      )
      .mark('settled');
    const playback = timeline.play();
    throwPlayback.current = playback;
    addLog(`#${String(playback.id)} throw started (${String(playback.duration)} ms)`);
    playback.onMarker('impact', (event) => {
      const contact = card.localToWorld({ x: 0, y: CARD_HEIGHT / 2 });
      addLog(`#${String(playback.id)} impact at ${String(Math.round(event.time))} ms${event.skipped ? ' (skipped)' : ''}`);
      if (event.skipped) return;
      fx.play('particle-burst', {
        position: contact,
        count: 70,
        duration: 900,
        direction: -90,
        spread: 160,
        speed: { min: 120, max: 380 },
        gravity: 700,
        colors: ['#FFD54A', '#FF7043', '#FFF3C4', '#F5F0FF'],
      });
    });
    playback.on('end', ({ result }) => {
      addLog(`#${String(playback.id)} ${result.status}${result.reason ? ` (${result.reason})` : ''}`);
    });
  };

  /** Rewind (`stop`: back to where the throw started) or skip (`finish`: jump to the landing). */
  const controlThrow = (action: 'rewind' | 'skip') => {
    const playback = throwPlayback.current;
    if (!playback || (playback.status !== 'playing' && playback.status !== 'paused')) {
      addLog(`${action}: no throw in progress (press it while the card is in the air)`);
      return;
    }
    if (action === 'rewind') playback.stop();
    else playback.finish();
  };

  const button = (label: string, onPress: () => void, style?: object) => (
    <Pressable key={label} style={({ pressed }) => [styles.button, style, pressed && styles.pressed]} onPress={onPress}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={styles.container}>
      <View ref={stageRef} style={styles.stage} onLayout={measure}>
        <Text style={styles.stageLabel}>Scene graph stage</Text>
      </View>
      <View style={styles.row}>
        {button('Throw card', throwCard, styles.primary)}
        {button('Cancel throw', () => throwPlayback.current?.cancel(), styles.danger)}
      </View>
      <View style={styles.row}>
        {button('Rewind throw', () => {
          controlThrow('rewind');
        })}
        {button('Skip to end', () => {
          controlThrow('skip');
        })}
        {button(paused ? 'Resume all' : 'Pause all', () => {
          if (!engine) return;
          if (paused) engine.resume();
          else engine.pause();
          setPaused(!paused);
        })}
      </View>
      <View style={styles.log}>
        {log.length === 0 ? <Text style={styles.logText}>Events appear here.</Text> : null}
        {log.map((line, index) => (
          <Text key={`${String(index)}-${line}`} style={styles.logText}>
            {line}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 10 },
  stage: { height: 330, borderRadius: 16, borderWidth: 1, borderColor: '#4B437A', padding: 10 },
  stageLabel: { color: '#6F679C', fontSize: 12 },
  row: { flexDirection: 'row', gap: 10 },
  button: { flex: 1, backgroundColor: '#3D3470', paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  primary: { backgroundColor: '#5B4A9E' },
  danger: { backgroundColor: '#8E2D3A' },
  pressed: { opacity: 0.7 },
  buttonText: { color: 'white', fontSize: 14, fontWeight: '600' },
  log: { gap: 2 },
  logText: { color: '#CFC8F0', fontSize: 12, fontVariant: ['tabular-nums'] },
});
