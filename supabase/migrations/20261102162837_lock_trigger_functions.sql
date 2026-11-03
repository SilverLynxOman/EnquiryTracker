-- Trigger functions must not be callable through the API (/rest/v1/rpc/...).
-- Supabase grants EXECUTE to authenticated directly, so revoking from PUBLIC alone is not enough.
revoke execute on function
  public.handle_new_user(),
  public.enquiries_before_write(),
  public.enquiries_audit()
from public, anon, authenticated;
