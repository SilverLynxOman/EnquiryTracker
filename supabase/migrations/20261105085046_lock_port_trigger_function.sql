-- Same rule as 20261102162837_lock_trigger_functions: trigger functions must not be callable through the API.
-- Supabase grants EXECUTE to authenticated directly, so revoking from PUBLIC alone is not enough.
revoke execute on function public.enquiries_apply_port_names() from public, anon, authenticated;
