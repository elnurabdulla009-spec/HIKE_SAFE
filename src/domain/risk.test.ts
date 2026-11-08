/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { advanceDelivery, applyEvaluation, resolveIncident } from './incident.ts';
import { distanceToRouteM, haversineM } from './geo.ts';
import { evaluateRisk } from './risk.ts';
import type { Hike, LocationSample, RiskInput } from './types.ts';

const MIN = 60_000;
const T0 = Date.UTC(2026, 6, 1, 6, 0); // hike start
// Medeu area, Almaty (illustrative coordinates).
const START = { lat: 43.1575, lng: 77.0587 };

const hike = (over: Partial<Hike> = {}): Hike => ({
  id: 'h1',
  destination: 'Medeu',
  route: [START, { lat: 43.1475, lng: 77.0587 }], // ~1.1 km straight south
  startedAt: T0,
  plannedReturnAt: T0 + 240 * MIN,
  status: 'ACTIVE',
  ...over,
});

/** One fix per minute between two minutes, walking south along the route. */
function walk(fromMin: number, toMin: number): LocationSample[] {
  const out: LocationSample[] = [];
  for (let m = fromMin; m <= toMin; m++) {
    out.push({ lat: START.lat - m * 0.00005, lng: START.lng, timestamp: T0 + m * MIN, accuracy: 8 });
  }
  return out;
}
/** Fixes every 2 minutes at one place (small jitter). */
function stay(at: { lat: number; lng: number }, fromMin: number, toMin: number): LocationSample[] {
  const out: LocationSample[] = [];
  for (let m = fromMin; m <= toMin; m += 2) {
    out.push({ lat: at.lat + (m % 4) * 0.00001, lng: at.lng, timestamp: T0 + m * MIN, accuracy: 10 });
  }
  return out;
}

const input = (over: Partial<RiskInput>): RiskInput => ({
  now: T0,
  hike: hike(),
  samples: [],
  batteryLevel: 0.8,
  sosActive: false,
  ...over,
});

describe('geo', () => {
  it('haversine ~111 km per degree of latitude', () => {
    const d = haversineM({ lat: 43, lng: 77 }, { lat: 44, lng: 77 });
    assert.ok(Math.abs(d - 111_195) < 200, String(d));
  });
  it('distance to route is ~0 on the route and grows sideways', () => {
    const route = hike().route;
    assert.ok(distanceToRouteM({ lat: 43.152, lng: 77.0587 }, route)! < 1);
    const side = distanceToRouteM({ lat: 43.152, lng: 77.0587 + 0.01 }, route)!;
    assert.ok(side > 790 && side < 830, String(side)); // 0.01° lng at 43° ≈ 813 m
  });
});

