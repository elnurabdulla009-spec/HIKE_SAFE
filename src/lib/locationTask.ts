// ─────────────────────────────────────────────────────────────────────────────
// Background GPS: the OS wakes this task with batches of fixes, even with the screen off.
//
// IMPORTANT: defineTask() must run in the GLOBAL scope when the bundle loads, because the
// OS may start the app headless just to deliver locations. That is why the root
// `index.js` imports this file before expo-router.
//
// Flow: device fix → sanitizeSamples → local SQLite (PointSink). LOCAL FIRST: nothing here
// needs the network. Uploading to Supabase is the sync stage (3b).
// ─────────────────────────────────────────────────────────────────────────────
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { ApiError } from '../data/api.ts';
import { getLocalDb, getPointSink } from '../data/local/db.ts';
import { clearTrackedHikeId, getTrackedHikeId, setTrackedHikeId } from '../data/local/trackingState.ts';
import { fromDeviceLocation, sanitizeSamples, TRACKING } from '../domain/tracking.ts';

export const LOCATION_TASK = 'hikesafe-background-location';

const TASK_OPTIONS: Location.LocationTaskOptions = {
  accuracy: Location.Accuracy.High,
  timeInterval: TRACKING.timeIntervalMs, // Android
  distanceInterval: TRACKING.distanceIntervalM,
  // iOS: tell the OS this is a walk, and never pause by itself — a resting hiker still matters.
  activityType: Location.ActivityType.Fitness,
  pausesUpdatesAutomatically: false,
  showsBackgroundLocationIndicator: true, // honest: the user always sees that we track
  // Android: a visible notification is required for a background location service.
  foregroundService: {
    notificationTitle: 'HIKE SAFE is recording your hike',
    notificationBody: 'GPS stops when you press "I\'m back safe".',
  },
};

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('[gps] task error:', error.message);
    return;
  }
  try {
    const db = await getLocalDb();
    const hikeId = await getTrackedHikeId(db);
    if (!hikeId) {
      // No active hike on this phone: stop. We do not track people outside a hike.
      await stopUpdatesIfRunning();
      return;
    }
    const samples = sanitizeSamples((data?.locations ?? []).map(fromDeviceLocation), Date.now());
    await (await getPointSink()).add(hikeId, samples);
  } catch (e) {
    // Never crash the task: the next batch will try again.
    console.warn('[gps] could not store fixes:', e instanceof Error ? e.message : e);
  }
});

async function stopUpdatesIfRunning(): Promise<void> {
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
}

/** Foreground first, then "Always". Both are needed to record with the screen off. */
export async function requestTrackingPermissions(): Promise<void> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') {
    throw new ApiError('LOCATION_PERMISSION_DENIED', 'HIKE SAFE needs location access to record your hike.');
  }
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== 'granted') {
    throw new ApiError(
      'LOCATION_PERMISSION_DENIED',
      'Allow location "Always" so your hike is recorded while the screen is off.',
    );
  }
}

export async function startTracking(hikeId: string): Promise<void> {
  // Save the hike id BEFORE starting, so the very first batch knows where to go.
  await setTrackedHikeId(await getLocalDb(), hikeId);
  await Location.startLocationUpdatesAsync(LOCATION_TASK, TASK_OPTIONS);
}

export async function stopTracking(): Promise<void> {
  // Clear the id first: even if stopping fails, the task will stop itself on its next batch.
  await clearTrackedHikeId(await getLocalDb());
  await stopUpdatesIfRunning();
}

/** Restarts tracking for an active hike if the OS stopped it (reboot, app update, ...). */
export async function ensureTracking(hikeId: string): Promise<void> {
  const db = await getLocalDb();
  const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  if (running && (await getTrackedHikeId(db)) === hikeId) return;
  const { status } = await Location.getBackgroundPermissionsAsync();
  if (status !== 'granted') return; // cannot ask from here; the live screen shows GPS_UNKNOWN
  await startTracking(hikeId);
}
