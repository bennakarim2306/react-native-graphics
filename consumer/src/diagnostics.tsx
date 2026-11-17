import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { useGameFXEngine } from 'react-native-graphics';
import type { EngineStats } from 'react-native-graphics';
import { styles } from './ui';

/** The provider's `engine.stats`, refreshed a few times per second (never per frame). */
export function useEngineStats(intervalMs = 250): EngineStats | null {
  const engine = useGameFXEngine();
  const [stats, setStats] = useState<EngineStats | null>(null);
  useEffect(() => {
    if (!engine) return undefined;
    const read = () => { setStats(engine.stats); };
    read();
    const timer = setInterval(read, intervalMs);
    return () => { clearInterval(timer); };
  }, [engine, intervalMs]);
  return stats;
}

export function formatStats(s: EngineStats | null): string {
  if (!s) return 'engine not ready';
  return [
    `state ${s.state} · frame loop ${s.frameLoop ? 'on' : 'off'}`,
    `effects ${String(s.activeEffects)} · playbacks ${String(s.playbacks)}`,
    `targets ${String(s.targets)} · local layers ${String(s.localLayers)} · scene nodes ${String(s.sceneNodes)}`,
    `images loaded ${String(s.assets.loaded)} (${(s.assets.bytes / 1024).toFixed(0)} KiB)`,
  ].join('\n');
}

export function StatsPanel({ testID = 'engine-stats' }: { testID?: string }) {
  const stats = useEngineStats();
  return (
    <Text style={styles.mono} testID={testID}>
      {formatStats(stats)}
    </Text>
  );
}
