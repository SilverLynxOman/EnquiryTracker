-- Runs the gmail-sync Edge Function every 5 minutes (README, "E-mail intake", step 6).
-- Not a migration: it needs the project URL and the EMAIL_SYNC_SECRET. Run it once in the SQL editor
-- after replacing <EMAIL_SYNC_SECRET> with the same value you gave `supabase secrets set`.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 1. Keep the URL and the secret in Vault, not in the job text.
select vault.create_secret('https://jaaueukrzijesejjaplt.supabase.co/functions/v1/gmail-sync', 'gmail_sync_url');
select vault.create_secret('<EMAIL_SYNC_SECRET>', 'gmail_sync_secret');

-- 2. Every 5 minutes. A run takes a lease on the mailbox, so a slow run is never overlapped.
select cron.schedule(
  'gmail-sync',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'gmail_sync_url'),
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
