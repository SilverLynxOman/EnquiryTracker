-- Excel imports never overwrite what people changed in the app (needed for the parallel run, when the same
-- enquiry can be updated in Excel and in the app).
-- enquiries.app_edited_fields lists the import columns changed in the app; import_enquiries keeps those values.
-- An enquiry created in the app lists every import column, so imports never change it.
-- "In the app" means outside an import: import_enquiries marks its transaction with app.import_batch_id.
-- enquiries_before_write is based on the live definition after 20261104202737_email_intake (e-mail enquiries
-- also get the reference prefixed to the subject); on a database without e-mail intake that branch never runs.

alter table public.enquiries add column app_edited_fields text[] not null default '{}';

comment on column public.enquiries.app_edited_fields is
  'Import columns changed in the app. import_enquiries never overwrites these. Clear an entry to let imports update that field again.';

create or replace function public.enquiries_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix text;
  v_seq integer;
  v_importing boolean := coalesce(current_setting('app.import_batch_id', true), '') <> '';
  -- Columns an import can write. Keep in sync with import_enquiries.
  c_import_columns constant text[] := array[
    'enquiry_date', 'quoted_date', 'confirmed_date', 'customer_id', 'subject', 'trade_type', 'qty_text',
    'shipment_mode', 'units', 'container_type', 'buy_rate', 'buy_total', 'sell_rate', 'sell_total',
    'pol', 'pod', 'agent_id', 'sales_person_id', 'remarks'
  ];
