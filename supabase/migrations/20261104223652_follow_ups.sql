-- Phase 5 follow-ups: close stale enquiries as lost in bulk, and undo it.
-- The Follow-ups page lists open enquiries that have waited 14 days or more (src/lib/followUps.ts) and closes the
-- ones staff choose. Both functions run as the caller, so the enquiries' row-level security applies, and every
-- change goes through the usual triggers: updated_at / updated_by and the change history.
-- A confirmation date entered later still wins: status is 'confirmed' whenever confirmed_date is set.

-- Closes open enquiries (awaiting quote or quoted) as lost with one reason. Confirmed, lost and cancelled ones
-- are left alone. Returns the ids actually closed, which is what reopen_enquiries needs to undo it.
create or replace function public.close_enquiries_as_lost(p_ids uuid[], p_reason text)
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
    raise exception 'Give the reason the enquiries were lost';
  end if;

  with closed as (
    update public.enquiries
       set closure = 'lost',
           closure_reason = v_reason
     where id = any (p_ids)
       and status in ('new', 'quoted')
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_closed from closed;
  return v_closed;
end;
$$;

-- Undo for close_enquiries_as_lost: reopens the given enquiries that are still lost. Returns how many.
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
     and status = 'lost';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function
  public.close_enquiries_as_lost(uuid[], text),
  public.reopen_enquiries(uuid[])
from public, anon;
grant execute on function
  public.close_enquiries_as_lost(uuid[], text),
  public.reopen_enquiries(uuid[])
to authenticated;
