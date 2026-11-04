-- Phase 5: merge duplicate customers.
-- The duplicate finder runs in the app (src/lib/customerDuplicates.ts): trigram similarity over a few thousand names
-- is instant in the browser, while the same self-join in SQL cannot use a trigram index and takes seconds.
-- This migration adds what must run on the server: the merge itself, renaming, the "not the same company"
-- decisions, a customer list with counts, and a history of merges.

-------------------------------------------------------------------------------
-- Customer list with counts
-------------------------------------------------------------------------------

create view public.customer_summary
with (security_invoker = true)
as
select
  c.id,
  c.name,
  c.notes,
  c.created_at,
  coalesce(e.enquiries, 0)::integer as enquiries,
  coalesce(e.confirmed, 0)::integer as confirmed,
  e.last_enquiry,
  coalesce(ct.contacts, 0)::integer as contacts,
  coalesce(al.aliases, '{}') as aliases
from public.customers c
left join (
  select customer_id, count(*) as enquiries, count(*) filter (where status = 'confirmed') as confirmed,
         max(enquiry_date) as last_enquiry
    from public.enquiries
   group by customer_id
) e on e.customer_id = c.id
left join (
  select customer_id, count(*) as contacts from public.customer_contacts group by customer_id
) ct on ct.customer_id = c.id
left join (
  select customer_id, array_agg(alias_key order by alias_key) as aliases from public.customer_aliases group by customer_id
) al on al.customer_id = c.id;

revoke all on public.customer_summary from anon;
grant select on public.customer_summary to authenticated;

-------------------------------------------------------------------------------
-- Pairs that look alike but are different companies
-------------------------------------------------------------------------------

create table public.customer_not_duplicates (
  customer_a uuid not null references public.customers (id) on delete cascade,
  customer_b uuid not null references public.customers (id) on delete cascade,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (customer_a, customer_b),
  check (customer_a < customer_b)
);
create index customer_not_duplicates_b_idx on public.customer_not_duplicates (customer_b);

comment on table public.customer_not_duplicates is
  'Customer pairs that staff marked as different companies; the duplicate finder no longer suggests them.';

alter table public.customer_not_duplicates enable row level security;
create policy "customer_not_duplicates: staff read" on public.customer_not_duplicates
  for select to authenticated using ((select public.app_role()) is not null);
create policy "customer_not_duplicates: editor insert" on public.customer_not_duplicates
  for insert to authenticated with check ((select public.can_edit()));
create policy "customer_not_duplicates: editor delete" on public.customer_not_duplicates
  for delete to authenticated using ((select public.can_edit()));
revoke all on public.customer_not_duplicates from anon;

-------------------------------------------------------------------------------
-- Merge history
-------------------------------------------------------------------------------

create table public.customer_merges (
  id bigint generated always as identity primary key,
  kept_customer_id uuid references public.customers (id) on delete set null,
  kept_name text not null,
  -- [{id, name, enquiries}] of the customers merged away.
  merged jsonb not null,
  enquiries_moved integer not null,
  merged_by uuid default auth.uid(),
  merged_at timestamptz not null default now()
);
create index customer_merges_kept_idx on public.customer_merges (kept_customer_id);

alter table public.customer_merges enable row level security;
create policy "customer_merges: staff read" on public.customer_merges
  for select to authenticated using ((select public.app_role()) is not null);
revoke all on public.customer_merges from anon;

-------------------------------------------------------------------------------
-- Rename: the old name is remembered, so imports and e-mails that still use it find the customer
-------------------------------------------------------------------------------

