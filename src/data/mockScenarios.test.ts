/// <reference types="node" />
// Demo scenarios on a hike that has JUST started — exactly what happens during
// the live presentation: sign in, plan a hike, then tap a scenario chip.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { mockApi as api, mockControls } from './mockApi.ts';

const HOUR = 3_600_000;

async function startFreshHike() {
  await api.verifySignInCode('demo@hikesafe.kz', '123456');
  await api.addContact({ name: 'Aigerim', phone: '+77011234567' });
  return api.startHike({ destination: 'Big Almaty Lake', route: [], plannedReturnAt: Date.now() + 4 * HOUR });
}

describe('mock scenarios on a just-started hike', () => {
  beforeEach(() => mockControls.reset());
  afterEach(() => mockControls.reset());

  it('GPS_LOST → movement UNKNOWN with GPS_UNKNOWN, never STATIONARY (RULE 01)', async () => {
    const hike = await startFreshHike();
    mockControls.setScenario('GPS_LOST');
    const { evaluation: ev, lastFixAt } = await api.getLiveStatus(hike.id);
    assert.equal(ev.movement, 'UNKNOWN');
    assert.notEqual(ev.gps, 'FRESH');
    assert.ok(ev.reasons.includes('GPS_UNKNOWN'), `reasons were ${ev.reasons.join(',')}`);
    assert.ok(!ev.reasons.includes('LONG_STATIONARY'));
    assert.equal(ev.stationaryMinutes, null);
    assert.ok(lastFixAt !== null && lastFixAt < Date.now() - 10 * 60_000, 'last fix should be old');
  });

  it('RESTING → movement STATIONARY', async () => {
    const hike = await startFreshHike();
    mockControls.setScenario('RESTING');
    const { evaluation: ev } = await api.getLiveStatus(hike.id);
    assert.equal(ev.movement, 'STATIONARY');
    assert.equal(ev.gps, 'FRESH');
    assert.ok((ev.stationaryMinutes ?? 0) >= 60);
    assert.ok(ev.reasons.includes('LONG_STATIONARY'));
  });

  it('OVERDUE → minutesToReturn > 0 and an incident is opened', async () => {
    const hike = await startFreshHike();
    mockControls.setScenario('OVERDUE');
    const { evaluation: ev, incident } = await api.getLiveStatus(hike.id);
    assert.ok(ev.minutesToReturn > 0, `minutesToReturn was ${ev.minutesToReturn}`);
    assert.ok(ev.reasons.includes('RETURN_OVERDUE'));
    assert.equal(incident?.status, 'OPEN');
    assert.equal(incident?.hikeId, hike.id);
  });

  it('OFFLINE → incident is QUEUED_OFFLINE, never CONTACT_NOTIFIED (RULE 04)', async () => {
    const hike = await startFreshHike();
    mockControls.setScenario('OFFLINE');
    const live = await api.getLiveStatus(hike.id);
    assert.equal(live.network, 'OFFLINE');
    assert.ok(live.incident, 'an incident should exist while offline');
    assert.equal(live.incident.delivery, 'QUEUED_OFFLINE');
    // Repeated polling while offline must never claim delivery.
    for (let i = 0; i < 3; i++) {
      const again = await api.getLiveStatus(hike.id);
      assert.notEqual(again.incident?.delivery, 'CONTACT_NOTIFIED');
    }
  });

  it('pressing SOS twice gives only one incident (RULE 02)', async () => {
    const hike = await startFreshHike();
    const first = await api.sendSos(hike.id);
    const second = await api.sendSos(hike.id);
    assert.equal(second.id, first.id);
    const live = await api.getLiveStatus(hike.id);
    assert.equal(live.incident?.id, first.id);
    assert.ok(live.evaluation.reasons.includes('MANUAL_SOS'));
  });

  it('after finishHike the hike never raises an alert again (RULE 03)', async () => {
    const hike = await startFreshHike();
    await api.finishHike(hike.id);
    for (const s of ['OVERDUE', 'GPS_LOST', 'RESTING', 'OFFLINE', 'LOW_BATTERY'] as const) {
      mockControls.setScenario(s);
      const live = await api.getLiveStatus(hike.id);
      assert.equal(live.incident, null, `scenario ${s} opened an incident`);
      assert.equal(live.evaluation.shouldEscalate, false, `scenario ${s} wanted to escalate`);
      assert.equal(live.evaluation.level, 'LOW');
    }
    await assert.rejects(api.sendSos(hike.id));
  });
});