describe('risk engine', () => {
  it('normal walking early in the hike is LOW', () => {
    const r = evaluateRisk(input({ now: T0 + 20 * MIN, samples: walk(0, 20) }));
    assert.equal(r.gps, 'FRESH');
    assert.equal(r.movement, 'MOVING');
    assert.equal(r.level, 'LOW');
    assert.deepEqual(r.reasons, []);
    assert.equal(r.shouldEscalate, false);
  });

  it('a 30-minute rest is STATIONARY but not a risk reason', () => {
    const samples = [...walk(0, 20), ...stay(walk(20, 20)[0], 22, 50)];
    const r = evaluateRisk(input({ now: T0 + 50 * MIN, samples }));
    assert.equal(r.movement, 'STATIONARY');
    assert.ok(r.stationaryMinutes! >= 28);
    assert.ok(!r.reasons.includes('LONG_STATIONARY'));
  });

  it('2 hours in one place with fresh GPS → LONG_STATIONARY', () => {
    const p = walk(20, 20)[0];
    const samples = [...walk(0, 20), ...stay(p, 22, 145)];
    const r = evaluateRisk(input({ now: T0 + 145 * MIN, samples }));
    assert.equal(r.movement, 'STATIONARY');
    assert.ok(r.reasons.includes('LONG_STATIONARY'));
    assert.ok(r.score >= 35);
  });

  it('RULE 01: GPS lost for 2 hours → UNKNOWN, never STATIONARY', () => {
    const r = evaluateRisk(input({ now: T0 + 140 * MIN, samples: walk(0, 20) }));
    assert.equal(r.gps, 'STALE');
    assert.equal(r.movement, 'UNKNOWN');
    assert.equal(r.stationaryMinutes, null);
    assert.ok(r.reasons.includes('GPS_UNKNOWN'));
    assert.ok(!r.reasons.includes('LONG_STATIONARY'));
  });

  it('RULE 01: a gap in fixes breaks the stationary streak', () => {
    const p = walk(20, 20)[0];
    // Fixes at the same place, but a 30-minute hole in the middle.
    const samples = [...stay(p, 20, 40), ...stay(p, 70, 80)];
    const r = evaluateRisk(input({ now: T0 + 80 * MIN, samples }));
    // Only the last 10 min of continuous evidence count — not the full 60 min.
    assert.equal(r.stationaryMinutes, 10);
    assert.ok(!r.reasons.includes('LONG_STATIONARY'));
  });

  it('inaccurate fixes are ignored (no fake movement or stillness)', () => {
    const bad = walk(0, 20).map((s) => ({ ...s, accuracy: 500 }));
    const r = evaluateRisk(input({ now: T0 + 20 * MIN, samples: bad }));
    assert.equal(r.gps, 'NO_FIX');
    assert.equal(r.movement, 'UNKNOWN');
  });

  it('no fix at all, inside the grace period → no GPS reason yet', () => {
    const r = evaluateRisk(input({ now: T0 + 5 * MIN }));
    assert.equal(r.gps, 'NO_FIX');
    assert.deepEqual(r.reasons, []);
  });

  it('return approaching adds a small signal', () => {
    const r = evaluateRisk(input({ now: T0 + 220 * MIN, samples: walk(200, 220) }));
    assert.ok(r.reasons.includes('RETURN_APPROACHING'));
    assert.equal(r.level, 'LOW');
  });

  it('overdue 30+ minutes escalates even when moving normally', () => {
    const r = evaluateRisk(input({ now: T0 + 275 * MIN, samples: walk(255, 275) }));
    assert.equal(r.minutesToReturn, 35);
    assert.ok(r.reasons.includes('RETURN_OVERDUE'));
    assert.equal(r.shouldEscalate, true);
  });

  it('overdue + GPS lost → HIGH and escalates', () => {
    const r = evaluateRisk(input({ now: T0 + 320 * MIN, samples: walk(0, 60) }));
    assert.ok(r.reasons.includes('RETURN_OVERDUE'));
    assert.ok(r.reasons.includes('GPS_UNKNOWN'));
    assert.ok(r.level === 'HIGH' || r.level === 'CRITICAL', r.level);
    assert.equal(r.shouldEscalate, true);
  });

  it('off route: 300 m → deviation, 1 km+ → severe', () => {
    const off = (dLng: number, min: number): LocationSample => ({
      lat: 43.152,
      lng: START.lng + dLng,
      timestamp: T0 + min * MIN,
      accuracy: 10,
    });
    const r1 = evaluateRisk(input({ now: T0 + 30 * MIN, samples: [off(0.005, 29), off(0.0055, 30)] }));
    assert.ok(r1.reasons.includes('ROUTE_DEVIATION'));
    const r2 = evaluateRisk(input({ now: T0 + 30 * MIN, samples: [off(0.02, 30)] }));
    assert.ok(r2.reasons.includes('SEVERE_DEVIATION'));
  });

  it('no planned route → no deviation reasons', () => {
    const r = evaluateRisk(input({ now: T0 + 20 * MIN, hike: hike({ route: [] }), samples: walk(0, 20) }));
    assert.equal(r.routeDistanceM, null);
  });

  it('low battery is a signal', () => {
    const r = evaluateRisk(input({ now: T0 + 20 * MIN, samples: walk(0, 20), batteryLevel: 0.1 }));
    assert.ok(r.reasons.includes('LOW_BATTERY'));
  });

  it('manual SOS → 100 / CRITICAL / escalate', () => {
    const r = evaluateRisk(input({ now: T0 + 20 * MIN, samples: walk(0, 20), sosActive: true }));
    assert.equal(r.score, 100);
    assert.equal(r.level, 'CRITICAL');
    assert.equal(r.shouldEscalate, true);
  });

  it('RULE 03: a completed hike never raises risk', () => {
    const r = evaluateRisk(
      input({ now: T0 + 400 * MIN, hike: hike({ status: 'COMPLETED' }), sosActive: true }),
    );
    assert.equal(r.score, 0);
    assert.equal(r.shouldEscalate, false);
  });
});

