import { router, Stack, usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Pressable, Text, View } from 'react-native';
import { colors } from '../src/components/ui.tsx';
import { logPilot } from '../src/pilot/pilotLog.ts';

/** Hidden observer entrance: tap the "HIKE SAFE" title 3 times within 1.5 s → Pilot mode. */
function HeaderTitle() {
  const taps = useRef<number[]>([]);
  function onPress() {
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 1500), now];
    if (taps.current.length >= 3) {
      taps.current = [];
      router.push('/pilot');
    }
  }
  return (
    <Pressable onPress={onPress} accessibilityLabel="HIKE SAFE">
      <Text style={{ color: colors.cream, fontWeight: '700', fontSize: 18 }}>HIKE SAFE</Text>
    </Pressable>
  );
}

// On a laptop browser the app is shown in a phone-sized column, so the
// prototype looks like a phone app on the projector.
export default function RootLayout() {
  const pathname = usePathname();
  useEffect(() => {
    // Pilot: log which screen the participant sees (path only, never parameters).
    if (pathname !== '/pilot') logPilot('SCREEN', { detail: pathname });
  }, [pathname]);

  return (
    <View style={{ flex: 1, backgroundColor: '#20231f', alignItems: 'center' }}>
      <View style={{ flex: 1, width: '100%', maxWidth: 430 }}>
        <Stack
          screenOptions={{
            headerTitle: () => <HeaderTitle />,
            title: 'HIKE SAFE',
            headerStyle: { backgroundColor: colors.forest },
            headerTintColor: colors.cream,
            contentStyle: { backgroundColor: colors.cream },
          }}
        />
      </View>
    </View>
  );
}
