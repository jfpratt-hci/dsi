-- Applied 2026-10-19 with execute_sql.
-- The DSI stays on bench, squat, deadlift and clean. Every member is also asked for snatch, push press, squat snatch
-- and squat clean, so logging those four is free too (they feed workout targets, not the score).
create or replace function public.lift_import_guard() returns trigger
language plpgsql security definer set search_path to 'public' as $function$
begin
  if public.sys_on() then return new; end if;
  if new.source = 'import' and not public.is_pro() then
    raise exception 'History import is a DSI Pro feature';
  end if;
  if new.lift not in ('bench','squat','deadlift','clean','snatch','push_press','squat_snatch','squat_clean') and new.source <> 'workout' and not public.is_pro() then
    raise exception 'Logging other lifts is a DSI Pro feature';
  end if;
  return new;
end $function$;
