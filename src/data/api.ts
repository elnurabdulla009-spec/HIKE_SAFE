// ─────────────────────────────────────────────────────────────────────────────
// HIKE SAFE — the contract between frontend (screens) and backend (data layer).
//
// Frontend: call ONLY these functions. Never import supabase or SQLite in a screen.
// Backend:  implement this interface for real (Supabase + SQLite + sync queue).
//
// Changing this file changes the agreement: discuss it with your teammate first,
// and change it in a Pull Request that both of you review.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hike, Incident, LatLng, RiskEvaluation } from '../domain/types.ts';

export interface Session {
  userId: string;
  email: string;
  displayName: string | null;
}

export interface TrustedContact {
  id: string;
  name: string;
  /** E.164 format, e.g. "+77011234567". */
  phone: string | null;
  /** True once the contact has started the HIKE SAFE Telegram bot. */
  telegramConnected: boolean;
}

export interface NewContact {
  name: string;
  phone: string;
}

export interface HikePlan {
  destination: string;
  /** Optional planned route; empty array = no route. */
  route: LatLng[];
  /** Epoch ms. Must be in the future. */
  plannedReturnAt: number;
}

export type NetworkState = 'ONLINE' | 'OFFLINE';

/** Everything the live hike screen needs, in one object. */
export interface LiveStatus {
  hike: Hike;
  evaluation: RiskEvaluation;
  incident: Incident | null;
  network: NetworkState;
  /** Events stored on the phone, not yet on the server. */
  queuedEvents: number;
  /** Epoch ms of the last usable GPS fix, or null. */
  lastFixAt: number | null;
}

/** Errors the UI should show to the user. Anything else = unexpected bug. */
export type ApiErrorCode =
  | 'NOT_SIGNED_IN'
  | 'INVALID_CODE'
  | 'INVALID_INPUT'
  | 'HIKE_ALREADY_ACTIVE'
  | 'NO_CONTACT'
  | 'NOT_FOUND'
  | 'LOCATION_PERMISSION_DENIED';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

export interface HikeSafeApi {
  // ── Sign-in (email + 6-digit code; no passwords to leak) ──
  getSession(): Promise<Session | null>;
  requestSignInCode(email: string): Promise<void>;
  verifySignInCode(email: string, code: string): Promise<Session>;
  signOut(): Promise<void>;

  // ── Trusted contacts ──
  listContacts(): Promise<TrustedContact[]>;
  /** Throws INVALID_INPUT if the phone is not E.164. */
  addContact(input: NewContact): Promise<TrustedContact>;
  removeContact(id: string): Promise<void>;

  // ── Hikes ──
  getActiveHike(): Promise<Hike | null>;
  /**
   * Saves the plan locally, starts GPS tracking, syncs when online.
   * Throws NO_CONTACT (no trusted contact yet), HIKE_ALREADY_ACTIVE,
   * INVALID_INPUT (return time in the past), LOCATION_PERMISSION_DENIED.
   */
  startHike(plan: HikePlan): Promise<Hike>;
  /** "I'm back safe." Stops tracking, closes the hike and any open incident. */
  finishHike(hikeId: string): Promise<void>;
  listPastHikes(): Promise<Hike[]>;

  // ── Live hike ──
  getLiveStatus(hikeId: string): Promise<LiveStatus>;
  /** Calls `onChange` whenever the status changes. Returns an unsubscribe function. */
  subscribeLiveStatus(hikeId: string, onChange: (s: LiveStatus) => void): () => void;
  /** Manual SOS. The UI must ask for confirmation BEFORE calling this. */
  sendSos(hikeId: string): Promise<Incident>;
}
