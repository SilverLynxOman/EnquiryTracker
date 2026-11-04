# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A web replacement for Silver Lynx's Excel enquiry register (a freight forwarder in Oman: one row per customer enquiry, tracked Enquiry → Quoted → Confirmed). React SPA on Cloudflare Pages talking directly to Supabase. There is no custom server.

`docs/IMPLEMENTATION_PLAN.md` is the source of business context. Read it before non-trivial work:
- §1.2 Excel column A–S ↔ database field mapping
- §1.3 monthly totals the app must reproduce (acceptance figures for the historical import)
- §1.4 data-quality quirks the importer handles
- §5 phase-by-phase roadmap with status markers (✅ / 🟡 / ⬜). Update them when phase work lands
- §6 open questions still awaiting the business (currency, week definition, permissions)

## Commands

```bash
npm run dev                # Vite dev server on http://localhost:5173
npm run build              # tsc --noEmit, then vite build into dist/
npm run typecheck
npm test                   # vitest run (all src/**/*.test.ts)
npx vitest run src/lib/normalize.test.ts   # one file
npx vitest run -t "parseQty"               # tests whose name matches
npm run check-workbook -- "path/to/MONTHLY ENQUIRIES 2026 FINAL.xlsx"  # dry-run the importer, no DB access
npx supabase db push       # apply new migrations (needs `npx supabase login` + `link --project-ref jaaueukrzijesejjaplt`)
```

