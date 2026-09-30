-- All fixtures and mutations roll back; tests exercise actual database roles and RLS.
begin;
insert into auth.users(id,email) values ('00000000-0000-4000-8000-000000000901','wildman-stall-test@example.invalid');
insert into auth.identities(user_id,provider,provider_id,identity_data) values('00000000-0000-4000-8000-000000000901','discord','999999999999999901','{"sub":"999999999999999901"}');
select set_config('test.stall',(select player_id::text from public.wildman_stalls order by player_id limit 1),true);
insert into private.wildman_stall_owners(player_id,discord_id) values(current_setting('test.stall')::uuid,'999999999999999901');
set local role anon;
do $$ begin
 if (select count(*) from public.wildman_stalls) < 8 then raise exception 'Public read failed'; end if;
 begin update public.wildman_stalls set jersey_name='FORBIDDEN'; raise exception 'Anonymous write allowed'; exception when insufficient_privilege then null; end;
 begin perform public.bind_wildman_stall(current_setting('test.stall')::uuid,'999999999999999902'); raise exception 'Anonymous binding allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000901',true);
set local role authenticated;
do $$ declare n integer; begin
 update public.wildman_stalls set jersey_name='TEST OWNER' where player_id=current_setting('test.stall')::uuid;
 get diagnostics n=row_count; if n<>1 then raise exception 'Owner save failed'; end if;
 update public.wildman_stalls set jersey_name='FORBIDDEN' where player_id<>current_setting('test.stall')::uuid;
 get diagnostics n=row_count; if n<>0 then raise exception 'Cross-player edit allowed'; end if;
 begin perform public.bind_wildman_stall(current_setting('test.stall')::uuid,'999999999999999902'); raise exception 'Player binding allowed'; exception when insufficient_privilege then null; end;
 begin update public.wildman_stalls set jersey_number='100' where player_id=current_setting('test.stall')::uuid; raise exception 'Invalid number accepted'; exception when check_violation then null; end;
 begin select count(*) into n from private.wildman_stall_owners; raise exception 'Private ownership visible'; exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Forged user metadata cannot grant ownership, and revoked IDs lose access immediately.
delete from private.wildman_stall_owners where player_id=current_setting('test.stall')::uuid;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000901","user_metadata":{"provider_id":"999999999999999901","role":"admin"}}',true);
set local role authenticated;
do $$ declare n integer; begin
 update public.wildman_stalls set jersey_name='FORBIDDEN' where player_id=current_setting('test.stall')::uuid;
 get diagnostics n=row_count; if n<>0 then raise exception 'Revoked/forged owner could save'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select user_id::text from private.wildman_stall_managers limit 1),true);
set local role authenticated;
do $$ begin
 perform public.bind_wildman_stall(current_setting('test.stall')::uuid,'999999999999999902');
 perform public.bind_wildman_stall(current_setting('test.stall')::uuid,null);
 if not (public.wildman_stall_access()->>'manager')::boolean then raise exception 'Manager access failed'; end if;
end $$;
reset role;
rollback;
