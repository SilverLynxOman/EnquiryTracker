-- Email intake (docs/IMPLEMENTATION_PLAN.md, Phase 7).
--
-- The gmail-sync Edge Function (supabase/functions/gmail-sync) reads the pricing mailbox with the service
-- role. For every message it asks email_match_context() what the database already knows (references,
-- earlier messages of the conversation, the sender's customer), decides what the message is, and stores
-- the result with ingest_email():
--   * follow-up of an enquiry  -> email_messages.status 'linked', shown in the enquiry's e-mail history
--   * new enquiry              -> an enquiry_drafts row ('pending') that staff review in the app
--   * cites an SL reference the register does not have yet -> 'awaiting_enquiry', linked automatically
--     by the enquiries_link_waiting_emails trigger once that enquiry is created or imported
--   * unsure                   -> 'review';  not enquiry related -> 'ignored'
-- Staff turn a draft into an enquiry with create_enquiry_from_draft() (one click), or fold it into an
-- existing enquiry with merge_draft_into_enquiry(). Nothing creates an enquiry without a person.

create extension if not exists pg_trgm with schema extensions;

-------------------------------------------------------------------------------
-- Helpers
-------------------------------------------------------------------------------

create or replace function public.email_domain(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(lower(split_part(btrim(coalesce(p, '')), '@', 2)), '')
$$;

-- Free-mail domains say nothing about which company a sender belongs to.
create or replace function public.is_public_email_domain(p_domain text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(lower(p_domain) = any (array[
    'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.co.uk', 'ymail.com', 'hotmail.com',
    'outlook.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com',
    'gmx.com', 'mail.com', 'yandex.com', 'qq.com', '163.com', '126.com', 'rediffmail.com', 'omantel.net.om'
  ]), false)
$$;

create or replace function public.jsonb_text_array(p jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    array(select x from jsonb_array_elements_text(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) x
           where btrim(x) <> ''),
    '{}'::text[])
$$;

-------------------------------------------------------------------------------
-- Customer contacts
-------------------------------------------------------------------------------

create table public.customer_contacts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  name text,
  email text check (email is null or email ~ '^[^@\s]+@[^@\s]+$'),
  phone text,
  designation text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create unique index customer_contacts_email_idx on public.customer_contacts (lower(email));
create index customer_contacts_domain_idx on public.customer_contacts (public.email_domain(email));
create index customer_contacts_customer_idx on public.customer_contacts (customer_id);

-- Find a contact by e-mail address, or add it to the customer. Returns null without a usable address.
create or replace function public.resolve_contact(p_customer_id uuid, p_name text, p_email text, p_phone text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_id uuid;
begin
  if p_customer_id is null or v_email is null or v_email !~ '^[^@\s]+@[^@\s]+$' then
    return null;
  end if;
  select id into v_id from public.customer_contacts where lower(email) = v_email;
  if v_id is null then
    insert into public.customer_contacts (customer_id, name, email, phone)
    values (p_customer_id, nullif(btrim(p_name), ''), v_email, nullif(btrim(p_phone), ''))
    on conflict ((lower(email))) do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id from public.customer_contacts where lower(email) = v_email;
    end if;
  else
    update public.customer_contacts
       set name = coalesce(name, nullif(btrim(p_name), '')),
           phone = coalesce(phone, nullif(btrim(p_phone), ''))
     where id = v_id
       and (name is null or phone is null);
  end if;
  return v_id;
end;
$$;

-------------------------------------------------------------------------------
-- Enquiries: contact, requirements, 'email' source
-------------------------------------------------------------------------------

alter table public.enquiries
  add column contact_id uuid references public.customer_contacts (id) on delete set null,
  add column requirements text;
create index enquiries_contact_idx on public.enquiries (contact_id);

alter table public.enquiries drop constraint enquiries_source_check;
alter table public.enquiries add constraint enquiries_source_check check (source in ('manual', 'import', 'email'));

-- e.* is expanded when a view is created, so the view must be rebuilt to show the new columns.
drop view public.enquiry_register;
create view public.enquiry_register
with (security_invoker = true)
as
select
  e.*,
  c.name as customer_name,
  a.name as agent_name,
  s.name as sales_person_name,
  ct.name as contact_name,
  ct.email as contact_email,
  ct.phone as contact_phone
from public.enquiries e
join public.customers c on c.id = e.customer_id
left join public.agents a on a.id = e.agent_id
left join public.sales_persons s on s.id = e.sales_person_id
left join public.customer_contacts ct on ct.id = e.contact_id;
grant select on public.enquiry_register to authenticated;

-- Same as before, except that e-mail-created enquiries also get the reference in front of the subject.
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
    if new.source in ('manual', 'email') and new.subject is not null and position(new.reference in new.subject) <> 1 then
      new.subject := new.reference || ' ' || new.subject;
    end if;
  else
    new.updated_at := now();
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

-- Same as before, plus contact (contact_name / contact_email / contact_phone), requirements and the
-- 'email' source. On update the new keys are optional: a payload without them leaves the stored values.
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
  v_contact uuid;
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
  v_contact := public.resolve_contact(v_customer, p ->> 'contact_name', p ->> 'contact_email', p ->> 'contact_phone');

  if p_id is null then
    insert into public.enquiries (
      reference, enquiry_date, quoted_date, confirmed_date, closure, closure_reason,
      customer_id, subject, trade_type, qty_text, shipment_mode, units, container_type,
      currency, buy_rate, buy_total, sell_rate, sell_total,
      pol, pod, agent_id, sales_person_id, remarks, contact_id, requirements, source
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
      v_contact,
      nullif(p ->> 'requirements', ''),
      case when p ->> 'source' = 'email' then 'email' else 'manual' end
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
      remarks         = nullif(p ->> 'remarks', ''),
      contact_id      = case when p ? 'contact_email' then v_contact else contact_id end,
      requirements    = case when p ? 'requirements' then nullif(p ->> 'requirements', '') else requirements end
    where id = p_id
    returning * into v_row;
    if not found then
      raise exception 'Enquiry % not found', p_id;
    end if;
  end if;
  return v_row;
end;
$$;

-------------------------------------------------------------------------------
-- Mailboxes, drafts, messages
-------------------------------------------------------------------------------

-- One row per watched mailbox (created by the sync on its first run). Holds the sync checkpoint.
create table public.mailboxes (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  active boolean not null default true,
  sync_from timestamptz,
  last_synced_at timestamptz,
  last_error text,
  locked_until timestamptz,
  stats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- A new enquiry found in the mailbox, waiting for a person to create it (or dismiss / merge it).
create table public.enquiry_drafts (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'pending' check (status in ('pending', 'created', 'merged', 'dismissed')),
  mailbox_id uuid references public.mailboxes (id) on delete set null,
  gmail_thread_id text,
  received_at timestamptz not null,
  customer_name text,
  customer_id uuid references public.customers (id) on delete set null,
  contact_name text,
  contact_email text,
  contact_phone text,
  contact_designation text,
  sales_person_name text,
  -- Proposed register fields: enquiry_date, subject, trade_type, qty_text, shipment_mode, units,
  -- container_type, pol, pod, remarks (see DraftFields in src/lib/types.ts).
  fields jsonb not null default '{}'::jsonb,
  requirements text,
  summary text,
  confidence numeric(4, 3),
  enquiry_id uuid references public.enquiries (id) on delete set null,
  dismiss_reason text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index enquiry_drafts_status_idx on public.enquiry_drafts (status, received_at desc);
create index enquiry_drafts_thread_idx on public.enquiry_drafts (gmail_thread_id);
create index enquiry_drafts_customer_idx on public.enquiry_drafts (customer_id);
create index enquiry_drafts_enquiry_idx on public.enquiry_drafts (enquiry_id);
create index enquiry_drafts_mailbox_idx on public.enquiry_drafts (mailbox_id);

create table public.email_messages (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid references public.mailboxes (id) on delete set null,
  gmail_message_id text not null unique,
  gmail_thread_id text not null,
  rfc_message_id text,
  in_reply_to text,
  reference_ids text[] not null default '{}',
  -- external: customers, agents, carriers; staff: a colleague's address; self: the watched mailbox
  sender_type text not null check (sender_type in ('external', 'staff', 'self')),
  from_email text,
  from_name text,
  to_emails text[] not null default '{}',
  cc_emails text[] not null default '{}',
  subject text,
  received_at timestamptz not null,
  snippet text,
  body_text text,
  sl_refs text[] not null default '{}',
  -- [{filename, mime_type, size, storage_path, skipped}]
  attachments jsonb not null default '[]'::jsonb,
  label_ids text[] not null default '{}',
  status text not null check (status in ('linked', 'draft', 'awaiting_enquiry', 'review', 'ignored')),
  classification text check (classification in ('new_enquiry', 'follow_up', 'not_enquiry')),
  match_method text check (match_method in ('reference', 'reply', 'ai', 'rule', 'manual')),
  confidence numeric(4, 3),
  summary text,
  note text,
  ai_result jsonb,
  suggested_enquiry_id uuid references public.enquiries (id) on delete set null,
  enquiry_id uuid references public.enquiries (id) on delete set null,
  draft_id uuid references public.enquiry_drafts (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index email_messages_thread_idx on public.email_messages (gmail_thread_id);
create index email_messages_rfc_idx on public.email_messages (rfc_message_id);
create index email_messages_enquiry_idx on public.email_messages (enquiry_id, received_at);
create index email_messages_suggested_idx on public.email_messages (suggested_enquiry_id);
create index email_messages_draft_idx on public.email_messages (draft_id);
create index email_messages_status_idx on public.email_messages (status, received_at desc);
create index email_messages_mailbox_idx on public.email_messages (mailbox_id);
create index email_messages_refs_idx on public.email_messages using gin (sl_refs);

-------------------------------------------------------------------------------
-- Keep e-mails attached when enquiries come and go
-------------------------------------------------------------------------------

-- An e-mail that cited a reference the register did not have yet is linked as soon as it appears
-- (manual entry, draft or Excel import).
create or replace function public.enquiries_link_waiting_emails()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.email_messages
     set enquiry_id = new.id,
         status = 'linked',
         match_method = 'reference',
         confidence = 1,
         note = null,
         updated_at = now()
   where status = 'awaiting_enquiry'
     and sl_refs @> array[new.reference];
  return null;
end;
$$;

create trigger enquiries_link_waiting_emails
  after insert on public.enquiries
  for each row execute function public.enquiries_link_waiting_emails();

-- Deleting an enquiry must not lose its e-mails: drafts it came from reopen, other e-mails go to review.
create or replace function public.enquiries_release_emails()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.enquiry_drafts
     set status = 'pending', enquiry_id = null, reviewed_by = null, reviewed_at = null, updated_at = now()
   where enquiry_id = old.id;
  update public.email_messages m
     set enquiry_id = null,
         status = case when exists (select 1 from public.enquiry_drafts d where d.id = m.draft_id and d.status = 'pending')
                       then 'draft' else 'review' end,
         note = 'Enquiry ' || old.reference || ' was deleted',
         updated_at = now()
   where m.enquiry_id = old.id;
  return old;
end;
$$;

create trigger enquiries_release_emails
  before delete on public.enquiries
  for each row execute function public.enquiries_release_emails();

-------------------------------------------------------------------------------
-- Sync RPCs (service role only, called by the gmail-sync Edge Function)
-------------------------------------------------------------------------------

-- Takes a lease on the mailbox so overlapping runs do not process the same mail.
-- Returns the mailbox row, or null while another run holds the lease (or the mailbox is inactive).
create or replace function public.begin_mailbox_sync(p_email text, p_lease_seconds integer, p_default_from timestamptz)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_row public.mailboxes;
begin
  insert into public.mailboxes (email, sync_from)
  values (lower(btrim(p_email)), p_default_from)
  on conflict (email) do nothing;

  update public.mailboxes
     set locked_until = now() + make_interval(secs => greatest(p_lease_seconds, 30))
   where email = lower(btrim(p_email))
     and active
     and (locked_until is null or locked_until < now())
  returning * into v_row;
  if not found then
    return null;
  end if;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.end_mailbox_sync(p_email text, p_sync_from timestamptz, p_error text, p_stats jsonb)
returns void
language sql
set search_path = ''
as $$
  update public.mailboxes
     set locked_until = null,
         last_synced_at = now(),
         last_error = p_error,
         stats = coalesce(p_stats, stats),
         sync_from = coalesce(p_sync_from, sync_from)
   where email = lower(btrim(p_email))
$$;

-- What the database knows about a message before it is classified. Input keys: gmail_message_id,
-- gmail_thread_id, in_reply_to, reference_ids[], sl_refs[] (subject first), customer_email (external
-- sender or null), participants[] (all addresses on the message).
create or replace function public.email_match_context(p jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_refs text[] := public.jsonb_text_array(p -> 'sl_refs');
  v_chain text[] := array_remove(public.jsonb_text_array(p -> 'reference_ids') || (p ->> 'in_reply_to'), null);
  v_thread text := p ->> 'gmail_thread_id';
  v_customer_email text := nullif(lower(btrim(coalesce(p ->> 'customer_email', ''))), '');
  v_domain text := public.email_domain(v_customer_email);
  v_participants text[] := array(select lower(x) from unnest(public.jsonb_text_array(p -> 'participants')) x);
  v_customer_id uuid;
  v_customer_name text;
  v_customer_via text;
begin
  if v_customer_email is not null then
    select c.id, c.name, 'contact' into v_customer_id, v_customer_name, v_customer_via
      from public.customer_contacts ct
      join public.customers c on c.id = ct.customer_id
     where lower(ct.email) = v_customer_email;
    if v_customer_id is null and v_domain is not null and not public.is_public_email_domain(v_domain) then
      select c.id, c.name, 'domain' into v_customer_id, v_customer_name, v_customer_via
        from public.customer_contacts ct
        join public.customers c on c.id = ct.customer_id
       where public.email_domain(ct.email) = v_domain
       group by c.id, c.name
       order by count(*) desc, c.name
       limit 1;
    end if;
  end if;

  return jsonb_build_object(
    'already_ingested', exists (select 1 from public.email_messages where gmail_message_id = p ->> 'gmail_message_id'),

    'ref_matches', coalesce((
      select jsonb_agg(jsonb_build_object('reference', e.reference, 'enquiry_id', e.id,
                                          'enquiry_date', e.enquiry_date, 'status', e.status)
                       order by array_position(v_refs, e.reference))
        from public.enquiries e
       where e.reference = any (v_refs)), '[]'::jsonb),

    'unknown_refs', to_jsonb(array(
      select r from unnest(v_refs) with ordinality u(r, n)
       where not exists (select 1 from public.enquiries e where e.reference = r)
       order by n)),

    -- An earlier stored message this one replies to (In-Reply-To / References), linked or in a pending draft.
    'reply_match', (
      select jsonb_build_object('email_id', m.id, 'enquiry_id', m.enquiry_id, 'reference', en.reference,
                                'enquiry_date', en.enquiry_date, 'status', en.status,
                                'draft_id', case when d.status = 'pending' then d.id end)
        from public.email_messages m
        left join public.enquiry_drafts d on d.id = m.draft_id
        left join public.enquiries en on en.id = m.enquiry_id
       where m.rfc_message_id = any (v_chain)
         and (m.enquiry_id is not null or d.status = 'pending')
       order by (m.enquiry_id is not null) desc, m.received_at desc
       limit 1),

    'customer', case when v_customer_id is null then null else
      jsonb_build_object('id', v_customer_id, 'name', v_customer_name, 'via', v_customer_via) end,

    -- Staff on the message whose address is recorded on a sales person.
    'sales_person', (
      select s.name from public.sales_persons s
       where s.active and lower(s.email) = any (v_participants)
       order by array_position(v_participants, lower(s.email))
       limit 1),
    'customer_sales_person', (
      select s.name from public.enquiries e
        join public.sales_persons s on s.id = e.sales_person_id
       where e.customer_id = v_customer_id
       order by e.enquiry_date desc, e.reference desc
       limit 1),
    'sales_persons', coalesce((select jsonb_agg(s.name order by s.name) from public.sales_persons s where s.active), '[]'::jsonb),

    -- What the message could be a follow-up of: enquiries already discussed in this conversation and
    -- the customer's recent enquiries, plus pending drafts from the same conversation or sender.
    'candidates', coalesce((
      select jsonb_agg(x order by x ->> 'date' desc)
        from (
          select jsonb_build_object(
                   'kind', 'enquiry', 'id', e.id, 'reference', e.reference, 'date', e.enquiry_date,
                   'customer', c.name, 'subject', e.subject, 'qty', e.qty_text, 'pol', e.pol, 'pod', e.pod,
                   'status', e.status) as x
            from public.enquiries e
            join public.customers c on c.id = e.customer_id
           where e.id in (
                   select m.enquiry_id from public.email_messages m
                    where m.gmail_thread_id = v_thread and m.enquiry_id is not null)
              or (e.customer_id = v_customer_id and e.enquiry_date >= current_date - 120
                  and e.status in ('new', 'quoted', 'confirmed'))
           order by e.enquiry_date desc
           limit 8
        ) q), '[]'::jsonb)
    || coalesce((
      select jsonb_agg(x)
        from (
          select jsonb_build_object(
                   'kind', 'draft', 'id', d.id, 'reference', null,
                   'date', (d.received_at at time zone 'Asia/Muscat')::date,
                   'customer', d.customer_name, 'subject', d.fields ->> 'subject', 'qty', d.fields ->> 'qty_text',
                   'pol', d.fields ->> 'pol', 'pod', d.fields ->> 'pod', 'status', 'draft') as x
            from public.enquiry_drafts d
           where d.status = 'pending'
             and (d.gmail_thread_id = v_thread
                  or lower(d.contact_email) = v_customer_email
                  or (v_customer_id is not null and d.customer_id = v_customer_id))
           order by d.received_at desc
           limit 5
        ) q), '[]'::jsonb)
  );
end;
$$;

-- Stores one classified message. Idempotent: a message already stored is returned unchanged.
-- p = {mailbox_email, email: {...}, decision: {status, classification, match_method, confidence, summary,
--      note, enquiry_id, draft_id, suggested_enquiry_id}, ai_result, new_draft: {...} | null}
create or replace function public.ingest_email(p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  m jsonb := p -> 'email';
  d jsonb := p -> 'decision';
  nd jsonb := case when jsonb_typeof(p -> 'new_draft') = 'object' then p -> 'new_draft' end;
  v_mailbox uuid;
  v_email uuid;
  v_status text := d ->> 'status';
  v_enquiry uuid := nullif(d ->> 'enquiry_id', '')::uuid;
  v_draft uuid := nullif(d ->> 'draft_id', '')::uuid;
  v_draft_row public.enquiry_drafts;
  v_note text := nullif(d ->> 'note', '');
  v_reference text;
  v_chain text[];
begin
  select id into v_mailbox from public.mailboxes where email = lower(btrim(p ->> 'mailbox_email'));

  -- Replying to a draft that has meanwhile been handled: follow the draft to its enquiry.
  if v_draft is not null then
    select * into v_draft_row from public.enquiry_drafts where id = v_draft for update;
    if not found then
      v_draft := null;
      v_status := 'review';
    elsif v_draft_row.status <> 'pending' then
      if v_draft_row.enquiry_id is not null then
        v_enquiry := v_draft_row.enquiry_id;
        v_status := 'linked';
      else
        v_status := 'review';
        v_note := coalesce(v_note, 'Reply to an e-mail enquiry that was dismissed');
      end if;
    else
      v_status := 'draft';
    end if;
  end if;
  if nd is not null then
    v_status := 'draft';
  end if;
  if v_status = 'linked' and v_enquiry is null then
    v_status := 'review';
  end if;

  insert into public.email_messages (
    mailbox_id, gmail_message_id, gmail_thread_id, rfc_message_id, in_reply_to, reference_ids, sender_type,
    from_email, from_name, to_emails, cc_emails, subject, received_at, snippet, body_text, sl_refs,
    attachments, label_ids, status, classification, match_method, confidence, summary, note, ai_result,
    suggested_enquiry_id, enquiry_id, draft_id
  ) values (
    v_mailbox,
    m ->> 'gmail_message_id',
    m ->> 'gmail_thread_id',
    nullif(m ->> 'rfc_message_id', ''),
    nullif(m ->> 'in_reply_to', ''),
    public.jsonb_text_array(m -> 'reference_ids'),
    m ->> 'sender_type',
    nullif(lower(m ->> 'from_email'), ''),
    nullif(m ->> 'from_name', ''),
    public.jsonb_text_array(m -> 'to_emails'),
    public.jsonb_text_array(m -> 'cc_emails'),
    m ->> 'subject',
    (m ->> 'received_at')::timestamptz,
    m ->> 'snippet',
    m ->> 'body_text',
    public.jsonb_text_array(m -> 'sl_refs'),
    case when jsonb_typeof(m -> 'attachments') = 'array' then m -> 'attachments' else '[]'::jsonb end,
    public.jsonb_text_array(m -> 'label_ids'),
    v_status,
    nullif(d ->> 'classification', ''),
    nullif(d ->> 'match_method', ''),
    nullif(d ->> 'confidence', '')::numeric,
    nullif(d ->> 'summary', ''),
    v_note,
    case when jsonb_typeof(p -> 'ai_result') = 'object' then p -> 'ai_result' end,
    nullif(d ->> 'suggested_enquiry_id', '')::uuid,
    case when v_status = 'linked' then v_enquiry end,
    v_draft
  )
  on conflict (gmail_message_id) do nothing
  returning id into v_email;

  if v_email is null then
    select id, status, enquiry_id, draft_id into v_email, v_status, v_enquiry, v_draft
      from public.email_messages where gmail_message_id = m ->> 'gmail_message_id';
    return jsonb_build_object('email_id', v_email, 'status', v_status, 'enquiry_id', v_enquiry,
                              'draft_id', v_draft, 'duplicate', true);
  end if;

  if nd is not null then
    insert into public.enquiry_drafts (
      mailbox_id, gmail_thread_id, received_at, customer_name, customer_id, contact_name, contact_email,
      contact_phone, contact_designation, sales_person_name, fields, requirements, summary, confidence
    ) values (
      v_mailbox,
      m ->> 'gmail_thread_id',
      (m ->> 'received_at')::timestamptz,
      nullif(upper(btrim(nd ->> 'customer_name')), ''),
      nullif(nd ->> 'customer_id', '')::uuid,
      nullif(nd ->> 'contact_name', ''),
      nullif(lower(btrim(nd ->> 'contact_email')), ''),
      nullif(nd ->> 'contact_phone', ''),
      nullif(nd ->> 'contact_designation', ''),
      nullif(nd ->> 'sales_person_name', ''),
      case when jsonb_typeof(nd -> 'fields') = 'object' then nd -> 'fields' else '{}'::jsonb end,
      nullif(nd ->> 'requirements', ''),
      nullif(nd ->> 'summary', ''),
      nullif(nd ->> 'confidence', '')::numeric
    )
    returning id into v_draft;
    update public.email_messages set draft_id = v_draft where id = v_email;
  elsif v_status = 'draft' then
    update public.enquiry_drafts set updated_at = now() where id = v_draft;
  end if;

  -- Staff created the enquiry by hand while its draft was still waiting, and this message (which carries
  -- the reference) replies to the draft's e-mails: fold the draft in instead of leaving a duplicate.
  if v_status = 'linked' then
    v_chain := array_remove(public.jsonb_text_array(m -> 'reference_ids') || (m ->> 'in_reply_to'), null);
    select reference into v_reference from public.enquiries where id = v_enquiry;
    with merged as (
      update public.enquiry_drafts dr
         set status = 'merged',
             enquiry_id = v_enquiry,
             dismiss_reason = 'Merged automatically: a reply in the same conversation refers to ' || v_reference,
             reviewed_at = now(),
             updated_at = now()
       where dr.status = 'pending'
         and dr.id in (select em.draft_id from public.email_messages em
                        where em.rfc_message_id = any (v_chain) and em.draft_id is not null)
      returning dr.id
    )
    update public.email_messages em
       set enquiry_id = v_enquiry, status = 'linked', updated_at = now()
     where em.draft_id in (select id from merged);
  end if;

  return jsonb_build_object('email_id', v_email, 'status', v_status, 'enquiry_id',
                            case when v_status = 'linked' then v_enquiry end,
                            'draft_id', v_draft, 'duplicate', false);
end;
$$;

-------------------------------------------------------------------------------
-- Review RPCs (staff, from the app)
-------------------------------------------------------------------------------

-- The one-click create: makes the enquiry from the reviewed draft fields (an upsert_enquiry payload)
-- and moves the draft's e-mails to it. Locks the draft, so a double click or two users cannot create it twice.
create or replace function public.create_enquiry_from_draft(p_draft_id uuid, p jsonb)
returns public.enquiries
language plpgsql
set search_path = ''
as $$
declare
  v_draft public.enquiry_drafts;
  v_row public.enquiries;
begin
  if not public.can_edit() then
    raise exception 'Only editors can create enquiries' using errcode = '42501';
  end if;
  select * into v_draft from public.enquiry_drafts where id = p_draft_id for update;
  if not found then
    raise exception 'E-mail enquiry % not found', p_draft_id;
  end if;
  if v_draft.status <> 'pending' then
    raise exception 'This e-mail enquiry was already %', v_draft.status
      || coalesce(' (' || (select reference from public.enquiries where id = v_draft.enquiry_id) || ')', '');
  end if;

  v_row := public.upsert_enquiry(null, coalesce(p, '{}'::jsonb) || jsonb_build_object('source', 'email'));

  update public.enquiry_drafts
     set status = 'created', enquiry_id = v_row.id, reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
   where id = p_draft_id;
  update public.email_messages
     set enquiry_id = v_row.id, status = 'linked', updated_at = now(), updated_by = auth.uid()
   where draft_id = p_draft_id;
  return v_row;
end;
$$;

-- "Already in the register": attach the draft's e-mails to an existing enquiry instead.
create or replace function public.merge_draft_into_enquiry(p_draft_id uuid, p_reference text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_draft public.enquiry_drafts;
  v_enquiry public.enquiries;
begin
  if not public.can_edit() then
    raise exception 'Only editors can change enquiries' using errcode = '42501';
  end if;
  select * into v_draft from public.enquiry_drafts where id = p_draft_id for update;
  if not found or v_draft.status <> 'pending' then
    raise exception 'This e-mail enquiry is no longer pending';
  end if;
  select * into v_enquiry from public.enquiries where reference = upper(replace(btrim(coalesce(p_reference, '')), ' ', ''));
  if not found then
    raise exception 'Enquiry % not found', p_reference;
  end if;

  update public.enquiry_drafts
     set status = 'merged', enquiry_id = v_enquiry.id, reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
   where id = p_draft_id;
  update public.email_messages
     set enquiry_id = v_enquiry.id, status = 'linked', match_method = 'manual', updated_at = now(), updated_by = auth.uid()
   where draft_id = p_draft_id;
  perform public.resolve_contact(v_enquiry.customer_id, v_draft.contact_name, v_draft.contact_email, v_draft.contact_phone);
  return jsonb_build_object('enquiry_id', v_enquiry.id, 'reference', v_enquiry.reference);
end;
$$;

create or replace function public.dismiss_draft(p_draft_id uuid, p_reason text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not public.can_edit() then
    raise exception 'Only editors can change enquiries' using errcode = '42501';
  end if;
  update public.enquiry_drafts
     set status = 'dismissed', dismiss_reason = nullif(btrim(p_reason), ''), reviewed_by = auth.uid(),
         reviewed_at = now(), updated_at = now()
   where id = p_draft_id and status = 'pending';
  if not found then
    raise exception 'This e-mail enquiry is no longer pending';
  end if;
  update public.email_messages
     set status = 'ignored', match_method = 'manual', updated_at = now(), updated_by = auth.uid()
   where draft_id = p_draft_id and status = 'draft';
end;
$$;

-- Attach a single e-mail to an enquiry by reference, or (blank reference) send it back to review.
create or replace function public.link_email(p_email_id uuid, p_reference text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_msg public.email_messages;
  v_enquiry public.enquiries;
begin
  if not public.can_edit() then
    raise exception 'Only editors can change enquiries' using errcode = '42501';
  end if;
  select * into v_msg from public.email_messages where id = p_email_id for update;
  if not found then
    raise exception 'E-mail % not found', p_email_id;
  end if;
  if v_msg.status = 'draft' then
    raise exception 'This e-mail belongs to a pending e-mail enquiry: create, merge or dismiss that instead';
  end if;

  if nullif(btrim(coalesce(p_reference, '')), '') is null then
    update public.email_messages
       set enquiry_id = null, status = 'review', match_method = 'manual', updated_at = now(), updated_by = auth.uid()
     where id = p_email_id;
    return jsonb_build_object('enquiry_id', null, 'reference', null);
  end if;

  select * into v_enquiry from public.enquiries where reference = upper(replace(btrim(p_reference), ' ', ''));
  if not found then
    raise exception 'Enquiry % not found', p_reference;
  end if;
  update public.email_messages
     set enquiry_id = v_enquiry.id, status = 'linked', match_method = 'manual', confidence = 1, note = null,
         updated_at = now(), updated_by = auth.uid()
   where id = p_email_id;
  return jsonb_build_object('enquiry_id', v_enquiry.id, 'reference', v_enquiry.reference);
end;
$$;

create or replace function public.set_email_ignored(p_email_id uuid, p_ignored boolean)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not public.can_edit() then
    raise exception 'Only editors can change enquiries' using errcode = '42501';
  end if;
  update public.email_messages
     set status = case when p_ignored then 'ignored' else 'review' end,
         enquiry_id = null,
         match_method = 'manual',
         updated_at = now(),
         updated_by = auth.uid()
   where id = p_email_id
     and status <> 'draft';
  if not found then
    raise exception 'E-mail not found, or it belongs to a pending e-mail enquiry';
  end if;
end;
$$;

-- Turn an e-mail the sync did not treat as a new enquiry into a draft. Uses the AI extraction when the
-- sync stored one (ai_result.draft), otherwise starts from the sender and the message text.
create or replace function public.draft_from_email(p_email_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_msg public.email_messages;
  nd jsonb;
  v_draft uuid;
begin
  if not public.can_edit() then
    raise exception 'Only editors can change enquiries' using errcode = '42501';
  end if;
  select * into v_msg from public.email_messages where id = p_email_id for update;
  if not found then
    raise exception 'E-mail % not found', p_email_id;
  end if;
  if v_msg.status = 'draft' then
    raise exception 'This e-mail already belongs to a pending e-mail enquiry';
  end if;

  nd := case when jsonb_typeof(v_msg.ai_result -> 'draft') = 'object' then v_msg.ai_result -> 'draft' else '{}'::jsonb end;
  insert into public.enquiry_drafts (
    mailbox_id, gmail_thread_id, received_at, customer_name, customer_id, contact_name, contact_email,
    contact_phone, contact_designation, sales_person_name, fields, requirements, summary, confidence
  ) values (
    v_msg.mailbox_id,
    v_msg.gmail_thread_id,
    v_msg.received_at,
    nullif(upper(btrim(nd ->> 'customer_name')), ''),
    nullif(nd ->> 'customer_id', '')::uuid,
    coalesce(nullif(nd ->> 'contact_name', ''), case when v_msg.sender_type = 'external' then v_msg.from_name end),
    coalesce(nullif(lower(nd ->> 'contact_email'), ''), case when v_msg.sender_type = 'external' then v_msg.from_email end),
    nullif(nd ->> 'contact_phone', ''),
    nullif(nd ->> 'contact_designation', ''),
    nullif(nd ->> 'sales_person_name', ''),
    case when jsonb_typeof(nd -> 'fields') = 'object' then nd -> 'fields'
         else jsonb_build_object('enquiry_date', (v_msg.received_at at time zone 'Asia/Muscat')::date) end,
    coalesce(nullif(nd ->> 'requirements', ''), left(v_msg.body_text, 2000)),
    coalesce(nullif(nd ->> 'summary', ''), v_msg.summary),
    nullif(nd ->> 'confidence', '')::numeric
  )
  returning id into v_draft;

  update public.email_messages
     set draft_id = v_draft, enquiry_id = null, status = 'draft', match_method = 'manual', updated_at = now(),
         updated_by = auth.uid()
   where id = p_email_id;
  return v_draft;
end;
$$;

-- Existing enquiries that may be the same request as a draft: same customer (by id, name or contact
-- e-mail) within three weeks of the e-mail, same route first.
create or replace function public.draft_duplicates(p_draft_id uuid)
returns table (id uuid, reference text, enquiry_date date, subject text, status text, customer_name text, same_route boolean)
language sql
stable
set search_path = ''
as $$
  select e.id, e.reference, e.enquiry_date, e.subject, e.status, c.name,
         coalesce(upper(btrim(e.pol)) = upper(btrim(d.fields ->> 'pol'))
                  and upper(btrim(e.pod)) = upper(btrim(d.fields ->> 'pod')), false)
    from public.enquiry_drafts d
    join public.enquiries e
      on e.enquiry_date between (d.received_at at time zone 'Asia/Muscat')::date - 21
                            and (d.received_at at time zone 'Asia/Muscat')::date + 21
    join public.customers c on c.id = e.customer_id
    left join public.customer_contacts ct on ct.id = e.contact_id
   where d.id = p_draft_id
     and (e.customer_id = d.customer_id
          or c.name_key = public.name_key(d.customer_name)
          or lower(ct.email) = lower(d.contact_email))
   order by 7 desc, e.enquiry_date desc, e.reference desc
   limit 5
$$;

-- Existing customers that a name / e-mail address probably refers to, best first.
create or replace function public.suggest_customers(p_name text, p_email text)
returns table (id uuid, name text, match text, score real)
language sql
stable
set search_path = ''
as $$
  with hits as (
    select c.id, c.name, 'contact'::text as match, 1.0::real as score
      from public.customer_contacts ct
      join public.customers c on c.id = ct.customer_id
     where lower(ct.email) = lower(btrim(p_email))
    union all
    select c.id, c.name, 'name', 1.0
      from public.customers c
     where c.name_key = public.name_key(p_name)
    union all
    select c.id, c.name, 'alias', 0.95
      from public.customer_aliases a
      join public.customers c on c.id = a.customer_id
     where a.alias_key = public.name_key(p_name)
    union all
    select c.id, c.name, 'domain', 0.9
      from public.customer_contacts ct
      join public.customers c on c.id = ct.customer_id
     where public.email_domain(p_email) is not null
       and not public.is_public_email_domain(public.email_domain(p_email))
       and public.email_domain(ct.email) = public.email_domain(p_email)
    union all
    select c.id, c.name, 'similar', extensions.similarity(c.name_key, public.name_key(p_name))
      from public.customers c
     where public.name_key(p_name) is not null
       and extensions.similarity(c.name_key, public.name_key(p_name)) >= 0.35
  )
  select distinct on (h.id) h.id, h.name, h.match, h.score
    from hits h
   order by h.id, h.score desc
$$;

create or replace function public.email_inbox_counts()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'drafts', (select count(*) from public.enquiry_drafts where status = 'pending'),
    'review', (select count(*) from public.email_messages where status = 'review'),
    'awaiting', (select count(*) from public.email_messages where status = 'awaiting_enquiry'),
    'mailboxes', coalesce((select jsonb_agg(jsonb_build_object(
        'email', mb.email, 'active', mb.active, 'last_synced_at', mb.last_synced_at,
        'last_error', mb.last_error, 'stats', mb.stats) order by mb.email)
      from public.mailboxes mb), '[]'::jsonb)
  )
$$;

-------------------------------------------------------------------------------
-- Row Level Security
-------------------------------------------------------------------------------

alter table public.customer_contacts enable row level security;
alter table public.mailboxes enable row level security;
alter table public.enquiry_drafts enable row level security;
alter table public.email_messages enable row level security;

create policy "customer_contacts: staff read" on public.customer_contacts
  for select to authenticated using ((select public.app_role()) is not null);
create policy "customer_contacts: editor insert" on public.customer_contacts
  for insert to authenticated with check ((select public.can_edit()));
create policy "customer_contacts: editor update" on public.customer_contacts
  for update to authenticated using ((select public.can_edit())) with check ((select public.can_edit()));
create policy "customer_contacts: admin delete" on public.customer_contacts
  for delete to authenticated using ((select public.is_admin()));

-- Mailboxes, drafts and messages are written by the sync (service role, which bypasses RLS) and changed
-- by staff through the review RPCs above.
create policy "mailboxes: staff read" on public.mailboxes
  for select to authenticated using ((select public.app_role()) is not null);
create policy "enquiry_drafts: staff read" on public.enquiry_drafts
  for select to authenticated using ((select public.app_role()) is not null);
create policy "enquiry_drafts: editor insert" on public.enquiry_drafts
  for insert to authenticated with check ((select public.can_edit()));
create policy "enquiry_drafts: editor update" on public.enquiry_drafts
  for update to authenticated using ((select public.can_edit())) with check ((select public.can_edit()));
create policy "email_messages: staff read" on public.email_messages
  for select to authenticated using ((select public.app_role()) is not null);
create policy "email_messages: editor update" on public.email_messages
  for update to authenticated using ((select public.can_edit())) with check ((select public.can_edit()));

-------------------------------------------------------------------------------
-- Function privileges
-------------------------------------------------------------------------------

revoke execute on function
  public.email_domain(text),
  public.is_public_email_domain(text),
  public.jsonb_text_array(jsonb),
  public.resolve_contact(uuid, text, text, text),
  public.create_enquiry_from_draft(uuid, jsonb),
  public.merge_draft_into_enquiry(uuid, text),
  public.dismiss_draft(uuid, text),
  public.link_email(uuid, text),
  public.set_email_ignored(uuid, boolean),
  public.draft_from_email(uuid),
  public.draft_duplicates(uuid),
  public.suggest_customers(text, text),
  public.email_inbox_counts()
from public, anon;
grant execute on function
  public.email_domain(text),
  public.is_public_email_domain(text),
  public.jsonb_text_array(jsonb),
  public.resolve_contact(uuid, text, text, text),
  public.create_enquiry_from_draft(uuid, jsonb),
  public.merge_draft_into_enquiry(uuid, text),
  public.dismiss_draft(uuid, text),
  public.link_email(uuid, text),
  public.set_email_ignored(uuid, boolean),
  public.draft_from_email(uuid),
  public.draft_duplicates(uuid),
  public.suggest_customers(text, text),
  public.email_inbox_counts()
to authenticated;

-- Only the sync may call these.
revoke execute on function
  public.begin_mailbox_sync(text, integer, timestamptz),
  public.end_mailbox_sync(text, timestamptz, text, jsonb),
  public.email_match_context(jsonb),
  public.ingest_email(jsonb)
from public, anon, authenticated;
grant execute on function
  public.begin_mailbox_sync(text, integer, timestamptz),
  public.end_mailbox_sync(text, timestamptz, text, jsonb),
  public.email_match_context(jsonb),
  public.ingest_email(jsonb)
to service_role;

-- Trigger functions are never called through the API (see 20261102162837_lock_trigger_functions.sql).
revoke execute on function
  public.enquiries_before_write(),
  public.enquiries_link_waiting_emails(),
  public.enquiries_release_emails()
from public, anon, authenticated;

-------------------------------------------------------------------------------
-- Storage: attachments of e-mails kept in the CRM (uploaded by the sync)
-------------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('email-attachments', 'email-attachments', false)
on conflict (id) do nothing;

create policy "email-attachments: staff read" on storage.objects
  for select to authenticated using (bucket_id = 'email-attachments' and (select public.app_role()) is not null);
