create table if not exists public.lg_auth_snapshots (
  id uuid primary key default gen_random_uuid(),
  captured_by uuid references auth.users(id) on delete set null,
  capture_type text not null check (capture_type in ('roster','weekly_lines','transactions','game','schedule','stats','unknown')),
  league text not null default 'LGCHL',
  season integer,
  source_url text not null,
  source_title text,
  captured_at timestamptz not null,
  source_hash text not null unique,
  payload jsonb not null default '{}'::jsonb,
  parsed jsonb not null default '{}'::jsonb,
  parse_status text not null default 'captured' check (parse_status in ('captured','parsed','partial','rejected','error')),
  parse_error text,
  created_at timestamptz not null default now()
);

alter table public.lg_auth_snapshots enable row level security;
revoke all on table public.lg_auth_snapshots from anon, authenticated;

create index if not exists lg_auth_snapshots_type_captured_idx
  on public.lg_auth_snapshots (capture_type, captured_at desc);

create table if not exists public.lg_roster_change_candidates (
  id uuid primary key default gen_random_uuid(),
  source_snapshot_id uuid not null references public.lg_auth_snapshots(id) on delete cascade,
  season integer not null,
  league text not null,
  lg_user_id bigint,
  gamertag text not null,
  event_type text not null check (event_type in (
    'roster_added','roster_removed','team_change','tc_call_up','sent_to_tc',
    'position_change','salary_change','management_change','gamertag_change'
  )),
  previous_state jsonb,
  current_state jsonb,
  review_status text not null default 'pending' check (review_status in ('pending','confirmed','ignored')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null
);

alter table public.lg_roster_change_candidates enable row level security;
revoke all on table public.lg_roster_change_candidates from anon, authenticated;

create index if not exists lg_roster_change_candidates_review_idx
  on public.lg_roster_change_candidates (review_status, created_at desc);
create index if not exists lg_roster_change_candidates_uid_idx
  on public.lg_roster_change_candidates (lg_user_id, season, league)
  where lg_user_id is not null;

alter table public.lg_roster_players
  add column if not exists lg_user_id bigint,
  add column if not exists roster_role text,
  add column if not exists source_capture_id uuid references public.lg_auth_snapshots(id) on delete set null;

create index if not exists lg_roster_players_uid_idx
  on public.lg_roster_players (season, league, lg_user_id)
  where lg_user_id is not null;
