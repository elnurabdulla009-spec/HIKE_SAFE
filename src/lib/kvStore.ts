// Small, failure-proof key/value storage for the prototype (mock data + pilot logs).
//
// Web: uses localStorage (the same thing AsyncStorage uses on web), synchronously,
// so data is loaded BEFORE the first screen asks "am I signed in?".
// No localStorage (Expo Go on a phone, private mode, quota full, tests) → in-memory fallback.
// Every call is wrapped in try/catch: storage problems never crash the app.

export interface KeyValueBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function memoryBackend(): KeyValueBackend {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

function detectLocalStorage(): KeyValueBackend | null {
  try {
    const ls = (globalThis as { localStorage?: KeyValueBackend }).localStorage;
    if (!ls) return null;
    const probe = '__hikesafe_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null; // e.g. blocked storage, or Node without --localstorage-file
  }
}

let backend: KeyValueBackend = detectLocalStorage() ?? memoryBackend();

/** Tests (and only tests) swap the backend to simulate a browser. */
export function setStorageBackend(b: KeyValueBackend): void {
  backend = b;
}

/** Reads and parses JSON. Returns null if missing, unreadable, or rejected by `validate`. */
export function loadJson<T>(key: string, validate: (raw: unknown) => T | null): T | null {
  try {
    const text = backend.getItem(key);
    if (text === null) return null;
    return validate(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Returns false if saving failed (the app keeps working from memory). */
export function saveJson(key: string, value: unknown): boolean {
  try {
    backend.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string): void {
  try {
    backend.removeItem(key);
  } catch {
    // ignore: nothing to clean up if storage is unavailable
  }
}
