import { mockControls, type MockScenario } from '../data/mockApi.ts';
import { logPilot } from '../pilot/pilotLog.ts';

export const SCENARIOS: { key: MockScenario; label: string }[] = [
  { key: 'WALKING', label: 'Walking' },
  { key: 'RESTING', label: 'Long rest' },
  { key: 'GPS_LOST', label: 'GPS lost' },
  { key: 'OVERDUE', label: 'Overdue' },
  { key: 'OFFLINE', label: 'Offline' },
  { key: 'LOW_BATTERY', label: 'Low battery' },
];

/** Changes the demo scenario and records it in the pilot log. */
export function changeScenario(s: MockScenario): void {
  mockControls.setScenario(s);
  logPilot('SCENARIO', { detail: s });
}
