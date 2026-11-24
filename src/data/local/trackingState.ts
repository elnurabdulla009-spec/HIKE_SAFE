// Which hike the background task is recording for.
// The task wakes up in a fresh JS context (screen off, app in background), so it cannot
// read React state: it learns the hike id from disk. No id stored = do not record.
import type { SqlDb } from './sqlDb.ts';

const KEY = 'tracked_hike_id';

export async function getTrackedHikeId(db: SqlDb): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM tracking_state WHERE key = ?', [KEY]);
  return row?.value ?? null;
}

export async function setTrackedHikeId(db: SqlDb, hikeId: string): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO tracking_state (key, value) VALUES (?, ?)', [KEY, hikeId]);
}

export async function clearTrackedHikeId(db: SqlDb): Promise<void> {
  await db.runAsync('DELETE FROM tracking_state WHERE key = ?', [KEY]);
}
