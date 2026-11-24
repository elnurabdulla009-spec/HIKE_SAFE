// Where GPS fixes go first. LOCAL FIRST: there is no network in the mountains, so a fix
// is stored on the phone before anything else happens to it.
// Stage 3b (sync) will read rows WHERE synced_at IS NULL and upload them with the same ids.
import { uuidv4 } from '../../lib/uuid.ts';
import type { LocationSample } from '../../domain/types.ts';
import type { SqlDb } from './sqlDb.ts';

export interface PointSink {
  /** Stores fixes for a hike. Returns how many rows were actually new. */
  add(hikeId: string, samples: LocationSample[]): Promise<number>;
  /** Fixes recorded at or after `sinceMs`, oldest first. */
  recent(hikeId: string, sinceMs: number): Promise<LocationSample[]>;
  /** Fixes that are on the phone but not on the server yet. */
  unsyncedCount(hikeId: string): Promise<number>;
}

/** Rows per INSERT (6 params each; far below SQLite's bound-parameter limit). */
const CHUNK = 100;

interface PointRow {
  recorded_at: number;
  lat: number;
  lng: number;
  accuracy_m: number | null;
}

export function createSqlitePointSink(db: SqlDb, newId: () => string = uuidv4): PointSink {
  return {
    async add(hikeId, samples) {
      let inserted = 0;
      // One multi-row INSERT per chunk. A single statement is atomic in SQLite, so we need
      // no manual BEGIN/COMMIT (which would clash when the task and a screen write at once).
      // ON CONFLICT DO NOTHING + UNIQUE(hike_id, recorded_at) makes a re-delivered batch
      // harmless. NOT "INSERT OR IGNORE": that would also silently drop rows failing a CHECK.
      for (let i = 0; i < samples.length; i += CHUNK) {
        const chunk = samples.slice(i, i + CHUNK);
        const params = chunk.flatMap((s) => [newId(), hikeId, s.timestamp, s.lat, s.lng, s.accuracy]);
        const r = await db.runAsync(
          `INSERT INTO location_points (id, hike_id, recorded_at, lat, lng, accuracy_m) VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')} ON CONFLICT DO NOTHING`,
          params,
        );
        inserted += r.changes;
      }
      return inserted;
    },

    async recent(hikeId, sinceMs) {
      const rows = await db.getAllAsync<PointRow>(
        'SELECT recorded_at, lat, lng, accuracy_m FROM location_points WHERE hike_id = ? AND recorded_at >= ? ORDER BY recorded_at ASC LIMIT 2000',
        [hikeId, sinceMs],
      );
      return rows.map((r) => ({ lat: r.lat, lng: r.lng, timestamp: r.recorded_at, accuracy: r.accuracy_m }));
    },

    async unsyncedCount(hikeId) {
      const row = await db.getFirstAsync<{ n: number }>(
        'SELECT COUNT(*) AS n FROM location_points WHERE hike_id = ? AND synced_at IS NULL',
        [hikeId],
      );
      return row?.n ?? 0;
    },
  };
}
