-- Users page (src/pages/UsersPage.tsx): admins see every staff login and set its role and linked sales person.
-- profiles has no e-mail address and the browser cannot read auth.users, so this function joins the two, for admins
-- only. Saving needs nothing new: the "profiles: admin update" policy already lets admins change role and
-- sales_person_id.

create or replace function public.admin_list_users()
returns table (
  id uuid,
  email text,
  full_name text,
  role text,
  sales_person_id uuid,
  sales_person_name text,
  last_sign_in_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can see the list of users' using errcode = '42501';
  end if;

  return query
    select u.id, u.email::text, p.full_name, p.role, p.sales_person_id, s.name, u.last_sign_in_at, u.created_at
      from auth.users u
      join public.profiles p on p.id = u.id
      left join public.sales_persons s on s.id = p.sales_person_id
     order by lower(coalesce(nullif(btrim(p.full_name), ''), u.email::text)), u.id;
end;
$$;

comment on function public.admin_list_users() is
  'Admins only: every login with its e-mail address, last sign-in, role and linked sales person (the Users page).';

revoke execute on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;
