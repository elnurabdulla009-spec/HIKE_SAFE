// The alert text a trusted contact would receive, built from real hike data.
// Pure TypeScript (no React) so the safety wording is unit-tested.
//
// RULE 01: if GPS is not fresh, the location is UNKNOWN. Never say "stopped" / "not moving".
// RULE 04: a preview is not a delivery. Only CONTACT_NOTIFIED may say "notified".
import type { DeliveryState, RiskEvaluation } from './types.ts';

export interface ContactAlertInput {
  hikerName: string;
  contactName: string;
  destination: string;
  plannedReturnAt: number;
  evaluation: Pick<RiskEvaluation, 'gps' | 'movement' | 'stationaryMinutes' | 'minutesToReturn' | 'reasons'>;
  /** Epoch ms of the last usable GPS fix, or null. */
  lastFixAt: number | null;
  /** Formats a clock time; injectable so tests do not depend on the time zone. */
  formatTime?: (ms: number) => string;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const clockTime = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function formatDuration(min: number): string {
  const m = Math.abs(Math.round(min));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

export function buildContactAlert(i: ContactAlertInput): string {
  const t = i.formatTime ?? clockTime;
  const name = i.hikerName;
  const ev = i.evaluation;
  const parts: string[] = [];

  parts.push(`HIKE SAFE alert for ${i.contactName}:`);

  if (ev.minutesToReturn > 0) {
    parts.push(`${name} planned to return from ${i.destination} by ${t(i.plannedReturnAt)} and is now ${formatDuration(ev.minutesToReturn)} late.`);
  } else {
    parts.push(`${name} is on a hike to ${i.destination} and planned to return by ${t(i.plannedReturnAt)}.`);
  }

  if (ev.reasons.includes('MANUAL_SOS')) parts.push(`${name} pressed SOS in the app.`);

  // RULE 01 — unknown is not stationary.
  if (ev.gps !== 'FRESH') {
    parts.push(i.lastFixAt !== null
      ? `Last known location: unknown since ${t(i.lastFixAt)} (no GPS signal; the phone may be out of coverage).`
      : 'Last known location: unknown (no GPS fix since the hike started).');
  } else if (ev.movement === 'STATIONARY' && ev.stationaryMinutes !== null) {
    parts.push(`GPS is working. Last fix at ${i.lastFixAt !== null ? t(i.lastFixAt) : 'unknown time'}; ${name} has not moved for ${formatDuration(ev.stationaryMinutes)}.`);
  } else {
    parts.push(`GPS is working. Last fix at ${i.lastFixAt !== null ? t(i.lastFixAt) : 'unknown time'}; ${name} was moving.`);
  }

  if (ev.reasons.includes('LOW_BATTERY')) parts.push(`${name}'s phone battery is low.`);

  parts.push(
    `What to do: 1) call ${name}, 2) if there is no answer, contact others on the hike or local rescue, ` +
    `3) call 112 if you believe ${name} is in danger. HIKE SAFE does not call 112.`,
  );
  return parts.join(' ');
}

/** RULE 04 — "Queued" and "Sent" are not "notified". Shared by the live screen and the preview. */
export const DELIVERY_TEXT: Record<DeliveryState, string> = {
  LOCAL_ONLY: 'Alert saved on this phone only. Your contact has NOT been told yet.',
  QUEUED_OFFLINE: 'No network. Alert is queued and will be sent when the phone is online. Your contact has NOT been told yet.',
  SENT_TO_SERVER: 'Alert reached our server. Waiting for delivery to your contact.',
  CONTACT_NOTIFIED: 'Contact notified.',
};

/** Banner for the preview screen: what is shown is a preview, plus the REAL delivery state. */
export function previewNotice(delivery: DeliveryState | null): string {
  const real = delivery === null ? 'There is no alert right now, so nothing would be sent.' : `Real status: ${DELIVERY_TEXT[delivery]}`;
  return `PREVIEW: this is what your contact would receive. Opening this preview does not send anything. ${real}`;
}
