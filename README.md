# HIKE SAFE

**Explore more. Return safely.**

HIKE SAFE is a mobile app for hikers in the Almaty mountains. Before a hike, the hiker records the route, the planned return time and a trusted contact. If the hiker does not come back on time, or the phone sees signs of trouble, the contact gets a message.

> Student project for the *Sustain System* course. It is **not** an emergency service: it does not contact 112, and alert delivery is not guaranteed.

## Status

| Stage | Scope | State |
|---|---|---|
| 1 | Risk engine, incident rules, database schema + Row Level Security, app skeleton | ✅ done |
| 2 | Sign-in, trusted contacts, hike plan form (backend: `realApi` ✅, screens ⏳) | ⏳ in progress |
| 3 | Real background GPS → local SQLite (3a ✅) → offline sync queue (3b) | ⏳ in progress |
| 4 | Live risk screen, manual SOS, finish hike | |
| 5 | Server: overdue check every minute + Telegram/SMS alert to contact | |
| 6 | Real-device field tests (battery, GPS gaps), store builds | |

## Safety rules

These are the rules the project was defended on. Each one is enforced in code and covered by tests.

| Rule | Where it is enforced |
|---|---|
| **Unknown is not stationary.** Missing or stale GPS gives `UNKNOWN`, never "stopped". | `src/domain/risk.ts` → `movementFor()` |
| **One hike. One incident.** Repeated signals update the same incident. | `src/domain/incident.ts` + `UNIQUE(hike_id)` in the database |
| **Resolved means resolved.** A closed hike or incident never escalates again. | engine + incident logic + database trigger |
| **A queue is not a rescue.** "Queued" is never shown as "delivered". | `advanceDelivery()`; only the server can set `contact_notified_at` |
| **Local first.** Every record is written on the phone first and synced later. | `src/data/local/pointSink.ts` (GPS → SQLite); device-generated IDs → idempotent upserts |

All risk thresholds in `THRESHOLDS` are **preliminary assumptions**. Field testing has to measure false alarms and missed incidents, and the thresholds must be revised from those results.

## Architecture

```
Phone (Expo / React Native)          Supabase                         Trusted contact
┌───────────────────────────┐        ┌──────────────────────────┐     ┌──────────────┐
│ GPS → SQLite (local)      │  sync  │ Auth                     │     │ Telegram/SMS │
│ Risk engine (pure TS)     │ ─────▶ │ Postgres + RLS           │ ──▶ │ "Elnur was   │
│ Offline queue             │        │ pg_cron: overdue check   │     │  due at 19:00"│
└───────────────────────────┘        └──────────────────────────┘     └──────────────┘
```

The server exists for one reason: **if the phone is dead or offline, it cannot send anything**. The server still knows the planned return time, so it can raise the alarm on the phone's behalf.

## Project structure

```
app/                     screens (expo-router)
index.js                 entry: defines the background GPS task, then starts expo-router
src/domain/              safety logic: pure TypeScript, no React, fully tested
  types.ts  geo.ts  risk.ts  incident.ts  tracking.ts
src/data/                api contract, mock, real Supabase backend
  local/                 on-device SQLite: schema, PointSink (GPS fixes), tracking state
src/lib/supabase.ts      backend client
src/lib/locationTask.ts  background GPS task (expo-location + expo-task-manager)
supabase/migrations/     database schema, RLS policies, triggers, overdue function
supabase/tests/          database security tests (run on plain Postgres)
```

## Setup (macOS)

```bash
# 1. Install dependencies (expo install picks versions that match the SDK)
npm install expo
npx expo install expo-router expo-linking expo-constants expo-status-bar \
  react-native-safe-area-context react-native-screens \
  expo-location expo-task-manager expo-sqlite expo-battery \
  @supabase/supabase-js @react-native-async-storage/async-storage react-native-url-polyfill
npm install -D typescript @types/react @types/node

# 2. Backend
cp .env.example .env     # then paste URL + anon key from your Supabase project
```

To set up Supabase, create a free project at supabase.com. Open **SQL Editor** and run `supabase/migrations/20261108000000_init.sql`. Then enable the **pg_cron** extension (Database → Extensions) and run:

```sql
select cron.schedule('escalate-overdue', '* * * * *', $$select public.escalate_overdue_hikes()$$);
```

```bash
# 3. Run
npm test          # all unit tests
npx expo start    # opens the app (mock backend works in Expo Go)
```

### Background GPS needs a development build

Background location does **not** work in Expo Go. With the real backend you need a development build:

```bash
npx expo run:ios --device      # iPhone over USB: needs Xcode and an Apple ID (free account is fine)
npx expo run:android           # Android phone with USB debugging
```

Then start a hike, allow location **"Always"**, and lock the screen. Fixes are written to the phone's SQLite
first (`hikesafe.db`), so they are recorded in airplane mode too. In the iOS Simulator you can use
**Features → Location → City Walk** to simulate movement.

Known limits of stage 3a: fixes are not uploaded to Supabase yet (stage 3b), and if the user force-quits the
app on iOS, the OS stops background GPS. The server-side overdue check still works in that case.

## Using the real backend (Supabase)

By default the app runs on the **mock** backend (`src/data/mockApi.ts`), so nobody needs a server to build screens.
To use Supabase:

1. Run both migrations in the Supabase **SQL Editor**, in order:
   - `supabase/migrations/20261108000000_init.sql`: tables, RLS, triggers, overdue function
   - `supabase/migrations/20261108000100_grants.sql`: explicit privileges (least privilege)
2. Enable **pg_cron** (Database → Extensions) and schedule the overdue check:
   ```sql
   select cron.schedule('escalate-overdue', '* * * * *', $$select public.escalate_overdue_hikes()$$);
   ```
3. Make sign-in emails contain a **6-digit code** instead of only a link.
   Go to **Authentication → Emails → Templates → Magic Link** and put `{{ .Token }}` in the body, for example:
   ```html
   <h2>Your HIKE SAFE code</h2>
   <p>Enter this code in the app: <strong>{{ .Token }}</strong></p>
   <p>If you did not request it, ignore this email.</p>
   ```
   The built-in email sender has a low hourly limit. That is fine for development; production needs custom SMTP.
4. In `.env` set the URL and publishable key, plus `EXPO_PUBLIC_API=real`. Then restart `npx expo start`.

What is real now: email-code sign-in, trusted contacts, starting and finishing hikes, background GPS stored on the
phone, live risk status computed from those local fixes, and SOS that creates the single incident for the hike.
Not yet: uploading fixes and the offline queue (stage 3b), and notifying the contact (stage 5).

## Testing the database rules

The database rules can be tested on any local PostgreSQL 15+ (no Supabase needed):

```bash
createdb hikesafe_test
psql -d hikesafe_test -f supabase/tests/auth_stub.sql \
     -f supabase/migrations/20261108000000_init.sql \
     -f supabase/tests/rls_test.sql
```

The tests check these cases:
- another user cannot read or write your hikes, GPS points, contacts or incidents;
- a second incident cannot be opened for the same hike;
- a closed hike or incident cannot be re-opened;
- the phone cannot fake a server incident or claim the contact was notified;
- GPS history is append-only;
- the overdue check fires exactly once.

## Limitations

- No integration with 112 or official rescue services.
- No satellite messaging. Without signal, nothing can be sent.
- Risk thresholds are unvalidated design assumptions.
- The app supports preparation and does not replace it: route planning, equipment, companions and responsible hiking still matter.
