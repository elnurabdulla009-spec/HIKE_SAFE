// ─────────────────────────────────────────────────────────────────────────────
// Real backend: Supabase (Auth + Postgres with Row Level Security).
//
// Stage 2 scope: sign-in, contacts, hikes, live status from server data, SOS.
// Stage 3 will add: background GPS → local SQLite → offline sync queue,
//                   so getLiveStatus will read local data and work offline.
//
// Security notes:
// - The anon/publishable key is public by design; RLS decides which rows a user sees.
// - The device never sets `contact_notified_at`; a DB trigger enforces this.
// ─────────────────────────────────────────────────────────────────────────────
import * as Crypto from 'expo-crypto';
import { applyEvaluation } from '../domain/incident.ts';
import { evaluateRisk } from '../domain/risk.ts';
import type {
  Hike,
  HikeStatus,
  Incident,
  LatLng,
  LocationSample,
  RiskLevel,
  RiskReason,
} from '../domain/types.ts';
import { getSupabase } from '../lib/supabase.ts';
import {
  ApiError,
  type HikePlan,
  type HikeSafeApi,
  type LiveStatus,
  type NewContact,
  type Session,
  type TrustedContact,
} from './api.ts';

const E164 = /^\+[1-9]\d{7,14}$/;
const EMAIL = /^\S+@\S+\.\S+$/;
const POLL_MS = 15_000;
const SAMPLE_WINDOW_MS = 6 * 60 * 60_000; // last 6 hours of GPS is enough for the engine

// ── Row shapes (what Postgres returns) ──────────────────────────────────────
interface HikeRow {
  id: string;
  destination: string;
  route: LatLng[] | null;
  started_at: string;
  planned_return_at: string;
  status: HikeStatus;
}
interface PointRow {
  recorded_at: string;
  lat: number;
  lng: number;
  accuracy_m: number | null;
}
interface IncidentRow {
  id: string;
  hike_id: string;
  status: 'OPEN' | 'RESOLVED';
  opened_at: string;
  updated_at: string;
  resolved_at: string | null;
  peak_level: RiskLevel;
  peak_score: number;
  reasons: RiskReason[];
  contact_notified_at: string | null;
}
interface ContactRow {
  id: string;
  name: string;
  phone: string | null;
  telegram_chat_id: number | null;
}

// ── Mappers ─────────────────────────────────────────────────────────────────
const toHike = (r: HikeRow): Hike => ({
  id: r.id,
  destination: r.destination,
  route: r.route ?? [],
  startedAt: Date.parse(r.started_at),
  plannedReturnAt: Date.parse(r.planned_return_at),
  status: r.status,
});

const toSample = (r: PointRow): LocationSample => ({
  lat: r.lat,
  lng: r.lng,
  timestamp: Date.parse(r.recorded_at),
  accuracy: r.accuracy_m,
});

const toIncident = (r: IncidentRow): Incident => ({
  id: r.id,
  hikeId: r.hike_id,
  status: r.status,
  openedAt: Date.parse(r.opened_at),
  updatedAt: Date.parse(r.updated_at),
  resolvedAt: r.resolved_at ? Date.parse(r.resolved_at) : null,
  peakLevel: r.peak_level,
  peakScore: r.peak_score,
  reasons: r.reasons ?? [],
  // The row exists on the server, so it is at least SENT_TO_SERVER.
  // Only the server can mark the contact as notified.
  delivery: r.contact_notified_at ? 'CONTACT_NOTIFIED' : 'SENT_TO_SERVER',
});

const toContact = (r: ContactRow): TrustedContact => ({
  id: r.id,
  name: r.name,
  phone: r.phone,
  telegramConnected: r.telegram_chat_id !== null,
});

