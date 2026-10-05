-- 07 · Calgary Hitmen stall requests (additive only)
-- New: table public.hitmen_stall_requests (RLS, read-only to clients), two private helpers,
-- six public SECURITY DEFINER RPCs (search_path=''). No existing table, policy or function is changed.

create table public.hitmen_stall_requests (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  season integer not null,
  requester_user_id uuid not null references auth.users(id) on delete cascade,
  discord_user_id text not null,
  discord_name text,
  discord_username text,
  requested_gamertag text not null check (char_length(requested_gamertag) between 2 and 40),
  locker_id uuid references public.team_player_lockers(id) on delete set null,
  matched_gamertag text not null,
  matched_roster_class text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','withdrawn')),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 280),
  link_id uuid references public.hitmen_discord_player_links(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.hitmen_stall_requests is
  'Player-initiated stall requests (Discord sign-in, no stall yet). Written only by SECURITY DEFINER RPCs; management approves or rejects.';

-- one open request per account
create unique index hitmen_stall_requests_one_pending
  on public.hitmen_stall_requests (team_id, season, requester_user_id) where status = 'pending';
create index hitmen_stall_requests_queue
  on public.hitmen_stall_requests (team_id, season, status, created_at desc);
create index hitmen_stall_requests_requester
  on public.hitmen_stall_requests (requester_user_id, created_at desc);
create index hitmen_stall_requests_locker
  on public.hitmen_stall_requests (locker_id);
create index hitmen_stall_requests_decided_by
  on public.hitmen_stall_requests (decided_by);
create index hitmen_stall_requests_link
  on public.hitmen_stall_requests (link_id);

alter table public.hitmen_stall_requests enable row level security;

revoke all on public.hitmen_stall_requests from anon, authenticated;
grant select on public.hitmen_stall_requests to authenticated;

-- one read policy (own rows, or Calgary management). Applied as a 2nd migration
-- (hitmen_stall_requests_single_read_policy) that merged the two original policies to clear
-- the multiple_permissive_policies advisor; this file shows the final state.
create policy hitmen_stall_requests_read on public.hitmen_stall_requests
  for select to authenticated
  using (requester_user_id = (select auth.uid())
         or (select private.vvhl_can_manage_team((select auth.uid()), team_id)));

-- ---------- private helpers ----------

-- Gamertag keys. exact: case + whitespace insensitive. fold: also treats I / l / | as the same glyph
-- (LeagueGaming and our roster disagree on these, e.g. "Bauer I 43 I" vs "Bauer l 43 l").
create function private.hitmen_gamertag_key(p_tag text, p_fold boolean)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_fold
    then translate(lower(regexp_replace(coalesce(p_tag, ''), '\s+', '', 'g')), 'l|', 'ii')
    else lower(regexp_replace(coalesce(p_tag, ''), '\s+', '', 'g'))
  end;
$$;

-- Discord identity of a user, read server-side from auth.identities (never from the client).
create function private.hitmen_discord_identity(p_user uuid)
returns table (discord_user_id text, discord_name text, discord_username text)
language sql
stable
security definer
set search_path = ''
as $$
  select i.provider_id,
         nullif(coalesce(i.identity_data->'custom_claims'->>'global_name', i.identity_data->>'full_name', i.identity_data->>'name'), ''),
         nullif(coalesce(i.identity_data->>'full_name', i.identity_data->>'user_name', i.identity_data->>'name'), '')
  from auth.identities i
  where i.user_id = p_user and i.provider = 'discord' and i.provider_id ~ '^[0-9]{5,25}$'
  order by i.last_sign_in_at desc nulls last
  limit 1;
$$;

revoke all on function private.hitmen_gamertag_key(text, boolean) from public, anon, authenticated;
revoke all on function private.hitmen_discord_identity(uuid) from public, anon, authenticated;

-- ---------- player RPCs ----------

-- What the signed-in user should see on My Stall.
create function public.hitmen_my_stall_request()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_team constant uuid := 'b0bcbdda-da9d-419d-8f61-b34937966d49';
  v_season constant integer := 55;
  v_user uuid := auth.uid();
  v_discord text;
  v_req public.hitmen_stall_requests%rowtype;
  v_locker uuid;
begin
  if v_user is null then
    return jsonb_build_object('signed_in', false);
  end if;
  select d.discord_user_id into v_discord from private.hitmen_discord_identity(v_user) d;
  select l.id into v_locker from public.team_player_lockers l
    where l.team_id = v_team and l.season = v_season and l.user_id = v_user limit 1;
  select * into v_req from public.hitmen_stall_requests r
    where r.team_id = v_team and r.season = v_season and r.requester_user_id = v_user
    order by r.created_at desc limit 1;
  return jsonb_build_object(
    'signed_in', true,
    'discord', v_discord is not null,
    'has_stall', v_locker is not null,
    'locker_id', v_locker,
    'is_manager', private.vvhl_can_manage_team(v_user, v_team),
    'access_removed', exists (select 1 from public.team_memberships m
                               where m.user_id = v_user and m.team_id = v_team and m.active = false),
    'request', case when v_req.id is null then null else jsonb_build_object(
      'id', v_req.id, 'status', v_req.status, 'requested_gamertag', v_req.requested_gamertag,
      'matched_gamertag', v_req.matched_gamertag, 'roster_class', v_req.matched_roster_class,
      'created_at', v_req.created_at, 'decided_at', v_req.decided_at, 'decision_note', v_req.decision_note) end
  );
end;
$$;

-- Create a pending request. Only the gamertag text comes from the client.
create function public.hitmen_request_stall(p_gamertag text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_team constant uuid := 'b0bcbdda-da9d-419d-8f61-b34937966d49';
  v_season constant integer := 55;
  v_user uuid := auth.uid();
  v_tag text := btrim(regexp_replace(coalesce(p_gamertag, ''), '\s+', ' ', 'g'));
  v_id record;
  v_n integer;
  v_locker public.team_player_lockers%rowtype;
  v_req public.hitmen_stall_requests%rowtype;
begin
  if v_user is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  select * into v_id from private.hitmen_discord_identity(v_user);
  if v_id.discord_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'discord_required');
  end if;
  if char_length(v_tag) < 2 or char_length(v_tag) > 40 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_gamertag');
  end if;
  if exists (select 1 from public.team_player_lockers l
             where l.team_id = v_team and l.season = v_season and l.user_id = v_user) then
    return jsonb_build_object('ok', false, 'reason', 'already_has_stall');
  end if;
  -- removed / archived accounts (deactivated Calgary membership) cannot self-serve a stall back
  if exists (select 1 from public.team_memberships m
             where m.user_id = v_user and m.team_id = v_team and m.active = false) then
    return jsonb_build_object('ok', false, 'reason', 'access_removed');
  end if;
  -- a management pre-link already exists for this Discord ID: the normal sign-in claim handles it
  if exists (select 1 from public.hitmen_discord_player_links k
             where k.team_id = v_team and k.season = v_season and k.discord_user_id = v_id.discord_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'already_prelinked');
  end if;
  if exists (select 1 from public.hitmen_stall_requests r
             where r.team_id = v_team and r.season = v_season and r.requester_user_id = v_user and r.status = 'pending') then
    return jsonb_build_object('ok', false, 'reason', 'request_pending');
  end if;
  select count(*) into v_n from public.hitmen_stall_requests r
    where r.requester_user_id = v_user and r.created_at > now() - interval '24 hours';
  if v_n >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  -- match: exact (case/space-insensitive) first, then the I/l fold; must be unique
  select count(*) into v_n from public.team_player_lockers l
    where l.team_id = v_team and l.season = v_season
      and private.hitmen_gamertag_key(l.gamertag, false) = private.hitmen_gamertag_key(v_tag, false);
  if v_n = 1 then
    select * into v_locker from public.team_player_lockers l
      where l.team_id = v_team and l.season = v_season
        and private.hitmen_gamertag_key(l.gamertag, false) = private.hitmen_gamertag_key(v_tag, false);
  elsif v_n = 0 then
    select count(*) into v_n from public.team_player_lockers l
      where l.team_id = v_team and l.season = v_season
        and private.hitmen_gamertag_key(l.gamertag, true) = private.hitmen_gamertag_key(v_tag, true);
    if v_n = 1 then
      select * into v_locker from public.team_player_lockers l
        where l.team_id = v_team and l.season = v_season
          and private.hitmen_gamertag_key(l.gamertag, true) = private.hitmen_gamertag_key(v_tag, true);
    end if;
  end if;
  if v_n > 1 then
    return jsonb_build_object('ok', false, 'reason', 'ambiguous');
  end if;
  if v_locker.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_match');
  end if;
  if v_locker.roster_class not in ('active_roster', 'tc') then
    return jsonb_build_object('ok', false, 'reason', 'not_on_roster');
  end if;
  if v_locker.user_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'stall_taken');
  end if;
  if exists (select 1 from public.hitmen_discord_player_links k
             where k.locker_id = v_locker.id and k.discord_user_id is not null
               and k.discord_user_id <> v_id.discord_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'stall_linked');
  end if;

  begin
    insert into public.hitmen_stall_requests
      (team_id, season, requester_user_id, discord_user_id, discord_name, discord_username,
       requested_gamertag, locker_id, matched_gamertag, matched_roster_class)
    values (v_team, v_season, v_user, v_id.discord_user_id, v_id.discord_name, v_id.discord_username,
            v_tag, v_locker.id, v_locker.gamertag, v_locker.roster_class)
    returning * into v_req;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'request_pending');
  end;

  return jsonb_build_object('ok', true, 'request', jsonb_build_object(
    'id', v_req.id, 'status', v_req.status, 'requested_gamertag', v_req.requested_gamertag,
    'matched_gamertag', v_req.matched_gamertag, 'roster_class', v_req.matched_roster_class,
    'created_at', v_req.created_at));
