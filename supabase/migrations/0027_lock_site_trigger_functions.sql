-- Applied to the Dandy Strength project on 2026-10-12 as migration 20261012213705 (lock_site_trigger_functions).

revoke execute on function public.gym_sites_guard() from public, anon, authenticated;
revoke execute on function public.text_lines_guard() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
revoke execute on function public.storage_gym(text) from public, anon;
grant execute on function public.storage_gym(text) to authenticated;
