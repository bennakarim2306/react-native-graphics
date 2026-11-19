/**
 * An ordinary React Navigation app. The GameFX integration is three additions that leave the
 * app's own component tree as it is:
 *   1. <GameFXProvider> around the app (one engine for all screens),
 *   2. <GameFXOverlay /> as the last child of the view it should cover,
 *   3. <GameFXTarget id> around the views that effects attach to (inside the screens).
 */
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GameFXOverlay, GameFXProvider } from 'react-native-graphics';
import type { QualityLevel } from 'react-native-graphics';
import type { RootStackParamList } from './src/navigation';
import { BenchmarkScreen } from './src/screens/BenchmarkScreen';
import { CompositionScreen } from './src/screens/CompositionScreen';
import { FireBorderScreen } from './src/screens/FireBorderScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { BusyScreen, LifecycleScreen } from './src/screens/LifecycleScreen';
import { ParticlesScreen } from './src/screens/ParticlesScreen';
import { QualityScreen } from './src/screens/QualityScreen';
import { ThrowScreen } from './src/screens/ThrowScreen';
import { SettingsContext } from './src/settings';

const Stack = createNativeStackNavigator<RootStackParamList>();
const ASSETS = { coin: require('./assets/coin-sheet.png') as number };

export default function App() {
  const [quality, setQuality] = useState<QualityLevel>('medium');
  const [reducedMotion, setReducedMotion] = useState<boolean | 'system'>('system');
  const settings = useMemo(() => ({ quality, reducedMotion, setQuality, setReducedMotion }), [quality, reducedMotion]);
  return (
    <SafeAreaProvider>
      <SettingsContext.Provider value={settings}>
        <GameFXProvider
          quality={quality}
          reducedMotion={reducedMotion}
          assets={ASSETS}
          onError={(error) => {
            console.warn('[GameFX]', error);
          }}
        >
          <View style={styles.root}>
            <NavigationContainer>
              <Stack.Navigator screenOptions={{ headerTintColor: '#1B1F2A' }}>
                <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'Rewards' }} />
                <Stack.Screen name="FireBorder" component={FireBorderScreen} options={{ title: 'B · Fire border' }} />
                <Stack.Screen name="Throw" component={ThrowScreen} options={{ title: 'C · Throw & Explode' }} />
                <Stack.Screen name="Particles" component={ParticlesScreen} options={{ title: 'D · Particles' }} />
                <Stack.Screen name="Composition" component={CompositionScreen} options={{ title: 'E · Composition' }} />
                <Stack.Screen name="Lifecycle" component={LifecycleScreen} options={{ title: 'F · Navigation & lifecycle' }} />
                <Stack.Screen name="Busy" component={BusyScreen} options={{ title: 'Busy screen' }} />
                <Stack.Screen name="Quality" component={QualityScreen} options={{ title: 'G · Quality & accessibility' }} />
                <Stack.Screen name="Benchmark" component={BenchmarkScreen} options={{ title: 'H · Performance' }} />
              </Stack.Navigator>
            </NavigationContainer>
            {/* Transparent, never takes touches; draws above the navigator and its headers. */}
            <GameFXOverlay />
          </View>
        </GameFXProvider>
      </SettingsContext.Provider>
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
