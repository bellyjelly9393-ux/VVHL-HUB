create table public.hitmen_market_snapshots (
team_id uuid primary key references public.teams(id), season integer not null default 55 check(season=55),
payload jsonb not null, fetched_at timestamptz not null);
create table public.hitmen_bid_targets (
team_id uuid references public.teams(id), player_key text not null, season integer not null default 55 check(season=55),
priority text not null default 'watch' check(priority in ('watch','target','pass')),
target_bid integer not null default 0 check(target_bid>=0 and target_bid<=30000000),
max_bid integer not null default 0 check(max_bid>=target_bid and max_bid<=30000000),
notes text not null default '', eligibility text not null default 'unverified' check(eligibility in ('unverified','confirmed','ineligible')),
eligibility_note text not null default '', updated_at timestamptz not null default now(),
primary key(team_id,season,player_key));
create table public.hitmen_player_reports (
id uuid primary key default gen_random_uuid(), team_id uuid not null references public.teams(id),
player_key text not null, season integer not null default 55 check(season=55),
review_id uuid references public.vod_review_sessions(id), summary text not null check(length(trim(summary))>0),
strengths text not null default '', concerns text not null default '', created_at timestamptz not null default now());
create index hitmen_reports_player on public.hitmen_player_reports(team_id,season,player_key);
alter table public.hitmen_market_snapshots enable row level security;
revoke all on public.hitmen_market_snapshots from anon,authenticated;
grant select,insert,update on public.hitmen_market_snapshots to authenticated;
create policy hitmen_management on public.hitmen_market_snapshots for all to authenticated using (private.vvhl_can_manage_team(auth.uid(), team_id) and exists(select 1 from public.teams t where t.id=team_id and t.name='Calgary Hitmen')) with check (private.vvhl_can_manage_team(auth.uid(), team_id) and exists(select 1 from public.teams t where t.id=team_id and t.name='Calgary Hitmen'));

alter table public.hitmen_bid_targets enable row level security;
revoke all on public.hitmen_bid_targets from anon,authenticated;
grant select,insert,update on public.hitmen_bid_targets to authenticated;
create policy hitmen_management on public.hitmen_bid_targets for all to authenticated using (private.vvhl_can_manage_team(auth.uid(), team_id) and exists(select 1 from public.teams t where t.id=team_id and t.name='Calgary Hitmen')) with check (private.vvhl_can_manage_team(auth.uid(), team_id) and exists(select 1 from public.teams t where t.id=team_id and t.name='Calgary Hitmen'));

alter table public.hitmen_player_reports enable row level security;
revoke all on public.hitmen_player_reports from anon,authenticated;
grant select,insert,update on public.hitmen_player_reports to authenticated;
create policy hitmen_management on public.hitmen_player_reports for all to authenticated using (private.vvhl_can_manage_team(auth.uid(), team_id) and exists(select 1 from public.teams t where t.id=team_id and t.name='Calgary Hitmen')) with check (private.vvhl_can_manage_team(auth.uid(), team_id) and exists(select 1 from public.teams t where t.id=team_id and t.name='Calgary Hitmen') and (review_id is null or exists(select 1 from public.vod_review_sessions v where v.id=review_id and v.team_id=hitmen_player_reports.team_id)));
