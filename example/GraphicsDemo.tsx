/**
 * Phase 3 demos A–E: sprites and sprite sheets, transforms with children, many sprites with
 * draw order and asset handling, graphical effects (glow, runtime shaders, blur, grayscale,
 * clipping), and effects anchored to ordinary React Native components.
 *
 * Everything goes through the public `react-native-graphics` entry point. Each demo stage is a
 * `GameFXTarget`: its proxy scene node sits at the centre of the stage view, so the demo's
 * nodes are children of it and follow the stage when the page scrolls. Nothing re-renders per
 * frame: React state changes only on button presses.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  energyShader,
  fireShader,
  GameFXTarget,
  grayscale,
  PathData,
  useGameFX,
  useGameFXAssets,
  useGameFXEngine,
} from 'react-native-graphics';
import type { EffectHandle, Engine, Playback, SceneNode, Sprite, SpriteSheet } from 'react-native-graphics';

const STAGE_HEIGHT = 200;

/** Asset ids registered on the provider in App.tsx. */
export const DEMO_ASSETS = {
  coin: require('./assets/coin-sheet.png') as number,
  slime: require('./assets/slime-sheet.png') as number,
};

function Button({ label, onPress, tone = 'normal' }: { label: string; onPress: () => void; tone?: 'normal' | 'accent' | 'danger' }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.button, tone === 'accent' && styles.accent, tone === 'danger' && styles.danger, pressed && styles.pressed]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardSubtitle}>{subtitle}</Text>
      {children}
    </View>
  );
}

function Stage({ id }: { id: string }) {
  return <GameFXTarget id={id} style={styles.stage} />;
}

/**
 * Runs `build` once the engine, the stage target and the sheets exist, and destroys what it
 * built on unmount (one `destroy()` of the root node releases sprites and their images).
 */
function useStageScene<T>(stageId: string, ready: boolean, build: (engine: Engine, stage: SceneNode) => T & { root: SceneNode }) {
  const engine = useGameFXEngine();
  const [built, setBuilt] = useState<(T & { root: SceneNode }) | null>(null);
  const buildRef = useRef(build);
  buildRef.current = build;
  useEffect(() => {
    if (!engine || !ready) return undefined;
    const stage = engine.targets.node(stageId);
    if (!stage) return undefined;
    const result = buildRef.current(engine, stage);
    setBuilt(result);
    return () => {
      result.root.destroy();
      setBuilt(null);
    };
  }, [engine, ready, stageId]);
  return built;
}

function useSheets(): { coin: SpriteSheet; slime: SpriteSheet } | null {
  const engine = useGameFXEngine();
  const { status, assets } = useGameFXAssets(['coin', 'slime']);
  const [sheets, setSheets] = useState<{ coin: SpriteSheet; slime: SpriteSheet } | null>(null);
  useEffect(() => {
    if (!engine || status !== 'ready' || !assets) return;
    setSheets({
      coin: engine.createSpriteSheet({
        image: assets.coin,
        grid: { frameWidth: 64, frameHeight: 64 },
        animations: {
          spin: { frames: { from: 0, to: 7 }, fps: 12, loop: true },
          flip: { frames: { from: 0, to: 7 }, fps: 16, events: [{ at: 4, name: 'edge' }] },
        },
      }),
      slime: engine.createSpriteSheet({
        image: assets.slime,
        grid: { frameWidth: 64, frameHeight: 64 },
        animations: { wobble: { frames: { from: 0, to: 5 }, fps: 10, loop: true, direction: 'alternate' } },
      }),
    });
  }, [engine, status, assets]);
  return sheets;
}

// --- A: sprite animation -------------------------------------------------------------------

