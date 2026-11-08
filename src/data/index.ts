// The ONE place that decides which backend the app uses.
// Screens import `api` from here:   import { api } from '../src/data';
//
// Today: mock. When the real backend is ready, the backend owner adds
// `realApi` and flips this line — no screen has to change.
import type { HikeSafeApi } from './api.ts';
import { mockApi } from './mockApi.ts';

export const api: HikeSafeApi = mockApi;

export * from './api.ts';
