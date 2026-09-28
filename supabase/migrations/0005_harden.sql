-- Lock down internal functions flagged by the security advisor
alter function public.sys_on() set search_path = public, pg_temp;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.groups_room() from public, anon, authenticated;
revoke execute on function public.lift_entries_before() from public, anon, authenticated;
revoke execute on function public.profiles_after() from public, anon, authenticated;
revoke execute on function public.profiles_guard() from public, anon, authenticated;
revoke execute on function public.protests_after_insert() from public, anon, authenticated;
revoke execute on function public.workout_logs_before() from public, anon, authenticated;
revoke execute on function public.sync_division(uuid) from public, anon, authenticated;

-- Signed in only
revoke execute on function public.room_for(text, uuid, text) from public, anon;
revoke execute on function public.rule_protest(uuid, text, text) from public, anon;
grant execute on function public.room_for(text, uuid, text) to authenticated;
grant execute on function public.rule_protest(uuid, text, text) to authenticated;

-- profile_claims is intentionally private: no client policies, service role only.
comment on table public.profile_claims is 'Private. Read only by the handle_new_user trigger.';

-- Policy helpers are only used in signed in policies
revoke execute on function public.my_profile_id() from public, anon;
revoke execute on function public.has_role(text[]) from public, anon;
revoke execute on function public.can_access_room(uuid) from public, anon;
grant execute on function public.my_profile_id() to authenticated;
grant execute on function public.has_role(text[]) to authenticated;
grant execute on function public.can_access_room(uuid) to authenticated;