begin
  if tg_op = 'INSERT' then
    if new.reference is null or btrim(new.reference) = '' then
      v_prefix := 'SL' || to_char(new.enquiry_date, 'YY');
      insert into public.reference_counters as rc (prefix, last_seq)
      values (v_prefix, 1)
      on conflict (prefix) do update set last_seq = rc.last_seq + 1
      returning rc.last_seq into v_seq;
      new.reference := v_prefix || case when v_seq < 10000 then lpad(v_seq::text, 4, '0') else v_seq::text end;
    else
      new.reference := upper(replace(new.reference, ' ', ''));
      if new.reference ~ '^SL[0-9]{6,}$' then
        insert into public.reference_counters as rc (prefix, last_seq)
        values (left(new.reference, 4), substr(new.reference, 5)::integer)
        on conflict (prefix) do update set last_seq = greatest(rc.last_seq, excluded.last_seq);
      end if;
    end if;

    -- House style: the subject starts with the reference.
    if new.source in ('manual', 'email') and new.subject is not null and position(new.reference in new.subject) <> 1 then
      new.subject := new.reference || ' ' || new.subject;
    end if;

    -- Created in the app: the app owns every field.
    if not v_importing then
      new.app_edited_fields := c_import_columns;
    end if;
  else
    new.updated_at := now();
    new.updated_by := auth.uid();

    -- Changed in the app: remember which import columns, so later imports leave them alone.
    if not v_importing then
      select coalesce(array_agg(distinct f order by f), '{}')
        into new.app_edited_fields
        from (
          select unnest(new.app_edited_fields) as f
          union
          select n.key
            from jsonb_each(to_jsonb(new)) n
            join jsonb_each(to_jsonb(old)) o on o.key = n.key
           where n.value is distinct from o.value
             and n.key = any (c_import_columns)
        ) s;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.import_enquiries(p_batch_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  r jsonb;
  v_is_insert boolean;
  v_inserted integer := 0;
  v_updated integer := 0;
begin
  if not public.can_edit() then
    raise exception 'Only editors can import enquiries' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  -- Lets the audit trigger tag every change with this batch, and tells enquiries_before_write this is an import.
  perform set_config('app.import_batch_id', p_batch_id::text, true);

  for r in select value from jsonb_array_elements(p_rows) loop
    insert into public.enquiries as e (
      reference, enquiry_date, quoted_date, confirmed_date,
      customer_id, subject, trade_type, qty_text, shipment_mode, units, container_type,
      buy_rate, buy_total, sell_rate, sell_total,
      pol, pod, agent_id, sales_person_id, remarks, source, import_batch_id
    ) values (
      r ->> 'reference',
      (r ->> 'enquiry_date')::date,
      nullif(r ->> 'quoted_date', '')::date,
      nullif(r ->> 'confirmed_date', '')::date,
      public.resolve_customer(r ->> 'customer_name'),
      nullif(r ->> 'subject', ''),
      nullif(r ->> 'trade_type', ''),
      nullif(r ->> 'qty_text', ''),
      nullif(r ->> 'shipment_mode', ''),
      nullif(r ->> 'units', '')::integer,
      nullif(r ->> 'container_type', ''),
      nullif(r ->> 'buy_rate', '')::numeric,
      nullif(r ->> 'buy_total', '')::numeric,
      nullif(r ->> 'sell_rate', '')::numeric,
      nullif(r ->> 'sell_total', '')::numeric,
      nullif(r ->> 'pol', ''),
      nullif(r ->> 'pod', ''),
      public.resolve_agent(r ->> 'agent_name'),
      public.resolve_sales_person(r ->> 'sales_person_name'),
      nullif(r ->> 'remarks', ''),
      'import',
      p_batch_id
    )
    -- Blank cells never erase a value, and fields changed in the app keep the app's value.
    on conflict (reference) do update set
      enquiry_date    = case when 'enquiry_date'    = any (e.app_edited_fields) then e.enquiry_date    else coalesce(excluded.enquiry_date, e.enquiry_date) end,
      quoted_date     = case when 'quoted_date'     = any (e.app_edited_fields) then e.quoted_date     else coalesce(excluded.quoted_date, e.quoted_date) end,
      confirmed_date  = case when 'confirmed_date'  = any (e.app_edited_fields) then e.confirmed_date  else coalesce(excluded.confirmed_date, e.confirmed_date) end,
      customer_id     = case when 'customer_id'     = any (e.app_edited_fields) then e.customer_id     else coalesce(excluded.customer_id, e.customer_id) end,
      subject         = case when 'subject'         = any (e.app_edited_fields) then e.subject         else coalesce(excluded.subject, e.subject) end,
      trade_type      = case when 'trade_type'      = any (e.app_edited_fields) then e.trade_type      else coalesce(excluded.trade_type, e.trade_type) end,
      qty_text        = case when 'qty_text'        = any (e.app_edited_fields) then e.qty_text        else coalesce(excluded.qty_text, e.qty_text) end,
      shipment_mode   = case when 'shipment_mode'   = any (e.app_edited_fields) then e.shipment_mode   else coalesce(excluded.shipment_mode, e.shipment_mode) end,
      units           = case when 'units'           = any (e.app_edited_fields) then e.units           else coalesce(excluded.units, e.units) end,
      container_type  = case when 'container_type'  = any (e.app_edited_fields) then e.container_type  else coalesce(excluded.container_type, e.container_type) end,
      buy_rate        = case when 'buy_rate'        = any (e.app_edited_fields) then e.buy_rate        else coalesce(excluded.buy_rate, e.buy_rate) end,
      buy_total       = case when 'buy_total'       = any (e.app_edited_fields) then e.buy_total       else coalesce(excluded.buy_total, e.buy_total) end,
      sell_rate       = case when 'sell_rate'       = any (e.app_edited_fields) then e.sell_rate       else coalesce(excluded.sell_rate, e.sell_rate) end,
      sell_total      = case when 'sell_total'      = any (e.app_edited_fields) then e.sell_total      else coalesce(excluded.sell_total, e.sell_total) end,
      pol             = case when 'pol'             = any (e.app_edited_fields) then e.pol             else coalesce(excluded.pol, e.pol) end,
      pod             = case when 'pod'             = any (e.app_edited_fields) then e.pod             else coalesce(excluded.pod, e.pod) end,
      agent_id        = case when 'agent_id'        = any (e.app_edited_fields) then e.agent_id        else coalesce(excluded.agent_id, e.agent_id) end,
      sales_person_id = case when 'sales_person_id' = any (e.app_edited_fields) then e.sales_person_id else coalesce(excluded.sales_person_id, e.sales_person_id) end,
      remarks         = case when 'remarks'         = any (e.app_edited_fields) then e.remarks         else coalesce(excluded.remarks, e.remarks) end,
      import_batch_id = excluded.import_batch_id
    returning (xmax = 0) into v_is_insert;

    if v_is_insert then
      v_inserted := v_inserted + 1;
    else
      v_updated := v_updated + 1;
    end if;
  end loop;

  update public.import_batches
     set inserted = inserted + v_inserted,
         updated = updated + v_updated
   where id = p_batch_id;

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated);
end;
$$;

-- Keep the bookkeeping column out of each enquiry's change history.
create or replace function public.enquiries_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch uuid := nullif(current_setting('app.import_batch_id', true), '')::uuid;
  v_changes jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.enquiry_audit (enquiry_id, reference, action, import_batch_id, changed_by)
    values (new.id, new.reference, 'insert', v_batch, auth.uid());
    return new;
  elsif tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, jsonb_build_object('old', o.value, 'new', n.value))
      into v_changes
      from jsonb_each(to_jsonb(new)) n
      join jsonb_each(to_jsonb(old)) o on o.key = n.key
     where n.value is distinct from o.value
       and n.key not in ('updated_at', 'updated_by', 'status', 'profit', 'import_batch_id', 'source', 'app_edited_fields');
    if v_changes is not null then
      insert into public.enquiry_audit (enquiry_id, reference, action, changes, import_batch_id, changed_by)
      values (new.id, new.reference, 'update', v_changes, v_batch, auth.uid());
    end if;
    return new;
  else
    insert into public.enquiry_audit (enquiry_id, reference, action, changes, import_batch_id, changed_by)
    values (old.id, old.reference, 'delete', to_jsonb(old), v_batch, auth.uid());
    return old;
  end if;
end;
$$;
