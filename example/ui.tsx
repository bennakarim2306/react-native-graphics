/** Small shared controls for the showcase screens. */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export type ButtonTone = 'normal' | 'accent' | 'danger' | 'on';

export function Button({ label, onPress, tone = 'normal', small = false }: { label: string; onPress: () => void; tone?: ButtonTone; small?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        buttonStyles.button,
        small && buttonStyles.small,
        tone === 'accent' && buttonStyles.accent,
        tone === 'danger' && buttonStyles.danger,
        tone === 'on' && buttonStyles.on,
        pressed && buttonStyles.pressed,
      ]}
    >
      <Text style={buttonStyles.buttonText}>{label}</Text>
    </Pressable>
  );
}

export const buttonStyles = StyleSheet.create({
  button: { backgroundColor: '#3D3470', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10 },
  small: { paddingVertical: 8, paddingHorizontal: 10 },
  accent: { backgroundColor: '#C2410C' },
  danger: { backgroundColor: '#8E2D3A' },
  on: { backgroundColor: '#5B4A9E', borderWidth: 1, borderColor: '#FFD54A' },
  pressed: { opacity: 0.7 },
  buttonText: { color: 'white', fontSize: 14, fontWeight: '600' },
});

/** A titled showcase section. */
export function Card({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <View style={uiStyles.card}>
      <Text style={uiStyles.cardTitle}>{title}</Text>
      <Text style={uiStyles.cardSubtitle}>{subtitle}</Text>
      {children}
    </View>
  );
}

/** A labelled − value + control (React Native has no built-in slider). */
export function Stepper({ label, value, format, onChange, step, min, max }: { label: string; value: number; format?: (v: number) => string; onChange: (v: number) => void; step: number; min: number; max: number }) {
  const set = (v: number) => {
    onChange(Math.min(max, Math.max(min, Math.round(v / step) * step)));
  };
  return (
    <View style={uiStyles.stepper}>
      <Text style={uiStyles.stepperLabel}>{label}</Text>
      <Button small label="−" onPress={() => { set(value - step); }} />
      <Text style={uiStyles.stepperValue}>{format ? format(value) : String(value)}</Text>
      <Button small label="+" onPress={() => { set(value + step); }} />
    </View>
  );
}

/** One-of-many choice as a row of small buttons. */
export function Chips<T extends string>({ options, value, onChange }: { options: readonly T[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={uiStyles.row}>
      {options.map((o) => (
        <Button key={o} small label={o} tone={o === value ? 'on' : 'normal'} onPress={() => { onChange(o); }} />
      ))}
    </View>
  );
}

export const uiStyles = StyleSheet.create({
  card: { backgroundColor: '#1C1930', borderRadius: 16, padding: 14, gap: 10 },
  cardTitle: { color: 'white', fontSize: 18, fontWeight: '700' },
  cardSubtitle: { color: '#9A92C4', fontSize: 13 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepperLabel: { color: '#CFC8F0', width: 110 },
  stepperValue: { color: 'white', width: 56, textAlign: 'center', fontVariant: ['tabular-nums'] },
});
