// Requests the Settings page sends to user-admin, checked before anything touches Supabase Auth.
// Plain TypeScript (no Deno or npm imports) so the unit tests run under Vitest as well.

/** Roles an invitation can give. Owner is given later, in the users table, by an owner. */
export const INVITE_ROLES = ["admin", "editor", "viewer"] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

/** How a link reaches the person: Supabase e-mails it, or it is returned for the owner to send (WhatsApp, Outlook). */
export type Delivery = "email" | "link";

export const MIN_PASSWORD = 8;

/** A ban long enough to mean "until access is turned back on" (100 years). */
export const BAN_FOREVER = "876000h";

export type AdminRequest =
  | { action: "invite"; email: string; fullName: string; role: InviteRole; salesPersonId: string | null; delivery: Delivery; redirectTo: string }
  | { action: "resend_invite"; userId: string; delivery: Delivery; redirectTo: string }
  | { action: "reset_password"; userId: string; delivery: Delivery; redirectTo: string }
  | { action: "set_password"; userId: string; password: string }
  | { action: "set_access"; userId: string; enabled: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** The request, or the reason it cannot be carried out. */
export function parseRequest(body: unknown): AdminRequest | { error: string } {
  if (!body || typeof body !== "object") return { error: "The request is empty." };
  const b = body as Record<string, unknown>;
  const action = str(b.action);

  const userId = str(b.userId);
  const needUser = () => (UUID.test(userId) ? null : { error: "Which login? The user id is missing or not valid." });
  const delivery: Delivery | null = b.delivery === "email" || b.delivery === "link" ? b.delivery : null;
  const redirectTo = str(b.redirectTo);
  const linkOptions = () => {
    if (!delivery) return { error: "Choose whether to e-mail the link or show it." };
    if (!/^https?:\/\/[^\s]+$/i.test(redirectTo)) return { error: "The page to return to after the link is missing." };
    return null;
  };

  switch (action) {
    case "invite": {
      const email = str(b.email).toLowerCase();
      if (!EMAIL.test(email)) return { error: "Enter a valid e-mail address." };
      const role = str(b.role) as InviteRole;
      if (!INVITE_ROLES.includes(role)) return { error: "Choose admin, editor or viewer. Make someone an owner from the users table." };
      const salesPersonId = str(b.salesPersonId) || null;
      if (salesPersonId && !UUID.test(salesPersonId)) return { error: "The sales person is not valid." };
      const bad = linkOptions();
      if (bad) return bad;
      return { action, email, fullName: str(b.fullName).replace(/\s+/g, " "), role, salesPersonId, delivery: delivery!, redirectTo };
    }
    case "resend_invite":
    case "reset_password": {
      const bad = needUser() ?? linkOptions();
      if (bad) return bad;
      return { action, userId, delivery: delivery!, redirectTo };
    }
    case "set_password": {
      const bad = needUser();
      if (bad) return bad;
      const password = typeof b.password === "string" ? b.password : "";
      if (password.length < MIN_PASSWORD) return { error: `Use at least ${MIN_PASSWORD} characters.` };
      if (password !== password.trim()) return { error: "The password cannot start or end with a space." };
      return { action, userId, password };
    }
    case "set_access": {
      const bad = needUser();
      if (bad) return bad;
      if (typeof b.enabled !== "boolean") return { error: "Say whether to turn access on or off." };
      return { action, userId, enabled: b.enabled };
    }
    default:
      return { error: `Unknown action "${action}".` };
  }
}

/** Actions the owner may not take on their own login (they use the Account page, or ask another owner). */
export function selfActionError(req: AdminRequest, callerId: string): string | null {
  if (!("userId" in req) || req.userId !== callerId) return null;
  if (req.action === "set_access") return "You cannot turn off your own access. Make someone else the owner first; they can then do it.";
  if (req.action === "set_password") return "Change your own password on the Account page.";
  return null;
}

/** The "redirectTo" for links: back to the app's Account page, where an invited or reset user chooses a password. */
export const accountPage = (redirectTo: string) => `${new URL(redirectTo).origin}/account`;

/** Supabase Auth errors, in words the owner can act on. */
export function authErrorMessage(err: { code?: string; message?: string; status?: number } | null | undefined): string {
  const code = err?.code ?? "";
  const message = err?.message ?? "Supabase Auth did not say why.";
  if (code === "email_exists" || code === "user_already_exists" || /already (been )?registered/i.test(message)) {
    return "There is already a login for this e-mail address.";
  }
  if (code === "over_email_send_rate_limit" || /rate limit/i.test(message)) {
    return "Supabase's e-mail limit was reached: its built-in mailer sends only a few e-mails an hour. Choose “Show me a link” and send it yourself, or set up your own SMTP in Supabase (Authentication → Emails).";
  }
  if (code === "email_address_not_authorized" || /not authorized/i.test(message)) {
    return "Supabase's built-in mailer only sends to the project team's addresses. Choose “Show me a link” and send it yourself, or set up your own SMTP in Supabase (Authentication → Emails).";
  }
  if (code === "user_not_found") return "This login no longer exists.";
  if (code === "weak_password") return `The password is too weak. ${message}`;
  if (code === "user_banned") return "This login's access is turned off. Turn it back on first.";
  return message;
}