function SpriteAnimationDemo({ sheets }: { sheets: { coin: SpriteSheet } | null }) {
  const [status, setStatus] = useState('idle');
  const [speed, setSpeed] = useState(1);
  const scene = useStageScene('stage-a', sheets !== null, (engine, stage) => {
    const root = engine.scene.createNode({ parent: stage });
    const coin = engine.createSprite({ sheet: (sheets as { coin: SpriteSheet }).coin, parent: root, scale: 2 });
    return { root, coin };
  });
  const playback = useRef<Playback | null>(null);

  const start = () => {
    if (!scene) return;
    playback.current = scene.coin.play('spin', { speed });
    playback.current.on('end', (e) => setStatus(e.result.status));
    setStatus('playing');
  };
  const control = (action: 'pause' | 'resume' | 'stop') => {
    const p = scene?.coin.playback;
    if (!p) {
      setStatus('nothing playing: press Start');
      return;
    }
    p[action]();
    if (action !== 'stop') setStatus(p.status);
  };
  const changeSpeed = (value: number) => {
    setSpeed(value);
    const p = scene?.coin.playback;
    if (p) p.speed = value;
  };

  return (
    <Card title="A · Sprite animation" subtitle="8-frame sprite sheet on the engine clock">
      <Stage id="stage-a" />
      <Text style={styles.status}>
        Status: {status} · speed ×{speed}
      </Text>
      <View style={styles.row}>
        <Button label="Start" tone="accent" onPress={start} />
        <Button label="Pause" onPress={() => control('pause')} />
        <Button label="Resume" onPress={() => control('resume')} />
        <Button label="Stop" tone="danger" onPress={() => control('stop')} />
      </View>
      <View style={styles.row}>
        {[0.25, 0.5, 1, 2, 4].map((s) => (
          <Button key={s} label={`×${String(s)}`} onPress={() => changeSpeed(s)} />
        ))}
      </View>
    </Card>
  );
}

// --- B: transformations and children ---------------------------------------------------------

function TransformDemo({ sheets }: { sheets: { coin: SpriteSheet; slime: SpriteSheet } | null }) {
  const [paused, setPaused] = useState(false);
  const scene = useStageScene('stage-b', sheets !== null, (engine, stage) => {
    const s = sheets as { coin: SpriteSheet; slime: SpriteSheet };
    const root = engine.scene.createNode({ parent: stage });
    // A vector "ship" (star path with a gradient) carries a slime sprite, which carries a coin.
    const star = new PathData().polygon(0, 0, 5, 34, 15);
    const ship = engine.scene.createNode({
      parent: root,
      x: -90,
      shape: {
        type: 'path',
        path: star,
        fill: { type: 'radial-gradient', center: { x: 0, y: 0 }, radius: 34, colors: ['#FFF3C4', '#FF7043'] },
        stroke: { fill: '#FFFFFF', width: 2, join: 'round' },
      },
    });
    const rider = engine.createSprite({ sheet: s.slime, parent: ship, y: -48, scale: 0.7 });
    const passenger = engine.createSprite({ sheet: s.coin, parent: rider, x: 40, y: -10, scale: 0.4 });
    const loops = [
      rider.play('wobble'),
      passenger.play('spin'),
      engine
        .timeline({ repeat: Infinity, yoyo: true })
        .add(engine.animate(ship, { x: 90, rotation: 180, duration: 2000, easing: 'easeInOutQuad' }))
        .add(engine.animate(ship, { scale: 1.4, duration: 1000, yoyo: true, repeat: 1 }), '<')
        .add(engine.animate(ship, { opacity: 0.35, duration: 1000, yoyo: true, repeat: 1 }), '<')
        .play(),
    ];
    return { root, loops };
  });

  const toggle = () => {
    if (!scene) return;
    for (const p of scene.loops) {
      if (paused) p.resume();
      else p.pause();
    }
    setPaused(!paused);
  };

  return (
    <Card title="B · Transformations" subtitle="Move, rotate, scale, fade; children inherit transforms">
      <Stage id="stage-b" />
      <Text style={styles.status}>Ship (path + gradient) → slime sprite → coin sprite</Text>
      <View style={styles.row}>
        <Button label={paused ? 'Resume' : 'Pause'} tone="accent" onPress={toggle} />
      </View>
    </Card>
  );
}

// --- C: many sprites, draw order, resources --------------------------------------------------

