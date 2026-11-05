// gmail-sync: reads new mail of the pricing mailbox and files it in the enquiry tracker.
//
// Called every few minutes by pg_cron (supabase/email_sync_schedule.sql) with the random secret kept in
// Vault as gmail_sync_secret, and on demand by an editor's "Check mail now" button (their own session
// token). Deploy with --no-verify-jwt: this function checks both itself.
// POST {"reclassify": true, "limit": 40} instead re-classifies stored e-mails that went to review as
// "Not classified" (e.g. Claude had no credits), oldest first; repeat until it reports 0 candidates.
//
// Secrets (Supabase dashboard → Edge Functions → Secrets, or npx supabase secrets set NAME=value):
//   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN   OAuth client + refresh token (gmail.readonly)
//   ANTHROPIC_API_KEY        without it, e-mails that need Claude go to "review"
//   GMAIL_MAILBOX            optional, default the first active row of public.mailboxes
//   EMAIL_SYNC_SECRET        optional, accepted in addition to the Vault secret
//   ANTHROPIC_MODEL          optional, default claude-opus-5-5
//   ANTHROPIC_EFFORT         optional, default low
//   INTERNAL_EMAIL_DOMAINS   optional, comma separated, default the mailbox's domain
//   SYNC_LOOKBACK_HOURS      optional, how far back the first run reads (default 24)
//   SYNC_TIME_BUDGET_SECONDS optional, stop starting new messages after this (default 110)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { GmailApi } from "../_shared/email/gmail.ts";
import {
  DEFAULT_OPTIONS,
  runReclassify,
  runSync,
  type SyncDb,
  type SyncStorage,
  type UnclassifiedEmail,
} from "../_shared/email/sync.ts";
import type { MatchContext } from "../_shared/email/types.ts";
import { createClaudeClassifier, type Effort } from "./claude.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function env(name: string, fallback?: string): string {
  const v = Deno.env.get(name)?.trim() || fallback;
  if (!v) throw new Error(`Missing secret ${name}: add it in the Supabase dashboard under Edge Functions → Secrets`);
  return v;
}

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** null when allowed, otherwise [status, message]. */
async function authorise(req: Request, admin: SupabaseClient): Promise<[number, string] | null> {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!token) return [401, "Missing Authorization header"];
  const secret = Deno.env.get("EMAIL_SYNC_SECRET")?.trim();
  if (secret && sameSecret(token, secret)) return null;
  // The scheduled job sends the secret stored in Vault; JWTs never match it.
  if (!token.startsWith("eyJ")) {
    const { data } = await admin.rpc("email_sync_secret_ok", { p_token: token });
    return data === true ? null : [401, "Invalid sync secret"];
  }

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return [401, "Not signed in"];
  const { data: profile } = await admin.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  return profile?.role === "admin" || profile?.role === "editor" ? null : [403, "Only editors can check the mailbox"];
}

