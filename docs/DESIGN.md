# Design guide

Rules for every screen of the Enquiry Tracker. The register (`src/pages/RegisterPage.tsx`) is the reference implementation.

**Goal:** a compact, calm enterprise tool. It should be easy to read, make the next action obvious, and fit a lot on one screen without feeling crowded.

## Where things live

| What | File |
|---|---|
| Tokens: colours, type scale, radii | `src/index.css` (`@theme`). Tailwind turns each one into a utility. |
| Buttons, inputs, fields, cards, status badges, alerts, empty states | `src/components/ui.tsx` |
| Icons, app logo | `src/components/icons.tsx` (stroke icons on a 24 px grid, after Lucide) |
| Dropdown menus (account, row overflow, column chooser) | `src/components/Menu.tsx` |
| Modal dialogs (merge customers, rename) | `src/components/Dialog.tsx` |
| Toolbar select box | `src/components/SelectBox.tsx` |
| Display rules: names, ports, dates, waiting time, next step | `src/lib/display.ts` |
| Register URL state, periods, columns | `src/lib/registerView.ts` |

Never hard-code a hex value or a pixel font size in a component. Use a token, or add one here and in `index.css`.

## Typography

**Inter** (variable), self-hosted from `@fontsource-variable/inter`, with `system-ui, sans-serif` as fallbacks. Sizes are in rem on a 16 px root.

| Use | Utility | Size / line height | Weight |
|---|---|---|---|
| Application name | `text-app` | 17 / 24 px | 600 |
| Navigation | `text-body` | 14 / 20 | 500, active 600 |
| Table content, customer names (600), profit (600) | `text-body` | 14 / 20 | 400 |
| Drawer and panel titles | `text-title` | 16 / 24 | 600 |
| Buttons, filter controls, enquiry references (600) | `text-control` | 13 / 20 | 500 |
| Dates, routes, agents, column headings (500), status labels and counts (500) | `text-meta` | 13 / 18 | 400 |

- **Case and spacing:** sentence case everywhere and normal letter spacing. No all-caps labels or headings, and no condensed or monospace faces.
- **Figures:** `tabular-nums` for amounts, references, dates in columns and counts. Large standalone numbers (stat tiles) keep proportional figures.
- **Upper-case data:** names stored in capitals (from Excel) are shown in title case with `displayName()`. Exports and form inputs keep the stored spelling.

## Colour

| Token (`bg-*` / `text-*` / `border-*`) | Value | Use |
|---|---|---|
| `page` | `#F7F8FB` | Page background |
| `surface` | `#FFFFFF` | Table, toolbar, navigation, drawer, cards |
| `ink` | `#19243B` | Main text |
| `ink-muted` | `#526075` | Secondary text (6.2:1 on white) |
| `ink-heading` | `#344056` | Column headings, inactive navigation and tabs |
| `primary` / `primary-hover` | `#5546D9` / `#4435BC` | Primary buttons, active navigation, links, selection |
| `selected` | `#F1EEFF` | Selected row, active count badge, avatar |
| `row-hover` | `#F6F8FC` | Row and menu hover |
| `table-head` | `#F5F6FA` | Table header, inactive count badges |
| `line` | `#E2E6EF` | Decorative borders and row dividers |
| `control` | `#7C8798` | Outlines that must stay visible: inputs and outline buttons (3.6:1) |
| `focus` | `#5546D9` | Keyboard focus ring (2 px, offset 2 px, global `:focus-visible`) |
| `danger` / `danger-hover` | `#B42318` / `#912018` | Destructive buttons |

**Status colours.** Status is always shown as text plus an icon, never colour alone.

| Status (stored value) | Label | Icon | Text / icon | Background | Tab dot |
|---|---|---|---|---|---|
| `new` | Awaiting quote | clock | `#92400E` | `#FFFBEB` | `#D97706` |
| `quoted` | Quoted | send | `#5B21B6` | `#F3E8FF` | `#5546D9` |
| `confirmed` | Confirmed | check | `#166534` | `#F0FDF4` | `#16A34A` |
| `lost` | Lost | ✕ | `#991B1B` | `#FEF2F2` | `#DC2626` |
| `cancelled` | Cancelled | ban | `#526075` | `#F1F3F7` | `#8A94A6` |

- **Neutral by default:** keep most surfaces neutral. Strong violet is for the primary action, the active navigation item, links and selection markers only.
- **Contrast:** text pairs meet WCAG AA, 4.5:1 or better (see the table values). Don't use grey lighter than `ink-muted` for text.

## Spacing and size

| Element | Size |
|---|---|
| Top navigation | 56 px (`h-14`), sticky, white, bottom border |
| Status tab strip | 48 px (`h-12`) |
| Filter toolbar | one row of 36 px controls, wrapping when narrow |
| Inputs, selects, standard buttons | 36 px (`h-9`), radius 6 px (`rounded-control`) |
| Small buttons | 32 px (`size="sm"`), for compact places only |
| Icon buttons | at least 32 × 32 px (`IconButton`) |
| Table header | 40 px, sticky |
| Table rows | about 56 px for two lines; may grow |
| Cell padding | 12 px horizontally (first cell 16 px) |
| Pagination footer | about 48 px |
| Panels and the table | radius 10 px (`rounded-panel`), 1 px `line` border, no shadow |
| Gaps | 8 px between controls (`gap-2`), 12–16 px between regions (`space-y-3`, `gap-4`) |
| Page | full width, 20 px side padding (`px-5`) |

