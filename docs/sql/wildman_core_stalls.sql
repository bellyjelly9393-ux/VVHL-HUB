-- Public jersey cosmetics; Discord ownership remains private and is never self-claimed.
create schema if not exists private;
create table public.wildman_stalls (
 player_id uuid primary key references public.esports_players(id) on delete cascade,
 jersey_name text not null check (char_length(jersey_name) between 1 and 24),
 jersey_number text not null default '' check (jersey_number ~ '^[0-9]{0,2}$')
);
alter table public.wildman_stalls enable row level security;
revoke all on public.wildman_stalls from anon, authenticated;
grant select on public.wildman_stalls to anon, authenticated;
grant update(jersey_name,jersey_number) on public.wildman_stalls to authenticated;
create table private.wildman_stall_managers (user_id uuid primary key references auth.users(id) on delete cascade);
create table private.wildman_stall_owners (
 player_id uuid primary key references public.wildman_stalls(player_id) on delete cascade,
 discord_id text unique not null check (discord_id ~ '^[0-9]{17,20}$')
);
alter table private.wildman_stall_managers enable row level security;
alter table private.wildman_stall_owners enable row level security;
revoke all on private.wildman_stall_managers,private.wildman_stall_owners from public,anon,authenticated;
insert into private.wildman_stall_managers(user_id)
 select id from public.profiles where role='admin'
 union select m.user_id from public.team_memberships m join public.teams t on t.id=m.team_id where t.name='Wildman Hockey' and m.active and m.role in ('owner','gm','agm');
create function private.wildman_stall_manager() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from private.wildman_stall_managers where user_id=auth.uid());
$$;
create function private.wildman_stall_editable(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (
 private.wildman_stall_manager() or (
 exists(select 1 from private.wildman_stall_owners o join auth.identities i on i.provider='discord' and i.provider_id=o.discord_id where o.player_id=target and i.user_id=auth.uid())
 and exists(select 1 from public.esports_event_rosters r join public.esports_teams t on t.id=r.team_id where r.player_id=target and r.active and t.slug='wildman-hockey')
 ));
$$;
revoke all on function private.wildman_stall_manager(),private.wildman_stall_editable(uuid) from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.wildman_stall_manager(),private.wildman_stall_editable(uuid) to authenticated;
create policy "Public jersey appearance" on public.wildman_stalls for select to anon,authenticated using(true);
create policy "Assigned Discord player edits appearance" on public.wildman_stalls for update to authenticated using(private.wildman_stall_editable(player_id)) with check(private.wildman_stall_editable(player_id));
create function public.wildman_stall_access() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('manager',private.wildman_stall_manager(),'editable',coalesce((select jsonb_agg(player_id) from public.wildman_stalls where private.wildman_stall_editable(player_id)),'[]'::jsonb));
$$;
-- Privileged identity binding requires the protected manager allowlist. No metadata or display-name matching.
create function private.bind_wildman_stall(target uuid,discord text) returns void language plpgsql security definer set search_path='' as $$
 begin
 if auth.uid() is null or not private.wildman_stall_manager() then raise exception 'Management permission required' using errcode='42501'; end if;
 if discord is null then delete from private.wildman_stall_owners where player_id=target; return; end if;
 if discord !~ '^[0-9]{17,20}$' then raise exception 'Enter a numeric Discord user ID (17–20 digits)'; end if;
 insert into private.wildman_stall_owners(player_id,discord_id) values(target,discord) on conflict(player_id) do update set discord_id=excluded.discord_id;
 end;
$$;
create function public.bind_wildman_stall(target uuid,discord text) returns void language sql security invoker set search_path='' as $$ select private.bind_wildman_stall(target,discord); $$;
revoke all on function public.wildman_stall_access(),public.bind_wildman_stall(uuid,text),private.bind_wildman_stall(uuid,text) from public,anon;
grant execute on function public.wildman_stall_access(),public.bind_wildman_stall(uuid,text),private.bind_wildman_stall(uuid,text) to authenticated;
insert into public.wildman_stalls(player_id,jersey_name,jersey_number)
 select distinct p.id,
 case when lower(p.gamertag)='the rusty knot' then 'RUSTY' else left(upper(p.gamertag),24) end,
 case lower(p.gamertag) when 'the rusty knot' then '19' when 'williamson20' then '20' when 'williamsonx88' then '88' else coalesce(r.jersey_number,'') end
 from public.esports_event_rosters r join public.esports_teams t on t.id=r.team_id join public.esports_players p on p.id=r.player_id
 where t.slug='wildman-hockey' and r.active on conflict do nothing;
