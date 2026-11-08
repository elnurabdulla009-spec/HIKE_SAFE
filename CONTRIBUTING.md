# Working together on HIKE SAFE

Two people, two areas, one contract.

## Who owns what

| Area | Owner | Folders |
|---|---|---|
| **Backend** | Elnur | `supabase/`, `src/domain/`, `src/data/` |
| **Frontend** | (teammate) | `app/`, `src/components/`, `assets/` |

You may read everything. Change files outside your area only after you agree with the owner.

## The contract: `src/data/api.ts`

Screens talk to the backend **only** through `api` (from `src/data`):

```ts
import { api, ApiError } from '../src/data';

const contacts = await api.listContacts();
```

- A screen never imports `supabase`, `expo-sqlite` or `expo-location` directly.
- Today `api` is the **mock** (`src/data/mockApi.ts`): in-memory data, sign-in code `123456`.
- The mock uses the real risk engine. Call `mockControls.setScenario('GPS_LOST' | 'OVERDUE' | 'OFFLINE' | ...)` to see how a screen looks in each situation.
- When the real backend is ready, `src/data/index.ts` switches from mock to real. No screen should need to change.
- **Changing `api.ts` = changing the agreement.** Discuss it first, then change it in its own Pull Request, reviewed by both of you.

## Git workflow

1. Never push directly to `main`.
2. Start every task from the latest `main`:
   ```bash
   git checkout main
   git pull
   git checkout -b backend/contacts-table      # or frontend/plan-screen
   ```
3. Commit small steps with clear messages, for example `Add trusted contacts screen` or `Fix GPS stale threshold`.
4. Before you open a Pull Request:
   ```bash
   npm test          # all tests pass
   npx tsc --noEmit  # no type errors
   ```
5. Push the branch, open a Pull Request on GitHub, and ask your teammate to review. Merge after their approval.
6. After the merge, delete the branch and `git pull` on `main`.

Branch names start with `backend/…`, `frontend/…`, or `docs/…`.

## Security rules (non-negotiable)

- **Never commit `.env`.** It is already in `.gitignore`. Share Supabase keys privately.
- The app may only contain the **anon** key. The **service_role** key never goes into the app or into Git.
- Never paste tokens, passwords or keys into chats, issues or commit messages. If one leaks, revoke it immediately.
- Every new table gets Row Level Security and a test in `supabase/tests/rls_test.sql`.
- Do not run `npm audit fix --force`. It breaks the Expo SDK versions. Upgrade with `npx expo install --fix`.

## Safety rules the app must keep

These come from the project defense. Do not break them in the UI either:

1. **Unknown is not stationary.** If GPS is lost, show "Location unknown", never "Stopped".
2. **One hike, one incident.**
3. **Resolved means resolved.**
4. **A queue is not a rescue.** Never show "Contact notified" unless `incident.delivery === 'CONTACT_NOTIFIED'`. "Queued" and "Sent" are different states and need different wording.
5. SOS always asks for confirmation before sending.
6. The app must say clearly that it does **not** call 112.
