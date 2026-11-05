// user-admin: what the owner does to logins from Settings (src/pages/SettingsPage.tsx) that needs Supabase Auth's
// admin API: inviting people, sending invitation and password-reset links again, setting a temporary password, and
// turning access off and on. Roles, sales-person links and names are saved straight to public.profiles, which Row
// Level Security lets only the owner update (supabase/migrations/20261105113220_owner_access.sql).
//
// Called with the owner's session token. verify_jwt is off (supabase/config.toml), as for gmail-sync: the function
// checks the token itself and then that the caller is an active owner, before using the service role.
//
// Links: Supabase e-mails them (delivery "email") or they come back in the response for the owner to send
// (delivery "link"). The built-in Supabase mailer only sends a few e-mails an hour and, without custom SMTP, only to
// the project team's addresses, so "link" always works.
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2.118.0";
import { accountPage, type AdminRequest, authErrorMessage, BAN_FOREVER, parseRequest, selfActionError } from "./rules.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** The reply: `message` says what happened; `link` is the invitation or reset link when one was asked for. */
interface Reply {
  message: string;
  link?: string;
  userId?: string;
}

class Refusal extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

/** The caller's user id when they are signed in as an active owner. */
async function ownerId(req: Request, admin: SupabaseClient): Promise<string> {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!token) throw new Refusal("Sign in first.", 401);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new Refusal("Your session has ended. Sign in again.", 401);
  const { data: me } = await admin.from("profiles").select("role, disabled_at").eq("id", data.user.id).maybeSingle();
  if (me?.role !== "owner" || me.disabled_at) throw new Refusal("Only the owner can manage logins.", 403);
  return data.user.id;
}

async function target(admin: SupabaseClient, userId: string): Promise<{ user: User; disabled: boolean; name: string }> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user) throw new Refusal(authErrorMessage(error ?? { code: "user_not_found" }), 404);
  const { data: profile } = await admin.from("profiles").select("full_name, disabled_at").eq("id", userId).maybeSingle();
  const name = profile?.full_name?.trim() || data.user.email || "This login";
  return { user: data.user, disabled: !!profile?.disabled_at, name };
}

const accepted = (u: User) => !!(u.email_confirmed_at || u.last_sign_in_at);

function check<T extends { error: unknown }>(result: T): T {
  if (result.error) throw new Refusal(authErrorMessage(result.error as { code?: string; message?: string }));
  return result;
}

async function invite(admin: SupabaseClient, req: Extract<AdminRequest, { action: "invite" }>): Promise<Reply> {
  const redirectTo = accountPage(req.redirectTo);
  const data = { full_name: req.fullName || req.email.split("@")[0] };
  let userId: string;
  let link: string | undefined;
  if (req.delivery === "email") {
    const res = check(await admin.auth.admin.inviteUserByEmail(req.email, { data, redirectTo }));
    userId = res.data.user!.id;
  } else {
    const res = check(await admin.auth.admin.generateLink({ type: "invite", email: req.email, options: { data, redirectTo } }));
    userId = res.data.user!.id;
    link = res.data.properties?.action_link;
  }

  // The new login's profile was made by public.handle_new_user as a viewer; give it what the owner chose.
  const { error } = await admin
    .from("profiles")
    .update({ role: req.role, sales_person_id: req.salesPersonId, full_name: data.full_name })
    .eq("id", userId);
  const sent = req.delivery === "email" ? `Invitation e-mailed to ${req.email}.` : `Invitation link ready for ${req.email}.`;
  if (error) return { userId, link, message: `${sent} Their role could not be set (${error.message}); set it in the table.` };
  return { userId, link, message: sent };
}

