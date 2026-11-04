# Enquiry Tracker

Web replacement for the Silver Lynx Excel enquiry register (`MONTHLY ENQUIRIES 2026 FINAL.xlsx` and the daily report).

- **Frontend:** React + TypeScript + Vite + Tailwind, hosted on **Cloudflare Pages**
- **Backend:** **Supabase** (Postgres with Row Level Security, Auth, Storage)
- **Revision control / CI:** GitHub + GitHub Actions

The analysis of the current workbooks, the data model and the phased roadmap are in
[docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md). Colours, type, spacing and component rules for every screen are in
[docs/DESIGN.md](docs/DESIGN.md).

## What it does

| Screen | |
|---|---|
| Dashboard | Today / month-to-date enquiries, quotes, confirmations, conversion, profit; follow-up lists; per-sales-person table (the weekly `DATA` sheet) |
| Register | Status tabs with live counts; search; date basis and period presets, sales person, shipment; one next step per row (*Mark quoted*, *Confirm job*, *View details*); details drawer; column chooser; export of the filtered view to Excel in the register layout |
| New / edit enquiry | Auto reference (`SL` + YY + running number), qty parser, auto totals and profit, lost/cancelled, change history |
| Import Excel | Upload the daily report or monthly workbook. Preview new / changed / unchanged / invalid rows, then import. The original file is archived |
| Reports | Daily, weekly (Sat–Fri) and monthly reports: enquiries raised plus earlier ones confirmed, sales-person and mode totals; Excel export in the old report layouts. Analytics: monthly trend and profit chart; conversion and profit by sales person, customer, agent, lane, mode or trade type |

## Project layout

```
supabase/migrations/   database schema (tables, RLS, triggers, RPC functions)
supabase/seed.sql      sales persons
src/lib/normalize.ts   date / qty / name parsing shared by the form and the importer
src/lib/excel/         workbook reader, diff against the database, Excel exports
src/lib/reports.ts     report periods, sections and totals
src/lib/api.ts         all Supabase queries
src/pages/             screens (src/pages/reports/: daily / weekly / monthly / analytics)
docs/                  analysis and implementation plan
```

## First-time setup

### 1. Tools (Windows)

```bash
winget install OpenJS.NodeJS.LTS
```

```bash
winget install Git.Git
```

The Supabase CLI is run through `npx` (it cannot be installed with `npm install -g`).

### 2. Database

The project `Enquiry_Tracker` (`jaaueukrzijesejjaplt`) already has every migration in `supabase/migrations/` applied, plus the sales persons from `supabase/seed.sql`.

**Schema changes are applied automatically when a pull request is merged.** `.github/workflows/migrations.yml` does the work:

- **When a pull request changes `supabase/migrations/`,** a dry run lists the migrations that merging would apply. It fails if Supabase has a version with no matching file here.
- **After the merge to `main`,** it runs `supabase db push`, which applies only the new files. A re-run is harmless.
- **To run it by hand:** Actions → *Database migrations* → *Run workflow*.

One-time setup. In GitHub, go to *Settings → Secrets and variables → Actions → New repository secret* and add:

| Secret | Where to get it |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | https://supabase.com/dashboard/account/tokens → *Generate new token* |
| `SUPABASE_DB_PASSWORD` | The database password chosen when the project was created. You can reset it under *Project Settings → Database*. |

To add a schema change, create a timestamped file and write the SQL in it:

```bash
npx supabase migration new add_something
```

Commit it in a pull request; it is applied when the pull request is merged. Never edit a migration that has already been applied. Add a new one instead.

To apply migrations by hand (for example before the secrets are set up):

```bash
npx supabase login
```

```bash
npx supabase link --project-ref jaaueukrzijesejjaplt
```

```bash
npx supabase db push
```

Local file names match the versions recorded in Supabase, so `db push` only applies new files.

In the Supabase dashboard:

1. **Authentication → Sign In / Providers**: disable *Allow new users to sign up*. Staff are invited instead.
2. **Authentication → URL Configuration**: set *Site URL* to the Cloudflare Pages URL. Add `http://localhost:5173/**` and `https://<project>.pages.dev/**` to the redirect URLs.
3. **Authentication → Users → Invite user** for each member of staff. Invited users follow the e-mail link, then set a password on the *Account* page.
4. Make yourself admin (SQL editor):

   ```sql
   update public.profiles set role = 'admin'
   where id = (select id from auth.users where email = 'you@silverlynxoman.com');
   ```

   Roles: `admin` (everything, including delete), `editor` (add / edit / import), `viewer` (read-only, the default).

### 3. Run locally

```bash
copy .env.example .env.local
```

Fill in `VITE_SUPABASE_PUBLISHABLE_KEY` (Supabase → Project Settings → API Keys), then:

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

### 4. GitHub

```bash
git add -A
```

```bash
git commit -m "Enquiry tracker: schema, register, entry form, Excel import"
```

Create an empty private repository on GitHub, then:

```bash
git remote add origin https://github.com/<you>/enquiry-tracker.git
```

```bash
git push -u origin main
```

### 5. Cloudflare Pages

*Workers & Pages → Create → Pages → Connect to Git* → pick the repository.

| Setting | Value |
|---|---|
| Framework preset | Vite (or None) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Environment variables (Production **and** Preview) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_COMPANY_NAME`, `NODE_VERSION=22` |

Every push to `main` deploys production. Every pull request gets its own preview URL.
Client-side routes work without a `_redirects` file, because Pages serves `index.html` for unknown paths when no `404.html` exists.

## Loading the 2026 history

Optional first step: preview what an import would do without touching the database. This prints errors, warnings and per-month totals:

```bash
npm run check-workbook -- "C:\projects\MONTHLY ENQUIRIES 2026 FINAL.xlsx"
```

1. Sign in as an editor → **Import Excel** → choose the workbook.
2. The month sheets (`JAN.` … `NOV`) are pre-selected. Leave `DATA1` out, because it repeats October rows.
3. **Analyse** → review the *New*, *Changed* and *Errors / warnings* tabs. Untick any row that should not be imported (search finds rows that are not shown). → **Import**.
4. Reconcile against the totals in `docs/IMPLEMENTATION_PLAN.md` §1.3.

**What an import never does:**

- **Erase values:** blank cells never wipe saved values.
- **Overwrite app changes:** values changed in the app are kept, and the preview lists them as *Kept*. Enquiries created in the app are never changed by an import.
- **Repeat work:** re-importing a file is safe. Rows already in sync are reported as *unchanged*.

Import only the most up-to-date workbook. An older copy, such as a monthly or daily report, would replace newer values with older ones where they differ.
