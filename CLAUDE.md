# HIKE SAFE — instructions for Claude Code

Read this first, then `README.md` and `CONTRIBUTING.md`.

## Who you are working with
- **Elnur** (repo owner, cybersecurity student): backend — `supabase/`, `src/domain/`, `src/data/`, `src/lib/`.
- **Demeu**: frontend — `app/`, `src/components/`, `assets/`.
- Both are learning. Reply **in Kazakh**, explain step by step, and say *why*. Keep code comments in English.
- Never ask for, print, or commit secrets (`.env`, tokens, passwords, service_role key).

## Project
Mobile app for hikers in the Almaty mountains. The user saves a route, a planned return time and a
trusted contact. A risk engine watches time, GPS and movement. If the hiker is overdue or presses SOS,
an incident opens and the contact is notified by the server.
It does **not** call 112 and does not guarantee delivery.

Stack: Expo SDK 58 (React Native, TypeScript, expo-router), Supabase (Postgres + RLS + Auth + pg_cron).

## Commands
- `npm test`: all unit tests (node:test, `--experimental-strip-types`). Must stay green.
- `npx tsc --noEmit`: typecheck. Must print nothing.
- `npx expo start`: dev server (Expo Go). `npx expo install <pkg>` for Expo-compatible versions.
- Never run `npm audit fix --force` (it breaks Expo).

## Architecture
- `src/domain/`: pure TS, no React. `risk.ts` (evaluateRisk, THRESHOLDS are preliminary), `incident.ts`, `geo.ts`, `types.ts`.
- `src/data/api.ts`: **the contract** (`HikeSafeApi`). Screens use only `import { api } from '../src/data'`.
- `src/data/mockApi.ts`: in-memory backend, sign-in code `123456`, `mockControls.setScenario(...)`.
- `src/data/realApi.ts`: Supabase implementation.
- `src/data/index.ts`: `EXPO_PUBLIC_API=real` selects Supabase. The default is mock.
- `src/data/local/`: on-device SQLite (`schema.ts` migrations, `pointSink.ts` GPS fixes, `trackingState.ts`). Tests run the same SQL on `node:sqlite`.
- `src/lib/supabase.ts`: lazy client. `src/lib/uuid.ts`: device-side IDs.
- `src/lib/locationTask.ts`: background GPS task, defined in the global scope via the root `index.js` (package.json `main`).
- `supabase/migrations/`: schema, RLS, triggers, `escalate_overdue_hikes()`, explicit grants. Already applied to the live project.

## Safety rules (from the defended project — never break them)
1. Unknown is not stationary. Missing or stale GPS means `UNKNOWN`, never "stopped".
2. One hike, one incident (also `UNIQUE(hike_id)` in the DB).
3. Resolved means resolved. A closed hike never re-escalates (DB trigger).
4. A queue is not a rescue. Show "contact notified" only when `delivery === 'CONTACT_NOTIFIED'`. Only the server sets `contact_notified_at`.
5. SOS always asks for confirmation first.
6. The UI says clearly that the app does not call 112.

## Security rules
- Every new table gets RLS, least-privilege grants, and a test in `supabase/tests/rls_test.sql`.
- The app may only contain the publishable/anon key.

## Git workflow
Never push directly to `main`. Use branches `backend/...` and `frontend/...`, then open a Pull Request
that the teammate reviews. Run `npm test` and `npx tsc --noEmit` before every PR.

## Status (2026-11-24)
- Done: risk engine, incident rules, API contract + mock, Supabase schema/RLS/grants/pg_cron, `realApi` (merged).
- Open:
  - Supabase free tier emails contain only a link, not the 6-digit code. Custom SMTP (a project Gmail + app password) is needed so the Magic Link template can use `{{ .Token }}`.
  - Demeu: sign-in screen (`app/sign-in.tsx`) on the mock, then contacts, plan form, live hike screen.
- Stage 3a (branch `backend/background-gps`): background GPS → local SQLite; `realApi` evaluates risk from local fixes.
  Needs a dev build (`npx expo run:ios --device`); Expo Go cannot run background location.
- Next backend stage 3b: upload unsynced fixes (`synced_at IS NULL`) to Supabase, then an offline queue for hikes/incidents.
