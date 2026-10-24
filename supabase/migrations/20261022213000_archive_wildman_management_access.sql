-- Archive Wildman Hockey management access (troy92 GM, williamson_91 AGM).
-- Deactivates memberships only; no rows deleted. Wildman-tagged VOD sessions, OBS channel
-- (wildman-main / Elitechel Media), HUT interest data and the team row are untouched.
-- Admin accounts keep full access to all of it. To restore:
--   update public.team_memberships set active = true where id in
--   ('cfa58b6d-185b-467f-98b2-623e59bcab4f','7a750fd4-9bac-4935-9397-32f8817888d3');
update public.team_memberships
   set active = false
 where id in ('cfa58b6d-185b-467f-98b2-623e59bcab4f','7a750fd4-9bac-4935-9397-32f8817888d3')
   and team_id = '5f36117c-7a51-4514-bf70-d4c672b41e48';
