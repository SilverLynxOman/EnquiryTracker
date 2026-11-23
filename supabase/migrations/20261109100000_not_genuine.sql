-- Not genuine enquiries: fake ones, competitors checking our rates, contact details that don't work.
-- Only the sales person can tell, so an editor closes the enquiry as 'not_genuine' with a reason. It is kept, with
-- its e-mails and history, under its own status, and left out of every count that measures the team: enquiries
-- raised, quotes sent, conversion and quoting speed (as cancelled ones already are). The Dashboard counts them per
-- sales person instead, so a manager can see who marks many.
-- A confirmation date entered later still wins, as for lost: status is 'confirmed' whenever confirmed_date is set.

alter table public.enquiries drop constraint enquiries_closure_check;
alter table public.enquiries
  add constraint enquiries_closure_check check (closure in ('lost', 'cancelled', 'not_genuine'));

-- Postgres 17: rewrites the stored column in place; the views that read it keep working.
alter table public.enquiries alter column status set expression as (
  case
    when closure = 'cancelled' then 'cancelled'
    when confirmed_date is not null then 'confirmed'
    when closure = 'lost' then 'lost'
    when closure = 'not_genuine' then 'not_genuine'
    when quoted_date is not null then 'quoted'
    else 'new'
  end
);

-------------------------------------------------------------------------------
-- Closing and reopening
-------------------------------------------------------------------------------

-- Closes open enquiries (awaiting quote or quoted) as not genuine with one reason. Confirmed and closed ones are
-- left alone. Returns the ids actually closed, which is what reopen_enquiries needs to undo it.
-- Runs as the caller: Row Level Security applies (a sales person's login closes only their own enquiries).
create or replace function public.close_enquiries_as_not_genuine(p_ids uuid[], p_reason text)
returns uuid[]
language plpgsql
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(regexp_replace(coalesce(p_reason, ''), '\s+', ' ', 'g')), '');
  v_closed uuid[];
begin
  if not public.can_edit() then
    raise exception 'Only editors can close enquiries' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'Give the reason the enquiries are not genuine';
  end if;

  with closed as (
    update public.enquiries
       set closure = 'not_genuine',
           closure_reason = v_reason
     where id = any (p_ids)
       and status in ('new', 'quoted')
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_closed from closed;
  return v_closed;
end;
$$;

-- Reopens the given enquiries that are still lost or not genuine. Returns how many.
create or replace function public.reopen_enquiries(p_ids uuid[])
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not public.can_edit() then
    raise exception 'Only editors can reopen enquiries' using errcode = '42501';
  end if;
  update public.enquiries
     set closure = null,
         closure_reason = null
   where id = any (p_ids)
     and status in ('lost', 'not_genuine');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-------------------------------------------------------------------------------
-- Counts that leave them out
-------------------------------------------------------------------------------

-- Headline numbers for a date range. Enquiries, quotes and conversion leave out not-genuine enquiries;
-- 'not_genuine' says how many were left out (raised in the range).
create or replace function public.dashboard_stats(p_from date, p_to date)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'enquiries', (select count(*) from public.enquiries where enquiry_date between p_from and p_to and status <> 'not_genuine'),
    'quoted', (select count(*) from public.enquiries where quoted_date between p_from and p_to and status <> 'not_genuine'),
    'confirmed', (select count(*) from public.enquiries where confirmed_date between p_from and p_to and status = 'confirmed'),
    'converted', (select count(*) from public.enquiries where enquiry_date between p_from and p_to and status = 'confirmed'),
    'profit', (select coalesce(sum(profit), 0) from public.enquiries where confirmed_date between p_from and p_to and status = 'confirmed'),
    'sell_total', (select coalesce(sum(sell_total), 0) from public.enquiries where confirmed_date between p_from and p_to and status = 'confirmed'),
    'not_genuine', (select count(*) from public.enquiries where enquiry_date between p_from and p_to and status = 'not_genuine')
  )
$$;

-- The weekly "DATA" sheet, plus each person's not-genuine enquiries raised in the range (not in total_enquiries).
-- The result gains a column, so the function is replaced.
drop function public.salesperson_summary(date, date);
create function public.salesperson_summary(p_from date, p_to date)
returns table (
  sales_person text,
  total_enquiries integer,
  confirmed integer,
  confirmed_new integer,
  confirmed_old integer,
  fcl_jobs integer,
  fcl_units integer,
  air integer,
  lcl integer,
  courier integer,
  other integer,
  profit numeric,
  not_genuine integer
)
language sql
stable
set search_path = ''
as $$
  with enq as (
    select coalesce(e.sales_person_id, '00000000-0000-0000-0000-000000000000'::uuid) as sp_id,
           (count(*) filter (where e.status <> 'not_genuine'))::integer as total_enquiries,
           (count(*) filter (where e.status = 'not_genuine'))::integer as not_genuine
      from public.enquiries e
     where e.enquiry_date between p_from and p_to
       and e.status <> 'cancelled'
     group by 1
  ), conf as (
    select coalesce(e.sales_person_id, '00000000-0000-0000-0000-000000000000'::uuid) as sp_id,
           count(*)::integer as confirmed,
           (count(*) filter (where e.enquiry_date >= p_from))::integer as confirmed_new,
           (count(*) filter (where e.enquiry_date < p_from))::integer as confirmed_old,
           (count(*) filter (where e.shipment_mode = 'FCL'))::integer as fcl_jobs,
           (coalesce(sum(e.units) filter (where e.shipment_mode = 'FCL'), 0))::integer as fcl_units,
           (count(*) filter (where e.shipment_mode = 'AIR'))::integer as air,
           (count(*) filter (where e.shipment_mode = 'LCL'))::integer as lcl,
           (count(*) filter (where e.shipment_mode = 'COURIER'))::integer as courier,
           (count(*) filter (where e.shipment_mode is null
                               or e.shipment_mode not in ('FCL', 'AIR', 'LCL', 'COURIER')))::integer as other,
           coalesce(sum(e.profit), 0) as profit
      from public.enquiries e
     where e.confirmed_date between p_from and p_to
       and e.status = 'confirmed'
     group by 1
  )
  select coalesce(sp.name, '(UNASSIGNED)'),
         coalesce(enq.total_enquiries, 0),
         coalesce(conf.confirmed, 0),
         coalesce(conf.confirmed_new, 0),
         coalesce(conf.confirmed_old, 0),
         coalesce(conf.fcl_jobs, 0),
         coalesce(conf.fcl_units, 0),
         coalesce(conf.air, 0),
         coalesce(conf.lcl, 0),
         coalesce(conf.courier, 0),
         coalesce(conf.other, 0),
         coalesce(conf.profit, 0),
         coalesce(enq.not_genuine, 0)
    from enq
    full join conf using (sp_id)
    left join public.sales_persons sp on sp.id = sp_id
   order by 1
