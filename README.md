# Enquiry Tracker

Web replacement for the Silver Lynx Excel enquiry register (`MONTHLY ENQUIRIES 2026 FINAL.xlsx` and the daily report).

- **Frontend:** React + TypeScript + Vite + Tailwind, hosted on **Cloudflare Pages**
- **Backend:** **Supabase** (Postgres with Row Level Security, Auth, Storage)
- **Revision control / CI:** GitHub + GitHub Actions

The analysis of the current workbooks, the data model and the phased roadmap are in
[docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).

## What it does

| Screen | |
|---|---|
| Dashboard | Today / month-to-date enquiries, quotes, confirmations, conversion, profit; follow-up lists; per-sales-person table (the weekly `DATA` sheet) |
| Register | Filter by enquiry / quoted / confirmation date, status, sales person, shipment type, free text; *Mark quoted*, *Confirm…*; export to Excel in the register layout |
| New / edit enquiry | Auto reference (`SL` + YY + running number), qty parser, auto totals and profit, lost/cancelled, change history |
| Import Excel | Upload the daily report or monthly workbook. Preview new / changed / unchanged / invalid rows, then import. The original file is archived |

## Project layout

```
supabase/migrations/   database schema (tables, RLS, triggers, RPC functions)
supabase/seed.sql      sales persons
src/lib/normalize.ts   date / qty / name parsing shared by the form and the importer
src/lib/excel/         workbook reader, diff against the database, Excel export
src/lib/api.ts         all Supabase queries
src/pages/             screens
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

The project `Enquiry_Tracker` (`jaaueukrzijesejjaplt`) already has both migrations in `supabase/migrations/` applied, plus the sales persons from `supabase/seed.sql`. Future schema changes go in new migration files. Apply them with:

```bash
npx supabase login
```

```bash
npx supabase init
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

1. Sign in as an editor → **Import Excel** → choose `MONTHLY ENQUIRIES 2026 FINAL.xlsx`.
2. The month sheets (`JAN.` … `NOV`) are pre-selected. Leave `DATA1` out, because it repeats October rows.
3. **Analyse** → review the *Errors / warnings* tab. Known issues: `SL262421` and `SL262664` are each used for two different enquiries. → **Import**.
4. Reconcile against the totals in `docs/IMPLEMENTATION_PLAN.md` §1.3.

Re-importing a file is safe. Rows already in sync are reported as *unchanged*, and blank cells never wipe saved values.
