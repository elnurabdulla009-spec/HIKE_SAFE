import { Redirect, router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { api, ApiError, type LiveStatus } from '../src/data/index.ts';
import { mockApi, mockControls, type MockScenario } from '../src/data/mockApi.ts';
import type { DeliveryState, RiskLevel, RiskReason } from '../src/domain/types.ts';
import { Body, Button, Card, Chip, ErrorText, Screen, Title, colors } from '../src/components/ui.tsx';

const LEVEL: Record<RiskLevel, { label: string; color: string }> = {
  LOW: { label: 'Low risk', color: colors.green },
  MEDIUM: { label: 'Medium risk', color: colors.amber },
  HIGH: { label: 'High risk', color: colors.orange },
  CRITICAL: { label: 'Critical risk', color: colors.red },
};

const REASON: Record<RiskReason, string> = {
  RETURN_APPROACHING: 'Planned return time is close',
  RETURN_OVERDUE: 'You are past your planned return time',
  LONG_STATIONARY: 'No movement for a long time',
  GPS_UNKNOWN: 'Location unknown — no GPS signal',
  ROUTE_DEVIATION: 'Away from the planned route',
  SEVERE_DEVIATION: 'Far away from the planned route',
  LOW_BATTERY: 'Battery is low',
  MANUAL_SOS: 'SOS pressed',
};

// Safety rule 4: a queue is not a rescue. Only CONTACT_NOTIFIED says "notified".
const DELIVERY: Record<DeliveryState, string> = {
  LOCAL_ONLY: 'Alert saved on this phone only. Your contact has NOT been told yet.',
  QUEUED_OFFLINE: 'No network. Alert is queued and will be sent when the phone is online. Your contact has NOT been told yet.',
  SENT_TO_SERVER: 'Alert reached our server. Waiting for delivery to your contact.',
  CONTACT_NOTIFIED: 'Contact notified.',
};

const SCENARIOS: { key: MockScenario; label: string }[] = [
  { key: 'WALKING', label: 'Walking' },
  { key: 'RESTING', label: 'Long rest' },
  { key: 'GPS_LOST', label: 'GPS lost' },
  { key: 'OVERDUE', label: 'Overdue' },
  { key: 'OFFLINE', label: 'Offline' },
  { key: 'LOW_BATTERY', label: 'Low battery' },
];

function fmtMinutes(min: number) {
  const m = Math.abs(Math.round(min));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

export default function Live() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [confirmSos, setConfirmSos] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<MockScenario>(mockControls.scenario);

  const [lost, setLost] = useState(false);

  useEffect(() => {
    if (!id) return;
    // After a page reload the demo data is gone (it lives in memory),
    // so the hike no longer exists: go back to the start instead of loading forever.
    api.getLiveStatus(id).catch(() => setLost(true));
    return api.subscribeLiveStatus(id, setStatus);
  }, [id]);

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try { await action(); } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally { setBusy(false); }
  }

  if (!id || lost) return <Redirect href="/" />;
  if (!status) return <Screen><Body muted>Loading hike…</Body></Screen>;

  const { hike, evaluation: ev, incident, network, queuedEvents } = status;
  const level = LEVEL[ev.level];

  // Safety rule 1: unknown is not stationary.
  const where =
    ev.movement === 'UNKNOWN' ? 'Location unknown'
      : ev.movement === 'STATIONARY' ? `Not moving for ${fmtMinutes(ev.stationaryMinutes ?? 0)}`
        : 'Moving';
  const gps = ev.gps === 'FRESH' ? 'GPS signal OK' : ev.gps === 'STALE' ? 'GPS signal lost' : 'No GPS fix yet';
  const back = ev.minutesToReturn > 0 ? `${fmtMinutes(ev.minutesToReturn)} late` : `${fmtMinutes(ev.minutesToReturn)} left`;

  return (
    <Screen>
      {/* During a hike there is no way "back": the hike ends only with "I'm back safe". */}
      <Stack.Screen options={{ headerBackVisible: false, headerLeft: () => null, gestureEnabled: false }} />
      <Title>{hike.destination}</Title>

      <View style={{ backgroundColor: level.color, borderRadius: 14, padding: 16 }}>
        <Text style={{ color: colors.cream, fontSize: 22, fontWeight: '700' }}>{level.label} · {ev.score}/100</Text>
        <Text style={{ color: colors.cream, fontSize: 16, marginTop: 4 }}>{where} · {gps}</Text>
        <Text style={{ color: colors.cream, fontSize: 16 }}>Return: {back}</Text>
      </View>

      {ev.reasons.length > 0 && (
        <Card tone="warn">
          <Body>Why:</Body>
          {ev.reasons.map((r) => <Body key={r} muted>• {REASON[r]}</Body>)}
        </Card>
      )}

      {network === 'OFFLINE' && (
        <Card tone="warn"><Body>Offline. {queuedEvents} updates are stored on the phone and will sync later.</Body></Card>
      )}

      {incident && incident.status === 'OPEN' && (
        <Card tone={incident.delivery === 'CONTACT_NOTIFIED' ? 'ok' : 'danger'}>
          <Body>Alert to your trusted contact</Body>
          <Body muted>{DELIVERY[incident.delivery]}</Body>
        </Card>
      )}

      <ErrorText message={error} />

      {/* Safety rule 5: SOS always asks first. */}
      {ev.reasons.includes('MANUAL_SOS') ? (
        <Card tone="danger">
          <Body>SOS is active. Stay where you are if it is safe, keep your phone on, and call 112 if you can.</Body>
        </Card>
      ) : confirmSos ? (
        <Card tone="danger">
          <Body>Send SOS to your trusted contact now?</Body>
          <Body muted>This does not call 112. If you can, call 112 yourself.</Body>
          <Button title="Yes, send SOS" variant="danger" busy={busy}
            onPress={() => act(async () => { await api.sendSos(hike.id); setConfirmSos(false); })} />
          <Button title="Cancel" variant="secondary" onPress={() => setConfirmSos(false)} />
        </Card>
      ) : (
        <Button title="SOS" variant="danger" onPress={() => setConfirmSos(true)} />
      )}

      <Button title="I'm back safe" busy={busy}
        onPress={() => act(async () => {
          await api.finishHike(hike.id);
          if (api === mockApi) mockControls.setScenario('WALKING');
          // Go back to the existing home screen instead of stacking a second copy of it.
          if (router.canDismiss()) router.dismissAll(); else router.replace('/');
        })} />

      <Body muted>HIKE SAFE does not call 112 and cannot guarantee delivery.</Body>

      {api === mockApi && (
        <Card>
          <Body>Prototype demo: simulate a situation</Body>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {SCENARIOS.map((s) => (
              <Chip key={s.key} label={s.label} selected={scenario === s.key}
                onPress={() => { mockControls.setScenario(s.key); setScenario(s.key); }} />
            ))}
          </View>
        </Card>
      )}
    </Screen>
  );
}
