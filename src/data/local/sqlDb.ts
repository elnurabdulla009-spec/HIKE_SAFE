// The small slice of expo-sqlite's SQLiteDatabase that our local store uses.
// expo-sqlite's database satisfies this interface as-is; tests pass an adapter over
// Node's built-in `node:sqlite`, so the SAME SQL is exercised on a real SQLite engine.
export type SqlValue = string | number | null;

export interface SqlDb {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, params: SqlValue[]): Promise<{ changes: number }>;
  getAllAsync<T>(source: string, params: SqlValue[]): Promise<T[]>;
  getFirstAsync<T>(source: string, params: SqlValue[]): Promise<T | null>;
}