function unwrap<T>({ data, error }: { data: T; error: { message: string } | null }, what: string): T {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

async function mailboxAddress(admin: SupabaseClient): Promise<string> {
  const fromSecret = Deno.env.get("GMAIL_MAILBOX")?.trim().toLowerCase();
  if (fromSecret) return fromSecret;
  const { data, error } = await admin.from("mailboxes").select("email").eq("active", true).order("created_at").limit(1).maybeSingle();
  if (error) throw new Error(`mailboxes: ${error.message}`);
  if (!data) throw new Error("No mailbox configured: add a row to public.mailboxes or set the GMAIL_MAILBOX secret");
  return data.email as string;
}

function database(admin: SupabaseClient): SyncDb {
  return {
    async beginSync(mailbox, leaseSeconds, defaultFrom) {
      return unwrap(
        await admin.rpc("begin_mailbox_sync", { p_email: mailbox, p_lease_seconds: leaseSeconds, p_default_from: defaultFrom }),
        "begin_mailbox_sync",
      );
    },
    async endSync(mailbox, syncFrom, error, stats) {
      unwrap(
        await admin.rpc("end_mailbox_sync", { p_email: mailbox, p_sync_from: syncFrom, p_error: error, p_stats: stats }),
        "end_mailbox_sync",
      );
    },
    async knownIds(ids) {
      const known = new Set<string>();
      for (let i = 0; i < ids.length; i += 200) {
        const rows = unwrap(
          await admin.from("email_messages").select("gmail_message_id").in("gmail_message_id", ids.slice(i, i + 200)),
          "email_messages",
        ) as { gmail_message_id: string }[];
        for (const r of rows) known.add(r.gmail_message_id);
      }
      return known;
    },
    async matchContext(input) {
      return unwrap(await admin.rpc("email_match_context", { p: input }), "email_match_context") as MatchContext;
    },
    async ingest(payload) {
      return unwrap(await admin.rpc("ingest_email", { p: payload }), "ingest_email") as { status: string; duplicate?: boolean };
    },
    async unclassified(limit) {
      return unwrap(
        await admin
          .from("email_messages")
          .select("id, gmail_message_id, gmail_thread_id")
          .eq("status", "review")
          .is("enquiry_id", null)
          .is("draft_id", null)
          .like("note", "Not classified:%")
          .order("received_at", { ascending: true })
          .limit(limit),
        "email_messages",
      ) as UnclassifiedEmail[];
    },
    async reingest(emailId, payload) {
      return unwrap(
        await admin.rpc("reingest_email", { p_email_id: emailId, p: payload }),
        "reingest_email",
      ) as { status?: string; skipped?: boolean };
    },
  };
}

function attachmentStore(admin: SupabaseClient): SyncStorage {
  return {
    async upload(path, bytes, contentType) {
      const { error } = await admin.storage.from("email-attachments").upload(path, bytes, { contentType, upsert: true });
      if (error) throw new Error(error.message);
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  let admin: SupabaseClient | null = null;
  let mailbox: string | null = null;
  let syncing = false;
  try {
    admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const denied = await authorise(req, admin);
    if (denied) return json({ error: denied[1] }, denied[0]);

    mailbox = await mailboxAddress(admin);
    const domains = env("INTERNAL_EMAIL_DOMAINS", mailbox.split("@")[1])
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY")?.trim();

    const deps = {
      options: {
        ...DEFAULT_OPTIONS,
        mailbox,
        internalDomains: domains,
        lookbackHours: Number(env("SYNC_LOOKBACK_HOURS", "24")),
        timeBudgetMs: Number(env("SYNC_TIME_BUDGET_SECONDS", "110")) * 1000,
      },
      gmail: new GmailApi({
        clientId: env("GOOGLE_CLIENT_ID"),
        clientSecret: env("GOOGLE_CLIENT_SECRET"),
        refreshToken: env("GOOGLE_REFRESH_TOKEN"),
      }),
      db: database(admin),
      storage: attachmentStore(admin),
      classify: apiKey
        ? createClaudeClassifier({
            apiKey,
            model: env("ANTHROPIC_MODEL", "claude-opus-5-5"),
            effort: env("ANTHROPIC_EFFORT", "low") as Effort,
            mailbox,
          })
        : null,
      log: (m: string) => console.log(m),
    };
    // POST {"reclassify": true, "limit": 40}: re-classify stored "Not classified" e-mails instead of syncing.
    const body = (await req.json().catch(() => ({}))) as { reclassify?: unknown; limit?: unknown } | null;
    if (body?.reclassify === true) {
      return json(await runReclassify(deps, Number(body.limit ?? 40)));
    }

    syncing = true; // from here on runSync records its own errors on the mailbox
    return json(await runSync(deps));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`gmail-sync failed: ${message}`);
    // Setup problems (e.g. a missing Google secret) are shown on the Inbox page.
    if (admin && mailbox && !syncing) await admin.from("mailboxes").update({ last_error: message }).eq("email", mailbox);
    return json({ error: message }, 500);
  }
});