Shadows are only for things that float: menus, the drawer when it overlays, and the toast.

## Components

### Navigation
- **Left:** logo and application name, then Dashboard, Register, Follow-ups, Reports, Inbox and Customers, each with an icon. The active item has 600 weight, violet text and a 2 px violet underline.
- **Right:** Import (editors only), Export (on the Register page; it exports the filtered view), New enquiry (the one filled primary button), then the avatar menu (account, sign out).
- **Narrow screens:** labels collapse to icons, and their accessible names stay. Navigation labels show from 1024 px, Import and Export labels from 1280 px. Below 640 px the bar has a 16 px gutter, and on the narrowest phones the navigation icons scroll inside the bar instead of widening the page.

### Page structure (list pages)
- **Order:** top navigation, then status tabs, then the toolbar, then one table surface, then pagination inside that surface.
- **No extras:** no page heading, breadcrumb or introduction. The active navigation item names the page.
- **No nested cards:** the tabs and toolbar sit on the page background, not in cards.

### Status tabs
- **Look:** text tabs with a small status dot and a count badge. The active tab has 600 weight, a 2 px violet underline and a violet count badge.
- **Counts:** real counts under the other filters. The status filter itself is ignored, so every tab shows what clicking it would give.
- **Right-hand side:** the number of enquiries in the current view, and a small spinner while it refreshes.

### Toolbar
- **Order:** search first (it applies as you type, after a pause, or on Enter), then date basis, period, sales person and shipment.
- **Reset:** appears only when a filter differs from the default.
- **Columns:** lets each viewer hide optional columns. The choice is stored in that browser.
- **Only working controls:** add a control only if it does something. There is no "Filters" button, because every filter is already visible.
- **Periods:** each period is an exact, inclusive date range (`periodRange()`): All dates, Today, This week (Saturday to Friday), This month, Last month, This year, or Custom range. "This month" in November never contains an October date, whichever date basis is chosen.

### Tables
- **Register columns:** Enquiry, Customer, Route, Shipment, Status, Sales & agent, Profit, Next step, then the ⋯ menu. Customer, Route and Status get the most width, and Profit is narrow and right-aligned.
- **Two-line cells:** reference over date, customer over (when the Route column is hidden) route, shipment over direction, status badge over waiting time, sales person over agent, profit over "on <sell total>".
- **Lines:** fine horizontal dividers (`line`) and no vertical gridlines.
- **Header:** `table-head` background, 13 px, 500 weight, `ink-heading` colour, sticky inside the scrolling body. Use `border-separate border-spacing-0` so the sticky header keeps its border.
- **Hover:** `row-hover` background.
- **Selection:** `selected` background, a 3 px violet marker on the left edge, a chevron in place of the ⋯ menu, a filled next-step button and `aria-current`. Hover and selection must look different.
- **No decoration:** no icon repeated in every cell. Avatars are 24 px, neutral grey, and show initials.
- **Scrolling tables:** a wrapper that scrolls a table sideways is `relative`, so screen-reader-only text in the table is positioned inside it and cannot widen the page. To hide a `Button` at some widths, put the visibility classes on a wrapper: the button's own `inline-flex` beats `hidden`.
- **Narrow tables:** optional columns hide by the table's own width (container queries), so opening the drawer adjusts the table too. They go in this order: Sales & agent below 1040 px, Shipment below 880, Route below 720 (the route then shows under the customer), Profit below 600, Next step below 560, and Status below 460 (the badge then shows under the customer). Nothing is lost: everything is in the drawer.

### Status and waiting time
- **Two separate pieces:** the badge says what state an enquiry is in. The line under it says how long it has waited ("Received today", "Waiting 3 days"), when it was confirmed, or why it closed.
- **Long waits:** a wait of `LONG_WAIT_DAYS` (7) or more gets a compact amber clock label.
- **No "overdue":** don't call anything overdue until a real deadline is configured.

### Actions
- **One next step per row:** Mark quoted (awaiting quote), Confirm job (quoted), or View details. Read-only users always get View details.
- **Button styles:** routine row actions use the outline (`secondary`) button. Filled violet is for the selected row's action and the page's primary action.
- **Overflow menu:** secondary actions go in the ⋯ menu: View details, Edit enquiry, Confirm job… (when not yet quoted), and Copy reference.
- **While saving:** the button shows a spinner and "Saving…", and other rows' Mark quoted buttons are disabled until it finishes.
- **Keep existing behaviour:** Confirm job opens the enquiry form with today's confirmation date filled in, as before. Validation, permissions (viewer, editor, admin) and confirmation prompts stay as they are.

