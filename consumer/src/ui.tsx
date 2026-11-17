// Plain React Native building blocks of this app. Nothing here knows about GameFX.
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { GestureResponderEvent, StyleProp, ViewStyle } from 'react-native';

export const colors = {
  page: '#F5F6FA',
  card: '#FFFFFF',
  ink: '#1B1F2A',
  muted: '#5B6275',
  accent: '#3E5BF2',
  danger: '#C62828',
  line: '#E2E5EE',
  stage: '#151827',
};

export function Screen({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.pageContent} testID={testID}>
      {children}
    </ScrollView>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export function Button({ label, onPress, tone = 'normal', testID, selected = false }: { label: string; onPress: (e: GestureResponderEvent) => void; tone?: 'normal' | 'primary' | 'danger'; testID?: string; selected?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [styles.button, tone === 'primary' && styles.primary, tone === 'danger' && styles.danger, selected && styles.selected, pressed && styles.pressed]}
    >
      <Text style={[styles.buttonText, (tone !== 'normal' || selected) && styles.buttonTextLight]}>{label}</Text>
    </Pressable>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

export function Choice<T extends string>({ options, value, onChange }: { options: readonly T[]; value: T; onChange: (v: T) => void }) {
  return (
    <Row>
      {options.map((o) => (
        <Button key={o} label={o} selected={o === value} onPress={() => { onChange(o); }} />
      ))}
    </Row>
  );
}

export function Stepper({ label, value, step, min, max, onChange, format = (v) => v.toFixed(1) }: { label: string; value: number; step: number; min: number; max: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  const set = (v: number) => { onChange(Math.min(max, Math.max(min, Math.round(v / step) * step))); };
  return (
    <Row style={styles.stepper}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <Button label="−" onPress={() => { set(value - step); }} />
      <Text style={styles.stepperValue}>{format(value)}</Text>
      <Button label="+" onPress={() => { set(value + step); }} />
    </Row>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <Text style={styles.note}>{children}</Text>;
}

export const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  pageContent: { padding: 16, gap: 16, paddingBottom: 48 },
  section: { backgroundColor: colors.card, borderRadius: 14, padding: 14, gap: 10, borderWidth: 1, borderColor: colors.line },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.ink },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  button: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, backgroundColor: '#E8EBF5' },
  primary: { backgroundColor: colors.accent },
  danger: { backgroundColor: colors.danger },
  selected: { backgroundColor: '#2B3A8F' },
  pressed: { opacity: 0.7 },
  buttonText: { color: colors.ink, fontWeight: '600' },
  buttonTextLight: { color: '#FFFFFF' },
  stepper: { justifyContent: 'flex-start' },
  stepperLabel: { width: 90, color: colors.muted },
  stepperValue: { minWidth: 48, textAlign: 'center', color: colors.ink, fontVariant: ['tabular-nums'] },
  note: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  stage: { height: 240, borderRadius: 12, backgroundColor: colors.stage, alignItems: 'center', justifyContent: 'center' },
  playingCard: { width: 96, height: 136, borderRadius: 12, backgroundColor: '#FBF7EF', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#E0D6C3' },
  playingCardText: { fontSize: 30, fontWeight: '800', color: '#B3261E' },
  mono: { fontFamily: 'monospace', fontSize: 12, color: colors.ink },
});
