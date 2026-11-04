# Enquiry Tracker — Analysis & Implementation Plan

Replaces the Excel enquiry register (`MONTHLY ENQUIRIES 2026 FINAL.xlsx` + `Daily Report <MONTH>, 2026.xlsx`)
with a web application.

- **Database / auth / file storage:** Supabase (project `Enquiry_Tracker`, `eu-west-1`)
- **Hosting:** Cloudflare Pages (static React app, auto-deployed from GitHub)
- **Revision control / CI:** GitHub (+ GitHub Actions)

---

## 1. How the register works today (analysis of the workbooks)

### 1.1 Workbooks

| Workbook | Sheets | Purpose |
|---|---|---|
| `MONTHLY ENQUIRIES 2026 FINAL.xlsx` | `JAN.` … `NOV` (one per month) | Master register, one row per enquiry |
| | `DATA1` | Weekly extract (e.g. 24.10.2026 – 30.10.2026) + "LAST WEEK'S CONFIRMATION" |
| | `DATA ` | Weekly per-sales-person summary (inquiries, confirmed, NEW+OLD, FCL, units, AIR, LCL, COURIER, profit) |
| | `Sheet1` | Scratch list (SL2655xx references) |
| `Daily Report NOVEMBER, 2026.xlsx` | `01.11` (one per day) | That day's new enquiries + "PREVIOUS DAY'S CONFIRMATION" section + footer "NO. OF ENQUIRIES / NO. OF CONFIRMATIONS" |
| `MONTHY REPORT FOR OCTOBER, 2026.xlsx` | `OCT`, `DATA ` | Month sheet + "LAST MONTH'S CONFIRMATION" footer |

### 1.2 Column layout (identical in every register sheet; header on rows 3–4, data from row 5)

| Col | Header | Meaning | App field |
|---|---|---|---|
| A | SL. NO. | Running number within the sheet | *(computed, not stored)* |
| B | ENQUIRY DATE | `DD.MM.YYYY` text | `enquiry_date` |
| C | QUOTED DATE | | `quoted_date` |
| D | CONFIRMATION DATE | Blank = not (yet) confirmed | `confirmed_date` |
| E | MY REFERENCE | `SL` + YY + 4-digit running number, e.g. `SL262731` | `reference` (unique key) |
| F | NAME OF CUSTOMER LOCAL/OVERSEAS | | `customer_id` → `customers` |
| G | SUBJECT | `SL262731 LCL EX-WORKS SHANGHAI CHINA TO SOHAR OMAN` | `subject` |
| H | JOB NATURE – MODE | `IMP` / `EXP` / `CT` (cross trade) | `trade_type` |
| I | JOB NATURE – QTY | `1X40'`, `2X40 RF`, `LCL`, `AIR`, `COURIER`, `RORO`, `1X20' / 1X40'` … | `qty_text` → parsed into `shipment_mode`, `units`, `container_type` |
| J | BUY RATE – BUY | Buy rate per unit | `buy_rate` |
| K | BUY RATE – TOTAL | Usually `J × units` | `buy_total` |
| L | SELL – TOTAL | Usually `M × units` | `sell_total` |
| M | SELL – SELL | Sell rate per unit | `sell_rate` |
| N | PROFIT | `L − K` | `profit` (computed) |
| O | POL | Port of loading | `pol` |
| P | POD | Port of discharge | `pod` |
| Q | AGENT | Overseas agent / carrier | `agent_id` → `agents` |
| R | SALES PERSON | | `sales_person_id` → `sales_persons` |
| S | *(no header)* | Notes, mostly commission ("COMMISSION OMR 40/CNTR.") | `remarks` |

**Lifecycle:** Enquiry → Quoted → Confirmed. "Lost" is never recorded. A row that never gets a confirmation date stays open forever.

### 1.3 Volumes (2026, Jan – 1 Nov)

