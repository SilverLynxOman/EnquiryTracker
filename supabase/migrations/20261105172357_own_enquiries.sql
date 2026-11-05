-- Sales staff see only their own enquiries.
-- A login linked to a sales person with the editor or viewer role belongs to that sales person: it reads and changes
-- only that sales person's enquiries, with their history, follow-ups and e-mails, and it cannot use the pricing
-- inbox or import. Owners, admins and logins not linked to a sales person (pricing, management) see everything.
-- The register, reports, follow-ups and The Window read through Row Level Security (security invoker), so they narrow
-- by themselves. The team voyage stays a team game: team_wins, team_quote_times and team_confirmed_by_month count
-- everyone, but name an enquiry (reference, route) only to someone who may see it.
-- Settings also gets each login's recent activity (changes in the register) for the owner.

create or replace function public.sees_all_enquiries()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.role in ('owner', 'admin') or p.sales_person_id is null
                     from public.profiles p
                    where p.id = auth.uid() and p.disabled_at is null), false)
$$;

comment on function public.sees_all_enquiries() is
  'Owner, admin, or a login not linked to a sales person: sees every enquiry. Sales staff see only their own.';

-- Enquiries: sales staff only their own sales person's, also for new rows and changes (they cannot hand one over).
drop policy "enquiries: staff read" on public.enquiries;
create policy "enquiries: staff read" on public.enquiries
  for select to authenticated
  using ((select public.app_role()) is not null
         and ((select public.sees_all_enquiries()) or sales_person_id = (select public.my_sales_person_id())));

drop policy "enquiries: editor insert" on public.enquiries;
create policy "enquiries: editor insert" on public.enquiries
  for insert to authenticated
  with check ((select public.can_edit())
              and ((select public.sees_all_enquiries()) or sales_person_id = (select public.my_sales_person_id())));

drop policy "enquiries: editor update" on public.enquiries;
create policy "enquiries: editor update" on public.enquiries
  for update to authenticated
  using ((select public.can_edit())
         and ((select public.sees_all_enquiries()) or sales_person_id = (select public.my_sales_person_id())))
  with check ((select public.can_edit())
              and ((select public.sees_all_enquiries()) or sales_person_id = (select public.my_sales_person_id())));

-- History of their own enquiries only.
drop policy "enquiry_audit: staff read" on public.enquiry_audit;
create policy "enquiry_audit: staff read" on public.enquiry_audit
  for select to authenticated
  using ((select public.app_role()) is not null
         and ((select public.sees_all_enquiries())
              or exists (select 1 from public.enquiries e
                          where e.id = enquiry_audit.enquiry_id and e.sales_person_id = (select public.my_sales_person_id()))));

-- Follow-ups they made, or on their own enquiries.
drop policy "follow_ups: staff read" on public.follow_ups;
create policy "follow_ups: staff read" on public.follow_ups
  for select to authenticated
  using ((select public.app_role()) is not null
         and ((select public.sees_all_enquiries())
              or sales_person_id = (select public.my_sales_person_id())
              or exists (select 1 from public.enquiries e
                          where e.id = follow_ups.enquiry_id and e.sales_person_id = (select public.my_sales_person_id()))));

-- The pricing mailbox: e-mails filed on their own enquiries only; the inbox (review, drafts) is the pricing team's.
drop policy "email_messages: staff read" on public.email_messages;
create policy "email_messages: staff read" on public.email_messages
  for select to authenticated
  using ((select public.app_role()) is not null
         and ((select public.sees_all_enquiries())
              or exists (select 1 from public.enquiries e
                          where e.id = email_messages.enquiry_id and e.sales_person_id = (select public.my_sales_person_id()))));

drop policy "email_messages: editor update" on public.email_messages;
create policy "email_messages: editor update" on public.email_messages
  for update to authenticated
  using ((select public.can_edit()) and (select public.sees_all_enquiries()))
  with check ((select public.can_edit()) and (select public.sees_all_enquiries()));

drop policy "enquiry_drafts: staff read" on public.enquiry_drafts;
create policy "enquiry_drafts: staff read" on public.enquiry_drafts
  for select to authenticated
  using ((select public.app_role()) is not null and (select public.sees_all_enquiries()));

drop policy "enquiry_drafts: editor insert" on public.enquiry_drafts;
create policy "enquiry_drafts: editor insert" on public.enquiry_drafts
  for insert to authenticated
  with check ((select public.can_edit()) and (select public.sees_all_enquiries()));

drop policy "enquiry_drafts: editor update" on public.enquiry_drafts;
create policy "enquiry_drafts: editor update" on public.enquiry_drafts
  for update to authenticated
  using ((select public.can_edit()) and (select public.sees_all_enquiries()))
  with check ((select public.can_edit()) and (select public.sees_all_enquiries()));

