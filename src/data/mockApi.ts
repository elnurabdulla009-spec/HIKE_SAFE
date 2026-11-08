// ─────────────────────────────────────────────────────────────────────────────
// Fake backend for building screens before the real one exists.
// Data lives in memory only (lost on reload). Uses the REAL risk engine,
// so the screens show realistic scores, levels and reasons.
//
// Sign-in code is always 123456.
// Use `mockControls.setScenario(...)` (e.g. from a hidden dev button) to see
// how screens look when GPS is lost, the hiker is overdue, offline, etc.
// ─────────────────────────────────────────────────────────────────────────────
import { advanceDelivery, applyEvaluation, resolveIncident } from '../domain/incident.ts';
import { evaluateRisk } from '../domain/risk.ts';
import type { Hike, Incident, LocationSample } from '../domain/types.ts';
import {
  ApiError,
  type HikePlan,
  type HikeSafeApi,
  type LiveStatus,
  type NewContact,
  type Session,
  type TrustedContact,
} from './api.ts';

const MIN = 60_000;
const DEMO_CODE = '123456';
const E164 = /^\+[1-9]\d{7,14}$/;

export type MockScenario = 'WALKING' | 'RESTING' | 'GPS_LOST' | 'OVERDUE' | 'OFFLINE' | 'LOW_BATTERY';