| Month | Enquiries | Quoted | Confirmed | Conv. % | Profit (confirmed) |
|---|---:|---:|---:|---:|---:|
| JAN | 337 | 337 | 187 | 55.5 | 62,972 |
| FEB | 225 | 222 | 96 | 42.7 | 33,311 |
| MAR | 174 | 167 | 51 | 29.3 | 21,110 |
| APR | 274 | 269 | 105 | 38.3 | 63,062 |
| MAY | 209 | 208 | 74 | 35.4 | 36,390 |
| JUN | 351 | 350 | 146 | 41.6 | 115,847 |
| JUL | 274 | 271 | 122 | 44.5 | 83,915 |
| AUG | 274 | 274 | 130 | 47.4 | 65,629 |
| SEP | 303 | 301 | 145 | 47.9 | 92,960 |
| OCT | 310 | 307 | 158 | 51.0 | 110,489 |
| NOV (1st) | 7 | 2 | 2 | — | 560 |

About 2,740 enquiries a year, roughly 15 a day. There are 873 distinct customer spellings, 163 agent spellings and 23 sales people.
These totals, counted by enquiry month, are the **acceptance figures for the historical import**: the app's monthly report must reproduce them.

### 1.4 Data-quality issues the importer must handle

| Issue | Example | Handling |
|---|---|---|
| Dates are text, with typos | `30..04.2026`, `11.05.206`, `13.10.20226`, `10.6.2026` | Tolerant parser; mistyped year → sheet year, flagged as warning |
| Missing enquiry date | NOV `SL262736`, `SL262737` | Carry forward from the row above, flagged as warning |
| Pre-allocated empty rows | NOV `SL262738`…`SL262993` have only a reference | Skipped (row needs a customer) |
| MODE / QTY swapped | `SL260592` MODE=`AIR`, QTY=`IMP` | Auto-corrected, warning |
| Duplicate reference | `SL262421` (SEP + OCT), `SL262664` (twice in OCT) | Same customer → merged; different customer → error, excluded |
| Name variants | `CONSOL CLUB` / `CONSOLE CLUB`, `JA SUPPLY` / `JA SUPLLY` / `J A SUPPLY`, `A.V. FREIGHT` / `A. V. FREIGHT` | Punctuation-insensitive matching now; merge tool + aliases in Phase 5 |
| `K` not always `J × units` | 2X40' rows where `J` already holds the total | Totals stored as given; never recomputed on import |
| `PROFIT` typed by hand | occasional mismatch with `L − K` | App computes `L − K`; mismatch flagged as warning |
| Same rows in several sheets | `DATA1` and the daily "PREVIOUS DAY'S CONFIRMATION" repeat earlier rows | Upsert by reference, so repeats are harmless |

### 1.5 Rows to review before the historical import (found by the dry run)

| Row | Issue | Suggested fix |
|---|---|---|
| SEP!R307 / OCT!R5 `SL262421` | Same reference for OASIS STARS BUSINESS LLC and V R LOGISTICS. Both are excluded | Give one of them a new reference |
| OCT!R247/R248 `SL262664` | Same enquiry entered twice. Merged automatically | Delete one row |
| APR!R180 `SL260912` | PROFIT 2,608 vs SELL−BUY 4,810 | Check K / L |
| MAY!R207 `SL261213` | PROFIT 805 vs 803 | Check K / L |
| JUN!R125 `SL261340` | PROFIT 160 vs 384 | Check K / L |
| JUN!R136 `SL261351` | PROFIT 200 vs 304 | Check K / L |
| JUN!R137 `SL261352` | PROFIT 200 vs 130 | Check K / L |
| JUN!R175 `SL261390` | PROFIT 550 vs 260 | Check K / L |
| JUN!R187 `SL261402` | PROFIT 103 vs 93 | Check K / L |
| JUN!R190 `SL261405` | PROFIT 1,000 vs **−3,600** | Almost certainly a wrong BUY TOTAL |
| AUG!R196 `SL262036` | PROFIT 1,100 vs 795 | Check K / L |
| SEP!R230 `SL262344` | QUOTED DATE `24.09.2024` (year typo) | Change to 2026 |
| JAN!R16 `SL260012`, MAR!R113 `SL260671` | Quoted before enquiry date | Check dates |
| MAY!R132 `SL261138`, JUL!R77 `SL261643`, NOV!R24 `SL262750` | Confirmed but no SELL amount | Add rates |

The app always computes profit as SELL TOTAL − BUY TOTAL. Fixing K / L in Excel before the import, or in the app afterwards, makes the totals right.

---

## 2. Target architecture

