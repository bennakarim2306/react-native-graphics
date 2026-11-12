/**
 * GameFX showcase: an ordinary React Native screen with the effects overlay on top.
 * It uses only the public `react-native-graphics` entry point, installed from the packed tarball.
 */
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import type { GestureResponderEvent } from 'react-native';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { GameFXOverlay, GameFXProvider, SDK_VERSION, useGameFX, useGameFXEngine } from 'react-native-graphics';
import { DEMO_ASSETS, GraphicsDemo } from './GraphicsDemo';
import { MotionDemo } from './MotionDemo';

type Tab = 'effects' | 'motion' | 'graphics';

const PALETTES: Record<string, readonly string[]> = {
  Gold: ['#FFD54A', '#FFB300', '#FF7043', '#FFF3C4'],
  Ice: ['#E1F5FE', '#81D4FA', '#29B6F6', '#FFFFFF'],
  Lime: ['#F4FF81', '#C6FF00', '#76FF03', '#FFFFFF'],
};

/** Shows how many effects are running. Updates only on effect start/end, not per frame. */
function ActiveCounter() {
  const engine = useGameFXEngine();
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!engine) return undefined;
    const sync = () => {
      setActive(engine.activeCount);
    };
    const offStart = engine.on('effectStart', sync);
    const offEnd = engine.on('effectEnd', sync);
    return () => {
      offStart();
      offEnd();
    };
  }, [engine]);
  return <Text style={styles.counter}>Active effects: {active}</Text>;
}

function Showcase() {
  const fx = useGameFX();
  const [taps, setTaps] = useState(0);

  // Touches report window (page) coordinates; effects use overlay coordinates.
  const burstAtTouch = (event: GestureResponderEvent, colors: readonly string[], count = 60) => {
    fx.play('particle-burst', {
      position: fx.fromWindow({ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY }),
      count,
      duration: 900,
      colors,
    });
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>GameFX Showcase</Text>
      <Text style={styles.subtitle}>SDK {SDK_VERSION} · public API only</Text>
      <ActiveCounter />

      {Object.entries(PALETTES).map(([name, colors]) => (
        <Pressable
          key={name}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          onPress={(e) => {
            burstAtTouch(e, colors);
          }}
        >
          <Text style={styles.buttonText}>{name} burst</Text>
        </Pressable>
      ))}

      <Pressable
        style={({ pressed }) => [styles.button, styles.secondary, pressed && styles.pressed]}
        onPress={(e) => {
          // Five simultaneous bursts around the touch point.
          for (let i = 0; i < 5; i++) {
            fx.play('particle-burst', {
              position: fx.fromWindow({ x: e.nativeEvent.pageX + (i - 2) * 50, y: e.nativeEvent.pageY - 60 }),
              count: 40,
              duration: 1100,
              colors: PALETTES.Gold,
            });
          }
        }}
      >
        <Text style={styles.buttonText}>5 bursts at once</Text>
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.button, styles.danger, pressed && styles.pressed]}
        onPress={() => {
          fx.cancelAll();
        }}
      >
        <Text style={styles.buttonText}>Cancel all</Text>
      </Pressable>

      <Pressable
        style={styles.playArea}
        onPress={(e) => {
          setTaps((n) => n + 1);
          burstAtTouch(e, PALETTES.Ice, 30);
        }}
      >
        <Text style={styles.playAreaText}>Tap anywhere here ({taps} taps)</Text>
        <Text style={styles.hint}>The overlay never blocks these touches.</Text>
      </Pressable>
    </ScrollView>
  );
}

function Tabs({ tab, onChange }: { tab: Tab; onChange: (tab: Tab) => void }) {
  return (
    <View style={styles.tabs}>
      {(
        [
          ['effects', 'Particles'],
          ['motion', 'Motion'],
          ['graphics', 'Graphics'],
        ] as const
      ).map(([id, label]) => (
        <Pressable
          key={id}
          style={[styles.tab, tab === id && styles.tabActive]}
          onPress={() => {
            onChange(id);
          }}
        >
          <Text style={styles.tabText}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function App() {
  const [fxEnabled, setFxEnabled] = useState(true);
  const [tab, setTab] = useState<Tab>('effects');
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.toggleRow}>
        <Text style={styles.toggleText}>Effects layer mounted</Text>
        <Switch value={fxEnabled} onValueChange={setFxEnabled} />
      </View>
      <Tabs tab={tab} onChange={setTab} />
      {fxEnabled ? (
        // Unmounting the provider disposes the engine and cancels every running effect.
        <GameFXProvider assets={DEMO_ASSETS}>
          {/* The overlay fills this view (below the tabs), so effects never draw over the header. */}
          <View style={styles.fxArea}>
            {tab === 'effects' ? <Showcase /> : tab === 'motion' ? <MotionDemo /> : <GraphicsDemo />}
            <GameFXOverlay />
          </View>
        </GameFXProvider>
      ) : (
        <Text style={styles.off}>Effects layer unmounted: engine disposed.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#14121F' },
  fxArea: { flex: 1 },
  toggleRow: {
    paddingTop: 56,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleText: { color: '#CFC8F0', fontSize: 15 },
  tabs: { flexDirection: 'row', marginHorizontal: 20, marginTop: 8, gap: 8 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center', backgroundColor: '#211D36' },
  tabActive: { backgroundColor: '#5B4A9E' },
  tabText: { color: 'white', fontSize: 14, fontWeight: '600' },
  content: { padding: 20, gap: 12 },
  title: { color: 'white', fontSize: 28, fontWeight: '700' },
  subtitle: { color: '#9A92C4' },
  counter: { color: '#FFD54A', fontVariant: ['tabular-nums'] },
  button: { backgroundColor: '#3D3470', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  secondary: { backgroundColor: '#5B4A9E' },
  danger: { backgroundColor: '#8E2D3A' },
  pressed: { opacity: 0.7 },
  buttonText: { color: 'white', fontSize: 16, fontWeight: '600' },
  playArea: {
    height: 260,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#4B437A',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  playAreaText: { color: 'white', fontSize: 16 },
  hint: { color: '#9A92C4', fontSize: 13 },
  off: { color: '#9A92C4', padding: 20 },
});
