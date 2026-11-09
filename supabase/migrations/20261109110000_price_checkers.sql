-- Price checkers: customers who keep asking for prices and never book. Worked out from the register, nobody tags
-- them: p_min_quotes or more enquiries quoted since p_since (quote date) and no job confirmed since then. Cancelled
-- and not genuine enquiries don't count. The badge goes away by itself once the customer books a job.
-- The rule's numbers live in the app (src/lib/priceCheckers.ts) and are passed in.
--
-- security definer, for every signed-in member of staff: whether a customer ever books is company knowledge, so a
-- sales person's login sees it for customers whose other enquiries belong to colleagues. Only the counts and the date
-- of the last job leave the function, never the enquiries themselves.
create or replace function public.price_checkers(p_since date, p_min_quotes integer)
returns table (customer_id uuid, quotes integer, last_win date)
language sql
stable
security definer
set search_path = ''
as $$
  select e.customer_id,
         (count(*) filter (where e.quoted_date >= p_since and e.status not in ('cancelled', 'not_genuine')))::integer,
         max(e.confirmed_date) filter (where e.status = 'confirmed')
    from public.enquiries e
   where public.app_role() is not null
   group by e.customer_id
  having count(*) filter (where e.quoted_date >= p_since and e.status not in ('cancelled', 'not_genuine')) >= p_min_quotes
     and count(*) filter (where e.status = 'confirmed' and e.confirmed_date >= p_since) = 0
$$;

comment on function public.price_checkers(date, integer) is
  'Customers quoted at least p_min_quotes times since p_since with no job confirmed since then; counts only.';

-- Supabase grants EXECUTE on new functions to anon directly; staff only.
revoke execute on function public.price_checkers(date, integer) from public, anon;
grant execute on function public.price_checkers(date, integer) to authenticated;