-- Imports write every sales person's enquiries: the pricing team's job.
drop policy "import_batches: editor insert" on public.import_batches;
create policy "import_batches: editor insert" on public.import_batches
  for insert to authenticated
  with check ((select public.can_edit()) and (select public.sees_all_enquiries()));

drop policy "import_batches: editor update" on public.import_batches;
create policy "import_batches: editor update" on public.import_batches
  for update to authenticated
  using ((select public.can_edit()) and (select public.sees_all_enquiries()))
  with check ((select public.can_edit()) and (select public.sees_all_enquiries()));

-- The team voyage: everyone's confirmed jobs of a period. Reference and route only where the caller may see the enquiry.
create or replace function public.team_wins(p_from date, p_to date)
returns table (
  id uuid,
  reference text,
  confirmed_date date,
  sales_person_id uuid,
  sales_person_name text,
  shipment_mode text,
  pol text,
  pod text
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select public.app_role() is not null as staff, public.sees_all_enquiries() as sees_all, public.my_sales_person_id() as sales_person_id
  )
  select e.id,
         case when me.sees_all or e.sales_person_id = me.sales_person_id then e.reference end,
         e.confirmed_date,
         e.sales_person_id,
         s.name,
         e.shipment_mode,
         case when me.sees_all or e.sales_person_id = me.sales_person_id then e.pol end,
         case when me.sees_all or e.sales_person_id = me.sales_person_id then e.pod end
    from public.enquiries e
   cross join me
    left join public.sales_persons s on s.id = e.sales_person_id
   where me.staff
     and e.status = 'confirmed'
     and e.confirmed_date between p_from and p_to
   order by e.confirmed_date, e.reference, e.id
$$;

comment on function public.team_wins(date, date) is
  'Team voyage: every confirmed job of the period; reference and route only for enquiries the caller may see.';

-- How quickly each person, and the team, quotes (The Window): dates only.
create or replace function public.team_quote_times(p_from date)
returns table (enquiry_date date, quoted_date date, sales_person_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select e.enquiry_date, e.quoted_date, e.sales_person_id
    from public.enquiries e
   where public.app_role() is not null
     and e.enquiry_date >= p_from
     and e.quoted_date is not null
   order by e.enquiry_date, e.id
$$;

comment on function public.team_quote_times(date) is 'The Window: quote dates of every enquiry since p_from, for the team''s quoting speed.';

-- Confirmed jobs per month for the whole team (the voyage's "beat last month" goal and record).
create or replace function public.team_confirmed_by_month(p_from date, p_to date)
returns table (month date, confirmed integer)
language sql
stable
security definer
set search_path = ''
as $$
  select m::date, coalesce(c.confirmed, 0)
    from generate_series(date_trunc('month', p_from::timestamp), date_trunc('month', p_to::timestamp), interval '1 month') as m
    left join (
      select date_trunc('month', e.confirmed_date::timestamp) as month, count(*)::integer as confirmed
        from public.enquiries e
       where e.status = 'confirmed' and e.confirmed_date between p_from and p_to
       group by 1
    ) c on c.month = m
   where public.app_role() is not null
   order by 1
$$;

comment on function public.team_confirmed_by_month(date, date) is 'Team voyage: confirmed jobs per month, for everyone.';

-- Settings: each login's recent work in the register, for the owner to keep an eye on.
create index if not exists enquiry_audit_changed_by_idx on public.enquiry_audit (changed_by, changed_at desc);

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
  disabled_at timestamptz,
  last_change_at timestamptz,
  changes_7d integer
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
           u.invited_at, u.confirmed_at, p.disabled_at,
           (select max(a.changed_at) from public.enquiry_audit a where a.changed_by = u.id),
           (select count(*)::integer from public.enquiry_audit a where a.changed_by = u.id and a.changed_at > now() - interval '7 days')
      from auth.users u
      join public.profiles p on p.id = u.id
      left join public.sales_persons s on s.id = p.sales_person_id
     order by lower(coalesce(nullif(btrim(p.full_name), ''), u.email::text)), u.id;
end;
$$;

comment on function public.admin_list_users() is
  'Owner only: every login with its e-mail address, sign-in, invitation and access state, role, sales person and recent changes (Settings).';

revoke execute on function public.admin_list_users(), public.sees_all_enquiries(), public.team_wins(date, date),
  public.team_quote_times(date), public.team_confirmed_by_month(date, date) from public, anon;
grant execute on function public.admin_list_users(), public.sees_all_enquiries(), public.team_wins(date, date),
  public.team_quote_times(date), public.team_confirmed_by_month(date, date) to authenticated;