create or replace function public.rename_customer(p_id uuid, p_name text)
returns public.customers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := nullif(upper(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'))), '');
  v_key text := public.name_key(p_name);
  v_old public.customers;
  v_other text;
  v_row public.customers;
begin
  if not public.can_edit() then
    raise exception 'Only editors can rename customers' using errcode = '42501';
  end if;
  if v_key is null then
    raise exception 'Enter the customer name';
  end if;

  select * into v_old from public.customers where id = p_id for update;
  if not found then
    raise exception 'This customer no longer exists. Refresh and try again.';
  end if;

  if v_key is distinct from v_old.name_key then
    select name into v_other from public.customers where name_key = v_key and id <> p_id;
    if found then
      raise exception 'A customer called % already exists. Merge the two instead.', v_other;
    end if;
    select c.name into v_other
      from public.customer_aliases a
      join public.customers c on c.id = a.customer_id
     where a.alias_key = v_key and a.customer_id <> p_id;
    if found then
      raise exception '% is already a former name of %. Merge the two instead.', v_name, v_other;
    end if;
    -- The new name may have been one of this customer's former names; it is the real name now.
    delete from public.customer_aliases where alias_key = v_key;
    insert into public.customer_aliases (alias_key, customer_id)
    values (v_old.name_key, p_id)
    on conflict (alias_key) do nothing;
  end if;

  update public.customers set name = v_name where id = p_id returning * into v_row;
  return v_row;
end;
$$;

-------------------------------------------------------------------------------
-- Merge
-------------------------------------------------------------------------------

-- Moves everything of p_merge onto p_keep (enquiries, contacts, e-mail drafts, former names), remembers the merged
-- names as former names of p_keep, deletes the merged customers and records the merge. Optionally renames p_keep.
create or replace function public.merge_customers(p_keep uuid, p_merge uuid[], p_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_merge uuid[];
  v_found integer;
  v_keep public.customers;
  v_final_name text;
  v_merged jsonb;
  v_moved uuid[];
  v_importable uuid[];
  v_contacts integer;
  v_drafts integer;
begin
  if not public.is_admin() then
    raise exception 'Only admins can merge customers' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct m), '{}') into v_merge
    from unnest(p_merge) m
   where m is not null and m is distinct from p_keep;
  if p_keep is null or cardinality(v_merge) = 0 then
    raise exception 'Choose the customer to keep and at least one customer to merge into it';
  end if;

  -- Lock every customer involved (in id order, so two merges cannot deadlock).
  perform 1 from public.customers where id = p_keep or id = any (v_merge) order by id for update;
  get diagnostics v_found = row_count;
  if v_found <> cardinality(v_merge) + 1 then
    raise exception 'One of these customers was changed or merged by someone else. Refresh and try again.';
  end if;
  select * into v_keep from public.customers where id = p_keep;

  select jsonb_agg(jsonb_build_object(
           'id', c.id, 'name', c.name,
           'enquiries', (select count(*) from public.enquiries e where e.customer_id = c.id)
         ) order by c.name)
    into v_merged
    from public.customers c
   where c.id = any (v_merge);

  -- Enquiries. Moving them is not an app edit of the customer column: future imports send the merged names to
  -- p_keep through the former names added below, so enquiries that imports could update stay that way.
  select coalesce(array_agg(id), '{}'),
         coalesce(array_agg(id) filter (where not ('customer_id' = any (app_edited_fields))), '{}')
    into v_moved, v_importable
    from public.enquiries
   where customer_id = any (v_merge);

  update public.enquiries set customer_id = p_keep where id = any (v_moved);
  update public.enquiries
     set app_edited_fields = array_remove(app_edited_fields, 'customer_id')
   where id = any (v_importable);

  -- History: "Customer: OLD NAME → KEPT NAME" instead of two ids, one of which is about to disappear.
  v_final_name := coalesce(nullif(upper(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'))), ''), v_keep.name);
  update public.enquiry_audit a
     set changes = (a.changes - 'customer_id')
                   || jsonb_build_object('customer', jsonb_build_object('old', m.name, 'new', v_final_name, 'merged', true))
    from public.customers m
   where a.enquiry_id = any (v_moved)
     and a.action = 'update'
     and a.changed_at = now()
     and a.changes ? 'customer_id'
     and m.id = (a.changes -> 'customer_id' ->> 'old')::uuid;

  update public.customer_contacts set customer_id = p_keep where customer_id = any (v_merge);
  get diagnostics v_contacts = row_count;
  update public.enquiry_drafts set customer_id = p_keep where customer_id = any (v_merge);
  get diagnostics v_drafts = row_count;

  -- Former names: those of the merged customers, and their own former names.
  update public.customer_aliases set customer_id = p_keep where customer_id = any (v_merge);
  insert into public.customer_aliases (alias_key, customer_id)
  select name_key, p_keep from public.customers where id = any (v_merge)
  on conflict (alias_key) do update set customer_id = excluded.customer_id;

  delete from public.customers where id = any (v_merge);

  if v_final_name is distinct from v_keep.name then
    perform public.rename_customer(p_keep, v_final_name);
  end if;

  insert into public.customer_merges (kept_customer_id, kept_name, merged, enquiries_moved)
  values (p_keep, v_final_name, v_merged, cardinality(v_moved));

  return jsonb_build_object(
    'name', v_final_name,
    'customers', cardinality(v_merge),
    'enquiries', cardinality(v_moved),
    'contacts', v_contacts,
    'drafts', v_drafts
  );
end;
$$;

-------------------------------------------------------------------------------
-- Not the same company
-------------------------------------------------------------------------------

-- Marks every pair among p_ids as different companies. Returns the number of new pairs.
create or replace function public.mark_customers_distinct(p_ids uuid[])
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not public.can_edit() then
    raise exception 'Only editors can do this' using errcode = '42501';
  end if;
  insert into public.customer_not_duplicates (customer_a, customer_b)
  select a.id, b.id
    from (select distinct unnest(p_ids) as id) a
    join (select distinct unnest(p_ids) as id) b on a.id < b.id
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-------------------------------------------------------------------------------
-- Function privileges
-------------------------------------------------------------------------------

revoke execute on function
  public.rename_customer(uuid, text),
  public.merge_customers(uuid, uuid[], text),
  public.mark_customers_distinct(uuid[])
from public, anon;
grant execute on function
  public.rename_customer(uuid, text),
  public.merge_customers(uuid, uuid[], text),
  public.mark_customers_distinct(uuid[])
to authenticated;
