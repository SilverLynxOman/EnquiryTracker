-- Re-classify e-mails that were stored without Claude's classification ("Not classified: ..."), for example
-- because the Claude account had no credits. The gmail-sync function (POST {"reclassify": true}) fetches
-- each such message from Gmail again, classifies it, and files it through reingest_email().
--
-- reingest_email replaces the stored row in one transaction: it locks the row, checks that it is still an
-- untouched "Not classified" review item, deletes it and stores the message again with ingest_email(), so
-- drafts, links and draft merges follow exactly the same rules as for new mail. Nothing references
-- email_messages, so the row can be replaced. If staff handled the e-mail meanwhile (linked, ignored, made
-- a draft) or it is not the same Gmail message, the row is left as it is and {skipped: true} is returned.

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
     or v_row.status <> 'review'
     or v_row.enquiry_id is not null
     or v_row.draft_id is not null
     or coalesce(v_row.note, '') not like 'Not classified:%' then
    return jsonb_build_object('email_id', p_email_id, 'skipped', true);
  end if;

  delete from public.email_messages where id = p_email_id;
  return public.ingest_email(p);
end;
$$;

comment on function public.reingest_email(uuid, jsonb) is
  'gmail-sync only: replaces an unclassified review e-mail with its re-classified version via ingest_email.';

-- Only the sync may call it.
revoke execute on function public.reingest_email(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.reingest_email(uuid, jsonb) to service_role;
