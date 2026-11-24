-- HIKE SAFE — explicit table privileges (least privilege).
-- The project was created with "Automatically expose new tables" OFF,
-- so nothing is reachable through the Data API until granted here.
-- RLS (see init migration) still decides WHICH rows each user can touch.
-- `anon` (signed-out) gets nothing.

grant usage on schema public to authenticated;

grant select, insert, update, delete on public.profiles, public.trusted_contacts to authenticated;
grant select, insert, update          on public.hikes, public.incidents        to authenticated;
grant select, insert                  on public.location_points                to authenticated; -- append-only GPS history
