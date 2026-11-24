/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import type { LocationSample } from '../../domain/types.ts';
import { createSqlitePointSink } from './pointSink.ts';
import { migrate, SCHEMA_VERSION } from './schema.ts';
import type { SqlDb, SqlValue } from './sqlDb.ts';
import { clearTrackedHikeId, getTrackedHikeId, setTrackedHikeId } from './trackingState.ts';

/** Runs our SQL on Node's real SQLite engine, behind the same interface as expo-sqlite. */
function nodeDb(): SqlDb & { raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  return {
    raw,
    async execAsync(sql) { raw.exec(sql); },
    async runAsync(sql, params: SqlValue[]) {
      const r = raw.prepare(sql).run(...params);
      return { changes: Number(r.changes) };
    },
    async getAllAsync<T>(sql: string, params: SqlValue[]) {
      return raw.prepare(sql).all(...params) as T[];
    },
    async getFirstAsync<T>(sql: string, params: SqlValue[]) {
      return (raw.prepare(sql).get(...params) as T | undefined) ?? null;
    },
  };
}

async function setup() {
  const db = nodeDb();
  await migrate(db);
  return { db, sink: createSqlitePointSink(db) };
}

const T0 = Date.UTC(2026, 10, 24, 8, 0);
const fix = (min: number, accuracy: number | null = 8): LocationSample => ({
  lat: 43.1575 + min * 0.0001,
  lng: 77.0587,
  timestamp: T0 + min * 60_000,
  accuracy,
});

describe('local SQLite point sink', () => {
  it('migrates to the latest version, and running it again is harmless', async () => {
    const { db } = await setup();
    await migrate(db);
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
    assert.equal(row?.user_version, SCHEMA_VERSION);
  });

  it('stores fixes and reads them back oldest first, exactly as given', async () => {
    const { sink } = await setup();
    assert.equal(await sink.add('h1', [fix(2), fix(0, null), fix(1, 120)]), 3);
    assert.deepEqual(await sink.recent('h1', T0), [fix(0, null), fix(1, 120), fix(2)]);
  });

  it('recent() respects the time window', async () => {
    const { sink } = await setup();
    await sink.add('h1', [fix(0), fix(10), fix(20)]);
    assert.deepEqual((await sink.recent('h1', T0 + 10 * 60_000)).map((s) => s.timestamp), [fix(10).timestamp, fix(20).timestamp]);
  });

  it('a re-delivered batch does not create duplicates', async () => {
    const { sink } = await setup();
    await sink.add('h1', [fix(0), fix(1)]);
    assert.equal(await sink.add('h1', [fix(1), fix(2)]), 1);
    assert.equal((await sink.recent('h1', 0)).length, 3);
  });

  it('keeps hikes apart', async () => {
    const { sink } = await setup();
    await sink.add('h1', [fix(0)]);
    await sink.add('h2', [fix(0), fix(1)]);
    assert.equal((await sink.recent('h1', 0)).length, 1);
    assert.equal(await sink.unsyncedCount('h2'), 2);
  });

  it('counts only points not yet on the server', async () => {
    const { db, sink } = await setup();
    await sink.add('h1', [fix(0), fix(1), fix(2)]);
    db.raw.exec(`UPDATE location_points SET synced_at = ${T0} WHERE recorded_at = ${fix(0).timestamp}`);
    assert.equal(await sink.unsyncedCount('h1'), 2);
  });

  it('handles big batches (more than one INSERT chunk) and empty ones', async () => {
    const { sink } = await setup();
    assert.equal(await sink.add('h1', []), 0);
    assert.equal(await sink.add('h1', Array.from({ length: 250 }, (_, i) => fix(i))), 250);
  });

  it('the database rejects impossible coordinates', async () => {
    const { sink } = await setup();
    await assert.rejects(sink.add('h1', [{ ...fix(0), lat: 95 }]));
  });
});

describe('tracking state', () => {
  it('remembers, replaces and clears the tracked hike', async () => {
    const { db } = await setup();
    assert.equal(await getTrackedHikeId(db), null);
    await setTrackedHikeId(db, 'h1');
    await setTrackedHikeId(db, 'h2');
    assert.equal(await getTrackedHikeId(db), 'h2');
    await clearTrackedHikeId(db);
    assert.equal(await getTrackedHikeId(db), null);
  });
});
