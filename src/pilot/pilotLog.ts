// Pilot study logger: evidence for the classroom pilot (~10 hikers + contacts).
// Pure TypeScript (no React) so it is unit-tested.
//
// PRIVACY: logs store a participant CODE only (e.g. "P01"). Never emails, names,
// phone numbers or destinations. Free text goes through scrubDetail().
// Logs survive a reload (same storage as the mock) and are NOT cleared by "Reset demo".
import { loadJson, saveJson } from '../lib/kvStore.ts';

export type TaskId = 'A' | 'B' | 'C';
export const TASKS: Record<TaskId, string> = {
  A: 'Plan a hike',
  B: 'Read live states',
  C: 'Contact reads alert',
};

export type PilotEventType =
  | 'SESSION_START' | 'SESSION_END'
  | 'SCREEN'
  | 'TASK_START' | 'TASK_END'
  | 'ERROR'
  | 'SOS_OPEN' | 'SOS_CONFIRM' | 'SOS_CANCEL'
  | 'SCENARIO'
  | 'BACK_SAFE'
  | 'PREVIEW_OPEN';

export interface PilotEvent {
  t: number; // epoch ms
  type: PilotEventType;
  task?: TaskId;
  detail?: string;
}

export interface PilotSession {
  id: string;
  participant: string;
  startedAt: number;
  endedAt: number | null;
  events: PilotEvent[];
}

export interface PilotState {
  v: 1;
  /** Observer setting: show the "simulate a situation" panel on app screens. */
  showDemoPanel: boolean;
  activeSessionId: string | null;
  sessions: PilotSession[];
}

const STORAGE_KEY = 'hikesafe.pilot.v1';
const empty = (): PilotState => ({ v: 1, showDemoPanel: false, activeSessionId: null, sessions: [] });

// ── privacy helpers ──────────────────────────────────────────────────────────
const CODE = /^[A-Z]{1,3}\d{1,4}$/;

/** "p01" → "P01". Returns null for anything that is not a short code (names, emails, phones). */
export function normalizeParticipantCode(input: string): string | null {
  const code = input.trim().toUpperCase();
  return CODE.test(code) ? code : null;
}

/** Removes emails and phone-like numbers, keeps it short. */
export function scrubDetail(text: string): string {
  return text
    .replace(/[^\s@]+@[^\s@]+/g, '[email]')
    .replace(/\+?\d[\d\s()-]{6,}\d/g, '[number]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

// ── state + storage ─────────────────────────────────────────────────────────
const TYPES: PilotEventType[] = ['SESSION_START', 'SESSION_END', 'SCREEN', 'TASK_START', 'TASK_END', 'ERROR',
  'SOS_OPEN', 'SOS_CONFIRM', 'SOS_CANCEL', 'SCENARIO', 'BACK_SAFE', 'PREVIEW_OPEN'];

function validate(raw: unknown): PilotState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || typeof r.showDemoPanel !== 'boolean' || !Array.isArray(r.sessions)) return null;
  if (r.activeSessionId !== null && typeof r.activeSessionId !== 'string') return null;
  const ok = r.sessions.every((s) => typeof s === 'object' && s !== null
    && typeof (s as PilotSession).id === 'string'
    && normalizeParticipantCode(String((s as PilotSession).participant)) === (s as PilotSession).participant
    && Array.isArray((s as PilotSession).events)
    && (s as PilotSession).events.every((e) => typeof e?.t === 'number' && TYPES.includes(e.type)));
  return ok ? (raw as PilotState) : null;
}

let state: PilotState = loadJson(STORAGE_KEY, validate) ?? empty();
const listeners = new Set<() => void>();

function commit(next: PilotState) {
  state = next;
  saveJson(STORAGE_KEY, state);
  listeners.forEach((fn) => fn());
}

export function getPilotState(): PilotState {
  return state;
}

