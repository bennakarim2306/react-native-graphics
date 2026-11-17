// A. An ordinary app screen (a rewards page). The GameFX parts are a target around the points
// badge and three effect calls in the "Claim" handler; the rest is plain React Native.
import { useNavigation } from '@react-navigation/native';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import { GameFXTarget, SDK_VERSION, useGameFX } from 'react-native-graphics';
import type { Navigation, RootStackParamList } from '../navigation';
import { Button, colors, Note, Row, Screen, Section } from '../ui';

const OFFERS = [
  { id: 'coffee', title: 'Free coffee', cost: 120 },
  { id: 'cinema', title: 'Cinema ticket', cost: 450 },
  { id: 'books', title: '10% off books', cost: 200 },
];

const DEMOS: { screen: keyof RootStackParamList; label: string }[] = [
  { screen: 'FireBorder', label: 'B · Fire border' },
  { screen: 'Throw', label: 'C · Throw & Explode' },
  { screen: 'Particles', label: 'D · Particles' },
  { screen: 'Composition', label: 'E · Composition' },
  { screen: 'Lifecycle', label: 'F · Navigation & lifecycle' },
  { screen: 'Quality', label: 'G · Quality & accessibility' },
  { screen: 'Benchmark', label: 'H · Performance' },
];

export function HomeScreen() {
  const navigation = useNavigation<Navigation>();
  const fx = useGameFX();
  const [points, setPoints] = useState(320);
  const [claimed, setClaimed] = useState(0);

  const claim = (event: GestureResponderEvent) => {
    setPoints((p) => p + 50);
    setClaimed((n) => n + 1);
    // Confetti from the button (touch point in window coordinates -> overlay coordinates),
    // sparks and a short glow on the badge (anchored to the view, wherever it is).
    fx.play('confetti', { position: fx.fromWindow({ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY }), count: 70 });
    fx.play('golden-sparks', { target: 'points-badge' });
    fx.attach('points-badge', 'glow-pulse', { pulses: 2, color: '#FFC83D' });
  };

  return (
    <Screen testID="home">
      <Section title="Hello, Sam">
        <Row style={styles.pointsRow}>
          <GameFXTarget id="points-badge" style={styles.badge}>
            <Text style={styles.points} testID="points">{points}</Text>
            <Text style={styles.pointsLabel}>points</Text>
          </GameFXTarget>
          <View style={styles.flex}>
            <Note>Claim your daily reward to earn 50 points.</Note>
            <Button label="Claim daily reward" tone="primary" onPress={claim} testID="claim" />
          </View>
        </Row>
        <Note>{`Claimed ${String(claimed)} time(s) this session.`}</Note>
      </Section>

      <Section title="Offers">
        {OFFERS.map((offer) => (
          <Row key={offer.id} style={styles.offer}>
            <Text style={styles.offerTitle}>{offer.title}</Text>
            <Text style={styles.offerCost}>{`${String(offer.cost)} pts`}</Text>
          </Row>
        ))}
      </Section>

      <Section title="Effect demos">
        <Row>
          {DEMOS.map((d) => (
            <Button key={d.screen} label={d.label} testID={`go-${d.screen}`} onPress={() => { navigation.navigate(d.screen); }} />
          ))}
        </Row>
        <Note>{`react-native-graphics ${SDK_VERSION}, installed from its npm tarball.`}</Note>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pointsRow: { flexWrap: 'nowrap', gap: 16 },
  badge: { width: 104, height: 104, borderRadius: 52, backgroundColor: '#FFF4D6', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#F2C94C' },
  points: { fontSize: 28, fontWeight: '800', color: colors.ink },
  pointsLabel: { color: colors.muted },
  flex: { flex: 1, gap: 8 },
  offer: { justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.line },
  offerTitle: { color: colors.ink, fontSize: 15 },
  offerCost: { color: colors.muted },
});
