/// <reference types="node" />
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { ApiError } from './api.ts';
import { mockApi as api, mockControls } from './mockApi.ts';

const HOUR = 3_600_000;
const plan = () => ({ destination: 'Medeu', route: [], plannedReturnAt: Date.now() + 4 * HOUR });
const code = (e: unknown) => (e instanceof ApiError ? e.code : String(e));

describe('mock API (frontend contract)', () => {
  beforeEach(() => mockControls.reset());

  it('requires sign-in', async () => {
    await assert.rejects(api.listContacts(), (e) => code(e) === 'NOT_SIGNED_IN');
  });

  it('signs in with code 123456 only', async () => {
    await assert.rejects(api.verifySignInCode('a@b.kz', '000000'), (e) => code(e) === 'INVALID_CODE');
    const s = await api.verifySignInCode('a@b.kz', '123456');
    assert.equal(s.email, 'a@b.kz');
    assert.deepEqual(await api.getSession(), s);
  });

  it('full happy path: contact → hike → live status → finish', async () => {
    await api.verifySignInCode('a@b.kz', '123456');
    await assert.rejects(api.startHike(plan()), (e) => code(e) === 'NO_CONTACT');
    await assert.rejects(api.addContact({ name: 'Ana', phone: '8701' }), (e) => code(e) === 'INVALID_INPUT');
    await api.addContact({ name: 'Ana', phone: '+77011234567' });

    const hike = await api.startHike(plan());
    await assert.rejects(api.startHike(plan()), (e) => code(e) === 'HIKE_ALREADY_ACTIVE');
    assert.equal((await api.getActiveHike())?.id, hike.id);

    const live = await api.getLiveStatus(hike.id);
    assert.equal(live.evaluation.level, 'LOW');
    assert.equal(live.incident, null);

    await api.finishHike(hike.id);
    assert.equal(await api.getActiveHike(), null);
    assert.equal((await api.listPastHikes()).length, 1);
  });

  it('scenarios drive the real risk engine', async () => {
    await api.verifySignInCode('a@b.kz', '123456');
    await api.addContact({ name: 'Ana', phone: '+77011234567' });
    const hike = await api.startHike(plan());

    mockControls.setScenario('OVERDUE');
    const overdue = await api.getLiveStatus(hike.id);
    assert.ok(overdue.evaluation.reasons.includes('RETURN_OVERDUE'));
    assert.equal(overdue.incident?.status, 'OPEN');

    mockControls.setScenario('OFFLINE');
    const off = await api.getLiveStatus(hike.id);
    assert.equal(off.network, 'OFFLINE');
    // A queue is not a rescue — and delivery never goes backwards.
    assert.equal(off.incident?.delivery, 'SENT_TO_SERVER');
  });

  it('SOS creates one incident; finishing resolves it', async () => {
    await api.verifySignInCode('a@b.kz', '123456');
    await api.addContact({ name: 'Ana', phone: '+77011234567' });
    const hike = await api.startHike(plan());
    const inc = await api.sendSos(hike.id);
    assert.equal(inc.peakLevel, 'CRITICAL');
    const again = await api.sendSos(hike.id);
    assert.equal(again.id, inc.id); // RULE 02
    await api.finishHike(hike.id);
    const after = await api.getLiveStatus(hike.id);
    assert.equal(after.incident?.status, 'RESOLVED'); // RULE 03
    await assert.rejects(api.sendSos(hike.id));
  });
});
