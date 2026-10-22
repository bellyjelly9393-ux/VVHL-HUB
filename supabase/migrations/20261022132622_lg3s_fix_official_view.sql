-- Fix: official standings view must only reference anon-granted columns (select * hit id/payload_hash -> 42501).
drop view if exists public.lg3s_public_official_standings;
create view public.lg3s_public_official_standings with (security_invoker = true) as
select s.captured_at, s.group_code, s.lg_team_id, s.rank, s.gp, s.w, s.l, s.otw, s.otl, s.pts, s.gf, s.ga, s.gd, s.streak, s.source_url
from public.lg3s_standings_snapshots s
where s.source = 'lg_official' and s.captured_at = (select max(x.captured_at) from public.lg3s_standings_snapshots x where x.source = 'lg_official');
grant select on public.lg3s_public_official_standings to anon, authenticated;
