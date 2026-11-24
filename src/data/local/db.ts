// Opens the on-device database once (lazy) and runs migrations.
// Used by both the background task and the real API, so both see the same data.
import { openDatabaseAsync } from 'expo-sqlite';
import { createSqlitePointSink, type PointSink } from './pointSink.ts';
import { migrate } from './schema.ts';
import type { SqlDb } from './sqlDb.ts';

const DB_NAME = 'hikesafe.db';

let opening: Promise<SqlDb> | null = null;

export function getLocalDb(): Promise<SqlDb> {
  if (!opening) {
    opening = (async () => {
      const db = await openDatabaseAsync(DB_NAME);
      await migrate(db);
      return db;
    })();
    // If opening fails, allow the next call to try again instead of caching the error.
    opening.catch(() => { opening = null; });
  }
  return opening;
}

export async function getPointSink(): Promise<PointSink> {
  return createSqlitePointSink(await getLocalDb());
}