- There is no ESLint or Prettier. Strict `tsc` (with `noUnusedLocals` and `noUnusedParameters`) is the lint step. CI (`.github/workflows/ci.yml`) runs typecheck, tests and build, in that order.
- Local runs need `.env.local` (copy `.env.example`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_COMPANY_NAME`. `src/lib/supabase.ts` throws at import time if the first two are missing.
- `xlsx` (SheetJS) is installed from `https://cdn.sheetjs.com/...tgz`, not the npm registry. Installs fail on networks that block `cdn.sheetjs.com`. Do not swap it for the npm `xlsx` package: that package is stuck on an old release with known vulnerabilities.
- The README and `.claude/launch.json` assume Windows (`winget`, `copy`, `C:\Program Files\nodejs\node.exe`).

## Architecture

### The database holds the business rules

All schema lives in `supabase/migrations/`. The browser connects with the publishable key plus the user's JWT, so **Postgres RLS and the checks inside the RPCs are the only security boundary**. `useAuth().canEdit` and `isAdmin` in the UI only hide buttons.

Roles live in `profiles.role`: `viewer` (the default for new auth users, via the `handle_new_user` trigger), `editor` (add, edit, import) and `admin` (also delete and change roles). The SQL helpers are `app_role()`, `can_edit()` and `is_admin()`.

The following are done in the database. Don't reimplement them in the client:
- **References** (`SL` + YY + 4-digit sequence, e.g. `SL262731`) are issued by the `enquiries_before_write` trigger from `reference_counters` when the inserted reference is blank. Explicitly supplied references (imports) push the counter forward so it never reissues them. For manual inserts the trigger also prefixes the subject with the reference.
- **`status` and `profit` are generated columns.** Never write them. Status precedence is cancelled > confirmed > lost > quoted > new (`closure` holds lost or cancelled). Profit is always `sell_total − buy_total`. The Excel PROFIT column is only used to raise warnings.
- **Audit:** the `enquiries_audit` trigger writes field-level old/new diffs to `enquiry_audit`. `import_enquiries` sets `app.import_batch_id` so each audit row is tagged with its import batch.

How the UI reads and writes:
- **Reads** go through the `enquiry_register` view (enquiries joined with customer, agent and sales-person names, `security_invoker`), plus the report RPCs `dashboard_stats` and `salesperson_summary`.
- **Saves from the form** call `upsert_enquiry(p_id, p jsonb)`. It is a full replace, so a blank field clears the stored value.
- **Imports** call `import_enquiries(batch_id, rows jsonb)`. It uses `coalesce`, so a blank incoming value never overwrites a stored one.
- **Mark quoted and delete** go straight to the `enquiries` table and rely on RLS.
- Customer, agent and sales-person names are sent as text and resolved server-side by `resolve_customer`, `resolve_agent` and `resolve_sales_person`. These look up `*_aliases` first, then `name_key`, and create the record if nothing matches.

### Rules that span TypeScript and SQL

- `nameKey()` in `src/lib/normalize.ts` must stay identical to `public.name_key()` in SQL. It uppercases, turns `.,'"\`` into spaces and collapses whitespace. Unique indexes on `name_key` depend on it.
- **"Imports never erase data"** is enforced in three places, which must stay consistent:
  - `diffRow` in `src/lib/excel/diff.ts` doesn't count a blank incoming value as a change.
  - `toPayload` doesn't let an enquiry date carried forward from the row above replace a stored one.
  - The SQL `coalesce` in `import_enquiries` keeps stored values when the incoming one is blank.
- `src/lib/types.ts` is maintained by hand (not generated). Update it alongside any schema change.

### Excel import pipeline

The importer runs in the browser (`src/pages/ImportPage.tsx`), and the same parsing code runs in Node through `scripts/check-workbook.ts`. Keep `src/lib/normalize.ts` and `src/lib/excel/` free of Supabase and DOM dependencies; the tests also run them in a Node environment.

1. `listRegisterSheets` (`src/lib/excel/register.ts`) finds any sheet with a "MY REFERENCE" header in its first 20 rows. It computes a column offset against the standard A–S layout (`COLS`) and pre-selects every sheet except `DATA*` summaries.
2. `parseRegisterSheet` turns each row into a `ParsedRow` with `issues`, each marked `error` or `warning`. Rows with errors are excluded from the import; warnings are shown and imported.
   - It skips rows with no reference or no customer (section titles, footers, empty pre-numbered rows).
   - It carries a blank enquiry date forward from the row above.
   - It swaps MODE and QTY when they were typed into each other's column.
   - It parses QTY text (e.g. `2X40 RF`) into mode, units and container type with `parseQty`.
3. `mergeDuplicates`: if a reference appears more than once with the same customer, the rows are merged and later non-blank values win. If the customers differ, every copy becomes an error.
4. `fetchExistingByReferences`, then `buildAnalysis`/`diffRow`, produce the preview: new, changed, unchanged and invalid rows.
5. On commit, the original file goes to the private `imports` storage bucket, an `import_batches` row is created, and rows go to `import_enquiries` in chunks of 250. Each RPC call runs in its own transaction.

`exportRegister` writes the same A–S layout (two header rows, data from row 5), so exported files re-import cleanly. The column order is irregular: BUY rate (J) comes before BUY TOTAL (K), but SELL TOTAL (L) comes before SELL rate (M).

`xlsx` stays out of the main bundle: `ImportPage` is `lazy()`-loaded in `App.tsx`, and `RegisterPage` dynamically imports `exportRegister`. Keep it that way.

### Frontend

- All Supabase calls live in `src/lib/api.ts`. PostgREST caps responses at 1000 rows, so full fetches go through `fetchAllPages`.
- TanStack Query keys are grouped by their first segment: `register`, `dashboard`, `enquiry`, `audit`, `names`, `sales-persons`, `import-batches`, `profile-names`. After any write, invalidate every group it affects (the form's save and `ImportPage`'s commit invalidate `register`, `dashboard`, `names` and `sales-persons`).
- Auth is invite-only. `src/lib/supabase.ts` reads `type=invite|recovery` from the URL hash *before* the Supabase client clears it, and stores a sessionStorage flag so the user is sent to set a password. Inside `onAuthStateChange` in `AuthProvider.tsx`, only set React state: calling Supabase from that callback can deadlock the auth client.
- Conventions:
  - Dates are `YYYY-MM-DD` internally and shown as `DD.MM.YYYY` (`fmtDate`).
  - Free text is typed in capitals, as in the Excel register (`UPPERCASE_FIELDS` in `EnquiryFormPage.tsx`).
  - Amounts default to USD (still an open question, §6).
- In the form, a total is calculated automatically as rate × units (units default to 1) until the user types the total. The importer calculates a total only when the cell is blank. It never recalculates totals that were given.

## Database changes

- Never edit an applied migration. Add `supabase/migrations/<YYYYMMDDHHMMSS>_<name>.sql`. File names must match the versions recorded in the Supabase project, which is how `db push` knows what is new.
- Follow the patterns in the initial schema:
  - Functions use `set search_path = ''` and fully qualified names.
  - Revoke `execute` from `public` and `anon`, then grant it to `authenticated` explicitly.
  - Trigger functions are also revoked from `authenticated`, because Supabase grants it directly (see `20261102162837_lock_trigger_functions.sql`).
  - Every new table gets RLS policies of the form `(select public.can_edit())`.
- `supabase/seed.sql` holds only the sales-person master list.
- `.claude/skills/supabase` and `.claude/skills/supabase-postgres-best-practices` are Supabase's official agent skills, copied unchanged from `supabase/agent-skills` at commit `c9be0e9` (MIT). To update them, copy the folders again from a newer commit. Where they conflict with this file, this file wins. For example, the existing `SECURITY DEFINER` role helpers in `public` (`app_role`, `can_edit`, `is_admin`) are intentional: they only report on the caller's own profile.

## Data handling

`*.xlsx` and `*.xls` are gitignored because the real workbooks contain customer and pricing data. Never commit them. Tests build workbooks in memory (see `dailyReport()` in `src/lib/excel/register.test.ts`).
