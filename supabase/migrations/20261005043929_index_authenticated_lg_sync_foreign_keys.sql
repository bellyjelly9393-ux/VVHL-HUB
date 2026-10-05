create index if not exists lg_auth_snapshots_captured_by_idx
  on public.lg_auth_snapshots (captured_by);
create index if not exists lg_roster_change_candidates_snapshot_idx
  on public.lg_roster_change_candidates (source_snapshot_id);
create index if not exists lg_roster_change_candidates_reviewed_by_idx
  on public.lg_roster_change_candidates (reviewed_by);
create index if not exists lg_roster_players_source_capture_idx
  on public.lg_roster_players (source_capture_id);
