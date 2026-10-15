-- Applied to the Dandy Strength project on 2026-10-12 (dandy_tv_board_names).
-- Dandy TV is one product with two boards: the gym board and the lobby board. A screen can show either or flip between them.
alter table public.signage_screens drop constraint if exists signage_screens_mode_check;
update public.signage_screens set mode = 'gym_board' where mode = 'class_board';
alter table public.signage_screens add constraint signage_screens_mode_check check (mode in ('lobby','gym_board','mixed'));
comment on table public.signage_screens is 'Dandy TV screens. mode: lobby (lobby board), gym_board, or mixed (owner flips between the two).';
comment on table public.signage_slides is 'Dandy TV lobby board slides.';
