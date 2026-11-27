import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { api, type LiveStatus, type Session, type TrustedContact } from '../src/data/index.ts';
import { buildContactAlert, previewNotice } from '../src/domain/contactMessage.ts';
import { Body, Card, Screen, Title, colors } from '../src/components/ui.tsx';
import { useSignedIn } from '../src/components/useSignedIn.ts';
import { logPilot } from '../src/pilot/pilotLog.ts';

/** The name the contact would see. The mock has no display name, so use the email's first part. */
function hikerName(s: Session | null): string {
  const raw = s?.displayName?.trim() || s?.email.split('@')[0] || 'Your hiker';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

// "What your contact sees": a PREVIEW of the alert text, built from the real hike data.
// Safety rule 4: opening this screen sends nothing and never claims delivery.
export default function ContactPreview() {
  const signedIn = useSignedIn();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [contacts, setContacts] = useState<TrustedContact[] | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [lost, setLost] = useState(false);

  useEffect(() => { logPilot('PREVIEW_OPEN'); }, []);

  useEffect(() => {
    if (!signedIn || !id) return;
    api.getSession().then(setSession, () => {});
    api.listContacts().then(setContacts, () => setContacts([]));
    api.getLiveStatus(id).catch(() => setLost(true));
    return api.subscribeLiveStatus(id, setStatus);
  }, [signedIn, id]);

  if (signedIn === false || !id || lost) return <Redirect href="/" />;
  if (!status || !contacts) return <Screen><Body muted>Loading preview…</Body></Screen>;

  const { hike, evaluation, incident, lastFixAt } = status;
  const notice = previewNotice(incident?.status === 'OPEN' ? incident.delivery : null);

  return (
    <Screen>
      <View style={{ backgroundColor: colors.amber, borderRadius: 14, padding: 14, gap: 4 }}>
        <Text style={{ color: colors.cream, fontSize: 20, fontWeight: '800', letterSpacing: 1 }}>PREVIEW — NOT SENT</Text>
        <Text style={{ color: colors.cream, fontSize: 15 }}>{notice}</Text>
      </View>

      <Title>What your contact sees</Title>

      {contacts.length === 0 && <Body muted>You have no trusted contact, so nobody would receive this alert.</Body>}

      {contacts.map((c) => (
        <Card key={c.id}>
          <Body muted>To: {c.name}</Body>
          <Text accessibilityLabel="Alert message" style={{ fontSize: 17, lineHeight: 25, color: colors.text }}>
            {buildContactAlert({
              hikerName: hikerName(session),
              contactName: c.name,
              destination: hike.destination,
              plannedReturnAt: hike.plannedReturnAt,
              evaluation,
              lastFixAt,
            })}
          </Text>
        </Card>
      ))}

      <Body muted>HIKE SAFE does not call 112 and cannot guarantee that alerts are delivered.</Body>
    </Screen>
  );
}
