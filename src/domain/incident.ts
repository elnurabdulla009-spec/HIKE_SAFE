import type { DeliveryState, Hike, Incident, RiskEvaluation, RiskLevel } from './types.ts';

const LEVEL_ORDER: RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const maxLevel = (a: RiskLevel, b: RiskLevel) =>
  LEVEL_ORDER.indexOf(a) >= LEVEL_ORDER.indexOf(b) ? a : b;

/**
 * RULE 02 — "One hike. One incident."
 * RULE 03 — "Resolved means resolved."
 *
 * Returns the incident that should exist after this evaluation:
 * - closed hike            → unchanged (never escalates again)
 * - no incident + escalate → a new OPEN incident
 * - OPEN incident          → the same incident, updated (peak level, merged reasons)
 * - RESOLVED incident      → unchanged
 */
export function applyEvaluation(
  hike: Hike,
  current: Incident | null,
  evaluation: RiskEvaluation,
  newId: () => string,
): Incident | null {
  if (hike.status !== 'ACTIVE') return current;
  if (current?.status === 'RESOLVED') return current;

  if (!current) {
    if (!evaluation.shouldEscalate) return null;
    return {
      id: newId(),
      hikeId: hike.id,
      status: 'OPEN',
      openedAt: evaluation.evaluatedAt,
      updatedAt: evaluation.evaluatedAt,
      resolvedAt: null,
      peakLevel: evaluation.level,
      peakScore: evaluation.score,
      reasons: [...evaluation.reasons],
      delivery: 'LOCAL_ONLY',
    };
  }

  // An open incident is never closed automatically because the score dropped:
  // only the hiker (or their contact) can confirm safety.
  return {
    ...current,
    updatedAt: evaluation.evaluatedAt,
    peakLevel: maxLevel(current.peakLevel, evaluation.level),
    peakScore: Math.max(current.peakScore, evaluation.score),
    reasons: [...new Set([...current.reasons, ...evaluation.reasons])],
  };
}

export function resolveIncident(incident: Incident, at: number): Incident {
  if (incident.status === 'RESOLVED') return incident;
  return { ...incident, status: 'RESOLVED', resolvedAt: at, updatedAt: at };
}

const DELIVERY_ORDER: DeliveryState[] = ['LOCAL_ONLY', 'QUEUED_OFFLINE', 'SENT_TO_SERVER', 'CONTACT_NOTIFIED'];

/** "A queue is not a rescue." Delivery state only moves forward, and only on real confirmation. */
export function advanceDelivery(incident: Incident, next: DeliveryState): Incident {
  return DELIVERY_ORDER.indexOf(next) > DELIVERY_ORDER.indexOf(incident.delivery)
    ? { ...incident, delivery: next }
    : incident;
}