export function subscribePilot(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Tests only: load again from storage, like a page reload. */
export function reloadPilotFromStorage(): void {
  state = loadJson(STORAGE_KEY, validate) ?? empty();
}

export function activeSession(s: PilotState = state): PilotSession | null {
  return s.sessions.find((x) => x.id === s.activeSessionId) ?? null;
}

function updateActive(fn: (s: PilotSession) => PilotSession) {
  const active = activeSession();
  if (!active) return;
  commit({ ...state, sessions: state.sessions.map((s) => (s.id === active.id ? fn(s) : s)) });
}

// ── observer actions ────────────────────────────────────────────────────────
export function setShowDemoPanel(show: boolean): void {
  commit({ ...state, showDemoPanel: show });
}

/** Throws if the code is not a short participant code like P01. */
export function startSession(participantInput: string, now = Date.now()): PilotSession {
  const participant = normalizeParticipantCode(participantInput);
  if (!participant) throw new Error('Use a participant code like P01 (letters + digits, no names).');
  if (activeSession()) endSession(now);
  const session: PilotSession = {
    id: `${participant}-${now.toString(36)}`,
    participant,
    startedAt: now,
    endedAt: null,
    events: [{ t: now, type: 'SESSION_START' }],
  };
  commit({ ...state, activeSessionId: session.id, sessions: [...state.sessions, session] });
  return session;
}

export function endSession(now = Date.now()): void {
  const active = activeSession();
  if (!active) return;
  const task = currentTask(active);
  const closing: PilotEvent[] = task ? [{ t: now, type: 'TASK_END', task, detail: 'session ended' }] : [];
  updateActive((s) => ({ ...s, endedAt: now, events: [...s.events, ...closing, { t: now, type: 'SESSION_END' }] }));
  commit({ ...state, activeSessionId: null });
}

/** Adds an event to the running session. Does nothing when no session runs. */
export function logPilot(type: PilotEventType, extra: { task?: TaskId; detail?: string } = {}, now = Date.now()): void {
  if (!activeSession()) return;
  const event: PilotEvent = { t: now, type };
  if (extra.task) event.task = extra.task;
  if (extra.detail) event.detail = scrubDetail(extra.detail);
  updateActive((s) => ({ ...s, events: [...s.events, event] }));
}

/** The task that was started and not finished yet, or null. */
export function currentTask(session: PilotSession | null = activeSession()): TaskId | null {
  if (!session) return null;
  let open: TaskId | null = null;
  for (const e of session.events) {
    if (e.type === 'TASK_START' && e.task) open = e.task;
    if (e.type === 'TASK_END' && e.task === open) open = null;
  }
  return open;
}

export function startTask(task: TaskId, now = Date.now()): void {
  const open = currentTask();
  if (open) logPilot('TASK_END', { task: open, detail: 'next task started' }, now);
  logPilot('TASK_START', { task }, now);
}

export function finishTask(now = Date.now()): void {
  const open = currentTask();
  if (open) logPilot('TASK_END', { task: open }, now);
}

/** Called by the app when a task is clearly done (e.g. Task A when a hike starts). */
export function finishTaskIfRunning(task: TaskId, now = Date.now()): void {
  if (currentTask() === task) logPilot('TASK_END', { task, detail: 'auto' }, now);
}

export function clearPilotLogs(): void {
  commit({ ...empty(), showDemoPanel: state.showDemoPanel });
}

// ── analysis + export ───────────────────────────────────────────────────────
export interface TaskResult {
  /** Time from the LAST start to its end, or null if never finished. */
  ms: number | null;
  errors: number;
}

export interface SessionSummary {
  sessionId: string;
  participant: string;
  durationMs: number | null;
  tasks: Record<TaskId, TaskResult>;
  errors: number;
  sosConfirmed: number;
  sosCancelled: number;
}

export function summarize(s: PilotSession): SessionSummary {
  const tasks: Record<TaskId, TaskResult> = { A: { ms: null, errors: 0 }, B: { ms: null, errors: 0 }, C: { ms: null, errors: 0 } };
  let open: { task: TaskId; t: number; errors: number } | null = null;
  for (const e of s.events) {
    if (e.type === 'TASK_START' && e.task) open = { task: e.task, t: e.t, errors: 0 };
    else if (e.type === 'ERROR' && open) open.errors++;
    else if (e.type === 'TASK_END' && open && e.task === open.task) {
      tasks[open.task] = { ms: e.t - open.t, errors: open.errors };
      open = null;
    }
  }
  const count = (type: PilotEventType) => s.events.filter((e) => e.type === type).length;
  return {
    sessionId: s.id,
    participant: s.participant,
    durationMs: s.endedAt === null ? null : s.endedAt - s.startedAt,
    tasks,
    errors: count('ERROR'),
    sosConfirmed: count('SOS_CONFIRM'),
    sosCancelled: count('SOS_CANCEL'),
  };
}

export const CSV_COLUMNS = ['participant', 'session_id', 'event_no', 'time_iso', 'elapsed_s', 'type', 'task', 'detail'] as const;

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One row per event, all sessions. */
export function toCsv(sessions: PilotSession[]): string {
  const rows = [CSV_COLUMNS.join(',')];
  for (const s of sessions) {
    s.events.forEach((e, i) => {
      rows.push([s.participant, s.id, i + 1, new Date(e.t).toISOString(), ((e.t - s.startedAt) / 1000).toFixed(1),
        e.type, e.task ?? '', e.detail ?? ''].map(csvCell).join(','));
    });
  }
  return rows.join('\n') + '\n';
}

export function toJson(sessions: PilotSession[]): string {
  return JSON.stringify({ exportedAt: new Date().toISOString(), sessions, summaries: sessions.map(summarize) }, null, 2);
}
