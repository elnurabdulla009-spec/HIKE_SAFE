import { StyleSheet, Text, View } from 'react-native';
import { THRESHOLDS } from '../src/domain/risk.ts';

// Stage 1 placeholder: proves the app boots and the shared risk engine is bundled.
// Stage 2 replaces this with sign-in, trusted contacts and the hike plan form.
export default function Home() {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>Explore more.{'\n'}Return safely.</Text>
      <Text style={styles.body}>
        Stage 1 build. Risk engine loaded — GPS is treated as unknown after{' '}
        {THRESHOLDS.gpsStaleMs / 60_000} minutes without a fix.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#f5f0e6' },
  title: { fontSize: 32, fontWeight: '700', color: '#1f3d2b', marginBottom: 16 },
  body: { fontSize: 16, color: '#1f3d2b' },
});
