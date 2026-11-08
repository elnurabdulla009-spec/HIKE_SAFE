import type { LatLng } from './types.ts';

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Shortest distance (metres) from point p to a polyline.
 * Uses a local flat projection around p — accurate enough for hiking-scale distances.
 */
export function distanceToRouteM(p: LatLng, route: LatLng[]): number | null {
  if (route.length === 0) return null;
  if (route.length === 1) return haversineM(p, route[0]);

  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos(toRad(p.lat));
  const project = (q: LatLng) => ({ x: (q.lng - p.lng) * mPerDegLng, y: (q.lat - p.lat) * mPerDegLat });

  let best = Infinity;
  for (let i = 0; i < route.length - 1; i++) {
    const a = project(route[i]);
    const b = project(route[i + 1]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    // p is the origin (0,0) in this projection.
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / len2));
    const cx = a.x + t * dx;
    const cy = a.y + t * dy;
    best = Math.min(best, Math.hypot(cx, cy));
  }
  return best;
}
