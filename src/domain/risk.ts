import { distanceToRouteM, haversineM } from './geo.ts';
import type {
  GpsState,
  LocationSample,
  Movement,
  RiskEvaluation,
  RiskInput,
  RiskLevel,
  RiskReason,
} from './types.ts';

const MIN = 60_000;

/**
 * PRELIMINARY thresholds. These are project assumptions, not measured predictors.
 * They must be revised after field testing (false alarms vs. missed incidents).
 */
export const THRESHOLDS = {
  /** Fixes worse than this are ignored for movement decisions. */
  maxAccuracyM: 50,
  /** Latest usable fix older than this → GPS is STALE, movement is UNKNOWN. */
  gpsStaleMs: 10 * MIN,
  /** A gap between fixes longer than this breaks a stationary streak. */
  maxSampleGapMs: 10 * MIN,
  /** All fixes within this radius of the latest one count as "same place". */
  stationaryRadiusM: 50,
  /** Shorter streaks are a normal rest, not "stationary". */
  stationaryMinMs: 10 * MIN,
  longStationaryMs: 60 * MIN,
  veryLongStationaryMs: 120 * MIN,
  returnApproachingMs: 30 * MIN,
  /** Overdue this long → escalate even if the score is not HIGH yet. */
  overdueEscalateMs: 30 * MIN,
  /** Grace period after start before a missing fix counts as a risk signal. */
  gpsGraceMs: 10 * MIN,
  routeDeviationM: 300,
  severeDeviationM: 1000,
  lowBattery: 0.15,
} as const;

export function levelFor(score: number): RiskLevel {
  if (score >= 80) return 'CRITICAL';
  if (score >= 55) return 'HIGH';
  if (score >= 30) return 'MEDIUM';
  return 'LOW';
}

function usableSamples(samples: LocationSample[], now: number): LocationSample[] {
  return samples
    .filter((s) => s.timestamp <= now && (s.accuracy === null || s.accuracy <= THRESHOLDS.maxAccuracyM))
    .sort((a, b) => a.timestamp - b.timestamp);
}

export function gpsStateFor(usable: LocationSample[], now: number): GpsState {
  const latest = usable.at(-1);
  if (!latest) return 'NO_FIX';
  return now - latest.timestamp > THRESHOLDS.gpsStaleMs ? 'STALE' : 'FRESH';
}

/**
 * RULE 01 — "Unknown is not stationary."
 * Movement is only judged from fresh, reliable fixes. Missing or stale data → UNKNOWN.
 */
export function movementFor(
  usable: LocationSample[],
  gps: GpsState,
  now: number,
): { movement: Movement; stationaryMs: number | null } {
  if (gps !== 'FRESH') return { movement: 'UNKNOWN', stationaryMs: null };

  const latest = usable[usable.length - 1];
  let earliest = latest;
  for (let i = usable.length - 2; i >= 0; i--) {
    const s = usable[i];
    if (earliest.timestamp - s.timestamp > THRESHOLDS.maxSampleGapMs) break; // gap → evidence ends
    if (haversineM(s, latest) > THRESHOLDS.stationaryRadiusM) break; // moved → streak ends
    earliest = s;
  }
  // Only time covered by real fixes counts, plus the (fresh) time since the last one.
  const stationaryMs = now - earliest.timestamp;
  if (earliest === latest || stationaryMs < THRESHOLDS.stationaryMinMs) {
    return { movement: 'MOVING', stationaryMs: null };
  }
  return { movement: 'STATIONARY', stationaryMs };
}

export function evaluateRisk(input: RiskInput): RiskEvaluation {
  const { now, hike, batteryLevel, sosActive } = input;
  const usable = usableSamples(input.samples, now);
  const gps = gpsStateFor(usable, now);
  const { movement, stationaryMs } = movementFor(usable, gps, now);
  const minutesToReturn = Math.round((now - hike.plannedReturnAt) / MIN);

  const latest = usable.at(-1);
  const routeDistanceM = gps === 'FRESH' && latest ? distanceToRouteM(latest, hike.route) : null;

  const base = {
    evaluatedAt: now,
    gps,
    movement,
    stationaryMinutes: stationaryMs === null ? null : Math.round(stationaryMs / MIN),
    minutesToReturn,
    routeDistanceM: routeDistanceM === null ? null : Math.round(routeDistanceM),
  };

  // RULE 03 — "Resolved means resolved." Only an ACTIVE hike can raise risk.
  if (hike.status !== 'ACTIVE') {
    return { ...base, reasons: [], score: 0, level: 'LOW', shouldEscalate: false };
  }

  const reasons: RiskReason[] = [];
  let score = 0;

  const overdueMs = now - hike.plannedReturnAt;
  if (overdueMs > 0) {
    reasons.push('RETURN_OVERDUE');
    score += 30 + Math.min(40, Math.floor(overdueMs / MIN / 2));
  } else if (-overdueMs <= THRESHOLDS.returnApproachingMs) {
    reasons.push('RETURN_APPROACHING');
    score += 10;
  }

  if (movement === 'STATIONARY' && stationaryMs !== null) {
    if (stationaryMs >= THRESHOLDS.veryLongStationaryMs) {
      reasons.push('LONG_STATIONARY');
      score += 35;
    } else if (stationaryMs >= THRESHOLDS.longStationaryMs) {
      reasons.push('LONG_STATIONARY');
      score += 20;
    }
  }

  // Missing GPS is uncertainty — a signal of its own, never converted into "stationary".
  if (gps !== 'FRESH' && now - hike.startedAt > THRESHOLDS.gpsGraceMs) {
    reasons.push('GPS_UNKNOWN');
    score += 15;
  }

  if (routeDistanceM !== null) {
    if (routeDistanceM > THRESHOLDS.severeDeviationM) {
      reasons.push('SEVERE_DEVIATION');
      score += 30;
    } else if (routeDistanceM > THRESHOLDS.routeDeviationM) {
      reasons.push('ROUTE_DEVIATION');
      score += 15;
    }
  }

  if (batteryLevel !== null && batteryLevel < THRESHOLDS.lowBattery) {
    reasons.push('LOW_BATTERY');
    score += 10;
  }

  if (sosActive) {
    reasons.push('MANUAL_SOS');
    score = 100;
  }

  score = Math.min(100, score);
  const level = levelFor(score);
  const shouldEscalate =
    sosActive || level === 'HIGH' || level === 'CRITICAL' || overdueMs >= THRESHOLDS.overdueEscalateMs;

  return { ...base, reasons, score, level, shouldEscalate };
}
