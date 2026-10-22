-- Kick + DST-proof tick for lg3s-sync. Creating these functions schedules NOTHING.
-- The cron job itself lives in scheduler/lg3s_cron_DRAFT.sql and is applied only after approval.
create schema if not exists private;

create or replace function private.lg3s_kick_sync(p_mode text, p_ids bigint[] default null)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare v_req bigint;
begin
  if p_mode not in ('schedule','gamenight','sweep','backfill') then raise exception 'bad mode %', p_mode; end if;
  if exists (select 1 from public.lg3s_sync_runs where status = 'running' and started_at > now() - interval '15 minutes') then return null; end if;
  select net.http_post(
    url := 'https://lrgllzvwgvqagcpiyvfd.supabase.co/functions/v1/lg3s-sync',
    body := jsonb_build_object('mode', p_mode, 'ids', coalesce(to_jsonb(p_ids), 'null'::jsonb)),
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-sync-token', (select value from public.lg_sync_settings where key = 'sync_token')),
    timeout_milliseconds := 150000) into v_req;
  return v_req;
end $$;

-- Decides what (if anything) to run, in Eastern time, so DST never needs cron edits.
--  10:00 & 12:00 ET daily : schedule refresh + 7-day sweep (late finals / corrections)
--  Wed/Thu/Fri 19:45–02:00 ET : game-night poll every tick, ONLY while some game with scheduled_at <= now+15m is unverified (adaptive)
create or replace function private.lg3s_tick()
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare et timestamp := now() at time zone 'America/Toronto'; dow int; hm int;
begin
  dow := extract(isodow from et - interval '3 hours');  -- 00:00–02:59 counts as previous evening
  hm := extract(hour from et)::int * 100 + extract(minute from et)::int;
  if hm in (1000, 1200) then perform private.lg3s_kick_sync('schedule'); return 'schedule'; end if;
  if hm in (1005, 1205) then perform private.lg3s_kick_sync('sweep'); return 'sweep'; end if;
  if dow in (3,4,5) and (hm >= 1945 or hm <= 200) and exists (
      select 1 from public.lg3s_games where scheduled_at <= now() + interval '15 minutes' and scheduled_at > now() - interval '8 hours'
        and verification_status not in ('verified','corrected') and status not in ('postponed','cancelled')) then
    perform private.lg3s_kick_sync('gamenight'); return 'gamenight';
  end if;
  return 'idle';
end $$;

revoke all on function private.lg3s_kick_sync(text, bigint[]) from public, anon, authenticated;
revoke all on function private.lg3s_tick() from public, anon, authenticated;