```
 Browser (staff)                    Cloudflare Pages                 Supabase
 ┌────────────────────┐   HTTPS   ┌──────────────────┐            ┌──────────────────────────────┐
 │ React SPA          │ ◀──────── │ static build of  │            │ Auth (email + password,      │
 │  • Register        │           │ this repo (dist) │            │       invite-only)           │
 │  • Entry form      │           └──────────────────┘            │ Postgres + Row Level Security│
 │  • Excel import    │  supabase-js (publishable key + user JWT) │  • tables, views, audit      │
 │    (parsed in the  │ ─────────────────────────────────────────▶│  • RPC: upsert / import /    │
 │     browser)       │                                           │         reports              │
 └────────────────────┘                                           │ Storage: original Excel files│
                                                                  └──────────────────────────────┘
 GitHub: main branch ──push──▶ Cloudflare Pages build (production)   PR ──▶ preview URL
         GitHub Actions: typecheck + unit tests + build on every push/PR
         supabase/migrations/*.sql: versioned schema, applied with `supabase db push`
```

Design choices:

- **No custom server.** Everything runs in the browser against Supabase. Security comes from Row Level Security and from the roles `admin` / `editor` / `viewer`.
- **Excel is parsed in the browser** (SheetJS). The user sees a preview of new, changed and invalid rows *before* anything is written. The commit is a single RPC per 250 rows, and each call runs in one transaction.
- **Imports never erase data.** A blank cell in the uploaded sheet never clears a value already in the database. Clearing a value is done in the app.
- **Every change is audited** (who, when, old → new, and which import batch).
- **References keep the current scheme** (`SL` + YY + 4 digits). The database issues the next number atomically, so two users can never get the same reference.

---

## 3. Data model (`supabase/migrations/20261102162701_initial_schema.sql`)

| Table / view | Purpose |
|---|---|
| `profiles` | One row per login: name, role (`admin`/`editor`/`viewer`), optional link to a sales person |
| `sales_persons` | Master list (seeded from the 23 names in the sheets) |
| `customers`, `customer_aliases` | Customer master; aliases map misspellings to the canonical customer |
| `agents`, `agent_aliases` | Agent / carrier master + aliases |
| `enquiries` | The register (one row per reference). `status` and `profit` are generated columns |
| `reference_counters` | Next running number per prefix (`SL26`, `SL27`, …) |
| `import_batches` | One row per uploaded file: counts, warnings, path of the stored original |
| `enquiry_audit` | Field-level change history, written by trigger |
| `enquiry_register` (view) | Enquiries joined with customer / agent / sales-person names, which is what the UI reads |

RPC functions: `upsert_enquiry` (manual save), `import_enquiries` (batch upsert), `dashboard_stats`, `salesperson_summary` (the weekly `DATA` sheet), `resolve_customer` / `resolve_agent` / `resolve_sales_person`.
Reports (`20261104180409_report_functions.sql`):
- `monthly_trend` counts, month by month, the enquiries raised (and what became of them) and the jobs confirmed.
- `enquiry_breakdown` groups the enquiries raised in a range by sales person, customer, agent, lane, mode or trade type.

---

## 4. Daily workflow in the app

