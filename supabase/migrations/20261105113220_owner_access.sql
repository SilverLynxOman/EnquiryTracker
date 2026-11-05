-- Organisation owner and access control.
-- The owner (role 'owner') is the one person who manages logins, in Settings: invitations, roles, sales-person
-- links, password resets and turning access off. An owner can also do everything an admin can.
-- A disabled login keeps its account and history but has no role, so every policy and function treats it as signed
-- out at once, before its session runs out. The Settings page also blocks it in Supabase Auth (the user-admin Edge
-- Function), so it cannot sign in again.

alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('owner', 'admin', 'editor', 'viewer'));
alter table public.profiles add column disabled_at timestamptz;

comment on column public.profiles.disabled_at is 'Set when the owner turns the login off: it then has no role anywhere. Null = active.';

create or replace function public.app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = auth.uid() and disabled_at is null
$$;

create or replace function public.can_edit()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.app_role() in ('owner', 'admin', 'editor'), false)
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.app_role() in ('owner', 'admin'), false)
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.app_role() = 'owner', false)
$$;

-- Only the owner changes logins (role, sales person, access).
drop policy "profiles: admin update" on public.profiles;
create policy "profiles: owner update" on public.profiles
  for update to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));

-- Only an owner makes another owner, and there is always at least one active owner.
create or replace function public.profiles_keep_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'owner' and old.role is distinct from 'owner' and auth.uid() is not null and not public.is_owner() then
    raise exception 'Only the owner can make someone an owner' using errcode = '42501';
  end if;
  if old.role = 'owner' and old.disabled_at is null and (new.role <> 'owner' or new.disabled_at is not null)
     and not exists (select 1 from public.profiles p where p.role = 'owner' and p.disabled_at is null and p.id <> old.id) then
    raise exception 'There must always be an active owner. Make someone else the owner first.';
  end if;
  return new;
end;
$$;

create trigger profiles_keep_owner
  before update on public.profiles
  for each row execute function public.profiles_keep_owner();

-- The list of logins for Settings: owner only, now with invitation and access state.
drop function public.admin_list_users();
create function public.admin_list_users()
returns table (
  id uuid,
  email text,
  full_name text,
  role text,
  sales_person_id uuid,
  sales_person_name text,
  last_sign_in_at timestamptz,
  created_at timestamptz,
  invited_at timestamptz,
  confirmed_at timestamptz,
  disabled_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'Only the owner can see the list of users' using errcode = '42501';
  end if;

  return query
    select u.id, u.email::text, p.full_name, p.role, p.sales_person_id, s.name, u.last_sign_in_at, u.created_at,
           u.invited_at, u.confirmed_at, p.disabled_at
      from auth.users u
      join public.profiles p on p.id = u.id
      left join public.sales_persons s on s.id = p.sales_person_id
     order by lower(coalesce(nullif(btrim(p.full_name), ''), u.email::text)), u.id;
end;
$$;

comment on function public.admin_list_users() is
  'Owner only: every login with its e-mail address, sign-in, invitation and access state, role and sales person (Settings).';

revoke execute on function public.admin_list_users(), public.is_owner() from public, anon;
grant execute on function public.admin_list_users(), public.is_owner() to authenticated;
revoke execute on function public.profiles_keep_owner() from public, anon, authenticated;
