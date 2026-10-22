-- Rollback for LG3S Stage-2 migrations. Drops ONLY lg3s_* objects. Run after taking a data export if rows exist:
--   copy (select * from public.lg3s_games) to stdout ... (or pg_dump -t 'public.lg3s_*')
begin;
drop view if exists public.lg3s_public_game_facts; drop function if exists private.lg3s_generate_drafts(); drop function if exists private.lg3s_check_draft_accuracy(); drop function if exists private.lg3s_recap_facts(bigint); drop function if exists private.lg3s_week_of(date); drop function if exists private.lg3s_tick();
select cron.unschedule(jobname) from cron.job where jobname like 'lg3s-%';
drop view if exists public.lg3s_public_goalie_leaders, public.lg3s_public_skater_leaders, public.lg3s_public_official_standings,
  public.lg3s_public_standings, public.lg3s_public_player_lines, public.lg3s_public_games;
drop function if exists public.lg3s_ingest_game(jsonb);
drop function if exists public.lg3s_upsert_schedule(jsonb, bigint);
drop function if exists private.lg3s_kick_sync(text);
drop table if exists public.lg3s_editorial_posts, public.lg3s_corrections, public.lg3s_sync_runs, public.lg3s_standings_snapshots,
  public.lg3s_player_game_lines, public.lg3s_games, public.lg3s_source_snapshots, public.lg3s_teams;
drop type if exists public.lg3s_verification_status;
commit;