end;
$$;

-- Requester can withdraw their own pending request.
create function public.hitmen_withdraw_stall_request()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_n integer;
begin
  if v_user is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  update public.hitmen_stall_requests
     set status = 'withdrawn', decided_at = now(), updated_at = now()
   where requester_user_id = v_user and status = 'pending'
     and team_id = 'b0bcbdda-da9d-419d-8f61-b34937966d49' and season = 55;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', v_n > 0);
end;
$$;

-- ---------- management RPCs (owner / gm / agm / site admin, via private.vvhl_can_manage_team) ----------

create function public.hitmen_list_stall_requests(p_include_closed boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_team constant uuid := 'b0bcbdda-da9d-419d-8f61-b34937966d49';
  v_season constant integer := 55;
  v_out jsonb;
begin
  if not coalesce(private.vvhl_can_manage_team(auth.uid(), v_team), false) then
    raise exception 'management only' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(x.j order by x.pending desc, x.created_at desc), '[]'::jsonb) into v_out
  from (
    select r.status = 'pending' as pending, r.created_at,
      jsonb_build_object(
        'id', r.id, 'status', r.status, 'requested_gamertag', r.requested_gamertag,
        'locker_id', r.locker_id, 'matched_gamertag', r.matched_gamertag,
        'roster_class', coalesce(l.roster_class, r.matched_roster_class), 'position', l.position,
        'stall_taken', l.user_id is not null and l.user_id <> r.requester_user_id,
        'discord_user_id', r.discord_user_id, 'discord_name', r.discord_name, 'discord_username', r.discord_username,
        'access_removed', exists (select 1 from public.team_memberships m
                                   where m.user_id = r.requester_user_id and m.team_id = r.team_id and m.active = false),
        'same_stall_pending', (select count(*) from public.hitmen_stall_requests o
                                where o.locker_id = r.locker_id and o.status = 'pending' and o.id <> r.id),
        'created_at', r.created_at, 'decided_at', r.decided_at, 'decision_note', r.decision_note) as j
    from public.hitmen_stall_requests r
    left join public.team_player_lockers l on l.id = r.locker_id
    where r.team_id = v_team and r.season = v_season
      and (r.status = 'pending' or (p_include_closed and r.created_at > now() - interval '30 days'))
    order by r.status = 'pending' desc, r.created_at desc
    limit 60
  ) x;
  return v_out;
