// HIKE SAFE — pure helpers for background GPS tracking.
// No Expo imports here: the background task (src/lib/locationTask.ts) adapts device data
// to these shapes, so the rules stay testable with node:test.
import type { LocationSample } from './types.ts';

const MIN = 60_000;

/**
 * PRELIMINARY tracking settings (battery vs. detail). Revise after field testing.
 * The interval must stay well below THRESHOLDS.gpsStaleMs, or a hiker who is walking
 * normally would look "GPS STALE" between two fixes (asserted in tracking.test.ts).
 */
export const TRACKING = {
  /** Ask the OS for a fix at most this often. */
  timeIntervalMs: 1 * MIN,
  /** ...or when the hiker moved this far. */
  distanceIntervalM: 20,
  /** Fixes stamped further in the future than this are rejected (bad device clock). */
  maxFutureSkewMs: 1 * MIN,
} as const;

/** The part of Expo's LocationObject that we use (structural type, no Expo import). */
export interface DeviceLocation {
  timestamp: number;
  coords: { latitude: number; longitude: number; accuracy: number | null };
}

export function fromDeviceLocation(loc: DeviceLocation): LocationSample {
  return {
    lat: loc.coords.latitude,
    lng: loc.coords.longitude,
    timestamp: loc.timestamp,
    accuracy: loc.coords.accuracy ?? null,
  };
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * Drops fixes that are physically impossible or corrupted, and duplicate timestamps.
 * RULE 01: we never invent or move points. Inaccurate but real fixes are KEPT;
 * risk.ts decides whether they are usable for movement decisions.
 * Returns the survivors sorted by time.
 */
export function sanitizeSamples(samples: LocationSample[], now: number): LocationSample[] {
  const byTime = new Map<number, LocationSample>();
  for (const s of samples) {
    if (!finite(s.lat) || !finite(s.lng) || !finite(s.timestamp)) continue;
    if (s.lat < -90 || s.lat > 90 || s.lng < -180 || s.lng > 180) continue;
    if (s.timestamp <= 0 || s.timestamp > now + TRACKING.maxFutureSkewMs) continue;
    const accuracy = finite(s.accuracy) && s.accuracy >= 0 ? s.accuracy : null;
    if (!byTime.has(s.timestamp)) byTime.set(s.timestamp, { ...s, accuracy });
  }
  return [...byTime.values()].sort((a, b) => a.timestamp - b.timestamp);
}
