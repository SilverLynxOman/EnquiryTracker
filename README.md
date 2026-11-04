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
| Inbox | New enquiries read from the pricing mailbox, ready to create with one click; e-mails to review; every enquiry keeps its e-mail history (see [E-mail intake](#e-mail-intake)) |

## Project layout

```
supabase/migrations/   database schema (tables, RLS, triggers, RPC functions)
supabase/seed.sql      sales persons
src/lib/normalize.ts   date / qty / name parsing shared by the form and the importer
src/lib/excel/         workbook reader, diff against the database, Excel export
src/lib/api.ts         all Supabase queries
src/pages/             screens
supabase/functions/    gmail-sync Edge Function (e-mail intake); shared, unit-tested code in _shared/email/
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

## E-mail intake

The `gmail-sync` Edge Function reads the pricing mailbox every 5 minutes and files every message:

| The e-mail… | Goes to |
|---|---|
| carries an SL reference that is in the register (`SL262759 1X40' QINGDAO …`) | that enquiry's e-mail history |
| replies to a message already filed (In-Reply-To / References headers) | the same enquiry, or the same pending e-mail enquiry |
| cites an SL reference the register does not have yet | **Waiting for reference**, linked automatically when that enquiry is entered or imported |
| is none of the above | read by Claude: a **new enquiry** (customer, contact, route, qty, incoterm, commodity, weights, attachments), a follow-up of one of the customer's open enquiries, or not an enquiry |
| is a newsletter, promotion or automatic reply | **Ignored** |

Nothing is created in the register without a person. In **Inbox → New enquiries**, check the details and click **Create enquiry**: the reference is issued, the contact is saved to the customer, and the e-mails move to the enquiry. **Review & edit** opens the full form first. **Add to existing enquiry** and **Not an enquiry** handle the rest. Anything the system is unsure about lands in **Needs review**; a message is never dropped.

Duplicates are prevented in four places:
- Each Gmail message is stored once.
- Replies attach to the pending e-mail enquiry instead of opening a new one.
- A pending e-mail enquiry is folded in automatically when staff create the enquiry by hand and reply with its reference.
- Each card lists existing enquiries of the same customer from the last three weeks.

**Keep the SL reference in the subject** when replying (house style already). Follow-ups are then filed without Claude.

Claude reads only the messages the rules above cannot file, with their PDF and picture attachments. On `claude-opus-5-5` (the default) that costs an estimated 2–5 US cents per message read. Set `ANTHROPIC_MODEL=claude-haiku-5-5` for a far cheaper, less careful reader. E-mail text and attachments (except those of ignored mail) are stored in Supabase.

Do the historical Excel import first, so that references in old conversations match.

### Setup

Already done on the `Enquiry_Tracker` project (4 Nov 2026): the migration (`20261104202737_email_intake.sql`) is applied, the `gmail-sync` function is deployed, the mailbox `pricing@silverlynxoman.com` is registered and the 5-minute job is scheduled with its secret in Vault. Until the keys below are added, each run stops with "Missing secret GOOGLE_CLIENT_ID", shown on the Inbox page.

What is left needs a browser:

1. **Gmail access** (Google Workspace admin, once):
   1. In [Google Cloud console](https://console.cloud.google.com/), create a project and enable the **Gmail API**.
   2. *Google Auth Platform → Branding / Audience*: user type **Internal**. Internal apps keep their refresh token; external apps in testing lose it after 7 days. Under *Data access* add the scope `https://www.googleapis.com/auth/gmail.readonly`.
   3. *Clients → Create client → Web application*, with the authorised redirect URI `https://developers.google.com/oauthplayground`. Copy the client ID and secret.
   4. Open the [OAuth Playground](https://developers.google.com/oauthplayground). Under ⚙ tick *Use your own OAuth credentials* and paste the client ID and secret. In step 1 enter the scope `https://www.googleapis.com/auth/gmail.readonly`, click *Authorize APIs* and sign in **as pricing@silverlynxoman.com**. In step 2 click *Exchange authorization code for tokens* and copy the **refresh token**.
2. **Claude**: create an API key in the [Claude Console](https://platform.claude.com/). Without a key, mail that needs reading goes to *Needs review*.
3. **Secrets**: in the Supabase dashboard, *Edge Functions → Secrets*, add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` and `ANTHROPIC_API_KEY`. The next run (within 5 minutes) reads the last 24 hours of mail.

Optional secrets: `ANTHROPIC_MODEL` (default `claude-opus-5-5`), `ANTHROPIC_EFFORT` (default `low`), `INTERNAL_EMAIL_DOMAINS` (default `silverlynxoman.com`), `SYNC_LOOKBACK_HOURS` (first run, default `24`), `GMAIL_MAILBOX` (default: the first active row of `public.mailboxes`).

To set it up on another project:

```bash
npx supabase db push
```

```bash
npx supabase functions deploy gmail-sync --no-verify-jwt
```

Then run `supabase/email_sync_schedule.sql` in the SQL editor (mailbox, Vault secret, 5-minute job; it also has queries to check and stop the job) and add the secrets above. If the deploy asks for Docker, add `--use-api`.

The status line on the Inbox page shows when the mailbox was last read and the last error, if any. Editors can also click **Check mail now**.