describe('incident lifecycle', () => {
  let n = 0;
  const id = () => `inc-${++n}`;

  it('no escalation → no incident', () => {
    const e = evaluateRisk(input({ now: T0 + 20 * MIN, samples: walk(0, 20) }));
    assert.equal(applyEvaluation(hike(), null, e, id), null);
  });

  it('RULE 02: repeated signals update the SAME incident', () => {
    const h = hike();
    const e1 = evaluateRisk(input({ now: T0 + 275 * MIN, samples: walk(255, 275) }));
    const i1 = applyEvaluation(h, null, e1, id)!;
    assert.equal(i1.status, 'OPEN');
    assert.equal(i1.delivery, 'LOCAL_ONLY');

    const e2 = evaluateRisk(input({ now: T0 + 330 * MIN, samples: walk(255, 275), sosActive: true }));
    const i2 = applyEvaluation(h, i1, e2, id)!;
    assert.equal(i2.id, i1.id);
    assert.equal(i2.peakLevel, 'CRITICAL');
    assert.ok(i2.reasons.includes('MANUAL_SOS'));
    assert.ok(i2.reasons.includes('RETURN_OVERDUE'));
  });

  it('a lower score later does not lower the peak or close the incident', () => {
    const h = hike();
    const hi = evaluateRisk(input({ now: T0 + 20 * MIN, samples: walk(0, 20), sosActive: true }));
    const i1 = applyEvaluation(h, null, hi, id)!;
    const lo = evaluateRisk(input({ now: T0 + 25 * MIN, samples: walk(0, 25) }));
    const i2 = applyEvaluation(h, i1, lo, id)!;
    assert.equal(i2.status, 'OPEN');
    assert.equal(i2.peakScore, 100);
  });

  it('RULE 03: resolved stays resolved, and a closed hike cannot re-escalate', () => {
    const h = hike();
    const e = evaluateRisk(input({ now: T0 + 20 * MIN, samples: walk(0, 20), sosActive: true }));
    const open = applyEvaluation(h, null, e, id)!;
    const closed = resolveIncident(open, T0 + 30 * MIN);
    assert.equal(closed.status, 'RESOLVED');
    assert.equal(applyEvaluation(h, closed, e, id), closed);
    assert.equal(applyEvaluation(hike({ status: 'COMPLETED' }), null, e, id), null);
  });

  it('a queue is not a rescue: delivery only moves forward', () => {
    const e = evaluateRisk(input({ now: T0 + 20 * MIN, samples: walk(0, 20), sosActive: true }));
    let inc = applyEvaluation(hike(), null, e, id)!;
    inc = advanceDelivery(inc, 'QUEUED_OFFLINE');
    inc = advanceDelivery(inc, 'SENT_TO_SERVER');
    inc = advanceDelivery(inc, 'QUEUED_OFFLINE'); // must not go back
    assert.equal(inc.delivery, 'SENT_TO_SERVER');
  });
});