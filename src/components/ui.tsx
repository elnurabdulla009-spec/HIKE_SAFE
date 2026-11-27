// Shared building blocks for HIKE SAFE screens: colors, buttons, inputs.
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

export const colors = {
  cream: '#f5f0e6',
  card: '#fbf8f1',
  border: '#d8cfbc',
  forest: '#1f3d2b',
  text: '#1f3d2b',
  muted: '#5c6157',
  orange: '#b3591c',
  red: '#a3261b',
  amber: '#8a5a00',
  green: '#2e6b3f',
};

export function Screen({ children }: { children: ReactNode }) {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.cream }} contentContainerStyle={styles.screen}>
      {children}
    </ScrollView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <Text style={[styles.body, muted && { color: colors.muted }]}>{children}</Text>;
}

export function Card({ children, tone }: { children: ReactNode; tone?: 'warn' | 'danger' | 'ok' }) {
  const border = tone === 'danger' ? colors.red : tone === 'warn' ? colors.amber : tone === 'ok' ? colors.green : colors.border;
  return <View style={[styles.card, { borderColor: border }]}>{children}</View>;
}

export function Field(props: TextInputProps & { label: string }) {
  const { label, ...rest } = props;
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput placeholderTextColor="#9a9a8e" style={styles.input} {...rest} />
    </View>
  );
}

type Variant = 'primary' | 'secondary' | 'danger';

export function Button({ title, onPress, variant = 'primary', busy, disabled }: {
  title: string;
  onPress: () => void;
  variant?: Variant;
  busy?: boolean;
  disabled?: boolean;
}) {
  const bg = variant === 'primary' ? colors.forest : variant === 'danger' ? colors.red : 'transparent';
  const fg = variant === 'secondary' ? colors.forest : colors.cream;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
        variant === 'secondary' && { borderWidth: 2, borderColor: colors.forest },
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return <Text style={styles.error}>{message}</Text>;
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, selected && { backgroundColor: colors.forest, borderColor: colors.forest }]}
    >
      <Text style={{ color: selected ? colors.cream : colors.forest, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 20, gap: 16 },
  title: { fontSize: 26, fontWeight: '700', color: colors.text },
  body: { fontSize: 16, lineHeight: 22, color: colors.text },
  card: { backgroundColor: colors.card, borderWidth: 2, borderRadius: 14, padding: 16, gap: 8 },
  label: { fontSize: 14, fontWeight: '600', color: colors.text },
  input: {
    borderWidth: 2, borderColor: colors.border, borderRadius: 10, padding: 12,
    fontSize: 16, color: colors.text, backgroundColor: colors.card,
  },
  button: { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  buttonText: { fontSize: 16, fontWeight: '700' },
  error: { color: colors.red, fontSize: 15, fontWeight: '600' },
  chip: { borderWidth: 2, borderColor: colors.border, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14 },
});