/** Turns a Supabase/PostgREST error into an exception. Never leaks raw details to the UI. */
function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what} failed: ${result.error.message}`);
  return result.data;
}

// ── Implementation ──────────────────────────────────────────────────────────
export function createRealApi(): HikeSafeApi {
  const db = () => getSupabase();

  async function requireUserId(): Promise<string> {
    const { data } = await db().auth.getSession();
    const id = data.session?.user.id;
    if (!id) throw new ApiError('NOT_SIGNED_IN', 'Please sign in first.');
    return id;
  }

  async function fetchHike(hikeId: string): Promise<Hike> {
    const row = check(
      await db().from('hikes').select('id, destination, route, started_at, planned_return_at, status').eq('id', hikeId).maybeSingle(),
      'Load hike',
    ) as HikeRow | null;
    if (!row) throw new ApiError('NOT_FOUND', 'Hike not found.');
    return toHike(row);
  }

  async function fetchIncident(hikeId: string): Promise<IncidentRow | null> {
    return check(
      await db()
        .from('incidents')
        .select('id, hike_id, status, opened_at, updated_at, resolved_at, peak_level, peak_score, reasons, contact_notified_at')
        .eq('hike_id', hikeId)
        .maybeSingle(),
      'Load incident',
    ) as IncidentRow | null;
  }

  async function fetchSamples(hikeId: string, now: number): Promise<LocationSample[]> {
    const rows = check(
      await db()
        .from('location_points')
        .select('recorded_at, lat, lng, accuracy_m')
        .eq('hike_id', hikeId)
        .gte('recorded_at', new Date(now - SAMPLE_WINDOW_MS).toISOString())
        .order('recorded_at', { ascending: true })
        .limit(1000),
      'Load GPS points',
    ) as PointRow[];
    return rows.map(toSample);
  }

  async function getActiveHike(): Promise<Hike | null> {
    await requireUserId();
    const row = check(
      await db()
        .from('hikes')
        .select('id, destination, route, started_at, planned_return_at, status')
        .eq('status', 'ACTIVE')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      'Load active hike',
    ) as HikeRow | null;
    return row ? toHike(row) : null;
  }

  /** Evaluates risk and writes the (single) incident back if it was created or changed. */
  async function syncStatus(hikeId: string, opts: { sos?: boolean } = {}): Promise<LiveStatus> {
    const userId = await requireUserId();
    const now = Date.now();
    const hike = await fetchHike(hikeId);
    const [samples, currentRow] = await Promise.all([fetchSamples(hikeId, now), fetchIncident(hikeId)]);
    const current = currentRow ? toIncident(currentRow) : null;

    const sosActive = opts.sos === true || (current?.status === 'OPEN' && current.reasons.includes('MANUAL_SOS'));
    const evaluation = evaluateRisk({ now, hike, samples, batteryLevel: null, sosActive });
    const next = applyEvaluation(hike, current, evaluation, () => Crypto.randomUUID());

    let incident = current;
    if (next && !current) {
      // RULE 02 is also enforced by UNIQUE(hike_id): if the server opened one first, we read it back.
      const inserted = await db()
        .from('incidents')
        .insert({
          id: next.id,
          hike_id: hike.id,
          user_id: userId,
          source: 'DEVICE',
          peak_level: next.peakLevel,
          peak_score: next.peakScore,
          reasons: next.reasons,
        })
        .select('id, hike_id, status, opened_at, updated_at, resolved_at, peak_level, peak_score, reasons, contact_notified_at')
        .maybeSingle();
      const row = inserted.error ? await fetchIncident(hikeId) : (inserted.data as IncidentRow | null);
      incident = row ? toIncident(row) : null;
    } else if (next && current && next.status === 'OPEN' &&
               (next.peakScore !== current.peakScore || next.reasons.length !== current.reasons.length)) {
      const updated = check(
        await db()
          .from('incidents')
          .update({ peak_level: next.peakLevel, peak_score: next.peakScore, reasons: next.reasons })
          .eq('id', current.id)
          .select('id, hike_id, status, opened_at, updated_at, resolved_at, peak_level, peak_score, reasons, contact_notified_at')
          .maybeSingle(),
        'Update incident',
      ) as IncidentRow | null;
      incident = updated ? toIncident(updated) : current;
    }

    return {
      hike,
      evaluation,
      incident,
      network: 'ONLINE', // stage 3: real connectivity detection + offline queue
      queuedEvents: 0,
      lastFixAt: samples.at(-1)?.timestamp ?? null,
    };
  }

  return {
    // ── Sign-in ──
    async getSession(): Promise<Session | null> {
      const { data } = await db().auth.getSession();
      const user = data.session?.user;
      return user ? { userId: user.id, email: user.email ?? '', displayName: null } : null;
    },

    async requestSignInCode(email) {
      const clean = email.trim().toLowerCase();
      if (!EMAIL.test(clean)) throw new ApiError('INVALID_INPUT', 'Enter a valid email.');
      const { error } = await db().auth.signInWithOtp({ email: clean, options: { shouldCreateUser: true } });
      if (error) throw new ApiError('INVALID_INPUT', 'Could not send the code. Try again in a minute.');
    },

    async verifySignInCode(email, code) {
      const { data, error } = await db().auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: code.trim(),
        type: 'email',
      });
      if (error || !data.user) throw new ApiError('INVALID_CODE', 'Wrong or expired code.');
      return { userId: data.user.id, email: data.user.email ?? email, displayName: null };
    },

    async signOut() {
      await db().auth.signOut();
    },

    // ── Contacts ──
    async listContacts() {
      await requireUserId();
      const rows = check(
        await db().from('trusted_contacts').select('id, name, phone, telegram_chat_id').order('created_at'),
        'Load contacts',
      ) as ContactRow[];
      return rows.map(toContact);
    },

    async addContact(input: NewContact) {
      const userId = await requireUserId();
      const name = input.name.trim();
      if (!name) throw new ApiError('INVALID_INPUT', 'Name is required.');
      if (!E164.test(input.phone)) throw new ApiError('INVALID_INPUT', 'Phone must look like +77011234567.');
      const row = check(
        await db()
          .from('trusted_contacts')
          .insert({ user_id: userId, name, phone: input.phone })
          .select('id, name, phone, telegram_chat_id')
          .single(),
        'Add contact',
      ) as ContactRow;
      return toContact(row);
    },

    async removeContact(contactId) {
      await requireUserId();
      check(await db().from('trusted_contacts').delete().eq('id', contactId), 'Remove contact');
    },

    // ── Hikes ──
    getActiveHike,

    async startHike(plan: HikePlan) {
      const userId = await requireUserId();
      const destination = plan.destination.trim();
      if (!destination) throw new ApiError('INVALID_INPUT', 'Destination is required.');
      if (plan.plannedReturnAt <= Date.now()) throw new ApiError('INVALID_INPUT', 'Return time must be in the future.');

      const { count } = await db().from('trusted_contacts').select('id', { count: 'exact', head: true });
      if (!count) throw new ApiError('NO_CONTACT', 'Add a trusted contact first.');
      if (await getActiveHike()) throw new ApiError('HIKE_ALREADY_ACTIVE', 'Finish your current hike first.');

      const row = check(
        await db()
          .from('hikes')
          .insert({
            id: Crypto.randomUUID(), // generated on the device: safe to retry offline later (stage 3)
            user_id: userId,
            destination,
            route: plan.route,
            started_at: new Date().toISOString(),
            planned_return_at: new Date(plan.plannedReturnAt).toISOString(),
            status: 'ACTIVE',
          })
          .select('id, destination, route, started_at, planned_return_at, status')
          .single(),
        'Start hike',
      ) as HikeRow;
      return toHike(row);
    },

    async finishHike(hikeId) {
      await requireUserId();
      const now = new Date().toISOString();
      check(
        await db().from('hikes').update({ status: 'COMPLETED', completed_at: now }).eq('id', hikeId).eq('status', 'ACTIVE'),
        'Finish hike',
      );
      // RULE 03: close the incident too. A resolved incident can never re-open (DB trigger).
      check(
        await db().from('incidents').update({ status: 'RESOLVED', resolved_at: now }).eq('hike_id', hikeId).eq('status', 'OPEN'),
        'Resolve incident',
      );
    },

    async listPastHikes() {
      await requireUserId();
      const rows = check(
        await db()
          .from('hikes')
          .select('id, destination, route, started_at, planned_return_at, status')
          .in('status', ['COMPLETED', 'CANCELLED'])
          .order('started_at', { ascending: false })
          .limit(50),
        'Load past hikes',
      ) as HikeRow[];
      return rows.map(toHike);
    },

    // ── Live hike ──
    getLiveStatus(hikeId) {
      return syncStatus(hikeId);
    },

    subscribeLiveStatus(hikeId, onChange) {
      let stopped = false;
      const tick = () =>
        syncStatus(hikeId)
          .then((s) => { if (!stopped) onChange(s); })
          .catch(() => { /* keep polling; the screen shows the last known status */ });
      tick();
      const timer = setInterval(tick, POLL_MS);
      return () => {
        stopped = true;
        clearInterval(timer);
      };
    },

    async sendSos(hikeId) {
      const hike = await fetchHike(hikeId);
      if (hike.status !== 'ACTIVE') throw new ApiError('NOT_FOUND', 'This hike is already closed.');
      const status = await syncStatus(hikeId, { sos: true });
      if (!status.incident) throw new Error('SOS could not be recorded.');
      return status.incident;
    },
  };
}
