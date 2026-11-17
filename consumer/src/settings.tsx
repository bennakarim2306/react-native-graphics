// App-level settings that feed the GameFXProvider props (quality, reduced motion).
import { createContext, useContext } from 'react';
import type { QualityLevel } from 'react-native-graphics';

export interface Settings {
  readonly quality: QualityLevel;
  readonly reducedMotion: boolean | 'system';
  setQuality(level: QualityLevel): void;
  setReducedMotion(value: boolean | 'system'): void;
}

export const SettingsContext = createContext<Settings | null>(null);

export function useSettings(): Settings {
  const settings = useContext(SettingsContext);
  if (!settings) throw new Error('useSettings outside SettingsContext');
  return settings;
}
