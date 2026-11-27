import { Redirect, router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { api, ApiError, type LiveStatus } from '../src/data/index.ts';
import { mockApi, mockControls } from '../src/data/mockApi.ts';
import { DELIVERY_TEXT, formatDuration } from '../src/domain/contactMessage.ts';
import type { RiskLevel, RiskReason } from '../src/domain/types.ts';
import { Body, Button, Card, Chip, ErrorText, Screen, Title, colors } from '../src/components/ui.tsx';
import { changeScenario, SCENARIOS } from '../src/components/scenarios.ts';
import { logPilot } from '../src/pilot/pilotLog.ts';
import { usePilot } from '../src/pilot/usePilot.ts';

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
// The texts live in src/domain/contactMessage.ts (shared with the preview, unit-tested).

const fmtMinutes = formatDuration;

export default function Live() {
  const pilot = usePilot();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [confirmSos, setConfirmSos] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lost, setLost] = useState(false);

  useEffect(() => {
    if (!id) return;
    // The hike can be gone (e.g. after "Reset demo" in another tab):
    // go back to the start instead of loading forever.
    api.getLiveStatus(id).catch(() => setLost(true));
    return api.subscribeLiveStatus(id, setStatus);
  }, [id]);

  // Coming back from Pilot mode: the observer may have reset the demo meanwhile.
  useFocusEffect(useCallback(() => {
    if (id) api.getLiveStatus(id).then(setStatus, () => setLost(true));
  }, [id]));

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
          <Body muted>{DELIVERY_TEXT[incident.delivery]}</Body>
          <Button title="Preview what your contact sees" variant="secondary"
            onPress={() => router.push({ pathname: '/contact-preview', params: { id: hike.id } })} />
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
            onPress={() => act(async () => { await api.sendSos(hike.id); logPilot('SOS_CONFIRM'); setConfirmSos(false); })} />
          <Button title="Cancel" variant="secondary" onPress={() => { logPilot('SOS_CANCEL'); setConfirmSos(false); }} />
        </Card>
      ) : (
        <Button title="SOS" variant="danger" onPress={() => { logPilot('SOS_OPEN'); setConfirmSos(true); }} />
      )}

      <Button title="I'm back safe" busy={busy}
        onPress={() => act(async () => {
          await api.finishHike(hike.id);
          logPilot('BACK_SAFE');
          if (api === mockApi) mockControls.setScenario('WALKING');
          // Go back to the existing home screen instead of stacking a second copy of it.
          if (router.canDismiss()) router.dismissAll(); else router.replace('/');
        })} />

      <Body muted>HIKE SAFE does not call 112 and cannot guarantee delivery.</Body>

      {/* Hidden for pilot participants; the observer turns it on in Pilot mode. */}
      {api === mockApi && pilot.showDemoPanel && (
        <Card>
          <Body>Prototype demo: simulate a situation</Body>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {SCENARIOS.map((s) => (
              <Chip key={s.key} label={s.label} selected={mockControls.scenario === s.key}
                onPress={() => changeScenario(s.key)} />
            ))}
          </View>
        </Card>
      )}
    </Screen>
  );
}
