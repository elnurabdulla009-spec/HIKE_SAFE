// Local (on-device) SQLite schema. Versioned with PRAGMA user_version:
// add a new entry to MIGRATIONS, never edit an old one (phones already ran it).
import type { SqlDb } from './sqlDb.ts';

const MIGRATIONS: string[] = [
  // v1 — GPS points recorded on the phone + small key/value state for the background task.
  `
  CREATE TABLE IF NOT EXISTS location_points (
    id          TEXT PRIMARY KEY,      -- uuidv4 on device; the same id goes to Supabase later
    hike_id     TEXT NOT NULL,
    recorded_at INTEGER NOT NULL,      -- epoch ms
    lat         REAL NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lng         REAL NOT NULL CHECK (lng BETWEEN -180 AND 180),
    accuracy_m  REAL CHECK (accuracy_m >= 0),
    synced_at   INTEGER                -- NULL = not on the server yet (sync stage)
  );
  -- The OS may deliver the same batch twice: one fix per hike per millisecond.
  CREATE UNIQUE INDEX IF NOT EXISTS lp_hike_time ON location_points (hike_id, recorded_at);
  CREATE TABLE IF NOT EXISTS tracking_state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export async function migrate(db: SqlDb): Promise<void> {
  // WAL lets the background task write while the screen reads.
  await db.execAsync('PRAGMA journal_mode = WAL;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
  const current = row?.user_version ?? 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    // Each step and its version bump commit together, so a crash cannot half-apply it.
    await db.execAsync(`BEGIN; ${MIGRATIONS[v]} PRAGMA user_version = ${v + 1}; COMMIT;`);
  }
}