async function resendInvite(admin: SupabaseClient, req: Extract<AdminRequest, { action: "resend_invite" }>): Promise<Reply> {
  const { user, disabled, name } = await target(admin, req.userId);
  if (disabled) throw new Refusal(`${name}'s access is turned off. Turn it back on first.`);
  if (accepted(user)) throw new Refusal(`${name} has already accepted the invitation. Send a password reset instead.`);
  const redirectTo = accountPage(req.redirectTo);
  if (req.delivery === "email") {
    check(await admin.auth.admin.inviteUserByEmail(user.email!, { redirectTo }));
    return { message: `Invitation e-mailed to ${user.email} again.` };
  }
  const res = check(await admin.auth.admin.generateLink({ type: "invite", email: user.email!, options: { redirectTo } }));
  return { link: res.data.properties?.action_link, message: `New invitation link ready for ${name}.` };
}

async function resetPassword(admin: SupabaseClient, req: Extract<AdminRequest, { action: "reset_password" }>): Promise<Reply> {
  const { user, disabled, name } = await target(admin, req.userId);
  if (disabled) throw new Refusal(`${name}'s access is turned off. Turn it back on first.`);
  if (!user.email) throw new Refusal(`${name} has no e-mail address.`);
  const redirectTo = accountPage(req.redirectTo);
  if (req.delivery === "email") {
    check(await admin.auth.resetPasswordForEmail(user.email, { redirectTo }));
    return { message: `Password reset e-mailed to ${user.email}.` };
  }
  const res = check(await admin.auth.admin.generateLink({ type: "recovery", email: user.email, options: { redirectTo } }));
  return { link: res.data.properties?.action_link, message: `Password reset link ready for ${name}.` };
}

async function setPassword(admin: SupabaseClient, req: Extract<AdminRequest, { action: "set_password" }>): Promise<Reply> {
  const { disabled, name } = await target(admin, req.userId);
  if (disabled) throw new Refusal(`${name}'s access is turned off. Turn it back on first.`);
  // must_change_password: the app sends them to the Account page to choose their own at the next sign-in.
  check(
    await admin.auth.admin.updateUserById(req.userId, {
      password: req.password,
      email_confirm: true,
      user_metadata: { must_change_password: true },
    }),
  );
  return { message: `Temporary password set for ${name}. They are asked to choose their own when they sign in.` };
}

async function setAccess(admin: SupabaseClient, req: Extract<AdminRequest, { action: "set_access" }>): Promise<Reply> {
  const { name } = await target(admin, req.userId);
  if (req.enabled) {
    check(await admin.auth.admin.updateUserById(req.userId, { ban_duration: "none" }));
    const { error } = await admin.from("profiles").update({ disabled_at: null }).eq("id", req.userId);
    if (error) throw new Refusal(`${name} can sign in again, but the app still shows them as turned off: ${error.message}`);
    return { message: `${name}'s access is back on.` };
  }
  // The profile first: the database refuses to turn off the last active owner, and this takes effect at once.
  const { error } = await admin.from("profiles").update({ disabled_at: new Date().toISOString() }).eq("id", req.userId);
  if (error) throw new Refusal(error.message);
  const ban = await admin.auth.admin.updateUserById(req.userId, { ban_duration: BAN_FOREVER });
  if (ban.error) {
    await admin.from("profiles").update({ disabled_at: null }).eq("id", req.userId);
    throw new Refusal(authErrorMessage(ban.error));
  }
  return { message: `${name}'s access is turned off. They are signed out of the app and cannot sign in again.` };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const callerId = await ownerId(req, admin);
    const parsed = parseRequest(await req.json().catch(() => null));
    if ("error" in parsed) throw new Refusal(parsed.error);
    const self = selfActionError(parsed, callerId);
    if (self) throw new Refusal(self);

    const reply =
      parsed.action === "invite"
        ? await invite(admin, parsed)
        : parsed.action === "resend_invite"
          ? await resendInvite(admin, parsed)
          : parsed.action === "reset_password"
            ? await resetPassword(admin, parsed)
            : parsed.action === "set_password"
              ? await setPassword(admin, parsed)
              : await setAccess(admin, parsed);
    return json(reply);
  } catch (e) {
    if (e instanceof Refusal) return json({ error: e.message }, e.status);
    console.error("user-admin failed", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
