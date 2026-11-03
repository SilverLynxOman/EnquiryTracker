-- Enquiry Tracker — initial schema
-- Mirrors the columns of the "MONTHLY ENQUIRIES" Excel register (see docs/IMPLEMENTATION_PLAN.md §1.2).

-------------------------------------------------------------------------------
-- Helpers
-------------------------------------------------------------------------------

-- Punctuation/space-insensitive key used to match customer, agent and sales-person names.
-- Keep in sync with nameKey() in src/lib/normalize.ts.
create or replace function public.name_key(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(regexp_replace(upper(coalesce(p, '')), '[.,''"`]', ' ', 'g'), '\s+', ' ', 'g')), '')
$$;

-------------------------------------------------------------------------------
-- Master data
-------------------------------------------------------------------------------

create table public.sales_persons (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  name_key text generated always as (public.name_key(name)) stored,
  email text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index sales_persons_name_key_idx on public.sales_persons (name_key);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  name_key text generated always as (public.name_key(name)) stored,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create unique index customers_name_key_idx on public.customers (name_key);

create table public.customer_aliases (
  alias_key text primary key,
  customer_id uuid not null references public.customers (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index customer_aliases_customer_idx on public.customer_aliases (customer_id);

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  name_key text generated always as (public.name_key(name)) stored,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create unique index agents_name_key_idx on public.agents (name_key);

create table public.agent_aliases (
  alias_key text primary key,
  agent_id uuid not null references public.agents (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index agent_aliases_agent_idx on public.agent_aliases (agent_id);

-------------------------------------------------------------------------------
-- Users & roles
-------------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  role text not null default 'viewer' check (role in ('admin', 'editor', 'viewer')),
  sales_person_id uuid references public.sales_persons (id) on delete set null,
  created_at timestamptz not null default now()
);
create index profiles_sales_person_idx on public.profiles (sales_person_id);

create or replace function public.app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.can_edit()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select role in ('admin', 'editor') from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false)
$$;

-- Every new auth user gets a read-only profile; an admin promotes them.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-------------------------------------------------------------------------------
-- Imports
-------------------------------------------------------------------------------

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  sheet_names text[] not null default '{}',
  rows_in_file integer not null default 0,
  inserted integer not null default 0,
  updated integer not null default 0,
  unchanged integer not null default 0,
  skipped integer not null default 0,
  warnings jsonb not null default '[]'::jsonb,
  storage_path text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index import_batches_created_at_idx on public.import_batches (created_at desc);

-------------------------------------------------------------------------------
-- Enquiry register
-------------------------------------------------------------------------------

-- Last issued running number per reference prefix ('SL26' -> 2737 means SL262737 was the last one).
create table public.reference_counters (
  prefix text primary key,
  last_seq integer not null
);

create table public.enquiries (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique check (reference ~ '^SL[0-9]{6,}$'),

  enquiry_date date not null,
  quoted_date date,
  confirmed_date date,
  closure text check (closure in ('lost', 'cancelled')),
  closure_reason text,
  status text generated always as (
    case
      when closure = 'cancelled' then 'cancelled'
      when confirmed_date is not null then 'confirmed'
      when closure = 'lost' then 'lost'
      when quoted_date is not null then 'quoted'
      else 'new'
    end
  ) stored,

  customer_id uuid not null references public.customers (id),
  subject text,

  trade_type text check (trade_type in ('IMP', 'EXP', 'CT')),
  qty_text text,
  shipment_mode text check (shipment_mode in ('FCL', 'LCL', 'AIR', 'COURIER', 'RORO', 'BREAK_BULK', 'MULTI', 'OTHER')),
  units integer check (units >= 0),
  container_type text,

  currency char(3) not null default 'USD',
  buy_rate numeric(14, 3),
  buy_total numeric(14, 3),
  sell_rate numeric(14, 3),
  sell_total numeric(14, 3),
  profit numeric(14, 3) generated always as (
    case when sell_total is null and buy_total is null then null
         else coalesce(sell_total, 0) - coalesce(buy_total, 0) end
  ) stored,

  pol text,
  pod text,
  agent_id uuid references public.agents (id),
  sales_person_id uuid references public.sales_persons (id),
  remarks text,

  source text not null default 'manual' check (source in ('manual', 'import')),
  import_batch_id uuid references public.import_batches (id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

create index enquiries_enquiry_date_idx on public.enquiries (enquiry_date desc);
create index enquiries_quoted_date_idx on public.enquiries (quoted_date) where quoted_date is not null;
create index enquiries_confirmed_date_idx on public.enquiries (confirmed_date) where confirmed_date is not null;
create index enquiries_status_idx on public.enquiries (status);
create index enquiries_customer_idx on public.enquiries (customer_id);
create index enquiries_agent_idx on public.enquiries (agent_id);
create index enquiries_sales_person_idx on public.enquiries (sales_person_id);
create index enquiries_import_batch_idx on public.enquiries (import_batch_id);

-- Issues references, keeps the counter ahead of explicitly supplied ones, stamps updates.
create or replace function public.enquiries_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix text;
  v_seq integer;
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
    if new.source = 'manual' and new.subject is not null and position(new.reference in new.subject) <> 1 then
      new.subject := new.reference || ' ' || new.subject;
    end if;
  else
    new.updated_at := now();
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger enquiries_before_write
  before insert or update on public.enquiries
  for each row execute function public.enquiries_before_write();

-------------------------------------------------------------------------------
-- Audit trail
-------------------------------------------------------------------------------

create table public.enquiry_audit (
  id bigint generated always as identity primary key,
  enquiry_id uuid not null,
  reference text not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  changes jsonb,
  import_batch_id uuid,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index enquiry_audit_enquiry_idx on public.enquiry_audit (enquiry_id, changed_at desc);

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
       and n.key not in ('updated_at', 'updated_by', 'status', 'profit', 'import_batch_id', 'source');
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

create trigger enquiries_audit
  after insert or update or delete on public.enquiries
  for each row execute function public.enquiries_audit();

-------------------------------------------------------------------------------
-- Read model used by the UI
-------------------------------------------------------------------------------

create view public.enquiry_register
with (security_invoker = true)
as
select
  e.*,
  c.name as customer_name,
  a.name as agent_name,
  s.name as sales_person_name
from public.enquiries e
join public.customers c on c.id = e.customer_id
left join public.agents a on a.id = e.agent_id
left join public.sales_persons s on s.id = e.sales_person_id;

-------------------------------------------------------------------------------
-- Name resolution (find by alias / normalised name, create if new)
-------------------------------------------------------------------------------

create or replace function public.resolve_customer(p_name text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_key text := public.name_key(p_name);
  v_id uuid;
begin
  if v_key is null then
    return null;
  end if;
  select customer_id into v_id from public.customer_aliases where alias_key = v_key;
  if v_id is null then
    select id into v_id from public.customers where name_key = v_key;
  end if;
  if v_id is null then
    insert into public.customers (name)
    values (upper(btrim(regexp_replace(p_name, '\s+', ' ', 'g'))))
    on conflict (name_key) do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id from public.customers where name_key = v_key;
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.resolve_agent(p_name text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_key text := public.name_key(p_name);
  v_id uuid;
begin
  if v_key is null then
    return null;
  end if;
  select agent_id into v_id from public.agent_aliases where alias_key = v_key;
  if v_id is null then
    select id into v_id from public.agents where name_key = v_key;
  end if;
  if v_id is null then
    insert into public.agents (name)
    values (upper(btrim(regexp_replace(p_name, '\s+', ' ', 'g'))))
    on conflict (name_key) do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id from public.agents where name_key = v_key;
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.resolve_sales_person(p_name text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_key text := public.name_key(p_name);
  v_id uuid;
begin
  if v_key is null then
    return null;
  end if;
  select id into v_id from public.sales_persons where name_key = v_key;
  if v_id is null then
    insert into public.sales_persons (name)
    values (upper(btrim(regexp_replace(p_name, '\s+', ' ', 'g'))))
    on conflict (name_key) do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id from public.sales_persons where name_key = v_key;
    end if;
  end if;
  return v_id;
end;
$$;

-------------------------------------------------------------------------------
-- Write RPCs
-------------------------------------------------------------------------------

-- Manual create (p_id null) or full update from the entry form. Names are resolved/created server-side.
create or replace function public.upsert_enquiry(p_id uuid, p jsonb)
returns public.enquiries
language plpgsql
set search_path = ''
as $$
declare
  v_row public.enquiries;
  v_customer uuid;
  v_agent uuid;
  v_sales uuid;
begin
  if not public.can_edit() then
    raise exception 'Only editors can change enquiries' using errcode = '42501';
  end if;

  v_customer := public.resolve_customer(p ->> 'customer_name');
  if v_customer is null then
    raise exception 'Customer is required';
  end if;
  v_agent := public.resolve_agent(p ->> 'agent_name');
  v_sales := public.resolve_sales_person(p ->> 'sales_person_name');

  if p_id is null then
    insert into public.enquiries (
      reference, enquiry_date, quoted_date, confirmed_date, closure, closure_reason,
      customer_id, subject, trade_type, qty_text, shipment_mode, units, container_type,
      currency, buy_rate, buy_total, sell_rate, sell_total,
      pol, pod, agent_id, sales_person_id, remarks, source
    ) values (
      nullif(p ->> 'reference', ''),
      (p ->> 'enquiry_date')::date,
      nullif(p ->> 'quoted_date', '')::date,
      nullif(p ->> 'confirmed_date', '')::date,
      nullif(p ->> 'closure', ''),
      nullif(p ->> 'closure_reason', ''),
      v_customer,
      nullif(p ->> 'subject', ''),
      nullif(p ->> 'trade_type', ''),
      nullif(p ->> 'qty_text', ''),
      nullif(p ->> 'shipment_mode', ''),
      nullif(p ->> 'units', '')::integer,
      nullif(p ->> 'container_type', ''),
      coalesce(nullif(p ->> 'currency', ''), 'USD'),
      nullif(p ->> 'buy_rate', '')::numeric,
      nullif(p ->> 'buy_total', '')::numeric,
      nullif(p ->> 'sell_rate', '')::numeric,
      nullif(p ->> 'sell_total', '')::numeric,
      nullif(p ->> 'pol', ''),
      nullif(p ->> 'pod', ''),
      v_agent,
      v_sales,
      nullif(p ->> 'remarks', ''),
      'manual'
    )
    returning * into v_row;
  else
    update public.enquiries set
      enquiry_date    = (p ->> 'enquiry_date')::date,
      quoted_date     = nullif(p ->> 'quoted_date', '')::date,
      confirmed_date  = nullif(p ->> 'confirmed_date', '')::date,
      closure         = nullif(p ->> 'closure', ''),
      closure_reason  = nullif(p ->> 'closure_reason', ''),
      customer_id     = v_customer,
      subject         = nullif(p ->> 'subject', ''),
      trade_type      = nullif(p ->> 'trade_type', ''),
      qty_text        = nullif(p ->> 'qty_text', ''),
      shipment_mode   = nullif(p ->> 'shipment_mode', ''),
      units           = nullif(p ->> 'units', '')::integer,
      container_type  = nullif(p ->> 'container_type', ''),
      currency        = coalesce(nullif(p ->> 'currency', ''), currency),
      buy_rate        = nullif(p ->> 'buy_rate', '')::numeric,
      buy_total       = nullif(p ->> 'buy_total', '')::numeric,
      sell_rate       = nullif(p ->> 'sell_rate', '')::numeric,
      sell_total      = nullif(p ->> 'sell_total', '')::numeric,
      pol             = nullif(p ->> 'pol', ''),
      pod             = nullif(p ->> 'pod', ''),
      agent_id        = v_agent,
      sales_person_id = v_sales,
      remarks         = nullif(p ->> 'remarks', '')
    where id = p_id
    returning * into v_row;
    if not found then
      raise exception 'Enquiry % not found', p_id;
    end if;
  end if;
  return v_row;
end;
$$;

-- Batch upsert from an Excel upload. Blank incoming values never overwrite stored values.
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

  -- Lets the audit trigger tag every change with this batch.
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
    on conflict (reference) do update set
      enquiry_date    = coalesce(excluded.enquiry_date, e.enquiry_date),
      quoted_date     = coalesce(excluded.quoted_date, e.quoted_date),
      confirmed_date  = coalesce(excluded.confirmed_date, e.confirmed_date),
      customer_id     = coalesce(excluded.customer_id, e.customer_id),
      subject         = coalesce(excluded.subject, e.subject),
      trade_type      = coalesce(excluded.trade_type, e.trade_type),
      qty_text        = coalesce(excluded.qty_text, e.qty_text),
      shipment_mode   = coalesce(excluded.shipment_mode, e.shipment_mode),
      units           = coalesce(excluded.units, e.units),
      container_type  = coalesce(excluded.container_type, e.container_type),
      buy_rate        = coalesce(excluded.buy_rate, e.buy_rate),
      buy_total       = coalesce(excluded.buy_total, e.buy_total),
      sell_rate       = coalesce(excluded.sell_rate, e.sell_rate),
      sell_total      = coalesce(excluded.sell_total, e.sell_total),
      pol             = coalesce(excluded.pol, e.pol),
      pod             = coalesce(excluded.pod, e.pod),
      agent_id        = coalesce(excluded.agent_id, e.agent_id),
      sales_person_id = coalesce(excluded.sales_person_id, e.sales_person_id),
      remarks         = coalesce(excluded.remarks, e.remarks),
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

-------------------------------------------------------------------------------
-- Report RPCs
-------------------------------------------------------------------------------

-- Headline numbers for a date range. Enquiries/quoted/confirmed are each counted by their own date,
-- "converted" counts enquiries raised in the range that are now confirmed.
create or replace function public.dashboard_stats(p_from date, p_to date)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'enquiries', (select count(*) from public.enquiries where enquiry_date between p_from and p_to),
    'quoted', (select count(*) from public.enquiries where quoted_date between p_from and p_to),
    'confirmed', (select count(*) from public.enquiries where confirmed_date between p_from and p_to and status = 'confirmed'),
    'converted', (select count(*) from public.enquiries where enquiry_date between p_from and p_to and status = 'confirmed'),
    'profit', (select coalesce(sum(profit), 0) from public.enquiries where confirmed_date between p_from and p_to and status = 'confirmed'),
    'sell_total', (select coalesce(sum(sell_total), 0) from public.enquiries where confirmed_date between p_from and p_to and status = 'confirmed')
  )
$$;

-- The weekly "DATA" sheet: per sales person, enquiries raised in the range and jobs confirmed in the range.
create or replace function public.salesperson_summary(p_from date, p_to date)
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
  profit numeric
)
language sql
stable
set search_path = ''
as $$
  with enq as (
    select coalesce(e.sales_person_id, '00000000-0000-0000-0000-000000000000'::uuid) as sp_id,
           count(*)::integer as total_enquiries
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
         coalesce(conf.profit, 0)
    from enq
    full join conf using (sp_id)
    left join public.sales_persons sp on sp.id = sp_id
   order by 1
$$;

-------------------------------------------------------------------------------
-- Row Level Security
-------------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.sales_persons enable row level security;
alter table public.customers enable row level security;
alter table public.customer_aliases enable row level security;
alter table public.agents enable row level security;
alter table public.agent_aliases enable row level security;
alter table public.import_batches enable row level security;
alter table public.reference_counters enable row level security; -- no policies: only the trigger touches it
alter table public.enquiries enable row level security;
alter table public.enquiry_audit enable row level security;

create policy "profiles: staff read" on public.profiles
  for select to authenticated using (true);
create policy "profiles: admin update" on public.profiles
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Master data and the register: any staff member reads, editors write, admins delete.
do $$
declare
  t text;
begin
  foreach t in array array['sales_persons', 'customers', 'customer_aliases', 'agents', 'agent_aliases', 'enquiries'] loop
    execute format('create policy "%1$s: staff read" on public.%1$I for select to authenticated using ((select public.app_role()) is not null)', t);
    execute format('create policy "%1$s: editor insert" on public.%1$I for insert to authenticated with check ((select public.can_edit()))', t);
    execute format('create policy "%1$s: editor update" on public.%1$I for update to authenticated using ((select public.can_edit())) with check ((select public.can_edit()))', t);
    execute format('create policy "%1$s: admin delete" on public.%1$I for delete to authenticated using ((select public.is_admin()))', t);
  end loop;
end;
$$;

create policy "import_batches: staff read" on public.import_batches
  for select to authenticated using ((select public.app_role()) is not null);
create policy "import_batches: editor insert" on public.import_batches
  for insert to authenticated with check ((select public.can_edit()));
create policy "import_batches: editor update" on public.import_batches
  for update to authenticated using ((select public.can_edit())) with check ((select public.can_edit()));

create policy "enquiry_audit: staff read" on public.enquiry_audit
  for select to authenticated using ((select public.app_role()) is not null);

-------------------------------------------------------------------------------
-- Function privileges: nothing for anonymous visitors
-------------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.name_key(text),
  public.app_role(),
  public.can_edit(),
  public.is_admin(),
  public.resolve_customer(text),
  public.resolve_agent(text),
  public.resolve_sales_person(text),
  public.upsert_enquiry(uuid, jsonb),
  public.import_enquiries(uuid, jsonb),
  public.dashboard_stats(date, date),
  public.salesperson_summary(date, date)
to authenticated;

-------------------------------------------------------------------------------
-- Storage: original uploaded Excel files
-------------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('imports', 'imports', false)
on conflict (id) do nothing;

create policy "imports: staff read" on storage.objects
  for select to authenticated using (bucket_id = 'imports' and (select public.app_role()) is not null);
create policy "imports: editor upload" on storage.objects
  for insert to authenticated with check (bucket_id = 'imports' and (select public.can_edit()));
