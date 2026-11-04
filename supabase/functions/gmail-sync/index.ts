// gmail-sync: reads new mail of the pricing mailbox and files it in the enquiry tracker.
//
// Called every few minutes by pg_cron (supabase/email_sync_schedule.sql) with
// "Authorization: Bearer <EMAIL_SYNC_SECRET>", and on demand by an editor's "Check mail now" button
// (their own session token). Deploy with --no-verify-jwt: this function checks both itself.
//
// Secrets (npx supabase secrets set NAME=value):
//   GMAIL_MAILBOX            pricing@silverlynxoman.com
//   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN   OAuth client + refresh token (gmail.readonly)
//   EMAIL_SYNC_SECRET        long random string, also stored in Vault for the cron job
//   ANTHROPIC_API_KEY        without it, e-mails that need Claude go to "review"
//   ANTHROPIC_MODEL          optional, default claude-opus-5-5
//   ANTHROPIC_EFFORT         optional, default low
//   INTERNAL_EMAIL_DOMAINS   optional, comma separated, default the mailbox's domain
//   SYNC_LOOKBACK_HOURS      optional, how far back the first run reads (default 24)
//   SYNC_TIME_BUDGET_SECONDS optional, stop starting new messages after this (default 110)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { GmailApi } from "../_shared/email/gmail.ts";
import { DEFAULT_OPTIONS, runSync, type SyncDb, type SyncStorage } from "../_shared/email/sync.ts";
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
  if (!v) throw new Error(`Missing secret ${name}`);
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

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return [401, "Not signed in"];
  const { data: profile } = await admin.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  return profile?.role === "admin" || profile?.role === "editor" ? null : [403, "Only editors can check the mailbox"];
}

function unwrap<T>({ data, error }: { data: T; error: { message: string } | null }, what: string): T {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
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

  try {
    const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const denied = await authorise(req, admin);
    if (denied) return json({ error: denied[1] }, denied[0]);

    const mailbox = env("GMAIL_MAILBOX").toLowerCase();
    const domains = env("INTERNAL_EMAIL_DOMAINS", mailbox.split("@")[1])
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY")?.trim();

    const stats = await runSync({
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
      log: (m) => console.log(m),
    });
    return json(stats);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`gmail-sync failed: ${message}`);
    return json({ error: message }, 500);
  }
});
