-- Security & rule tests. Run after auth_stub.sql + migrations. Any failure aborts (ON_ERROR_STOP).
\set ON_ERROR_STOP on
grant select, insert, update, delete on all tables in schema public to authenticated;
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');

-- helper: expect a statement to fail
create function pg_temp.expect_fail(sql text, label text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then raise notice 'PASS (blocked): %', label; return; end;
  raise exception 'FAIL: % was allowed', label;
end $$;
grant execute on function pg_temp.expect_fail(text, text) to authenticated;

-- ── act as user A
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
set request.jwt.claim.role = 'authenticated';
insert into public.hikes (id, destination, started_at, planned_return_at)
  values ('11111111-0000-0000-0000-000000000001', 'Medeu', now() - interval '5 hours', now() - interval '1 hour');
insert into public.hikes (id, destination, started_at, planned_return_at)
  values ('11111111-0000-0000-0000-000000000002', 'Kok-Zhailau', now(), now() + interval '4 hours');
insert into public.location_points (id, hike_id, recorded_at, lat, lng, accuracy_m)
  values (gen_random_uuid(), '11111111-0000-0000-0000-000000000002', now(), 43.15, 77.05, 8);
insert into public.trusted_contacts (name, phone) values ('Ana', '+77011234567');
select pg_temp.expect_fail($$insert into public.trusted_contacts (name) values ('No channel')$$, 'contact without phone/telegram');
select pg_temp.expect_fail($$insert into public.trusted_contacts (name, phone) values ('Bad', '8701')$$, 'non-E.164 phone');
select pg_temp.expect_fail($$insert into public.hikes (id, destination, started_at, planned_return_at)
  values (gen_random_uuid(), 'X', now(), now() - interval '1 hour')$$, 'return before start');

-- RULE 02 on device side
insert into public.incidents (id, hike_id, source, peak_level, peak_score, reasons)
  values (gen_random_uuid(), '11111111-0000-0000-0000-000000000002', 'DEVICE', 'CRITICAL', 100, '{MANUAL_SOS}');
select pg_temp.expect_fail($$insert into public.incidents (id, hike_id, source, peak_level, peak_score)
  values (gen_random_uuid(), '11111111-0000-0000-0000-000000000002', 'DEVICE', 'HIGH', 70)$$, 'second incident for same hike');
select pg_temp.expect_fail($$insert into public.incidents (id, hike_id, source, peak_level, peak_score)
  values (gen_random_uuid(), '11111111-0000-0000-0000-000000000001', 'SERVER_OVERDUE', 'HIGH', 70)$$, 'device faking a server incident');
select pg_temp.expect_fail($$update public.incidents set contact_notified_at = now()$$, 'device claiming contact was notified');
select pg_temp.expect_fail($$select public.escalate_overdue_hikes()$$, 'user calling server escalation');

-- ── act as user B: must see nothing of A and cannot write into A's hike
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  if (select count(*) from public.hikes) + (select count(*) from public.location_points)
     + (select count(*) from public.trusted_contacts) + (select count(*) from public.incidents) <> 0
  then raise exception 'FAIL: user B can read user A data'; end if;
  raise notice 'PASS: user B sees 0 rows of user A';
end $$;
select pg_temp.expect_fail($$insert into public.location_points (id, hike_id, recorded_at, lat, lng)
  values (gen_random_uuid(), '11111111-0000-0000-0000-000000000002', now(), 1, 1)$$, 'B writing GPS into A''s hike');
select pg_temp.expect_fail($$insert into public.hikes (id, user_id, destination, started_at, planned_return_at)
  values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'spoof', now(), now() + interval '1 hour')$$, 'B creating hike as A');
update public.hikes set status = 'CANCELLED';  -- affects 0 rows under RLS
reset role;
do $$ begin
  if exists (select 1 from public.hikes where status = 'CANCELLED') then raise exception 'FAIL: B modified A hikes'; end if;
  raise notice 'PASS: B could not modify A hikes';
end $$;

-- ── server: overdue escalation (runs as owner, like pg_cron)
do $$ declare n int; begin
  select count(*) into n from public.escalate_overdue_hikes();
  if n <> 1 then raise exception 'FAIL: expected 1 overdue incident, got %', n; end if;
  select count(*) into n from public.escalate_overdue_hikes();
  if n <> 0 then raise exception 'FAIL: overdue escalation is not idempotent'; end if;
  raise notice 'PASS: server escalates the overdue hike exactly once';
end $$;

-- ── RULE 03 as user A
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
update public.incidents set status = 'RESOLVED', resolved_at = now() where hike_id = '11111111-0000-0000-0000-000000000002';
select pg_temp.expect_fail($$update public.incidents set status = 'OPEN', resolved_at = null
  where hike_id = '11111111-0000-0000-0000-000000000002'$$, 're-opening a resolved incident');
update public.hikes set status = 'COMPLETED', completed_at = now() where id = '11111111-0000-0000-0000-000000000001';
select pg_temp.expect_fail($$update public.hikes set status = 'ACTIVE', completed_at = null
  where id = '11111111-0000-0000-0000-000000000001'$$, 're-activating a completed hike');
delete from public.location_points;  -- no delete policy → 0 rows affected
reset role;
do $$ begin
  if not exists (select 1 from public.location_points) then raise exception 'FAIL: GPS history was deleted'; end if;
  raise notice 'PASS: GPS history is append-only';
end $$;
\echo ALL DATABASE TESTS PASSED
