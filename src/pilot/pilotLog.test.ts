/// <reference types="node" />
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { memoryBackend, setStorageBackend } from '../lib/kvStore.ts';
import {
  clearPilotLogs, CSV_COLUMNS, currentTask, endSession, finishTask, finishTaskIfRunning, getPilotState,
  logPilot, normalizeParticipantCode, reloadPilotFromStorage, scrubDetail, setShowDemoPanel, startSession,
  startTask, summarize, toCsv, toJson,
} from './pilotLog.ts';

const T = 1_800_000_000_000;
const PERSONAL = /@|aigerim|elnur|\+?7\d{9}|almaty/i;

describe('pilot logger', () => {
  beforeEach(() => {
    setStorageBackend(memoryBackend());
    reloadPilotFromStorage();
    clearPilotLogs();
    setShowDemoPanel(false);
  });

  it('accepts only participant codes, never names, emails or phones', () => {
    assert.equal(normalizeParticipantCode(' p01 '), 'P01');
    assert.equal(normalizeParticipantCode('PA12'), 'PA12');
    for (const bad of ['Elnur', 'elnur@mail.kz', '+77011234567', '', 'P', 'P01 Aigerim']) {
      assert.equal(normalizeParticipantCode(bad), null, bad);
    }
    assert.throws(() => startSession('Aigerim Nurlanovna'));
  });

  it('does nothing when no session runs', () => {
    logPilot('SCREEN', { detail: '/live' });
    assert.equal(getPilotState().sessions.length, 0);
  });

  it('stores no personal data, even if an error message contains some', () => {
    startSession('P01', T);
    logPilot('SCREEN', { detail: '/contacts' }, T + 1000);
    logPilot('ERROR', { detail: 'Code sent to elnur@mail.kz, call +7 701 123 45 67' }, T + 2000);
    logPilot('ERROR', { detail: 'Phone must look like +77011234567.' }, T + 3000);
    endSession(T + 4000);
    const all = JSON.stringify(getPilotState()) + toCsv(getPilotState().sessions);
    assert.doesNotMatch(all, PERSONAL);
    assert.match(all, /\[email\]/);
    assert.match(all, /\[number\]/);
    assert.equal(scrubDetail('x'.repeat(500)).length, 120);
  });

  it('times tasks and counts errors per task; Task A auto-finishes', () => {
    startSession('P02', T);
    startTask('A', T + 1_000);
    logPilot('ERROR', { detail: 'Wrong code.' }, T + 2_000);
    logPilot('ERROR', { detail: 'Phone must look like ...' }, T + 3_000);
    finishTaskIfRunning('B', T + 4_000); // wrong task → ignored
    assert.equal(currentTask(), 'A');
    finishTaskIfRunning('A', T + 61_000);
    startTask('B', T + 70_000);
    logPilot('SCENARIO', { detail: 'GPS_LOST' }, T + 71_000);
    startTask('C', T + 100_000); // starting C closes B
    logPilot('SOS_OPEN', {}, T + 101_000);
    logPilot('SOS_CANCEL', {}, T + 102_000);
    logPilot('SOS_OPEN', {}, T + 103_000);
    logPilot('SOS_CONFIRM', {}, T + 104_000);
    finishTask(T + 130_000);
    logPilot('ERROR', { detail: 'outside any task' }, T + 131_000);
    endSession(T + 140_000);

    const sum = summarize(getPilotState().sessions[0]);
    assert.equal(sum.participant, 'P02');
    assert.deepEqual(sum.tasks, { A: { ms: 60_000, errors: 2 }, B: { ms: 30_000, errors: 0 }, C: { ms: 30_000, errors: 0 } });
    assert.equal(sum.errors, 3);
    assert.equal(sum.sosConfirmed, 1);
    assert.equal(sum.sosCancelled, 1);
    assert.equal(sum.durationMs, 140_000);
  });

  it('ending a session closes an open task', () => {
    startSession('P03', T);
    startTask('B', T + 1000);
    endSession(T + 5000);
    assert.equal(summarize(getPilotState().sessions[0]).tasks.B.ms, 4000);
    assert.equal(getPilotState().activeSessionId, null);
  });

  it('CSV has the agreed columns, one row per event, and escapes commas/quotes', () => {
    startSession('P04', T);
    logPilot('ERROR', { detail: 'Bad "value", try again' }, T + 1500);
    endSession(T + 3000);
    startSession('P05', T + 10_000);
    endSession(T + 11_000);
    const lines = toCsv(getPilotState().sessions).trimEnd().split('\n');
    assert.equal(lines[0], 'participant,session_id,event_no,time_iso,elapsed_s,type,task,detail');
    assert.deepEqual(lines[0].split(','), [...CSV_COLUMNS]);
    assert.equal(lines.length, 1 + 3 + 2);
    assert.match(lines[2], /^P04,P04-[a-z0-9]+,2,[0-9T:.\-]+Z,1\.5,ERROR,,"Bad ""value"", try again"$/);
    assert.match(lines[4], /^P05,/);
    const json = JSON.parse(toJson(getPilotState().sessions));
    assert.equal(json.sessions.length, 2);
    assert.equal(json.summaries[0].participant, 'P04');
  });

  it('logs and the observer setting survive a reload; clearing logs keeps the setting', () => {
    setShowDemoPanel(true);
    startSession('P06', T);
    logPilot('SCREEN', { detail: '/plan' }, T + 1000);
    reloadPilotFromStorage();
    assert.equal(getPilotState().showDemoPanel, true);
    assert.equal(getPilotState().sessions[0].events.length, 2);
    assert.equal(currentTask(), null);
    logPilot('BACK_SAFE', {}, T + 2000); // session still active after reload
    assert.equal(getPilotState().sessions[0].events.length, 3);
    clearPilotLogs();
    reloadPilotFromStorage();
    assert.equal(getPilotState().sessions.length, 0);
    assert.equal(getPilotState().showDemoPanel, true);
  });
});