function ManySpritesDemo({ sheets }: { sheets: { coin: SpriteSheet; slime: SpriteSheet } | null }) {
  const engine = useGameFXEngine();
  const [info, setInfo] = useState('');
  const scene = useStageScene('stage-c', sheets !== null, (eng, stage) => ({ root: eng.scene.createNode({ parent: stage }), sprites: [] as Sprite[] }));

  const report = (extra = '') => {
    if (!engine || !scene) return;
    const coin = engine.assets.peek('coin');
    const slime = engine.assets.peek('slime');
    const { loaded, bytes } = engine.assets.stats;
    setInfo(
      `${String(scene.sprites.length)} sprites · coin refs ${String(coin?.refCount ?? 0)} · slime refs ${String(slime?.refCount ?? 0)} · ${String(loaded)} images, ${String(Math.round(bytes / 1024))} KiB${extra}`,
    );
  };

  const spawn = () => {
    if (!engine || !scene || !sheets) return;
    for (let i = 0; i < 100; i++) {
      const col = i % 10;
      const row = Math.floor(i / 10);
      const sprite = engine.createSprite({
        sheet: i % 3 === 0 ? sheets.coin : sheets.slime,
        parent: scene.root,
        x: (col - 4.5) * 26 + (Math.random() - 0.5) * 6,
        y: (row - 4.5) * 17,
        scale: 0.5,
        zIndex: row,
      });
      sprite.play(i % 3 === 0 ? 'spin' : 'wobble', { speed: 0.5 + Math.random() * 1.5 });
      scene.sprites.push(sprite);
    }
    report();
  };
  const reverseOrder = () => {
    if (!scene) return;
    for (const s of scene.sprites) s.zIndex = -s.zIndex;
    report(' · draw order reversed');
  };
  const clear = () => {
    if (!scene) return;
    for (const s of scene.sprites) s.destroy();
    scene.sprites.length = 0;
    report();
  };
  const tryUnload = () => {
    if (!engine) return;
    try {
      engine.assets.unload('slime');
      report(' · slime unloaded (reload by reopening this tab)');
    } catch (error) {
      report(` · ${(error as Error).message}`);
    }
  };

  return (
    <Card title="C · Many sprites" subtitle="100 sprites per tap, one shared image per sheet, z-order">
      <Stage id="stage-c" />
      <Text style={styles.status}>{info || 'Press “Spawn 100”.'}</Text>
      <View style={styles.row}>
        <Button label="Spawn 100" tone="accent" onPress={spawn} />
        <Button label="Reverse z" onPress={reverseOrder} />
        <Button label="Clear" tone="danger" onPress={clear} />
        <Button label="Unload slime" onPress={tryUnload} />
      </View>
    </Card>
  );
}

// --- D: graphical effects --------------------------------------------------------------------

function EffectsDemo({ sheets }: { sheets: { slime: SpriteSheet } | null }) {
  const engine = useGameFXEngine();
  const [gray, setGray] = useState(false);
  const [blur, setBlur] = useState(false);
  const scene = useStageScene('stage-d', sheets !== null, (eng, stage) => {
    const root = eng.scene.createNode({ parent: stage });
    // Glow (image filter) on a rounded card, pulsing by animating its scale.
    const glowCard = eng.scene.createNode({
      parent: root,
      x: -110,
      y: -40,
      effects: [{ type: 'glow', color: '#FFD54A', radius: 16, strength: 1.5 }],
      shape: { type: 'rect', width: 56, height: 80, cornerRadius: 8, color: '#3D3470', stroke: { fill: '#FFD54A', width: 2 } },
    });
    // Runtime shaders: animated energy fill and fire fill (fall back to solid colors).
    const energy = eng.scene.createNode({
      parent: root,
      x: -20,
      y: -40,
      shape: { type: 'rect', width: 80, height: 80, cornerRadius: 14, fill: { type: 'shader', shader: energyShader } },
    });
    const fire = eng.scene.createNode({
      parent: root,
      x: 80,
      y: -40,
      shape: { type: 'circle', radius: 40, fill: { type: 'shader', shader: fireShader, uniforms: { intensity: 1.2 } } },
    });
    // Clipping: sprites slide through a circular window (clipChildren).
    const window = eng.scene.createNode({
      parent: root,
      x: 0,
      y: 55,
      clipChildren: true,
      shape: { type: 'ellipse', width: 220, height: 70, color: '#211D36' },
    });
    const slider = eng.createSprite({ sheet: (sheets as { slime: SpriteSheet }).slime, parent: window, x: -150, scale: 0.8 });
    const loops = [
      slider.play('wobble'),
      eng.animate(slider, { x: 150, duration: 2500, repeat: Infinity, yoyo: true, easing: 'easeInOutQuad' }).play(),
      eng.animate(glowCard, { scale: 1.08, duration: 600, repeat: Infinity, yoyo: true }).play(),
      eng.animate(energy, { rotation: 360, duration: 6000, repeat: Infinity }).play(),
    ];
    return { root, fire, energy, glowCard, loops };
  });

  useEffect(() => {
    if (!scene) return;
    scene.root.effects = [...(gray ? [grayscale(1)] : []), ...(blur ? [{ type: 'blur' as const, radius: 6 }] : [])];
  }, [scene, gray, blur]);

  const caps = engine ? 'Runtime shaders compile in Skia; unsupported shaders use their fallback color.' : '';
  return (
    <Card title="D · Graphical effects" subtitle="Glow · animated shaders · clipping · grayscale · blur">
      <Stage id="stage-d" />
      <Text style={styles.status}>{caps}</Text>
      <View style={styles.row}>
        <Button label={gray ? 'Color' : 'Grayscale'} onPress={() => setGray(!gray)} />
        <Button label={blur ? 'Sharp' : 'Blur'} onPress={() => setBlur(!blur)} />
      </View>
    </Card>
  );
}