end;
$$;

-- Approve: create/use the Discord pre-link row, then attach stall + player membership
-- exactly like claim_my_hitmen_discord_locker does (it is not called, because it only accepts active_roster).
create function public.hitmen_approve_stall_request(p_request_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_team constant uuid := 'b0bcbdda-da9d-419d-8f61-b34937966d49';
  v_season constant integer := 55;
  v_me uuid := auth.uid();
  v_req public.hitmen_stall_requests%rowtype;
  v_locker public.team_player_lockers%rowtype;
  v_link public.hitmen_discord_player_links%rowtype;
  v_role text;
  v_active boolean;
begin
  if not coalesce(private.vvhl_can_manage_team(v_me, v_team), false) then
    raise exception 'management only' using errcode = '42501';
  end if;
  select * into v_req from public.hitmen_stall_requests
    where id = p_request_id and team_id = v_team and season = v_season for update;
  if v_req.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_req.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'not_pending', 'status', v_req.status);
  end if;
  select m.role, m.active into v_role, v_active from public.team_memberships m
    where m.user_id = v_req.requester_user_id and m.team_id = v_team;
  if v_active = false then
    return jsonb_build_object('ok', false, 'reason', 'access_removed');
  end if;
  if exists (select 1 from public.team_player_lockers l
             where l.team_id = v_team and l.season = v_season and l.user_id = v_req.requester_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'already_has_stall');
  end if;
  select * into v_locker from public.team_player_lockers
    where id = v_req.locker_id and team_id = v_team and season = v_season for update;
  if v_locker.id is null or v_locker.roster_class not in ('active_roster', 'tc') then
    return jsonb_build_object('ok', false, 'reason', 'not_on_roster');
  end if;
  if v_locker.user_id is not null and v_locker.user_id <> v_req.requester_user_id then
    return jsonb_build_object('ok', false, 'reason', 'stall_taken');
  end if;
  if exists (select 1 from public.hitmen_discord_player_links k
             where k.team_id = v_team and k.season = v_season and k.discord_user_id = v_req.discord_user_id
               and k.locker_id is distinct from v_locker.id) then
    return jsonb_build_object('ok', false, 'reason', 'discord_linked_elsewhere');
  end if;

  select * into v_link from public.hitmen_discord_player_links k
    where k.team_id = v_team and k.season = v_season
      and (k.locker_id = v_locker.id or (k.locker_id is null and lower(k.roster_alias) = lower(v_locker.gamertag)))
    order by (k.locker_id = v_locker.id) desc nulls last
    limit 1 for update;
  if v_link.id is not null and v_link.discord_user_id is not null and v_link.discord_user_id <> v_req.discord_user_id then
    return jsonb_build_object('ok', false, 'reason', 'stall_linked');
  end if;

  if v_link.id is null then
    if exists (select 1 from public.hitmen_discord_player_links k
               where k.team_id = v_team and k.season = v_season and k.roster_alias = v_locker.gamertag) then
      return jsonb_build_object('ok', false, 'reason', 'alias_conflict');
    end if;
    insert into public.hitmen_discord_player_links
      (team_id, season, locker_id, roster_alias, discord_user_id, status, claimed_user_id, claimed_at, notes)
    values (v_team, v_season, v_locker.id, v_locker.gamertag, v_req.discord_user_id, 'claimed',
            v_req.requester_user_id, now(), 'Stall request approved by management')
    returning * into v_link;
  else
    update public.hitmen_discord_player_links
       set locker_id = v_locker.id, discord_user_id = v_req.discord_user_id, status = 'claimed',
           claimed_user_id = v_req.requester_user_id, claimed_at = now(), updated_at = now(),
           notes = concat_ws('; ', nullif(notes, ''), 'Stall request approved by management')
     where id = v_link.id
    returning * into v_link;
  end if;

  update public.team_player_lockers
     set user_id = v_req.requester_user_id, updated_at = now()
   where id = v_locker.id;

  if v_role is null then
    insert into public.team_memberships (user_id, team_id, role, active)
    values (v_req.requester_user_id, v_team, 'player', true);
  end if;

  update public.hitmen_stall_requests
     set status = 'approved', decided_by = v_me, decided_at = now(), link_id = v_link.id, updated_at = now()
   where id = v_req.id;

  update public.hitmen_stall_requests
     set status = 'rejected', decided_by = v_me, decided_at = now(), updated_at = now(),
         decision_note = 'This stall was assigned to another account.'
   where locker_id = v_locker.id and status = 'pending' and id <> v_req.id;

  return jsonb_build_object('ok', true, 'locker_id', v_locker.id, 'gamertag', v_locker.gamertag, 'link_id', v_link.id);