### Details drawer
- **Opening:** a row, its reference or View details opens a 380 px drawer. The open drawer is in the URL (`sel=`), so it survives a reload and can be shared.
- **Wide screens (1280 px and up):** it sits beside the table, and closing it gives the table its full width back. Below that it floats over the page from the right.
- **Contents:** reference and status, customer, subject, progress (enquiry, quote, confirmation or closure), job details, rates and remarks. The footer holds the next step and Edit enquiry / Open full record.
- **Keyboard:** focus moves to the drawer title on open. Escape or the ✕ closes it, and focus returns to the row's reference.

### Menus
- **Placement:** they open in a portal, so a scrolling table cannot clip them. They sit right-aligned under the trigger and flip upwards near the bottom of the screen.
- **Keyboard:** Enter or Space opens, arrows and Home/End move, Escape closes and returns focus to the trigger, Tab leaves.
- **Checkbox items** (the column chooser) stay open when toggled.

### Dialogs
- **Element:** the native `<dialog>` through `Dialog`: focus stays inside, Escape and ✕ close it (not while saving), and focus returns to the button that opened it.
- **Layout:** title bar, body, then a footer with Cancel (outline) and the one primary action on the right. Errors appear inside the dialog, above the footer.
- **Use for:** decisions that need input or confirmation before a change that is hard to undo (merging customers, renaming). Not for information that could sit on the page.

### Customers page
- **Tabs:** *Possible duplicates* (default) and *All customers*, styled like the status tabs, with counts under the search.
- **Duplicate groups:** one table. Each group is a row group whose header says why the names match ("same name apart from punctuation or legal form", "similar spelling") and holds *Not the same* (ghost) and *Merge…* (outline). Every name starts ticked; unticking one turns the button into "Merge 2 ticked…".
- **Merge dialog:** choose the customer to keep (most enquiries by default), optionally correct its name, and read what moves where before confirming.
- **Counts link to the register**, searched for that customer over all dates.

### Follow-ups page
- **Tabs by age:** quoted 14–30 days ago (default), 31–90 days, over 90 days, not quoted. Counts follow the search and sales-person filter, like the status tabs.
- **Rows:** reference over the quote date, customer over route, sales person, quote amount, waiting days, then *Confirm job* (outline) and the ⋯ menu (Confirm job, Mark lost…, Edit enquiry). Below 860 px of table width, *Confirm job* moves into the menu.
- **Bulk:** the header tick box selects the page; *Select all N* selects the whole tab. *Mark lost…* opens a dialog with one reason (suggestions, free text). After saving, a success alert offers *Undo*; it stays until dismissed.
- **Sales users** see their own enquiries first (`sp` in the URL overrides it).

### Feedback states
- **Loading:** skeleton rows on first load. On refetch the previous rows stay in place at 60 % opacity, with no layout jump.
- **Empty:** say why the list is empty and offer the way out: "Clear all filters", or "New enquiry" and "Import Excel" when there is no data at all.
- **Errors:** an alert above the table with what failed and a "Try again" button. Action errors name the enquiry.
- **Success:** a short toast at the bottom ("SL261205 marked as quoted today."), announced to screen readers.

## Display rules

| Value | Rule | Example |
|---|---|---|
| Customer, agent, sales person | `displayName()`: title case, keeping initials and company suffixes | `JA SUPPLY` → JA Supply, `A.V. FREIGHT` → A.V. Freight |
| Port in the Route column | `shortPort()`: country dropped (the full name is in the tooltip and drawer) | `JEBEL ALI UAE` → Jebel Ali |
| Dates on screen | `fmtDateLong()` / `fmtDayMonth()` | 04 Nov 2026, 04 Nov |
| Dates in Excel exports and reports | `fmtDate()`, the register's house format | 04.11.2026 |
| FCL shipments | container count with a multiplication sign | 2×20' |

## Accessibility

- **Real controls:** use real `<button>`, `<a>`, `<label>` and `<select>` elements. Icon-only buttons get an `aria-label`. `Field` wraps its one control in a `<label>`, so the field caption is the control's accessible name; a link that shows only a number gets an `aria-label` that says what it counts.
- **Focus:** keep the global `:focus-visible` ring (2 px violet). Never remove an outline without replacing it.
- **Not colour alone:** status always has a label and an icon, and selection has a marker, a chevron and `aria-current`.
- **Contrast:** at least 4.5:1 for text and 3:1 for control outlines and meaningful graphics.
- **Size and zoom:** text is never smaller than 13 px. Interfaces must stay usable at 200 % zoom, with vertical scrolling allowed.
- **Motion:** `prefers-reduced-motion` turns transitions off. Keep transitions to 150 ms colour and opacity changes.

## Checklist for a new screen

1. Uses only tokens and the shared components above, with no stock Tailwind greys or hex values.
2. Has one primary (filled violet) action at most, with everything else as outline, ghost or menu actions.
3. Shows loading, empty, error and success states.
4. Works at 1366×768, 1440×900 and 1920×1080, and at phone width without horizontal page scrolling.
5. Can be used by keyboard alone, with focus always visible.
