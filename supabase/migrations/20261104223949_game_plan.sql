-- Game plan (a sales person's home page) and the team voyage.
-- Stores only what the register cannot tell: personal settings, follow-ups logged on quotes, high-fives
-- between colleagues and the team's monthly goal. Activity (quotes, wins, streaks, XP) is computed from the
-- register in the browser (src/lib/gamePlan.ts). Nothing here holds money.

-------------------------------------------------------------------------------
-- Helper: the sales person linked to the signed-in user (profiles.sales_person_id)
-------------------------------------------------------------------------------

create or replace function public.my_sales_person_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select sales_person_id from public.profiles where id = (select auth.uid())
$$;

-------------------------------------------------------------------------------
-- Personal settings: monthly goal, "what I'm working for", colour, sections shown. Private to each user.
-------------------------------------------------------------------------------

create table public.user_prefs (
  user_id uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  game_plan jsonb not null default '{}'::jsonb
    check (jsonb_typeof(game_plan) = 'object' and octet_length(game_plan::text) <= 8000),
  updated_at timestamptz not null default now()
);

-------------------------------------------------------------------------------
-- The team's goal for a month, in confirmed jobs (containers on the ship). Set by admins.
-------------------------------------------------------------------------------

create table public.team_goals (
  month date primary key check (extract(day from month) = 1),
  confirmed_jobs integer not null check (confirmed_jobs between 1 and 100000),
  updated_by uuid default auth.uid() references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index team_goals_updated_by_idx on public.team_goals (updated_by);

-------------------------------------------------------------------------------
-- Follow-ups a sales person logs on quoted enquiries: at most one per enquiry and day.
-- followed_up_on is the sales person's local date, sent by the app.
-------------------------------------------------------------------------------

create table public.follow_ups (
  id bigint generated always as identity primary key,
  enquiry_id uuid not null references public.enquiries (id) on delete cascade,
  sales_person_id uuid not null references public.sales_persons (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  followed_up_on date not null,
  created_at timestamptz not null default now(),
  unique (enquiry_id, sales_person_id, followed_up_on)
);
create index follow_ups_person_day_idx on public.follow_ups (sales_person_id, followed_up_on desc);
create index follow_ups_user_idx on public.follow_ups (user_id);

-------------------------------------------------------------------------------
-- High-fives between colleagues. Managers without a sales person can give them too.
-------------------------------------------------------------------------------

create table public.high_fives (
  id bigint generated always as identity primary key,
  from_user uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  from_sales_person_id uuid references public.sales_persons (id) on delete set null,
  to_sales_person_id uuid not null references public.sales_persons (id) on delete cascade,
  message text check (message is null or char_length(message) <= 280),
  given_on date not null,
  created_at timestamptz not null default now(),
  check (from_sales_person_id is distinct from to_sales_person_id)
);
create index high_fives_to_idx on public.high_fives (to_sales_person_id, created_at desc);
create index high_fives_from_idx on public.high_fives (from_sales_person_id, given_on);
create index high_fives_user_idx on public.high_fives (from_user);

-------------------------------------------------------------------------------
-- Row Level Security
-------------------------------------------------------------------------------

alter table public.user_prefs enable row level security;
alter table public.team_goals enable row level security;
alter table public.follow_ups enable row level security;
alter table public.high_fives enable row level security;

-- Settings: each person reads and writes only their own.
create policy "user_prefs: own read" on public.user_prefs
  for select to authenticated using (user_id = (select auth.uid()));
create policy "user_prefs: own insert" on public.user_prefs
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "user_prefs: own update" on public.user_prefs
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Team goal: all staff read, admins set.
create policy "team_goals: staff read" on public.team_goals
  for select to authenticated using ((select public.app_role()) is not null);
create policy "team_goals: admin insert" on public.team_goals
  for insert to authenticated with check ((select public.is_admin()));
create policy "team_goals: admin update" on public.team_goals
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "team_goals: admin delete" on public.team_goals
  for delete to authenticated using ((select public.is_admin()));

-- Follow-ups: all staff read; a sales person logs (and takes back) their own.
create policy "follow_ups: staff read" on public.follow_ups
  for select to authenticated using ((select public.app_role()) is not null);
create policy "follow_ups: own insert" on public.follow_ups
  for insert to authenticated
  with check (user_id = (select auth.uid()) and sales_person_id = (select public.my_sales_person_id()));
create policy "follow_ups: own delete" on public.follow_ups
  for delete to authenticated using (user_id = (select auth.uid()));

-- High-fives: all staff read and give; the giver (or an admin) can take one back.
create policy "high_fives: staff read" on public.high_fives
  for select to authenticated using ((select public.app_role()) is not null);
create policy "high_fives: own insert" on public.high_fives
  for insert to authenticated
  with check (
    from_user = (select auth.uid())
    and (select public.app_role()) is not null
    and from_sales_person_id is not distinct from (select public.my_sales_person_id())
  );
create policy "high_fives: own delete" on public.high_fives
  for delete to authenticated using (from_user = (select auth.uid()) or (select public.is_admin()));

-------------------------------------------------------------------------------
-- Privileges: nothing for anonymous visitors
-------------------------------------------------------------------------------

revoke all on public.user_prefs, public.team_goals, public.follow_ups, public.high_fives from anon;

revoke execute on function public.my_sales_person_id() from public, anon;
grant execute on function public.my_sales_person_id() to authenticated;
