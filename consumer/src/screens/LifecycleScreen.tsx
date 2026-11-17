// F. Navigation and lifecycle: leave screens while effects run, remount providers, background.
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { GameFXOverlay, GameFXProvider, GameFXTarget, useGameFX, useGameFXEngine } from 'react-native-graphics';
import type { Engine, EngineStats } from 'react-native-graphics';
import { StatsPanel, formatStats } from '../diagnostics';
import type { Navigation, RootStackParamList } from '../navigation';
import { useRemeasureAfterTransition } from '../navigation';
import { Button, Note, Row, Screen, Section, colors, styles as ui } from '../ui';

const CYCLES = 10;
const REMOUNTS = 20;

/** What must be back to the starting values once everything a screen started has ended. */
function sameIdle(now: EngineStats, before: EngineStats): boolean {
  return (
    now.activeEffects === 0 &&
    now.playbacks === 0 &&
    now.targets === before.targets &&
    now.localLayers === before.localLayers &&
    now.sceneNodes === before.sceneNodes
  );
}

export function LifecycleScreen() {
  useRemeasureAfterTransition();
  const navigation = useNavigation<Navigation>();
  const engine = useGameFXEngine();
  const [navResult, setNavResult] = useState('Not run');
  const [remountResult, setRemountResult] = useState('Not run');
  const [appLog, setAppLog] = useState<string[]>([]);
  const run = useRef<{ left: number; baseline: EngineStats } | null>(null);

  // Automated push/pop: every time this screen is focused again, open the busy screen until
  // the cycles are used up, then wait for the engine to return to the starting counters.
  useEffect(
    () =>
      navigation.addListener('focus', () => {
        const r = run.current;
        if (!r || !engine) return;
        if (r.left > 0) {
          r.left--;
          setNavResult(`Running: cycle ${String(CYCLES - r.left)} of ${String(CYCLES)}`);
          navigation.navigate('Busy', { auto: true });
          return;
        }
        run.current = null;
        setNavResult('Cycles done, waiting for graceful endings…');
        const started = Date.now();
        const timer = setInterval(() => {
          const now = engine.stats;
          const ok = sameIdle(now, r.baseline);
          const waited = Date.now() - started;
          if (ok || waited > 6000) {
            clearInterval(timer);
            const verdict = ok ? `PASS after ${(waited / 1000).toFixed(1)} s` : 'FAIL: counters did not return to the start values';
            setNavResult(`${verdict}\nstart: ${formatStats(r.baseline).replace(/\n/g, ' | ')}\nend:   ${formatStats(now).replace(/\n/g, ' | ')}`);
            console.log(`[gamefx-consumer] navigation ×${String(CYCLES)}: ${verdict}`);
          }
        }, 100);
      }),
    [navigation, engine],
  );

  const startNavigationTest = () => {
    if (!engine) return;
    run.current = { left: CYCLES - 1, baseline: engine.stats };
    setNavResult(`Running: cycle 1 of ${String(CYCLES)}`);
    navigation.navigate('Busy', { auto: true });
  };

  // The main provider's AppState handling (pauseInBackground) runs before this listener.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (status) => {
      const line = `${new Date().toLocaleTimeString()} ${status}: engine ${engine?.state ?? 'none'}`;
      setAppLog((log) => [line, ...log].slice(0, 6));
    });
    return () => { sub.remove(); };
  }, [engine]);

  return (
    <Screen testID="lifecycle-screen">
      <Section title="Engine counters (live)">
        <StatsPanel />
      </Section>

      <Section title="Leave a busy screen">
        <Row>
          <Button label="Open busy screen" tone="primary" onPress={() => { navigation.navigate('Busy'); }} testID="open-busy" />
        </Row>
        <Note>It starts fire borders, an endless rotation, a glow, sparks and repeated explosions. Go back at any moment: the counters above return to the values before (fire and sparks fade out within about 2 s, nothing keeps running).</Note>
        <Row>
          <Button label={`Automated: open and leave ×${String(CYCLES)}`} onPress={startNavigationTest} testID="nav-test" />
        </Row>
        <Text style={ui.mono} testID="nav-result">{navResult}</Text>
      </Section>

      <Section title="Mount and unmount a provider">
        <RemountTest onResult={setRemountResult} />
        <Text style={ui.mono} testID="remount-result">{remountResult}</Text>
      </Section>

      <Section title="Background and foreground">
        <Note>Start the fire on the busy screen, press the device Home button, wait a few seconds and come back. The engine pauses in the background and resumes where it was (provider prop pauseInBackground, default on).</Note>
        <Text style={ui.mono} testID="app-log">{appLog.length ? appLog.join('\n') : 'No app state changes yet'}</Text>
      </Section>
    </Screen>
  );
}

