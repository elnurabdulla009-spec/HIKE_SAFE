import { useSyncExternalStore } from 'react';
import { getPilotState, subscribePilot, type PilotState } from './pilotLog.ts';

/** Re-renders the screen whenever pilot state changes (session, logs, demo panel setting). */
export function usePilot(): PilotState {
  return useSyncExternalStore(subscribePilot, getPilotState, getPilotState);
}
