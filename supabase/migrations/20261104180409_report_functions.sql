-- Phase 4 report RPCs (docs/IMPLEMENTATION_PLAN.md §5, Phase 4).
-- Both functions count enquiries raised in the range, cancelled ones excluded, so every column describes
-- the same set of enquiries and conversion = confirmed / enquiries. monthly_trend also reports the jobs
-- booked (confirmed) in each month, whatever month the enquiry was raised in.
-- security invoker (the default): Row Level Security on enquiries applies to the caller.

-- Analytics: enquiries raised in the range, grouped by one dimension.
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
         and e.status <> 'cancelled'
    ) g
   where g.label is not null -- unknown p_dimension: no rows
   group by g.label
   order by 2 desc, 1
$$;

-- Month by month: enquiries raised (and what became of them) + jobs booked in the month.
-- The "raised" columns reproduce the acceptance figures in docs/IMPLEMENTATION_PLAN.md §1.3.
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
       and e.status <> 'cancelled'
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

-- Supabase grants EXECUTE on new functions to anon directly; staff only.
revoke execute on function
  public.enquiry_breakdown(date, date, text),
  public.monthly_trend(date, date)
from public, anon;
grant execute on function
  public.enquiry_breakdown(date, date, text),
  public.monthly_trend(date, date)
to authenticated;
