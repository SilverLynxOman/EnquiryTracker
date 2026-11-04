-- Runs the gmail-sync Edge Function every 5 minutes (README, "E-mail intake", step 5).
-- Not a migration (it is project configuration). Run it once in the SQL editor; it is safe to run again.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 1. The mailbox to read (the function uses the first active row).
insert into public.mailboxes (email) values ('pricing@silverlynxoman.com') on conflict (email) do nothing;

-- 2. A random secret for the job, generated and kept in Vault. The function checks calls against it
--    (public.email_sync_secret_ok), so it never has to be copied anywhere.
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'gmail_sync_secret',
                           'Authorises the gmail-sync cron job')
 where not exists (select 1 from vault.secrets where name = 'gmail_sync_secret');

-- 3. Every 5 minutes. A run takes a lease on the mailbox, so a slow run is never overlapped.
select cron.schedule(
  'gmail-sync',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://jaaueukrzijesejjaplt.supabase.co/functions/v1/gmail-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'gmail_sync_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);

-- Check the last runs:
--   select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
--   select status_code, content, created from net._http_response order by created desc limit 5;
--   select email, last_synced_at, last_error, stats from public.mailboxes;
-- Stop:
--   select cron.unschedule('gmail-sync');