end;
$$;

create function public.hitmen_reject_stall_request(p_request_id uuid, p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_team constant uuid := 'b0bcbdda-da9d-419d-8f61-b34937966d49';
  v_n integer;
begin
  if not coalesce(private.vvhl_can_manage_team(auth.uid(), v_team), false) then
    raise exception 'management only' using errcode = '42501';
  end if;
  update public.hitmen_stall_requests
     set status = 'rejected', decided_by = auth.uid(), decided_at = now(), updated_at = now(),
         decision_note = nullif(left(btrim(coalesce(p_note, '')), 280), '')
   where id = p_request_id and team_id = v_team and season = 55 and status = 'pending';
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', v_n > 0, 'reason', case when v_n = 0 then 'not_pending' end);
end;
$$;

revoke all on function public.hitmen_my_stall_request() from public, anon;
revoke all on function public.hitmen_request_stall(text) from public, anon;
revoke all on function public.hitmen_withdraw_stall_request() from public, anon;
revoke all on function public.hitmen_list_stall_requests(boolean) from public, anon;
revoke all on function public.hitmen_approve_stall_request(uuid) from public, anon;
revoke all on function public.hitmen_reject_stall_request(uuid, text) from public, anon;
grant execute on function public.hitmen_my_stall_request() to authenticated;
grant execute on function public.hitmen_request_stall(text) to authenticated;
grant execute on function public.hitmen_withdraw_stall_request() to authenticated;
grant execute on function public.hitmen_list_stall_requests(boolean) to authenticated;
grant execute on function public.hitmen_approve_stall_request(uuid) to authenticated;
grant execute on function public.hitmen_reject_stall_request(uuid, text) to authenticated;
