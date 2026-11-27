/// <reference types="node" />
// A page reload (F5) during the pilot must not lose the hike or sign the user out.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { memoryBackend, setStorageBackend, type KeyValueBackend } from '../lib/kvStore.ts';
import { mockApi as api, mockControls } from './mockApi.ts';

const HOUR = 3_600_000;
const KEY = 'hikesafe.mock.v1';
let storage: KeyValueBackend;

describe('mock persistence (survives a page reload)', () => {
  beforeEach(() => {
    storage = memoryBackend();
    setStorageBackend(storage);
    mockControls.reset();
  });
  afterEach(() => mockControls.reset());

  it('save → reload → same session, contacts, hike, incident, SOS and scenario', async () => {
    await api.verifySignInCode('p01@pilot.kz', '123456');
    await api.addContact({ name: 'Aigerim', phone: '+77011234567' });
    const hike = await api.startHike({ destination: 'Kok-Zhailau', route: [], plannedReturnAt: Date.now() + 4 * HOUR });
    mockControls.setScenario('OFFLINE');
    const sos = await api.sendSos(hike.id);
    const before = await api.getLiveStatus(hike.id);

    mockControls.reloadFromStorage(); // F5

    assert.equal((await api.getSession())?.email, 'p01@pilot.kz');
    assert.deepEqual((await api.listContacts()).map((c) => c.name), ['Aigerim']);
    assert.equal((await api.getActiveHike())?.id, hike.id);
    assert.equal(mockControls.scenario, 'OFFLINE');
    const after = await api.getLiveStatus(hike.id);
    assert.equal(after.incident?.id, sos.id); // still ONE incident (RULE 02)
    assert.equal(after.incident?.delivery, before.incident?.delivery);
    assert.ok(after.evaluation.reasons.includes('MANUAL_SOS'));
  });

  it('a finished hike stays finished after reload (RULE 03)', async () => {
    await api.verifySignInCode('p01@pilot.kz', '123456');
    await api.addContact({ name: 'Aigerim', phone: '+77011234567' });
    const hike = await api.startHike({ destination: 'Medeu', route: [], plannedReturnAt: Date.now() + HOUR });
    await api.sendSos(hike.id);
    await api.finishHike(hike.id);

    mockControls.reloadFromStorage();
    mockControls.setScenario('OVERDUE');

    assert.equal(await api.getActiveHike(), null);
    const live = await api.getLiveStatus(hike.id);
    assert.equal(live.incident?.status, 'RESOLVED');
    assert.equal(live.evaluation.shouldEscalate, false);
    await assert.rejects(api.sendSos(hike.id));
  });

  it('reset demo clears memory AND storage', async () => {
    await api.verifySignInCode('p01@pilot.kz', '123456');
    assert.notEqual(storage.getItem(KEY), null);
    mockControls.reset();
    assert.equal(storage.getItem(KEY), null);
    mockControls.reloadFromStorage();
    assert.equal(await api.getSession(), null);
  });

  it('corrupt or unexpected stored data → starts fresh instead of crashing', async () => {
    for (const bad of ['{not json', '{"v":99}', JSON.stringify({ v: 1, session: null, contacts: 'x', hikes: [], incidents: [], sos: [], scenario: 'WALKING' })]) {
      storage.setItem(KEY, bad);
      mockControls.reloadFromStorage();
      assert.equal(await api.getSession(), null);
      assert.equal(mockControls.scenario, 'WALKING');
    }
  });

  it('broken storage (throws on every call) → the app still works from memory', async () => {
    const boom = () => { throw new Error('storage disabled'); };
    setStorageBackend({ getItem: boom, setItem: boom, removeItem: boom });
    mockControls.reloadFromStorage();
    await api.verifySignInCode('p01@pilot.kz', '123456');
    await api.addContact({ name: 'Aigerim', phone: '+77011234567' });
    assert.equal((await api.listContacts()).length, 1);
    mockControls.reset(); // must not throw either
  });
});
