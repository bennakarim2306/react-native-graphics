/** Small shared controls for the showcase screens. */
import { Pressable, StyleSheet, Text } from 'react-native';

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