// --- E: effects anchored to React Native components -------------------------------------------

function AnchoringDemo() {
  const fx = useGameFX();
  const [effect, setEffect] = useState<EffectHandle | null>(null);
  const [right, setRight] = useState(false);
  const [buys, setBuys] = useState(0);

  const attach = (name: 'glow-border' | 'energy-border' | 'fire-border') => {
    effect?.cancel();
    const handle =
      name === 'glow-border'
        ? fx.attach('buy-button', 'glow-border', { color: '#FFD54A', padding: 6, cornerRadius: 16, pulse: 1.2 })
        : fx.attach('buy-button', name, { padding: 6, cornerRadius: 16, width: 5, intensity: name === 'fire-border' ? 1.4 : 1.5 });
    setEffect(handle);
  };

  return (
    <Card title="E · Anchored to a React Native view" subtitle="The button is a normal Pressable; the border follows its layout">
      <View style={[styles.anchorRow, right && styles.anchorRowRight]}>
        <GameFXTarget id="buy-button">
          <Pressable
            style={({ pressed }) => [styles.buyButton, pressed && styles.pressed]}
            onPress={() => {
              setBuys((n) => n + 1);
              const layout = fx.engine?.targets.layout('buy-button');
              if (layout) {
                fx.play('particle-burst', {
                  position: { x: layout.x + layout.width / 2, y: layout.y + layout.height / 2 },
                  count: 40,
                  duration: 700,
                });
              }
            }}
          >
            <Text style={styles.buyText}>Buy ({buys})</Text>
          </Pressable>
        </GameFXTarget>
      </View>
      <View style={styles.row}>
        <Button label="Glow" tone="accent" onPress={() => attach('glow-border')} />
        <Button label="Energy" tone="accent" onPress={() => attach('energy-border')} />
        <Button label="Fire" tone="accent" onPress={() => attach('fire-border')} />
        <Button
          label="Remove"
          tone="danger"
          onPress={() => {
            effect?.cancel();
            setEffect(null);
          }}
        />
        <Button label="Move button" onPress={() => setRight(!right)} />
      </View>
      <Text style={styles.status}>The button stays tappable: the overlay never takes touches.</Text>
    </Card>
  );
}

export function GraphicsDemo() {
  const fx = useGameFX();
  const sheets = useSheets();
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      scrollEventThrottle={16}
      // Scrolling moves views without a layout event: ask targets to measure again.
      onScroll={() => fx.ready && fx.remeasure()}
    >
      {sheets ? null : <Text style={styles.status}>Loading sprite sheets…</Text>}
      <SpriteAnimationDemo sheets={sheets} />
      <TransformDemo sheets={sheets} />
      <ManySpritesDemo sheets={sheets} />
      <EffectsDemo sheets={sheets} />
      <AnchoringDemo />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 16 },
  card: { backgroundColor: '#1B1830', borderRadius: 16, padding: 14, gap: 8 },
  cardTitle: { color: 'white', fontSize: 18, fontWeight: '700' },
  cardSubtitle: { color: '#9A92C4', fontSize: 13 },
  stage: { height: STAGE_HEIGHT, borderRadius: 12, borderWidth: 1, borderColor: '#3A3460' },
  status: { color: '#CFC8F0', fontSize: 13 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { backgroundColor: '#3D3470', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10 },
  accent: { backgroundColor: '#5B4A9E' },
  danger: { backgroundColor: '#8E2D3A' },
  pressed: { opacity: 0.7 },
  buttonText: { color: 'white', fontSize: 14, fontWeight: '600' },
  anchorRow: { paddingVertical: 24, alignItems: 'flex-start' },
  anchorRowRight: { alignItems: 'flex-end' },
  buyButton: { backgroundColor: '#2E7D32', paddingVertical: 14, paddingHorizontal: 28, borderRadius: 14 },
  buyText: { color: 'white', fontSize: 18, fontWeight: '700' },
});
