import { Redirect, router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { api, type TrustedContact } from '../src/data/index.ts';
import type { Hike } from '../src/domain/types.ts';
import { Body, Button, Card, Screen, Title, colors } from '../src/components/ui.tsx';

// Home: decides where the user should be, and shows the next step.
export default function Home() {
  const [loading, setLoading] = useState(true);
  const [contacts, setContacts] = useState<TrustedContact[]>([]);
  const [past, setPast] = useState<Hike[]>([]);
  const [goTo, setGoTo] = useState<Href | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        const session = await api.getSession();
        if (!session) { if (alive) setGoTo('/sign-in'); return; }
        const active = await api.getActiveHike();
        if (active) { if (alive) setGoTo({ pathname: '/live', params: { id: active.id } }); return; }
        const [c, p] = await Promise.all([api.listContacts(), api.listPastHikes()]);
        if (alive) { setContacts(c); setPast(p); setLoading(false); }
      })();
      return () => { alive = false; };
    }, []),
  );

  // Redirect as a component: navigating from an effect on first load leaves a blank page on web.
  if (goTo) return <Redirect href={goTo} />;

  if (loading) {
    return <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.cream }}><ActivityIndicator color={colors.forest} /></View>;
  }

  const hasContact = contacts.length > 0;
  return (
    <Screen>
      <Title>Ready for a hike?</Title>

      <Card tone={hasContact ? 'ok' : 'warn'}>
        <Body>{hasContact ? `Trusted contact: ${contacts.map((c) => c.name).join(', ')}` : 'Step 1: add a trusted contact. They are told if you do not return on time.'}</Body>
        <Button title={hasContact ? 'Manage contacts' : 'Add trusted contact'} variant={hasContact ? 'secondary' : 'primary'}
          onPress={() => router.push('/contacts')} />
      </Card>

      <Card>
        <Body>Step 2: tell us where you go and when you will be back.</Body>
        <Button title="Plan a hike" disabled={!hasContact} onPress={() => router.push('/plan')} />
      </Card>

      {past.length > 0 && (
        <Card>
          <Body>Past hikes</Body>
          {past.map((h) => (
            <Body key={h.id} muted>• {h.destination} — {new Date(h.startedAt).toLocaleDateString()} ({h.status === 'COMPLETED' ? 'back safe' : 'cancelled'})</Body>
          ))}
        </Card>
      )}

      <Body muted>HIKE SAFE does not call 112 and cannot guarantee that alerts are delivered. In an emergency, call 112 yourself.</Body>
      <Button title="Sign out" variant="secondary" onPress={async () => { await api.signOut(); router.replace('/sign-in'); }} />
    </Screen>
  );
}
