// HIKE SAFE — core domain types.
// Pure TypeScript: no React, no Expo, no network. This keeps the safety rules testable.

export type HikeStatus = 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Hike {
  id: string;
  destination: string;
  /** Planned route as a polyline. Empty array = no route given. */
  route: LatLng[];
  startedAt: number; // epoch ms
  plannedReturnAt: number; // epoch ms
  status: HikeStatus;
}

export interface LocationSample extends LatLng {
  timestamp: number; // epoch ms
  /** Horizontal accuracy in metres, as reported by the device. */
  accuracy: number | null;
}

export type GpsState = 'FRESH' | 'STALE' | 'NO_FIX';
export type Movement = 'MOVING' | 'STATIONARY' | 'UNKNOWN';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type RiskReason =
  | 'RETURN_APPROACHING'
  | 'RETURN_OVERDUE'
  | 'LONG_STATIONARY'
  | 'GPS_UNKNOWN'
  | 'ROUTE_DEVIATION'
  | 'SEVERE_DEVIATION'
  | 'LOW_BATTERY'
  | 'MANUAL_SOS';

export interface RiskInput {
  now: number;
  hike: Hike;
  samples: LocationSample[];
  /** 0..1, or null if unknown. */
  batteryLevel: number | null;
  sosActive: boolean;
}

export interface RiskEvaluation {
  evaluatedAt: number;
  gps: GpsState;
  movement: Movement;
  /** Minutes without meaningful movement; null unless movement === 'STATIONARY'. */
  stationaryMinutes: number | null;
  /** Positive = minutes late; negative = minutes left. */
  minutesToReturn: number;
  /** Distance from planned route in metres; null if no route or no fresh fix. */
  routeDistanceM: number | null;
  reasons: RiskReason[];
  score: number; // 0..100
  level: RiskLevel;
  shouldEscalate: boolean;
}

export type IncidentStatus = 'OPEN' | 'RESOLVED';

/** How far the incident has travelled. A queued alert is NOT a delivered alert. */
export type DeliveryState = 'LOCAL_ONLY' | 'QUEUED_OFFLINE' | 'SENT_TO_SERVER' | 'CONTACT_NOTIFIED';

export interface Incident {
  id: string;
  hikeId: string;
  status: IncidentStatus;
  openedAt: number;
  updatedAt: number;
  resolvedAt: number | null;
  peakLevel: RiskLevel;
  peakScore: number;
  reasons: RiskReason[];
  delivery: DeliveryState;
}
