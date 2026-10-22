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

-- ===== Threes Bot (20261022150000_lg3s_threes_bot) =====
alter table public.lg3s_editorial_posts drop column if exists superseded_by;
-- delete edge function lg3s-threes-bot via dashboard/CLI first.
delete from public.lg3s_editorial_posts where feature is not null;
drop index if exists public.lg3s_editorial_feature_period_uq;
alter table public.lg3s_editorial_posts drop column if exists feature, drop column if exists period_key, drop column if exists prompt_version, drop column if exists output_json, drop column if exists review_reasons;
alter table public.lg3s_editorial_posts drop constraint if exists lg3s_editorial_posts_article_type_check;
alter table public.lg3s_editorial_posts add constraint lg3s_editorial_posts_article_type_check check (article_type in ('recap','spotlight','power_rankings','night_wrap','preview'));
alter table public.lg3s_editorial_posts drop constraint if exists lg3s_editorial_posts_status_check;
alter table public.lg3s_editorial_posts add constraint lg3s_editorial_posts_status_check check (status in ('pending_review','approved','published','rejected'));
drop function if exists public.lg3s_threes_feed(text,text), public.lg3s_threes_prompt(text), public.lg3s_store_threes(jsonb), public.lg3s_ingest_roster(jsonb), private.lg3s_kick_threes(jsonb),
  private.lg3s_feed_daily_three(date), private.lg3s_feed_power_rankings(int,date), private.lg3s_feed_duo_index(int,date,int), private.lg3s_duo_pairs(date),
  private.lg3s_feed_roster_wire(bigint), private.lg3s_feed_pick3(int), private.lg3s_week_bounds(int), private.lg3s_fpts(int,int,int,int,boolean);
drop view if exists private.lg3s_v_skater_results;
drop table if exists public.lg3s_generation_runs, public.lg3s_roster_snapshot_rows, public.lg3s_roster_snapshots, public.lg3s_prompts;
