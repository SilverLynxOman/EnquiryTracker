-- Replies sent from the app (Inbox → Follow-up e-mails → Reply). The gmail-send Edge Function sends them through
-- Gmail as the pricing mailbox, in the same Gmail conversation, and records here who sent what. The sent message
-- itself arrives in email_messages at the next mail check, like any other mail of the mailbox (sender_type 'self');
-- gmail_message_id ties the two together so the conversation can say "sent from the app by …".
--
-- Written only by the Edge Function (service role); read by whoever may read the enquiry's e-mails.

create table public.email_replies (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid references public.enquiries (id) on delete set null,
  reply_to_email_id uuid references public.email_messages (id) on delete set null,
  sent_by uuid references auth.users (id) on delete set null,
  from_email text not null,
  to_emails text[] not null default '{}',
  cc_emails text[] not null default '{}',
  subject text not null,
  body_text text not null,
  -- [{filename, mime_type, size}]: what was attached (the files themselves stay in Gmail)
  attachments jsonb not null default '[]'::jsonb,
  gmail_message_id text not null unique,
  gmail_thread_id text not null,
  sent_at timestamptz not null default now()
);

comment on table public.email_replies is
  'Replies sent from the app through Gmail (gmail-send Edge Function): who sent what, to whom, and when.';

create index email_replies_enquiry_idx on public.email_replies (enquiry_id, sent_at);
create index email_replies_reply_to_idx on public.email_replies (reply_to_email_id);
create index email_replies_sent_by_idx on public.email_replies (sent_by);

alter table public.email_replies enable row level security;

-- The same visibility as the e-mails themselves (20261105172357_own_enquiries.sql): everyone who sees all
-- enquiries, and sales staff for their own enquiries' replies. No insert/update/delete policies: only the
-- Edge Function (service role) writes.
create policy "email_replies: staff read" on public.email_replies
  for select to authenticated
  using ((select public.app_role()) is not null
         and ((select public.sees_all_enquiries())
              or exists (select 1 from public.enquiries e
                          where e.id = email_replies.enquiry_id and e.sales_person_id = (select public.my_sales_person_id()))));

grant select on public.email_replies to authenticated;
