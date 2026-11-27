import { Stack } from 'expo-router';
import { View } from 'react-native';
import { colors } from '../src/components/ui.tsx';

// On a laptop browser the app is shown in a phone-sized column, so the
// prototype looks like a phone app on the projector.
export default function RootLayout() {
  return (
    <View style={{ flex: 1, backgroundColor: '#20231f', alignItems: 'center' }}>
      <View style={{ flex: 1, width: '100%', maxWidth: 430 }}>
        <Stack
          screenOptions={{
            headerTitle: 'HIKE SAFE',
            headerStyle: { backgroundColor: colors.forest },
            headerTintColor: colors.cream,
            headerTitleStyle: { fontWeight: '700' },
            contentStyle: { backgroundColor: colors.cream },
          }}
        />
      </View>
    </View>
  );
}
