-- Lobby TV slides can now show for 3 or 5 seconds (was 5 to 120).
alter table public.gym_tv drop constraint if exists gym_tv_lobby_secs_check;
alter table public.gym_tv add constraint gym_tv_lobby_secs_check check (lobby_secs between 3 and 120);
