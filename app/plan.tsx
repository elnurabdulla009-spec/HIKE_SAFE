import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { api, ApiError } from '../src/data/index.ts';
import { Body, Button, Chip, ErrorText, Field, Screen, Title } from '../src/components/ui.tsx';
import { useSignedIn } from '../src/components/useSignedIn.ts';

const DESTINATIONS = ['Medeu → Shymbulak', 'Big Almaty Lake', 'Kok-Zhailau', 'Furmanov peak'];
const DURATIONS = [2, 4, 6, 8]; // hours from now

export default function Plan() {
  const signedIn = useSignedIn();
  const [destination, setDestination] = useState('');
  const [hours, setHours] = useState<number | null>(4);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const returnAt = hours ? Date.now() + hours * 3_600_000 : null;

  async function start() {
    setError(null);
    if (!returnAt) { setError('Choose when you will be back.'); return; }
    setBusy(true);
    try {
      const hike = await api.startHike({ destination, route: [], plannedReturnAt: returnAt });
      router.replace({ pathname: '/live', params: { id: hike.id } });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not start the hike.');
    } finally {
      setBusy(false);
    }
  }

  if (signedIn === false) return <Redirect href="/sign-in" />;
  if (signedIn === null) return <Screen><Body muted>Loading…</Body></Screen>;

  return (
    <Screen>
      <Title>Plan your hike</Title>

      <Field label="Where are you going?" value={destination} onChangeText={setDestination} placeholder="e.g. Big Almaty Lake" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {DESTINATIONS.map((d) => <Chip key={d} label={d} selected={destination === d} onPress={() => setDestination(d)} />)}
      </View>

      <Body>When will you be back?</Body>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {DURATIONS.map((h) => <Chip key={h} label={`in ${h} h`} selected={hours === h} onPress={() => setHours(h)} />)}
      </View>
      {returnAt && (
        <Body muted>
          Planned return: {new Date(returnAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. If you are not back by then, your contact is alerted.
        </Body>
      )}

      <ErrorText message={error} />
      <Button title="Start hike" busy={busy} onPress={start} />
    </Screen>
  );
}