$$;

-- Analytics: enquiries raised in the range, grouped by one dimension (cancelled and not genuine left out).
create or replace function public.enquiry_breakdown(p_from date, p_to date, p_dimension text)
returns table (
  label text,
  enquiries integer,
  quoted integer,
  confirmed integer,
  lost integer,
  sell_total numeric,
  profit numeric
)
language sql
stable
set search_path = ''
as $$
  select g.label,
         count(*)::integer,
         (count(*) filter (where g.quoted_date is not null))::integer,
         (count(*) filter (where g.status = 'confirmed'))::integer,
         (count(*) filter (where g.status = 'lost'))::integer,
         coalesce(sum(g.sell_total) filter (where g.status = 'confirmed'), 0),
         coalesce(sum(g.profit) filter (where g.status = 'confirmed'), 0)
    from (
      select e.quoted_date, e.status, e.sell_total, e.profit,
             case p_dimension
               when 'sales_person' then coalesce(s.name, '(UNASSIGNED)')
               when 'customer' then c.name
               when 'agent' then coalesce(a.name, '(NO AGENT)')
               when 'lane' then coalesce(nullif(upper(btrim(e.pol)), ''), '?') || ' → ' || coalesce(nullif(upper(btrim(e.pod)), ''), '?')
               when 'mode' then coalesce(e.shipment_mode, 'OTHER')
               when 'trade_type' then coalesce(e.trade_type, '(NONE)')
             end as label
        from public.enquiries e
        join public.customers c on c.id = e.customer_id
        left join public.agents a on a.id = e.agent_id
        left join public.sales_persons s on s.id = e.sales_person_id
       where e.enquiry_date between p_from and p_to
         and e.status not in ('cancelled', 'not_genuine')
    ) g
   where g.label is not null -- unknown p_dimension: no rows
   group by g.label
   order by 2 desc, 1
$$;

-- Month by month: enquiries raised (cancelled and not genuine left out) + jobs booked in the month.
create or replace function public.monthly_trend(p_from date, p_to date)
returns table (
  month date,
  enquiries integer,
  quoted integer,
  converted integer,
  converted_profit numeric,
  confirmed integer,
  confirmed_sell numeric,
  confirmed_profit numeric
)
language sql
stable
set search_path = ''
as $$
  with months as (
    select m::date as month
      from generate_series(date_trunc('month', p_from::timestamp), date_trunc('month', p_to::timestamp), interval '1 month') as m
  ), raised as (
    select date_trunc('month', e.enquiry_date::timestamp)::date as month,
           count(*)::integer as enquiries,
           (count(*) filter (where e.quoted_date is not null))::integer as quoted,
           (count(*) filter (where e.status = 'confirmed'))::integer as converted,
           coalesce(sum(e.profit) filter (where e.status = 'confirmed'), 0) as converted_profit
      from public.enquiries e
     where e.enquiry_date between p_from and p_to
       and e.status not in ('cancelled', 'not_genuine')
     group by 1
  ), booked as (
    select date_trunc('month', e.confirmed_date::timestamp)::date as month,
           count(*)::integer as confirmed,
           coalesce(sum(e.sell_total), 0) as confirmed_sell,
           coalesce(sum(e.profit), 0) as confirmed_profit
      from public.enquiries e
     where e.confirmed_date between p_from and p_to
       and e.status = 'confirmed'
     group by 1
  )
  select m.month,
         coalesce(r.enquiries, 0),
         coalesce(r.quoted, 0),
         coalesce(r.converted, 0),
         coalesce(r.converted_profit, 0),
         coalesce(b.confirmed, 0),
         coalesce(b.confirmed_sell, 0),
         coalesce(b.confirmed_profit, 0)
    from months m
    left join raised r on r.month = m.month
    left join booked b on b.month = m.month
   order by m.month
$$;

-- How quickly each person, and the team, quotes (The Window): a quote to a fake enquiry says nothing about it.
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
     and e.status <> 'not_genuine'
   order by e.enquiry_date, e.id
$$;

-- Supabase grants EXECUTE on new functions to anon directly; staff only.
revoke execute on function
  public.close_enquiries_as_not_genuine(uuid[], text),
  public.salesperson_summary(date, date)
from public, anon;
grant execute on function
  public.close_enquiries_as_not_genuine(uuid[], text),
  public.salesperson_summary(date, date)
to authenticated;
