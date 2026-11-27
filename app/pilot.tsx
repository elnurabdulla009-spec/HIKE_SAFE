import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { TextInput, View } from 'react-native';
import { api } from '../src/data/index.ts';
import { mockApi, mockControls } from '../src/data/mockApi.ts';
import type { Hike } from '../src/domain/types.ts';
import { Body, Button, Card, Chip, ErrorText, Field, Screen, Title, colors } from '../src/components/ui.tsx';
import { changeScenario, SCENARIOS } from '../src/components/scenarios.ts';
import { copyText, downloadText, stamp } from '../src/pilot/exportFile.ts';
import {
  activeSession, clearPilotLogs, currentTask, endSession, finishTask, setShowDemoPanel, startSession,
  startTask, summarize, TASKS, toCsv, toJson, type TaskId,
} from '../src/pilot/pilotLog.ts';
import { usePilot } from '../src/pilot/usePilot.ts';

const mmss = (ms: number | null) => {
  if (ms === null) return '—';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// Observer-only screen. Open it by tapping the "HIKE SAFE" title 3 times, or go to /pilot.
// The participant never needs to see this screen.
export default function Pilot() {
  const pilot = usePilot();
  const session = activeSession(pilot);
  const task = currentTask(session);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [jsonFallback, setJsonFallback] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [activeHike, setActiveHike] = useState<Hike | null>(null);
  const [, rerender] = useState(0);

  useFocusEffect(useCallback(() => {
    api.getActiveHike().then(setActiveHike, () => setActiveHike(null));
  }, []));

  function start() {
    setError(null);
    try {
      // Every participant starts from a clean app (logs of earlier participants are kept).
      if (api === mockApi) mockControls.reset();
      setActiveHike(null);
      startSession(code);
      setCode('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the session.');
    }
  }

  async function copyJson() {
    const json = toJson(pilot.sessions);
    if (await copyText(json)) { setNotice('JSON copied to the clipboard.'); setJsonFallback(null); }
    else { setNotice('Copy is blocked by this browser: select the text below and copy it.'); setJsonFallback(json); }
  }

  function downloadCsv() {
    const ok = downloadText(`hikesafe-pilot-${stamp()}.csv`, toCsv(pilot.sessions), 'text/csv');
    setNotice(ok ? 'CSV downloaded.' : 'Download is not possible here. Use "Copy JSON" instead.');
  }

  return (
    <Screen>
      <Title>Pilot mode (observer)</Title>
      <Body muted>Logs store the participant code only — no emails, names or phone numbers. Logs stay after a reload and after "Reset demo".</Body>

      {/* 1. Session */}
      {session ? (
        <Card tone="ok">
          <Body>Session {session.participant} is running.</Body>
          <Body muted>Current task: {task ? `${task} — ${TASKS[task]}` : 'none'}</Body>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(Object.keys(TASKS) as TaskId[]).map((t) => (
              <Chip key={t} label={`Start ${t}: ${TASKS[t]}`} selected={task === t} onPress={() => startTask(t)} />
            ))}
          </View>
          <Button title="Finish current task" variant="secondary" disabled={!task} onPress={() => finishTask()} />
          <Button title="End session" variant="danger" onPress={() => endSession()} />
        </Card>
      ) : (
        <Card>
          <Field label="Participant code" value={code} onChangeText={setCode} placeholder="P01" autoCapitalize="characters" maxLength={7} />
          <ErrorText message={error} />
          <Button title="Reset demo & start session" onPress={start} />
          <Body muted>Starting a session clears the demo app data (sign-in, contacts, hikes) so each participant starts fresh.</Body>
        </Card>
      )}

      {/* 2. Observer controls */}
      {api === mockApi && (
        <Card>
          <Body>Simulate a situation (the participant does not see these buttons)</Body>
          {activeHike ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {SCENARIOS.map((s) => (
                <Chip key={s.key} label={s.label} selected={mockControls.scenario === s.key}
                  onPress={() => { changeScenario(s.key); rerender((n) => n + 1); }} />
              ))}
            </View>
          ) : <Body muted>No active hike yet. Scenarios appear here once the participant starts a hike.</Body>}
          <Button
            title={pilot.showDemoPanel ? 'Hide demo panel on app screens' : 'Show demo panel on app screens'}
            variant="secondary"
            onPress={() => setShowDemoPanel(!pilot.showDemoPanel)} />
          <Body muted>Demo panel is {pilot.showDemoPanel ? 'ON (for presentations)' : 'OFF (for pilot participants)'}.</Body>
          <Button title="Reset demo (keep logs)" variant="secondary"
            onPress={() => { mockControls.reset(); setActiveHike(null); setNotice('Demo data cleared.'); }} />
        </Card>
      )}

      {/* Back to the root home screen: it re-checks sign-in / active hike, so the app is
          never left on a stale screen after "Reset demo". */}
      <Button title="Back to app" onPress={() => (router.canDismiss() ? router.dismissAll() : router.replace('/'))} />

      {/* 3. Results */}
      <Title>Results</Title>
      {pilot.sessions.length === 0 && <Body muted>No sessions yet.</Body>}
      {[...pilot.sessions].reverse().map((s) => {
        const sum = summarize(s);
        return (
          <Card key={s.id}>
            <Body>{sum.participant} · {new Date(s.startedAt).toLocaleString()} {s.endedAt === null ? '· running' : `· ${mmss(sum.durationMs)}`}</Body>
            {(Object.keys(TASKS) as TaskId[]).map((t) => (
              <Body key={t} muted>Task {t} ({TASKS[t]}): {mmss(sum.tasks[t].ms)} · errors {sum.tasks[t].errors}</Body>
            ))}
            <Body muted>All errors: {sum.errors} · SOS sent {sum.sosConfirmed} · SOS cancelled {sum.sosCancelled} · events {s.events.length}</Body>
          </Card>
        );
      })}

      <Button title="Download CSV" variant="secondary" disabled={pilot.sessions.length === 0} onPress={downloadCsv} />
      <Button title="Copy JSON" variant="secondary" disabled={pilot.sessions.length === 0} onPress={copyJson} />
      {notice && <Body>{notice}</Body>}
      {jsonFallback && (
        <TextInput multiline editable={false} value={jsonFallback} selectTextOnFocus
          style={{ minHeight: 160, borderWidth: 2, borderColor: colors.border, borderRadius: 10, padding: 10, fontFamily: 'monospace', fontSize: 12 }} />
      )}

      {confirmDelete ? (
        <Card tone="danger">
          <Body>Delete ALL pilot logs? Export them first. This cannot be undone.</Body>
          <Button title="Yes, delete all logs" variant="danger" onPress={() => { clearPilotLogs(); setConfirmDelete(false); setNotice('All logs deleted.'); }} />
          <Button title="Cancel" variant="secondary" onPress={() => setConfirmDelete(false)} />
        </Card>
      ) : (
        <Button title="Delete all pilot logs…" variant="secondary" disabled={pilot.sessions.length === 0} onPress={() => setConfirmDelete(true)} />
      )}
    </Screen>
  );
}
