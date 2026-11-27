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
import { loadJson, removeKey, saveJson } from '../lib/kvStore.ts';
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

// ── Persistence: a page reload (F5) keeps the demo data ──────────────────────
const STORAGE_KEY = 'hikesafe.mock.v1';
const SCENARIOS: MockScenario[] = ['WALKING', 'RESTING', 'GPS_LOST', 'OVERDUE', 'OFFLINE', 'LOW_BATTERY'];

interface StoredState {
  v: 1;
  session: Session | null;
  contacts: TrustedContact[];
  hikes: Hike[];
  incidents: [string, Incident][];
  sos: string[];
  scenario: MockScenario;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

/** Accepts stored data only if it has the expected shape; anything else → start fresh. */
function validateStored(raw: unknown): StoredState | null {
  if (!isObj(raw) || raw.v !== 1) return null;
  const { session, contacts, hikes, incidents, sos, scenario } = raw;
  if (session !== null && !(isObj(session) && typeof session.userId === 'string' && typeof session.email === 'string')) return null;
  if (!Array.isArray(contacts) || !contacts.every((c) => isObj(c) && typeof c.id === 'string' && typeof c.name === 'string')) return null;
  if (!Array.isArray(hikes) || !hikes.every((h) => isObj(h) && typeof h.id === 'string' && typeof h.status === 'string'
    && typeof h.startedAt === 'number' && typeof h.plannedReturnAt === 'number' && Array.isArray(h.route))) return null;
  if (!Array.isArray(incidents) || !incidents.every((e) => Array.isArray(e) && typeof e[0] === 'string' && isObj(e[1]) && typeof e[1].status === 'string')) return null;
  if (!Array.isArray(sos) || !sos.every((s) => typeof s === 'string')) return null;
  if (!SCENARIOS.includes(scenario as MockScenario)) return null;
  return raw as unknown as StoredState;
}

function persist() {
  const stored: StoredState = {
    v: 1,
    session: state.session,
    contacts: state.contacts,
    hikes: state.hikes,
    incidents: [...state.incidents.entries()],
    sos: [...state.sos],
    scenario: state.scenario,
  };
  saveJson(STORAGE_KEY, stored);
}

function hydrate() {
  const s = loadJson(STORAGE_KEY, validateStored);
  state.session = s?.session ?? null;
  state.contacts = s?.contacts ?? [];
  state.hikes = s?.hikes ?? [];
  state.incidents = new Map(s?.incidents ?? []);
  state.sos = new Set(s?.sos ?? []);
  state.scenario = s?.scenario ?? 'WALKING';
}

hydrate();

function requireSession(): Session {
  if (!state.session) throw new ApiError('NOT_SIGNED_IN', 'Please sign in first.');
  return state.session;
}

function findHike(hikeId: string): Hike {
  const hike = state.hikes.find((h) => h.id === hikeId);
  if (!hike) throw new ApiError('NOT_FOUND', 'Hike not found.');
  return hike;
}

/**
 * Demo: "long rest" and "GPS lost" need history. On a hike that just started,
 * pretend it began 3 hours ago so these scenarios show up immediately.
 * The risk engine must see the SAME start time as the fake GPS history,
 * otherwise its "just started" grace period hides GPS_UNKNOWN.
 */
function demoStartedAt(hike: Hike, now: number): number {
  const needsHistory = state.scenario === 'RESTING' || state.scenario === 'GPS_LOST';
  return needsHistory ? Math.min(hike.startedAt, now - 180 * MIN) : hike.startedAt;
}

/** OVERDUE and OFFLINE pretend 45 minutes passed after the planned return. */
function demoNow(hike: Hike): number {
  const late = state.scenario === 'OVERDUE' || state.scenario === 'OFFLINE';
  return late ? Math.max(Date.now(), hike.plannedReturnAt + 45 * MIN) : Date.now();
}

/** Generates fake GPS samples that match the current scenario. */
function fakeSamples(hike: Hike, now: number): LocationSample[] {
  const start = hike.route[0] ?? { lat: 43.1575, lng: 77.0587 }; // Medeu
  const out: LocationSample[] = [];
  const from = demoStartedAt(hike, now);
  const minutes = Math.max(1, Math.floor((now - from) / MIN));
  const lastMinute = state.scenario === 'GPS_LOST' ? Math.max(0, minutes - 40) : minutes;
  for (let m = 0; m <= lastMinute; m++) {
    const resting = state.scenario === 'RESTING' && m > lastMinute - 90;
    const step = resting ? lastMinute - 90 : m;
    out.push({
      lat: start.lat - step * 0.00005,
      lng: start.lng,
      timestamp: from + m * MIN,
      accuracy: 8,
    });
  }
  return out;
}

function buildStatus(hike: Hike): LiveStatus {
  // OFFLINE = the typical mountain case: no network AND late, so an alert
  // exists but can only be queued on the phone (a queue is not a rescue).
  const now = demoNow(hike);
  const samples = fakeSamples(hike, now);
  const evaluation = evaluateRisk({
    now,
    hike: { ...hike, startedAt: demoStartedAt(hike, now) },
    samples,
    batteryLevel: state.scenario === 'LOW_BATTERY' ? 0.08 : 0.76,
    sosActive: state.sos.has(hike.id),
  });

  let incident = applyEvaluation(hike, state.incidents.get(hike.id) ?? null, evaluation, () => id('inc'));
  if (incident) {
    incident = advanceDelivery(incident, state.scenario === 'OFFLINE' ? 'QUEUED_OFFLINE' : 'SENT_TO_SERVER');
    state.incidents.set(hike.id, incident);
    persist();
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
    persist();
    return state.session;
  },

  async signOut() {
    await delay(100);
    state.session = null;
    persist();
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
    persist();
    return contact;
  },

  async removeContact(contactId) {
    requireSession();
    await delay();
    state.contacts = state.contacts.filter((c) => c.id !== contactId);
    persist();
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
    persist();
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
    persist();
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
    persist();
    const status = buildStatus(hike);
    notify(hikeId);
    return status.incident!;
  },
};

/** Development-only helpers for the mock. Not part of the real API. */
export const mockControls = {
  setScenario(s: MockScenario) {
    state.scenario = s;
    persist();
    state.hikes.filter((h) => h.status === 'ACTIVE').forEach((h) => notify(h.id));
  },
  get scenario() {
    return state.scenario;
  },
  /** "Reset demo": wipes ALL demo data, in memory and in storage (pilot logs are separate). */
  reset() {
    state.session = null;
    state.contacts = [];
    state.hikes = [];
    state.incidents.clear();
    state.sos.clear();
    state.scenario = 'WALKING';
    removeKey(STORAGE_KEY);
  },
  /** Tests only: forget memory and load again from storage, like a page reload (F5). */
  reloadFromStorage() {
    hydrate();
  },
};
