-- Phase 5: commission, read from the remarks.
-- The register writes commission in the remarks ("COMMISSION OMR 40/CNTR.", "COMMISSION USD 130/40 HC",
-- "OMR 200.00 COMMSION"). The remarks stay the one place to enter it; these columns are read from them on every save
-- (from the app, an import or an e-mail), so reports can use the amount. The app shows the same reading while the
-- remarks are typed (src/lib/commission.ts: keep the two parsers in step).

alter table public.enquiries
  add column commission_amount numeric(12,2) check (commission_amount >= 0),
  add column commission_currency text check (commission_currency in ('OMR', 'USD', 'AED', 'EUR')),
  add column commission_per_unit boolean,
  add column commission_total numeric(12,2) generated always as (
    case when commission_per_unit then commission_amount * greatest(coalesce(units, 1), 1) else commission_amount end
  ) stored;

comment on column public.enquiries.commission_amount is 'Commission read from remarks (per container when commission_per_unit). Set by trigger; edit the remarks instead.';
comment on column public.enquiries.commission_currency is 'Currency of the commission: OMR, USD, AED or EUR; null when the remarks give none.';
comment on column public.enquiries.commission_per_unit is 'True when the commission is per container (/CNTR, /40 HC, PER CONTAINER), false when for the shipment.';
comment on column public.enquiries.commission_total is 'Commission for the shipment: per-container amounts times units (at least 1).';

-- The commission in a remarks text; all nulls when there is none. Same rules as parseCommission in
-- src/lib/commission.ts: the text after the commission word is searched first, then the text before it.
create or replace function public.parse_commission(p_remarks text, out amount numeric, out currency text, out per_unit boolean)
language plpgsql
immutable
set search_path = ''
as $$
declare
  c_cur constant text := '(OMR|USD|AED|EUR|RO)';
  c_amt constant text := '([0-9][0-9,]*(?:\.[0-9]+)?)';
  c_unit constant text := '(\s*(?:/|PER\s)\s*(?:CNTR|CONTAINER|CTR|CONT|UNIT|BOX|TEU|20|40))?';
  -- COMMISSION and its misspellings (COMMISION, COMMSION, COMISSION...), or COMM. Not COMMODITY or COMMENT.
  c_word constant text := '(?:COM{1,2}I?S{1,2}I?O?NS?|COMM)';
  t text := upper(coalesce(p_remarks, ''));
  v_at integer;
  v_tail text;
  v_head text;
  m text[];
begin
  v_at := regexp_instr(t, '\y' || c_word || '\y');
  if v_at = 0 then
    return;
  end if;
  v_tail := substr(t, v_at);
  v_head := left(t, v_at - 1);

  m := regexp_match(v_tail, '\y' || c_cur || '\.?\s*' || c_amt || c_unit);
  if m is not null then
    currency := m[1]; amount := replace(m[2], ',', '')::numeric; per_unit := m[3] is not null;
  else
    m := regexp_match(v_tail, c_amt || '\s*' || c_cur || '\y' || c_unit);
    if m is not null then
      amount := replace(m[1], ',', '')::numeric; currency := m[2]; per_unit := m[3] is not null;
    else
      m := regexp_match(v_tail, '\y' || c_word || '\.?\s*:?\s*' || c_amt || c_unit);
      if m is not null then
        amount := replace(m[1], ',', '')::numeric; per_unit := m[2] is not null;
      else
        m := regexp_match(v_head, '\y' || c_cur || '\.?\s*' || c_amt || c_unit);
        if m is not null then
          currency := m[1]; amount := replace(m[2], ',', '')::numeric; per_unit := m[3] is not null;
        else
          m := regexp_match(v_head, c_amt || '\s*' || c_cur || '\y' || c_unit);
          if m is not null then
            amount := replace(m[1], ',', '')::numeric; currency := m[2]; per_unit := m[3] is not null;
          end if;
        end if;
      end if;
    end if;
  end if;

  if currency = 'RO' then
    currency := 'OMR';
  end if;
  -- Larger than the column holds: a typing slip, not a commission.
  if amount > 9999999999 then
    amount := null; currency := null; per_unit := null;
  end if;
end;
$$;

-- Keeps the commission columns in step with the remarks.
create or replace function public.enquiries_read_commission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
begin
  select * into v from public.parse_commission(new.remarks);
  new.commission_amount := v.amount;
  new.commission_currency := v.currency;
  new.commission_per_unit := v.per_unit;
  return new;
end;
$$;

-- Existing enquiries, without touching updated_at / updated_by or writing history lines: the remarks did not change.
alter table public.enquiries disable trigger user;
update public.enquiries e
   set (commission_amount, commission_currency, commission_per_unit) =
       (select p.amount, p.currency, p.per_unit from public.parse_commission(e.remarks) p)
 where e.remarks is not null;
alter table public.enquiries enable trigger user;

create trigger enquiries_read_commission
  before insert or update of remarks on public.enquiries
  for each row execute function public.enquiries_read_commission();

-- The register view lists its columns, so the new ones are added at the end (create or replace keeps the grants).
create or replace view public.enquiry_register
with (security_invoker = true)
as
select
  e.id, e.reference, e.enquiry_date, e.quoted_date, e.confirmed_date, e.closure, e.closure_reason, e.status,
  e.customer_id, e.subject, e.trade_type, e.qty_text, e.shipment_mode, e.units, e.container_type, e.currency,
  e.buy_rate, e.buy_total, e.sell_rate, e.sell_total, e.profit, e.pol, e.pod, e.agent_id, e.sales_person_id,
  e.remarks, e.source, e.import_batch_id, e.created_at, e.created_by, e.updated_at, e.updated_by, e.contact_id,
  e.requirements,
  c.name as customer_name,
  a.name as agent_name,
  s.name as sales_person_name,
  ct.name as contact_name,
  ct.email as contact_email,
  ct.phone as contact_phone,
  e.commission_amount,
  e.commission_currency,
  e.commission_per_unit,
  e.commission_total
from public.enquiries e
join public.customers c on c.id = e.customer_id
left join public.agents a on a.id = e.agent_id
left join public.sales_persons s on s.id = e.sales_person_id
left join public.customer_contacts ct on ct.id = e.contact_id;

-- Trigger functions must not be callable through the API (see 20261102162837_lock_trigger_functions).
revoke execute on function public.enquiries_read_commission() from public, anon, authenticated;
revoke execute on function public.parse_commission(text) from public, anon;
grant execute on function public.parse_commission(text) to authenticated;
