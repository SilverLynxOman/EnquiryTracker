// gmail-send: a reply written in the app (Inbox → Follow-up e-mails → Reply) goes out through Gmail as the pricing
// mailbox, in the same Gmail conversation as the e-mail it answers, so it also appears in Gmail's Sent folder and the
// customer sees an ordinary reply. Each reply is recorded in public.email_replies (who sent it, to whom, when); the
// sent message itself is filed under the enquiry by the next gmail-sync run.
//
// Called by an editor with their session token. verify_jwt is off (supabase/config.toml), as for gmail-sync: the
// function checks the token and that the caller may edit, then reads the answered e-mail with the caller's own
// token, so Row Level Security decides whether they may see (and so answer) it.
//
// Secrets: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN, shared with gmail-sync. The refresh token
// must carry the gmail.send scope as well as gmail.readonly (README "Replying from the app"); until then sending stops
// with a message that says so. GMAIL_MAILBOX optional, as for gmail-sync.
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { GmailApi } from "../_shared/email/gmail.ts";
import { base64Url, buildReplyMessage, parseSendRequest, Refusal } from "./mime.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function env(name: string): string {
  const v = Deno.env.get(name)?.trim();
  if (!v) throw new Refusal(`Sending is not set up: the secret ${name} is missing.`, 500);
  return v;
}

/** The caller's user id when they are signed in and may edit (the same rule as public.can_edit()). */
async function editorId(token: string, admin: SupabaseClient): Promise<string> {
  if (!token) throw new Refusal("Sign in first.", 401);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new Refusal("Your session has ended. Sign in again.", 401);
  const { data: me } = await admin.from("profiles").select("role, disabled_at").eq("id", data.user.id).maybeSingle();
  if (!["owner", "admin", "editor"].includes(me?.role) || me?.disabled_at) throw new Refusal("Only editors can send replies.", 403);
  return data.user.id;
}

async function mailboxAddress(admin: SupabaseClient): Promise<string> {
  const fromSecret = Deno.env.get("GMAIL_MAILBOX")?.trim().toLowerCase();
  if (fromSecret) return fromSecret;
  const { data } = await admin.from("mailboxes").select("email").eq("active", true).order("created_at").limit(1).maybeSingle();
  if (!data) throw new Refusal("No mailbox is set up for sending.", 500);
  return data.email as string;
}

/** Turns Google's refusals into something the sender can act on. */
function gmailRefusal(e: unknown): Refusal {
  const m = e instanceof Error ? e.message : String(e);
  if (/ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient(Permissions| authentication scopes)/i.test(m)) {
    return new Refusal(
      "Sending is not switched on yet: the Gmail connection only has permission to read. " +
        "Give it send permission as described in the README (“Replying from the app”), then try again. Your reply is kept.",
      412,
    );
  }
  if (/Google sign-in failed/.test(m)) return new Refusal("Gmail refused the app's sign-in. The Gmail connection needs to be set up again.", 502);
  return new Refusal(`Gmail did not send the reply: ${m}`, 502);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST.", message: "Use POST." }, 405);
  try {
    const url = env("SUPABASE_URL");
    const admin = createClient(url, env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
    const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
    const userId = await editorId(token, admin);

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new Refusal("The request could not be read.");
    }
    const r = parseSendRequest(raw);

    // Read the answered e-mail as the caller: RLS hides e-mails of enquiries they may not see.
    const asCaller = createClient(url, env("SUPABASE_ANON_KEY"), {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: original } = await asCaller
      .from("email_messages")
      .select("id, gmail_thread_id, rfc_message_id, reference_ids, enquiry_id")
      .eq("id", r.replyToEmailId)
      .maybeSingle();
    if (!original) throw new Refusal("That e-mail was not found, or you may not answer it.", 404);

    const from = await mailboxAddress(admin);
    const references = [...(original.reference_ids ?? []), ...(original.rfc_message_id ? [original.rfc_message_id] : [])].slice(-20);
    const message = buildReplyMessage({
      from,
      to: r.to,
      cc: r.cc,
      subject: r.subject,
      body: r.body,
      inReplyTo: original.rfc_message_id,
      references,
      attachments: r.attachments,
      date: new Date(),
      boundary: `sl-${crypto.randomUUID()}`,
    });

    const gmail = new GmailApi({ clientId: env("GOOGLE_CLIENT_ID"), clientSecret: env("GOOGLE_CLIENT_SECRET"), refreshToken: env("GOOGLE_REFRESH_TOKEN") });
    let sent: { id: string; threadId: string };
    try {
      sent = await gmail.send(base64Url(message), original.gmail_thread_id);
    } catch (e) {
      throw gmailRefusal(e);
    }

    const row = {
      enquiry_id: original.enquiry_id,
      reply_to_email_id: original.id,
      sent_by: userId,
      from_email: from,
      to_emails: r.to,
      cc_emails: r.cc,
      subject: r.subject,
      body_text: r.body,
      attachments: r.attachments.map((a) => ({ filename: a.filename, mime_type: a.mimeType, size: Math.floor((a.data.length * 3) / 4) })),
      gmail_message_id: sent.id,
      gmail_thread_id: sent.threadId,
    };
    const { data: saved, error } = await admin.from("email_replies").insert(row).select("id, sent_at").single();
    // The e-mail is already on its way; a failed record must not make the sender try again (and send it twice).
    if (error) console.error("email_replies insert failed", error.message);

    return json({ message: `Reply sent from ${from}.`, id: saved?.id ?? null, sentAt: saved?.sent_at ?? new Date().toISOString(), gmailMessageId: sent.id });
  } catch (e) {
    if (e instanceof Refusal) return json({ error: e.message, message: e.message }, e.status);
    console.error(e);
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message, message }, 500);
  }
});
