-- Which stored e-mails gmail-sync may re-classify, defined once and used by both the candidate list and
-- reingest_email():
--   * "Not classified: ..."  Claude was unavailable (e.g. no credits);
--   * the unmatched follow-up note given before Claude was asked whether an e-mail is about pricing.
--     Most of those are operational mail on running jobs; re-classifying files them as Ignored
--     ("Operations e-mail") and leaves only pricing follow-ups for review, under a new note that is
--     not re-classifiable, so no e-mail is re-classified over and over.
-- Only untouched review items qualify: nothing linked, no draft. Keep the note text in step with
-- UNMATCHED_FOLLOW_UP_NOTE in supabase/functions/_shared/email/decide.ts.

create or replace function public.email_is_reclassifiable(m public.email_messages)
returns boolean
language sql
stable
set search_path = ''
as $$
  select m.status = 'review'
     and m.enquiry_id is null
     and m.draft_id is null
     and (coalesce(m.note, '') like 'Not classified:%'
          or m.note = 'Looks like a follow-up, but the enquiry could not be identified');
$$;

-- Oldest first; p_ids narrows it to those rows (to check which of a batch are still open).
create or replace function public.reclassify_candidates(p_limit integer, p_ids uuid[] default null)
returns table (id uuid, gmail_message_id text, gmail_thread_id text)
language sql
stable
set search_path = ''
as $$
  select m.id, m.gmail_message_id, m.gmail_thread_id
    from public.email_messages m
   where public.email_is_reclassifiable(m)
     and (p_ids is null or m.id = any (p_ids))
   order by m.received_at, m.id
   limit greatest(p_limit, 0);
$$;

-- Same as 20261105091500_reclassify_emails.sql, with the shared rule.
create or replace function public.reingest_email(p_email_id uuid, p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_row public.email_messages;
begin
  select * into v_row from public.email_messages where id = p_email_id for update;
  if not found
     or v_row.gmail_message_id is distinct from (p -> 'email' ->> 'gmail_message_id')
     or not public.email_is_reclassifiable(v_row) then
    return jsonb_build_object('email_id', p_email_id, 'skipped', true);
  end if;

  delete from public.email_messages where id = p_email_id;
  return public.ingest_email(p);
end;
$$;

-- Only the sync may call these.
revoke execute on function public.email_is_reclassifiable(public.email_messages) from public, anon, authenticated;
revoke execute on function public.reclassify_candidates(integer, uuid[]) from public, anon, authenticated;
grant execute on function public.email_is_reclassifiable(public.email_messages) to service_role;
grant execute on function public.reclassify_candidates(integer, uuid[]) to service_role;
