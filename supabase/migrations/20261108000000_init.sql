-- HIKE SAFE — initial schema
-- Principles (from the project presentation):
--   * Local first: the phone generates IDs, so offline records sync idempotently (upsert by id).
--   * RULE 02 "One hike. One incident."   → UNIQUE(hike_id) on incidents.
--   * RULE 03 "Resolved means resolved."  → trigger blocks re-opening and escalation of closed hikes.
--   * Privacy: Row Level Security on every table; a user only ever sees their own rows.

-- ───────────────────────── profiles ─────────────────────────
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  created_at   timestamptz not null default now()
);

-- ───────────────────────── trusted contacts ─────────────────────────
create table public.trusted_contacts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name             text not null check (char_length(name) between 1 and 80),
  phone            text check (phone ~ '^\+[1-9][0-9]{7,14}$'),          -- E.164, e.g. +77011234567
  telegram_chat_id bigint,
  created_at       timestamptz not null default now(),
  constraint contact_has_channel check (phone is not null or telegram_chat_id is not null)
);
create index on public.trusted_contacts (user_id);

-- ───────────────────────── hikes ─────────────────────────
create table public.hikes (
  id                uuid primary key,                      -- generated on the device
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  destination       text not null check (char_length(destination) between 1 and 120),
  route             jsonb not null default '[]'::jsonb check (jsonb_typeof(route) = 'array'),
  started_at        timestamptz not null,
  planned_return_at timestamptz not null,
  status            text not null default 'ACTIVE'
                    check (status in ('PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED')),
  completed_at      timestamptz,
  updated_at        timestamptz not null default now(),
  constraint return_after_start check (planned_return_at > started_at),
  constraint completed_has_time check ((status = 'COMPLETED') = (completed_at is not null))
);
create index on public.hikes (user_id, started_at desc);
create index hikes_active_return on public.hikes (planned_return_at) where status = 'ACTIVE';

-- ───────────────────────── GPS samples ─────────────────────────
create table public.location_points (
  id          uuid primary key,                            -- generated on the device
  hike_id     uuid not null references public.hikes (id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  recorded_at timestamptz not null,
  lat         double precision not null check (lat between -90 and 90),
  lng         double precision not null check (lng between -180 and 180),
  accuracy_m  real check (accuracy_m >= 0)
);
create index on public.location_points (hike_id, recorded_at desc);

-- ───────────────────────── incidents ─────────────────────────
create table public.incidents (
  id          uuid primary key,
  hike_id     uuid not null unique references public.hikes (id) on delete cascade,  -- RULE 02
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source      text not null check (source in ('DEVICE', 'SERVER_OVERDUE')),
  status      text not null default 'OPEN' check (status in ('OPEN', 'RESOLVED')),
  opened_at   timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  resolved_at timestamptz,
  peak_level  text not null check (peak_level in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  peak_score  smallint not null check (peak_score between 0 and 100),
  reasons     text[] not null default '{}',
  -- Set ONLY by the server after a real confirmation from the messaging provider.
  contact_notified_at timestamptz,
  constraint resolved_has_time check ((status = 'RESOLVED') = (resolved_at is not null))
);

-- RULE 03 — "Resolved means resolved." Enforced in the database, not only in the app.
create function public.guard_incident() returns trigger
language plpgsql set search_path = '' as $$
declare
  hike_status text;
begin
  if tg_op = 'UPDATE' and old.status = 'RESOLVED' and new.status <> 'RESOLVED' then
    raise exception 'incident % is resolved and cannot be re-opened', old.id;
  end if;
  if tg_op = 'INSERT' and new.status = 'OPEN' then
    select h.status into hike_status from public.hikes h where h.id = new.hike_id;
    if hike_status is distinct from 'ACTIVE' then
      raise exception 'cannot open an incident for a hike that is not ACTIVE';
    end if;
  end if;
  -- The phone may not claim the contact was notified; only the server (service role) may.
  if auth.role() <> 'service_role' and new.contact_notified_at is distinct from
     (case when tg_op = 'UPDATE' then old.contact_notified_at else null end) then
    raise exception 'contact_notified_at is server-controlled';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger incidents_guard before insert or update on public.incidents
  for each row execute function public.guard_incident();

-- A completed or cancelled hike cannot become active again.
create function public.guard_hike() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status in ('COMPLETED', 'CANCELLED') and new.status <> old.status then
    raise exception 'hike % is closed', old.id;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger hikes_guard before update on public.hikes
  for each row execute function public.guard_hike();

-- ───────────────────────── Row Level Security ─────────────────────────
alter table public.profiles         enable row level security;
alter table public.trusted_contacts enable row level security;
alter table public.hikes            enable row level security;
alter table public.location_points  enable row level security;
alter table public.incidents        enable row level security;

create policy "own profile" on public.profiles
  for all to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "own contacts" on public.trusted_contacts
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "read own hikes"   on public.hikes for select to authenticated using (user_id = (select auth.uid()));
create policy "create own hikes" on public.hikes for insert to authenticated with check (user_id = (select auth.uid()));
create policy "update own hikes" on public.hikes for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- No delete policy: hike history is kept (the account deletion cascade still removes it).

create policy "read own points" on public.location_points for select to authenticated
  using (user_id = (select auth.uid()));
create policy "add points to own hike" on public.location_points for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.hikes h where h.id = hike_id and h.user_id = (select auth.uid()))
  );
-- GPS points are append-only: no update / delete policies.

create policy "read own incidents" on public.incidents for select to authenticated
  using (user_id = (select auth.uid()));
create policy "open incident on own hike" on public.incidents for insert to authenticated
  with check (
    user_id = (select auth.uid()) and source = 'DEVICE'
    and exists (select 1 from public.hikes h where h.id = hike_id and h.user_id = (select auth.uid()))
  );
create policy "update own incidents" on public.incidents for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ───────────────────────── server-side overdue check ─────────────────────────
-- The core reason a server exists: the phone may be dead or offline, the server still knows
-- the planned return time. Run every minute (pg_cron, see README). Only the server may call it.
create function public.escalate_overdue_hikes(grace interval default interval '30 minutes')
returns setof public.incidents
language sql security definer set search_path = '' as $$
  insert into public.incidents (id, hike_id, user_id, source, peak_level, peak_score, reasons)
  select gen_random_uuid(), h.id, h.user_id, 'SERVER_OVERDUE', 'HIGH', 70, array['RETURN_OVERDUE']
  from public.hikes h
  where h.status = 'ACTIVE' and h.planned_return_at + grace < now()
  on conflict (hike_id) do nothing          -- RULE 02: the device may already have opened one
  returning *;
$$;

revoke all on function public.escalate_overdue_hikes(interval) from public, anon, authenticated;