/** Busy screen: effects that keep running until the screen goes away. */
export function BusyScreen() {
  useRemeasureAfterTransition();
  const navigation = useNavigation<Navigation>();
  const route = useRoute<RouteProp<RootStackParamList, 'Busy'>>();
  const auto = route.params?.auto === true;
  const fx = useGameFX();

  useEffect(() => {
    if (!fx.ready) return undefined;
    // Deliberately no handle cleanup: unmounting the targets must end these effects.
    fx.attach('busy-1', 'fire-border', { intensity: 1 });
    fx.attach('busy-2', 'fire-border', { intensity: 0.8, color: '#2F7BFF' });
    fx.attach('busy-3', 'glow-pulse', { color: '#69F0AE' });
    fx.attach('busy-3', 'golden-sparks', { count: 20, rate: 25 });
    fx.animate('busy-2', { rotation: 360, duration: 1600, repeat: Infinity });
    // A JavaScript timer is the screen's own resource, so the screen clears it.
    let n = 0;
    const timer = setInterval(() => {
      n++;
      fx.play('explosion', { target: n % 2 ? 'busy-1' : 'busy-3', follow: false, intensity: 0.5 });
    }, 700);
    const leave = auto ? setTimeout(() => { navigation.goBack(); }, 900) : null;
    return () => {
      clearInterval(timer);
      if (leave) clearTimeout(leave);
    };
  }, [fx, auto, navigation]);

  return (
    <Screen testID="busy-screen">
      <Section title={auto ? 'Automated cycle: leaving shortly' : 'Effects are running'}>
        <View style={[ui.stage, local.row]}>
          <GameFXTarget id="busy-1" style={local.card}><Text style={ui.playingCardText}>1</Text></GameFXTarget>
          <GameFXTarget id="busy-2" style={local.card}><Text style={ui.playingCardText}>2</Text></GameFXTarget>
          <GameFXTarget id="busy-3" style={local.card}><Text style={ui.playingCardText}>3</Text></GameFXTarget>
        </View>
        <Note>Press back (or the header arrow) whenever you like.</Note>
        <Button label="Go back" onPress={() => { navigation.goBack(); }} testID="busy-back" />
      </Section>
      <Section title="Engine">
        <StatsPanel />
      </Section>
    </Screen>
  );
}

/**
 * Mounts a separate provider (its own engine and overlay) 20 times in a row, each time playing
 * a burst, and checks that every replaced engine was disposed with nothing left running.
 */
function RemountTest({ onResult }: { onResult: (text: string) => void }) {
  const [key, setKey] = useState<number | null>(null);
  const engines = useRef<Engine[]>([]);

  useEffect(() => {
    if (key === null) return undefined;
    if (key < REMOUNTS) {
      const t = setTimeout(() => { setKey(key + 1); }, 120);
      return () => { clearTimeout(t); };
    }
    // Last mount done: unmount it too, then inspect every engine.
    const t = setTimeout(() => {
      setKey(null);
      setTimeout(() => {
        const all = engines.current;
        const leaks = all.filter((e) => {
          const s = e.stats;
          return s.state !== 'disposed' || s.activeEffects > 0 || s.playbacks > 0 || s.sceneNodes > 0 || s.frameLoop;
        });
        const verdict = all.length === REMOUNTS && leaks.length === 0 ? 'PASS' : 'FAIL';
        const text = `${verdict}: ${String(all.length)} engines created, ${String(all.length - leaks.length)} disposed cleanly${leaks.length ? `, ${String(leaks.length)} not` : ''}`;
        onResult(text);
        console.log(`[gamefx-consumer] provider remount ×${String(REMOUNTS)}: ${text}`);
      }, 50);
    }, 300);
    return () => { clearTimeout(t); };
  }, [key, onResult]);

  return (
    <>
      <Row>
        <Button
          label={`Remount ×${String(REMOUNTS)}`}
          onPress={() => {
            engines.current = [];
            onResult('Running…');
            setKey(1);
          }}
          testID="remount-test"
        />
      </Row>
      <View style={local.box}>
        {key !== null ? (
          <GameFXProvider key={key} pauseInBackground={false}>
            <BurstOnMount engines={engines.current} />
            <GameFXOverlay />
          </GameFXProvider>
        ) : (
          <Text style={local.boxText}>Separate provider (unmounted)</Text>
        )}
      </View>
    </>
  );
}

function BurstOnMount({ engines }: { engines: Engine[] }) {
  const fx = useGameFX();
  const engine = useGameFXEngine();
  useEffect(() => {
    if (!engine) return;
    if (!engines.includes(engine)) engines.push(engine);
    fx.play('particle-burst', { position: { x: 150, y: 50 }, count: 40, duration: 600 });
  }, [engine, engines, fx]);
  return <Text style={local.boxText}>Provider #{String(engines.length)}</Text>;
}

const local = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  card: { width: 70, height: 98, borderRadius: 10, backgroundColor: '#FBF7EF', alignItems: 'center', justifyContent: 'center' },
  box: { height: 100, borderRadius: 12, backgroundColor: colors.stage, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  boxText: { color: '#C9CEE6' },
});
