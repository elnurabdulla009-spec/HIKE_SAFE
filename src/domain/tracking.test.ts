/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluateRisk, THRESHOLDS } from './risk.ts';
import { fromDeviceLocation, sanitizeSamples, TRACKING } from './tracking.ts';
import type { Hike, LocationSample } from './types.ts';

const MIN = 60_000;
const NOW = Date.UTC(2026, 10, 24, 12, 0);
const fix = (minutesAgo: number, extra: Partial<LocationSample> = {}): LocationSample => ({
  lat: 43.1575,
  lng: 77.0587,
  timestamp: NOW - minutesAgo * MIN,
  accuracy: 8,
  ...extra,
});

describe('tracking', () => {
  it('fix interval stays well below the GPS stale threshold', () => {
    assert.ok(TRACKING.timeIntervalMs * 3 <= THRESHOLDS.gpsStaleMs);
  });

  it('maps an Expo location to a LocationSample', () => {
    const s = fromDeviceLocation({ timestamp: NOW, coords: { latitude: 43.1, longitude: 77.2, accuracy: 12 } });
    assert.deepEqual(s, { lat: 43.1, lng: 77.2, timestamp: NOW, accuracy: 12 });
  });

  it('drops impossible fixes: NaN, out of range, future, zero time', () => {
    const out = sanitizeSamples(
      [
        fix(1),
        fix(2, { lat: Number.NaN }),
        fix(3, { lat: 91 }),
        fix(4, { lng: -181 }),
        fix(-5), // 5 minutes in the future
        { ...fix(0), timestamp: 0 },
      ],
      NOW,
    );
    assert.deepEqual(out, [fix(1)]);
  });

  it('RULE 01: inaccurate fixes are kept (risk.ts filters them), never invented', () => {
    const out = sanitizeSamples([fix(1, { accuracy: 500 }), fix(2, { accuracy: null })], NOW);
    assert.equal(out.length, 2);
    assert.deepEqual(out.map((s) => s.accuracy), [null, 500]);
  });

  it('invalid accuracy becomes null instead of a fake value', () => {
    const [s] = sanitizeSamples([fix(1, { accuracy: -3 })], NOW);
    assert.equal(s.accuracy, null);
  });

  it('removes duplicate timestamps and sorts by time', () => {
    const out = sanitizeSamples([fix(1), fix(3), fix(1, { lat: 43.2 }), fix(2)], NOW);
    assert.deepEqual(out.map((s) => s.timestamp), [fix(3).timestamp, fix(2).timestamp, fix(1).timestamp]);
    assert.equal(out[2].lat, 43.1575); // first one wins
  });

  it('a fix every TRACKING interval keeps GPS FRESH for a hiker who walks', () => {
    const hike: Hike = {
      id: 'h', destination: 'Kok-Zhailau', route: [],
      startedAt: NOW - 60 * MIN, plannedReturnAt: NOW + 120 * MIN, status: 'ACTIVE',
    };
    const step = TRACKING.timeIntervalMs / MIN;
    const samples = Array.from({ length: 60 / step }, (_, i) => fix(i * step, { lat: 43.1575 + i * 0.001 }));
    const ev = evaluateRisk({ now: NOW + 5 * MIN, hike, samples: sanitizeSamples(samples, NOW), batteryLevel: null, sosActive: false });
    assert.equal(ev.gps, 'FRESH');
    assert.equal(ev.movement, 'MOVING');
  });
});
