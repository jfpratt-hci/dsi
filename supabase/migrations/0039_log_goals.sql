-- A member can set their own goal over the one DI suggests, per part, per day. Kept on that day's log as
-- { "<item key>": number }. The app, the results page and Dandy TV use it before DI's number.
alter table public.workout_logs add column if not exists goals jsonb not null default '{}'::jsonb;
