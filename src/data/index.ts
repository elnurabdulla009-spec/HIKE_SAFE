// The ONE place that decides which backend the app uses.
// Screens import `api` from here:   import { api } from '../src/data';
//
// Default: mock (no setup needed — this is what the frontend uses).
// Real Supabase backend: put EXPO_PUBLIC_API=real in .env and restart `npx expo start`.
import type { HikeSafeApi } from './api.ts';
import { mockApi } from './mockApi.ts';
import { createRealApi } from './realApi.ts';

export const api: HikeSafeApi = process.env.EXPO_PUBLIC_API === 'real' ? createRealApi() : mockApi;

export * from './api.ts';
