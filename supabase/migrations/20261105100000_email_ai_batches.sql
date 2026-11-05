-- Batch re-classification: gmail-sync (POST {"reclassify": true}) sends the e-mails stored as
-- "Not classified" to Claude as one Message Batch (half price, results usually within an hour) and
-- collects the answers on a later call. This table remembers the submitted batch between calls.
-- Only the sync (service role) uses it: RLS is on and no policy grants access to app users.

create table public.email_ai_batches (
  id uuid primary key default gen_random_uuid(),
  batch_id text not null unique,            -- Anthropic Message Batch id
  status text not null default 'submitted' check (status in ('submitted', 'collected')),
  items jsonb not null,                     -- [{id, gmail_message_id, gmail_thread_id}] of the stored rows sent
  submitted_at timestamptz not null default now(),
  collected_at timestamptz,
  stats jsonb
);

comment on table public.email_ai_batches is
  'gmail-sync only: Claude Message Batches submitted to re-classify "Not classified" e-mails.';

-- At most one batch waiting at a time.
create unique index email_ai_batches_one_pending on public.email_ai_batches ((true)) where status = 'submitted';

alter table public.email_ai_batches enable row level security;
revoke all on public.email_ai_batches from anon, authenticated;
grant select, insert, update on public.email_ai_batches to service_role;
