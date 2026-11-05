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
| The Window | Home page of every user linked to a sales person: every open quote on a timeline of days since it was sent, against their own win window (the days in which 95% of their wins arrive), enquiries waiting for a quote, the month's wins against last month, and quick quotes against the team. Mark quoted, Followed up, Won and Mark lost from the page; quotes older than two weeks link to Follow-ups. No money on it. Anyone's opens at `/plan/<sales person>` (see [docs/DESIGN.md](docs/DESIGN.md#the-window-and-the-team-voyage)) |
| Team voyage and TV view | One container per job confirmed this month on a ship, against the team goal (admins set it; otherwise "beat last month"). `/tv` shows it full screen for the office, refreshing every two minutes |
| Dashboard | For managers (users not linked to a sales person): today / month-to-date enquiries, quotes, confirmations, conversion, profit; the team ship; follow-up lists; per-sales-person table (the weekly `DATA` sheet) |
| Register | Status tabs with live counts; search; date basis and period presets, sales person, shipment; one next step per row (*Mark quoted*, *Confirm job*, *View details*); details drawer; column chooser; export of the filtered view to Excel in the register layout |
| New / edit enquiry | Auto reference (`SL` + YY + running number), qty parser, auto totals and profit, lost/cancelled, change history; commission read from the remarks (`COMMISSION OMR 40/CNTR.`) and shown as you type |
| Import Excel | Upload the daily report or monthly workbook. Preview new / changed / unchanged / invalid rows, then import. The original file is archived |
| Follow-ups | Quotes waiting 14 days or more, by age (14–30 days, 31–90, over 90) and enquiries never quoted; filter by sales person; confirm the job, or tick rows and mark them lost with a reason (with undo) |
| Reports | Daily, weekly (Sat–Fri) and monthly reports: enquiries raised plus earlier ones confirmed, sales-person and mode totals; Excel export in the old report layouts. Analytics: monthly trend and profit chart; conversion and profit by sales person, customer, agent, lane, mode or trade type |
| Masters | **Customers**, **Agents** and **Ports**: every name with its counts; rename; **possible duplicates** grouped by similar spelling, merged in one step (admins). Old names and spellings are remembered, so imports and e-mails still find them; a remembered port spelling becomes the standard name whenever it is typed or imported |
| Inbox | New enquiries read from the pricing mailbox, ready to create with one click; e-mails to review; every enquiry keeps its e-mail history (see [E-mail intake](#e-mail-intake)) |
| Settings | The owner only, from the avatar menu: every staff login with its access (active, invited, turned off), role, sales person, last sign-in and changes this week. Invite someone, invite again, reset a password, set a temporary password, turn access off and on, make another owner. Asks before a second login is linked to the same sales person |
| Who sees what | Owners and admins see everything; editors add, edit and import; viewers read. A sales person's login (an editor or viewer linked to a sales person) sees only that sales person's enquiries and has no inbox or import; pricing and managers stay unlinked and see everything |

## Project layout

```
supabase/migrations/   database schema (tables, RLS, triggers, RPC functions)
supabase/seed.sql      sales persons
src/lib/normalize.ts   date / qty / name parsing shared by the form and the importer
src/lib/excel/         workbook reader, diff against the database, Excel exports
src/lib/reports.ts     report periods, sections and totals
src/lib/api.ts         all Supabase queries
src/pages/             screens (src/pages/reports/: daily / weekly / monthly / analytics)
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
3. Make the organisation owner (SQL editor), after inviting them once from **Authentication → Users → Invite user**:

   ```sql
   update public.profiles set role = 'owner'
   where id = (select id from auth.users where email = 'owner@silverlynxoman.com');
   ```

   Roles: `owner` (everything, and manages logins in Settings), `admin` (everything else, including merging and deleting), `editor` (add / edit / import), `viewer` (read-only, the default).
4. Deploy the `user-admin` Edge Function (`npx supabase functions deploy user-admin --no-verify-jwt`); it checks itself that the caller is the owner.
5. Everyone else is set up in the app: the owner opens the avatar menu → **Settings** → **Invite someone**, with their role and sales person. The invitation link is shown to send by WhatsApp or e-mail; *E-mail it from Supabase* needs your own SMTP (Authentication → Emails), because Supabase's built-in mailer sends only a few e-mails an hour and only to the project team. Link each sales person's login to their name in the register: their open quotes (The Window) become their home page and they see only their own enquiries. Users without a link (managers, pricing) keep the dashboard and see everything.

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

The browser smoke test (sign in, add an enquiry, import) builds the app against a mocked Supabase and runs in Chromium:

```bash
npx playwright install chromium
```

```bash
npm run test:e2e
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
