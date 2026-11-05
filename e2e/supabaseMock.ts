import type { Page, Route } from "@playwright/test";

// A small in-memory Supabase for the smoke test: Auth (password sign-in), the REST calls the dashboard, the enquiry
// form and the importer make, and Storage. Nothing reaches a real project. The app is built with
// VITE_SUPABASE_URL=SUPABASE_URL (playwright.config.ts).

export const SUPABASE_URL = "https://supabase.e2e.test";
export const EMAIL = "pricing@example.com";
export const PASSWORD = "correct-horse-battery";

const USER = {
  id: "00000000-0000-4000-8000-000000000001",
  aud: "authenticated",
  role: "authenticated",
  email: EMAIL,
  app_metadata: { provider: "email" },
  user_metadata: {},
  created_at: "2026-11-01T08:00:00Z",
};
/** An admin not linked to a sales person: sees every enquiry and may import. */
const PROFILE = { id: USER.id, full_name: "Pricing Desk", role: "admin", sales_person_id: null, disabled_at: null };
export const SALES_PERSONS = [
  { id: "00000000-0000-4000-8000-0000000000a1", name: "ANWAR" },
  { id: "00000000-0000-4000-8000-0000000000a2", name: "VIVEK" },
];

/** What the app sent, for the test to check. */
export interface Calls {
  signIns: { email: string; password: string }[];
  saved: Record<string, unknown>[];
  imported: Record<string, unknown>[];
  batches: Record<string, unknown>[];
  uploads: string[];
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "*",
  "access-control-expose-headers": "content-range",
};

export async function mockSupabase(page: Page): Promise<Calls> {
  const calls: Calls = { signIns: [], saved: [], imported: [], batches: [], uploads: [] };
  const saved = new Map<string, Record<string, unknown>>();

  await page.route(`${SUPABASE_URL}/**`, async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    const body = () => JSON.parse(req.postData() || "{}");
    const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
      route.fulfill({ status, contentType: "application/json", headers: { ...CORS, ...headers }, body: JSON.stringify(data) });
    const single = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");

    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });

    // --- Auth ---
    if (path === "/auth/v1/token" && url.searchParams.get("grant_type") === "password") {
      const { email, password } = body();
      calls.signIns.push({ email, password });
      if (email !== EMAIL || password !== PASSWORD) {
        return json({ code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" }, 400);
      }
      const now = Math.floor(Date.now() / 1000);
      return json({ access_token: "e2e-access-token", token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: "e2e-refresh", user: USER });
    }
    if (path === "/auth/v1/user") return json(USER);
    if (path === "/auth/v1/logout") return route.fulfill({ status: 204, headers: CORS });

    // --- Storage (the importer keeps the uploaded workbook) ---
    if (path.startsWith("/storage/v1/object/")) {
      calls.uploads.push(path);
      return json({ Key: path.replace("/storage/v1/object/", "") });
    }

    // --- Functions ---
    if (path.startsWith("/rest/v1/rpc/")) {
      const fn = path.slice("/rest/v1/rpc/".length);
      if (fn === "upsert_enquiry") {
        const { p } = body();
        calls.saved.push(p);
        const n = saved.size + 1;
        const row = { ...p, id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, reference: p.reference || `SL26${String(9000 + n)}`, status: "new" };
        saved.set(row.id, row);
        return json(row);
      }
      if (fn === "import_enquiries") {
        const { p_rows } = body();
        calls.imported.push(...p_rows);
        return json({ inserted: p_rows.length, updated: 0 });
      }
      if (fn === "dashboard_stats") return json({ enquiries: 0, quoted: 0, confirmed: 0, converted: 0, profit: 0, sell_total: 0 });
      if (fn === "email_inbox_counts") return json({ drafts: 0, review: 0, awaiting: 0, mailboxes: [] });
      if (fn === "team_confirmed_by_month" || fn === "team_wins" || fn === "salesperson_summary") return json([]);
      return json([]);
    }

    // --- Tables and views ---
    if (path === "/rest/v1/profiles") return json(single ? PROFILE : [PROFILE]);
    if (path === "/rest/v1/sales_persons") return json(SALES_PERSONS);
    if (path === "/rest/v1/customers" || path === "/rest/v1/agents") return json([]);
    if (path === "/rest/v1/import_batches" && method === "POST") {
      const batch = body();
      calls.batches.push(batch);
      return json({ id: "00000000-0000-4000-8000-0000000000b1", inserted: 0, updated: 0, ...batch, created_at: new Date().toISOString() });
    }
    if (path === "/rest/v1/enquiry_register") {
      const id = url.searchParams.get("id")?.replace(/^eq\./, "");
      if (id && single) {
        const row = saved.get(id);
        return row ? json(row) : json({ message: "not found" }, 406);
      }
      // Counts (HEAD) and lists: an empty register.
      return json([], 200, { "content-range": "*/0" });
    }
    return json([], 200, { "content-range": "*/0" });
  });

  return calls;
}