let seq = 0;
const id = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++seq}`;
const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms));

const state = {
  session: null as Session | null,
  contacts: [] as TrustedContact[],
  hikes: [] as Hike[],
  incidents: new Map<string, Incident>(), // hikeId → incident
  sos: new Set<string>(),
  scenario: 'WALKING' as MockScenario,
  listeners: new Map<string, Set<(s: LiveStatus) => void>>(),
};

function requireSession(): Session {
  if (!state.session) throw new ApiError('NOT_SIGNED_IN', 'Please sign in first.');
  return state.session;
}

function findHike(hikeId: string): Hike {
  const hike = state.hikes.find((h) => h.id === hikeId);
  if (!hike) throw new ApiError('NOT_FOUND', 'Hike not found.');
  return hike;
}

/** Generates fake GPS samples that match the current scenario. */
function fakeSamples(hike: Hike, now: number): LocationSample[] {
  const start = hike.route[0] ?? { lat: 43.1575, lng: 77.0587 }; // Medeu
  const out: LocationSample[] = [];
  const minutes = Math.max(1, Math.floor((now - hike.startedAt) / MIN));
  const lastMinute = state.scenario === 'GPS_LOST' ? Math.max(0, minutes - 40) : minutes;
  for (let m = 0; m <= lastMinute; m++) {
    const resting = state.scenario === 'RESTING' && m > lastMinute - 90;
    const step = resting ? lastMinute - 90 : m;
    out.push({
      lat: start.lat - step * 0.00005,
      lng: start.lng,
      timestamp: hike.startedAt + m * MIN,
      accuracy: 8,
    });
  }
  return out;
}

function buildStatus(hike: Hike): LiveStatus {
  // In OVERDUE we pretend 45 minutes passed after the planned return.
  const now = state.scenario === 'OVERDUE' ? Math.max(Date.now(), hike.plannedReturnAt + 45 * MIN) : Date.now();
  const samples = fakeSamples(hike, now);
  const evaluation = evaluateRisk({
    now,
    hike,
    samples,
    batteryLevel: state.scenario === 'LOW_BATTERY' ? 0.08 : 0.76,
    sosActive: state.sos.has(hike.id),
  });

  let incident = applyEvaluation(hike, state.incidents.get(hike.id) ?? null, evaluation, () => id('inc'));
  if (incident) {
    incident = advanceDelivery(incident, state.scenario === 'OFFLINE' ? 'QUEUED_OFFLINE' : 'SENT_TO_SERVER');
    state.incidents.set(hike.id, incident);
  }

  const offline = state.scenario === 'OFFLINE';
  return {
    hike,
    evaluation,
    incident,
    network: offline ? 'OFFLINE' : 'ONLINE',
    queuedEvents: offline ? 12 : 0,
    lastFixAt: evaluation.gps === 'NO_FIX' ? null : samples.at(-1)?.timestamp ?? null,
  };
}

function notify(hikeId: string) {
  const hike = state.hikes.find((h) => h.id === hikeId);
  const subs = state.listeners.get(hikeId);
  if (!hike || !subs) return;
  const status = buildStatus(hike);
  subs.forEach((fn) => fn(status));
}

export const mockApi: HikeSafeApi = {
  async getSession() {
    await delay(100);
    return state.session;
  },

  async requestSignInCode(email) {
    await delay();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new ApiError('INVALID_INPUT', 'Enter a valid email.');
  },

  async verifySignInCode(email, code) {
    await delay();
    if (code !== DEMO_CODE) throw new ApiError('INVALID_CODE', 'Wrong code. (Mock code is 123456.)');
    state.session = { userId: 'mock-user', email, displayName: null };
    return state.session;
  },

  async signOut() {
    await delay(100);
    state.session = null;
  },

  async listContacts() {
    requireSession();
    await delay();
    return [...state.contacts];
  },

  async addContact(input: NewContact) {
    requireSession();
    await delay();
    if (!input.name.trim()) throw new ApiError('INVALID_INPUT', 'Name is required.');
    if (!E164.test(input.phone)) throw new ApiError('INVALID_INPUT', 'Phone must look like +77011234567.');
    const contact: TrustedContact = { id: id('contact'), name: input.name.trim(), phone: input.phone, telegramConnected: false };
    state.contacts.push(contact);
    return contact;
  },

  async removeContact(contactId) {
    requireSession();
    await delay();
    state.contacts = state.contacts.filter((c) => c.id !== contactId);
  },

  async getActiveHike() {
    requireSession();
    await delay(100);
    return state.hikes.find((h) => h.status === 'ACTIVE') ?? null;
  },

  async startHike(plan: HikePlan) {
    requireSession();
    await delay();
    if (state.contacts.length === 0) throw new ApiError('NO_CONTACT', 'Add a trusted contact first.');
    if (state.hikes.some((h) => h.status === 'ACTIVE')) throw new ApiError('HIKE_ALREADY_ACTIVE', 'Finish your current hike first.');
    if (!plan.destination.trim()) throw new ApiError('INVALID_INPUT', 'Destination is required.');
    if (plan.plannedReturnAt <= Date.now()) throw new ApiError('INVALID_INPUT', 'Return time must be in the future.');
    const hike: Hike = {
      id: id('hike'),
      destination: plan.destination.trim(),
      route: plan.route,
      startedAt: Date.now(),
      plannedReturnAt: plan.plannedReturnAt,
      status: 'ACTIVE',
    };
    state.hikes.push(hike);
    return hike;
  },

  async finishHike(hikeId) {
    requireSession();
    await delay();
    const hike = findHike(hikeId);
    hike.status = 'COMPLETED';
    const incident = state.incidents.get(hikeId);
    if (incident) state.incidents.set(hikeId, resolveIncident(incident, Date.now()));
    state.sos.delete(hikeId);
    notify(hikeId);
  },

  async listPastHikes() {
    requireSession();
    await delay();
    return state.hikes.filter((h) => h.status !== 'ACTIVE').sort((a, b) => b.startedAt - a.startedAt);
  },

  async getLiveStatus(hikeId) {
    requireSession();
    await delay(150);
    return buildStatus(findHike(hikeId));
  },

  subscribeLiveStatus(hikeId, onChange) {
    const subs = state.listeners.get(hikeId) ?? new Set();
    subs.add(onChange);
    state.listeners.set(hikeId, subs);
    notify(hikeId);
    const timer = setInterval(() => notify(hikeId), 5_000); // real API pushes on change
    return () => {
      clearInterval(timer);
      subs.delete(onChange);
    };
  },

  async sendSos(hikeId) {
    requireSession();
    await delay();
    const hike = findHike(hikeId);
    if (hike.status !== 'ACTIVE') throw new ApiError('NOT_FOUND', 'This hike is already closed.');
    state.sos.add(hikeId);
    const status = buildStatus(hike);
    notify(hikeId);
    return status.incident!;
  },
};

/** Development-only helpers for the mock. Not part of the real API. */
export const mockControls = {
  setScenario(s: MockScenario) {
    state.scenario = s;
    state.hikes.filter((h) => h.status === 'ACTIVE').forEach((h) => notify(h.id));
  },
  get scenario() {
    return state.scenario;
  },
  reset() {
    state.session = null;
    state.contacts = [];
    state.hikes = [];
    state.incidents.clear();
    state.sos.clear();
    state.scenario = 'WALKING';
  },
};