**Manual (recommended once live)**
1. *New enquiry*: fill in date, customer, sales person, qty, POL/POD. The reference is issued automatically.
2. Once quoted, click *Mark quoted* in the register (sets today's date).
3. On confirmation, open the enquiry, enter the buy/sell rates (totals auto-calculate from rate × units) and the confirmation date. Profit is calculated automatically.
4. Mark dead enquiries as *Lost* (with a reason) so the follow-up lists stay clean.

**Excel upload (transition period, or bulk updates)**
1. *Import Excel*: choose the daily report or the monthly workbook. The app finds every sheet with the register header and pre-selects them, except `DATA*`.
2. *Analyse*: rows are validated and compared with the database. The preview shows **New**, **Changed** (field by field, old → new), **Unchanged** and **Errors / warnings**.
3. *Import*: new and changed rows are written, and the original file is stored in Supabase Storage. The batch then appears in *Recent imports* and in each enquiry's history.

---

## 5. Phase-by-phase implementation plan

Status key: ✅ done · 🟡 code written, not yet run or verified · ⬜ not started

### Phase 0 — Environment & accounts (½ day) ⬜
| Task | Detail |
|---|---|
| Install tools on the dev PC | Node.js 22 LTS, Git; the Supabase CLI runs via `npx supabase` |
| GitHub repo | Create a private repo `enquiry-tracker`; push this folder; protect `main` (PR + passing CI) |
| Supabase | Project exists ✅. In Auth settings: disable public sign-ups; set Site URL to the Pages URL; add `http://localhost:5173` to redirect URLs |
| Cloudflare Pages | *Workers & Pages → Create → Pages → Connect to Git* → repo; build `npm run build`, output `dist`; env vars `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `NODE_VERSION=22` |
| **Done when** | `npm run dev` works locally and the empty app deploys to `*.pages.dev` |

### Phase 1 — Database foundation (1 day) ✅
Applied to Supabase on 2026-11-02 (migrations `20261102162701_initial_schema`, `20261102162837_lock_trigger_functions`). Sales persons are seeded. A rolled-back smoke test passed: references, subject prefix, profit/status, import upsert with blank-preserving, audit, reports, and RLS for editor/viewer/anon. The security advisor shows only expected items. Remaining for this phase: invite the first admin.

| Task | Detail |
|---|---|
| Schema migration | Tables, generated `status` / `profit`, indexes, `enquiry_register` view |
| Security | RLS on every table; roles via `profiles`; RPCs granted to `authenticated` only; `imports` storage bucket |
| Integrity | Atomic reference generator, audit trigger, name normalisation (`name_key`) |
| Seed | `supabase/seed.sql`: sales persons |
| **Done when** | Migration applied; Supabase security advisor shows no errors; first admin user invited and promoted |

### Phase 2 — Core app: register + manual entry (2–3 days) 🟡
Typecheck, 39 unit tests and production build pass (2026-11-03). Runs locally against Supabase. The screens behind the login are not yet clicked through, because that needs the first user account.

| Task | Detail |
|---|---|
| Auth | Login, password reset / set password, role-aware UI (viewers read-only) |
| Register | Filter by date range (enquiry / quoted / confirmed date), status, sales person, mode, free-text search; pagination; export to Excel in the company layout |
| Entry form | Auto reference, "Today" buttons, qty parser (mode/units/container type), auto totals, profit, subject generator, lost/cancelled with reason, warnings (e.g. confirmed without sell), change history |
| Quick actions | *Mark quoted* from the register; *Confirm* opens the form with today's date pre-filled |
| Dashboard | Today and month-to-date: enquiries, quoted, confirmed, profit, conversion; follow-up lists (awaiting quote / awaiting confirmation, last 30 days); sales-person table for the month |
| **Done when** | A user can record a full day's enquiries and confirmations without Excel; deployed on Pages |

### Phase 3 — Excel import + historical load (2 days) 🟡
Dry run of the importer on the real workbooks (`npm run check-workbook -- <file>`, 2026-11-03), from `MONTHLY ENQUIRIES 2026 FINAL.1.xlsx`: 2,770 rows parsed, 2,768 importable, 2 excluded (`SL262421` reused for two customers), 223 empty pre-numbered rows ignored.
- Enquiry / quoted / confirmed counts and buy / sell totals per month equal the Excel figures in §1.3. The only differences are the two excluded rows and the merged `SL262664`.
- Profit differs where column N was typed by hand. See §1.5.

| Task | Detail |
|---|---|
| Importer | Sheet detection, tolerant parsing (§1.4), cross-sheet de-duplication, diff preview, chunked transactional commit, original file archived, batch history |
| Historical load | Import JAN–NOV from the monthly workbook. Then fix the errors it reports (duplicate refs) in Excel or in the app |
| Reconciliation | Compare app monthly totals with §1.3, sheet by sheet; investigate every difference |
| **Done when** | All 2026 data is in the app and the monthly totals match the Excel figures |

### Phase 4 — Reports & exports (2–3 days) 🟡
Written 2026-11-04 (*Reports* menu). Migration `20261104180409_report_functions` is applied to Supabase. It was smoke-tested in a rolled-back transaction: hand-checked totals, cancelled enquiries excluded, and no access for `anon`. Typecheck, 53 unit tests and the production build pass. A unit test feeds every report export back through the importer. The screens and exports were checked in a browser against a mocked backend. They have not yet been checked against real data, which needs the historical import and a login.
- **Daily / weekly / monthly reports.** Enquiries raised in the period, then the earlier enquiries confirmed in it, plus counts, sales and profit. Weekly and monthly reports add the sales-person table and shipment-mode totals.
- **Excel exports.** They use the register layout, with the old section titles (`PREVIOUS DAY'S` / `LAST WEEK'S` / `LAST MONTH'S CONFIRMATION`) and the `NO. OF ENQUIRIES` / `NO. OF CONFIRMATIONS` footer. Sheet names follow the old workbooks: `01.11`, `DATA1` + `DATA`, and `OCT` + `DATA`.
- **The earlier-confirmations section** lists only enquiries confirmed in the period, not the whole open backlog (see open question 5).
- **Cancelled enquiries** are listed but not counted, as in the sales-person summary.
- **Analytics.** Monthly trend, and a breakdown by sales person, customer, agent, lane, shipment mode or trade type.
  - The trend's columns for enquiries raised in each month (enquiries, quoted, confirmed, profit) are counted the same way as the §1.3 table, so they can be used for the Phase 3 reconciliation.

| Task | Detail |
|---|---|
| Daily report | Date picker → that day's enquiries + earlier enquiries confirmed that day + footer counts; Excel export in the current `Daily Report` layout |
| Weekly report | Range picker (default Sat–Fri) → `DATA`-sheet table: per sales person total inquiries, confirmed, NEW+OLD, FCL, units, AIR, LCL, COURIER, profit; mode totals |
| Monthly report | Month sheet + "LAST MONTH'S CONFIRMATION" section; Excel export |
| Analytics | Conversion by sales person / customer / lane (POL→POD) / agent; profit trend by month; top customers |
| **Done when** | Management stops requesting the Excel reports because the app's reports and exports replace them |

### Phase 5 — Data quality & follow-up (2 days) ⬜
| Task | Detail |
|---|---|
| Master-data screens | Customers / agents / sales persons: rename, deactivate, **merge duplicates** (moves enquiries, records alias so future imports map automatically) |
| Duplicate finder | `pg_trgm` similarity to suggest likely duplicates (e.g. `SYNERGIES CASTING` vs `SYNERGIES CASTINGS`) |
| Ports | Port master + normalisation (`NHAVA SHEVA` → `NHAVA-SHEVA INDIA`) |
| Follow-ups | Quoted > N days without confirmation → reminder list / optional daily e-mail (Supabase scheduled Edge Function); bulk "mark lost" for stale quotes |
| Commission | Parse `COMMISSION OMR 40/CNTR.` into structured `commission_amount`, `commission_currency`, `commission_per_unit` |

### Phase 6 — Hardening, rollout & cut-over (1–2 days + 2-week parallel run) ⬜
| Task | Detail |
|---|---|
| Users | Invite all staff; admin screen for roles; optionally restrict sales users to their own enquiries |
| Backups | Supabase daily backups (Pro plan, or PITR) + nightly CSV export via a GitHub Action |
| CI/CD | Migrations applied from GitHub Actions on merge to `main` (`supabase db push`), Cloudflare preview deployments for PRs |
| Tests | Unit tests for parser/normaliser (written); Playwright smoke test for login → add → import |
| Parallel run | 2 weeks: the app issues references. Excel is updated by import/export only. Reconcile daily counts |
| Cut-over | Freeze the Excel workbook (read-only archive), app becomes the system of record |

**Rough total:** about 2½–3 weeks of development, then the two-week parallel run.

---

## 6. Open questions (please confirm)

1. **Currency of BUY/SELL/PROFIT.** The app assumes **USD**, because the commission notes say "OMR …" or "USD …" explicitly. Change `enquiries.currency` default if it is OMR.
2. **Week definition** for the weekly report. `DATA1` used 24.10–30.10 (Saturday–Friday).
3. **Who may edit?** Default: `editor` can add/edit everything, `viewer` read-only, only `admin` can delete. Should sales staff only see/edit their own enquiries?
4. **Reference issuing during the parallel run.** Once the app is live, references should be issued by the app only. Otherwise Excel and the app will hand out the same number twice.
5. **"PREVIOUS DAY'S CONFIRMATION" section** of the daily report. It lists the whole backlog of earlier open enquiries, not only those confirmed the previous day. Should the app's daily report do the same, or show only enquiries updated that day?
6. `SL2655xx` references in `Sheet1`: a separate series, or scratch data that can be ignored?
7. `SL262421` and `SL262664` are used twice. Which row keeps the reference?
