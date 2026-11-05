import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { ConfidenceBadge, EmailView, Pill, shownName } from "../components/EmailView";
import { Icon } from "../components/icons";
import { Alert, Button, Card, Empty, IconButton, Spinner, buttonClass, inputClass } from "../components/ui";
import {
  checkMailNow,
  createEnquiryFromDraft,
  dismissDraft,
  draftFromEmail,
  fetchDraftDuplicates,
  fetchEmails,
  fetchInboxCounts,
  fetchNames,
  fetchPendingDrafts,
  linkEmail,
  searchEmails,
  mergeDraft,
  setEmailIgnored,
  suggestCustomers,
} from "../lib/api";
import { fmtDateLong } from "../lib/display";
import { dayLabel, decodeEntities, muscatTime, rowSubject } from "../lib/conversations";
import { Conversations } from "./inbox/Conversations";
import { draftToPayload, muscatDate } from "../lib/emailDrafts";
import { errorMessage, fmtDateTime } from "../lib/format";
import type { EmailListItem, EmailStatus, EnquiryDraft, InboxCounts, SyncResult } from "../lib/types";

type Tab = "drafts" | "review" | "awaiting" | "linked" | "ignored";

/** Each tab's colour: `dot` on the plain pill, `on` when it is the open tab, `count` for its number. */
const LANE: Record<Tab, { dot: string; on: string; count: string }> = {
  drafts: { dot: "bg-primary", on: "bg-primary text-white", count: "text-primary" },
  review: { dot: "bg-await-dot", on: "bg-await text-white", count: "text-await" },
  awaiting: { dot: "bg-lane-wait", on: "bg-lane-wait text-white", count: "text-lane-wait" },
  linked: { dot: "bg-lane-mail", on: "bg-lane-mail text-white", count: "text-lane-mail" },
  ignored: { dot: "bg-cancelled-dot", on: "bg-cancelled text-white", count: "text-cancelled" },
};

const TABS: { key: Tab; label: string; count?: (c: InboxCounts) => number; hint: string }[] = [
  {
    key: "drafts",
    label: "New enquiries",
    count: (c) => c.drafts,
    hint: "New enquiries found in the mailbox, oldest first. Check the details and create them in the register.",
  },
  {
    key: "review",
    label: "Needs review",
    count: (c) => c.review,
    hint: "E-mails the system could not file with confidence. Link each to its enquiry, turn it into a new enquiry, or ignore it.",
  },
  {
    key: "awaiting",
    label: "Waiting for reference",
    count: (c) => c.awaiting,
    hint: "E-mails citing an SL reference that is not in the register yet. They are linked automatically as soon as that enquiry is entered or imported.",
  },
  {
    key: "linked",
    label: "Follow-up e-mails",
    hint: "E-mails filed to existing enquiries, one conversation per enquiry. Pick a day or search to go back in time.",
  },
  {
    key: "ignored",
    label: "Ignored",
    hint: "Newsletters, invoices, notices and other mail that is not about an enquiry. Click a row to read it or move it back to review.",
  },
];

const STATUS_OF_TAB: Record<Exclude<Tab, "drafts">, EmailStatus> = {
  review: "review",
  awaiting: "awaiting_enquiry",
  linked: "linked",
  ignored: "ignored",
};

const refClass = "font-semibold tabular-nums text-primary hover:text-primary-hover hover:underline";

function invalidateAll(qc: QueryClient) {
  for (const key of ["inbox", "register", "dashboard", "window", "names", "enquiry-emails"]) qc.invalidateQueries({ queryKey: [key] });
}

function syncSummary(r: SyncResult): string {
  if (r.skipped) return r.skipped;
  const parts = [
    r.draft ? `${r.draft} new enquir${r.draft === 1 ? "y" : "ies"}` : null,
    r.linked ? `${r.linked} follow-up${r.linked === 1 ? "" : "s"}` : null,
    r.review ? `${r.review} to review` : null,
    r.awaiting_enquiry ? `${r.awaiting_enquiry} waiting for a reference` : null,
    r.ignored ? `${r.ignored} ignored` : null,
  ].filter(Boolean);
  const more = r.deferred ? ` ${r.deferred} more will follow in the next run.` : "";
  return parts.length ? `Checked: ${parts.join(", ")}.${more}` : `No new mail.${more}`;
}

export default function InboxPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.key === params.get("tab"))?.key ?? "drafts") as Tab;
  const { canEdit } = useAuth();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<ReactNode>(null);

  const counts = useQuery({ queryKey: ["inbox", "counts"], queryFn: fetchInboxCounts, refetchInterval: 60_000 });
  const mailbox = counts.data?.mailboxes[0] ?? null;

  const check = useMutation({
    mutationFn: checkMailNow,
    onSuccess: (r) => {
      setNotice(syncSummary(r));
      invalidateAll(queryClient);
    },
    onError: () => invalidateAll(queryClient),
  });

  const current = TABS.find((t) => t.key === tab)!;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <nav aria-label="Inbox" className="flex flex-wrap gap-2">
          {TABS.map((t) => {
            const n = t.count && counts.data ? t.count(counts.data) : null;
            const active = t.key === tab;
            return (
              <button
                key={t.key}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  setNotice(null);
                  setParams(t.key === "drafts" ? {} : { tab: t.key }, { replace: true });
                }}
                className={`inline-flex h-10 items-center gap-2 rounded-full px-3.5 text-body transition-colors duration-150 ${
                  active ? `${LANE[t.key].on} font-semibold` : "bg-surface font-medium text-ink ring-1 ring-inset ring-line hover:bg-row-hover"
                }`}
              >
                <span aria-hidden="true" className={`size-2 rounded-full ${active ? "bg-white" : LANE[t.key].dot}`} />
                {t.label}
                {n != null && <span className={`font-bold tabular-nums ${active ? "text-white" : LANE[t.key].count}`}>{n}</span>}
              </button>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {mailbox && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-meta ${
                mailbox.last_error ? "bg-await-bg text-await" : "bg-confirmed-bg text-confirmed"
              }`}
            >
              <span aria-hidden="true" className={`size-1.5 rounded-full ${mailbox.last_error ? "bg-await-dot" : "bg-confirmed-dot"}`} />
              {mailbox.email} · {mailbox.last_synced_at ? `last read ${fmtDateTime(mailbox.last_synced_at)}` : "not read yet"}
            </span>
          )}
          {canEdit && (
            <Button variant="secondary" loading={check.isPending} onClick={() => check.mutate()}>
              {!check.isPending && <Icon name="refresh" />}
              {check.isPending ? "Checking mail…" : "Check mail now"}
            </Button>
          )}
        </div>
      </div>

      {!counts.isLoading && !counts.error && !mailbox && (
        <Alert kind="info">The mailbox is not connected yet. Follow “E-mail intake” in the README; new mail is then read every few minutes.</Alert>
      )}
      {mailbox?.last_error && <Alert kind="warning">The last mail check reported a problem: {mailbox.last_error}</Alert>}
      {counts.error && <Alert>{errorMessage(counts.error)}</Alert>}
      {check.error && <Alert>Checking the mailbox failed. {errorMessage(check.error)}</Alert>}
      {notice && (
        <Alert
          kind="success"
          action={
            <Button variant="ghost" size="sm" onClick={() => setNotice(null)}>
              Dismiss
            </Button>
          }
        >
          {notice}
        </Alert>
      )}

      <p className="text-meta text-ink-muted">{current.hint}</p>

      {tab === "drafts" ? (
        <DraftList mailbox={mailbox?.email} onNotice={setNotice} />
      ) : tab === "linked" ? (
        <Conversations
          mailbox={mailbox?.email}
          onNotice={setNotice}
          listView={<EmailHistory status="linked" mailbox={mailbox?.email} onNotice={setNotice} />}
        />
      ) : tab === "ignored" ? (
        <EmailHistory key={tab} status={STATUS_OF_TAB[tab]} mailbox={mailbox?.email} onNotice={setNotice} />
      ) : (
        <EmailList status={STATUS_OF_TAB[tab]} mailbox={mailbox?.email} onNotice={setNotice} />
      )}
    </div>
  );
}

// --- New enquiries --------------------------------------------------------------

function DraftList({ mailbox, onNotice }: { mailbox?: string; onNotice: (n: ReactNode) => void }) {
  const drafts = useQuery({ queryKey: ["inbox", "drafts"], queryFn: fetchPendingDrafts, refetchInterval: 60_000 });
  if (drafts.isLoading) return <Spinner />;
  if (drafts.error)
    return (
      <Alert action={<Button variant="secondary" size="sm" onClick={() => drafts.refetch()}>Try again</Button>}>
        Loading the new enquiries failed. {errorMessage(drafts.error)}
      </Alert>
    );
  if (!drafts.data?.length) return <Empty>No new enquiries waiting. New ones appear here a few minutes after they arrive.</Empty>;
  return (
    <div className="space-y-3">
      {drafts.data.map((d, i) => (
        <DraftCard key={d.id} draft={d} mailbox={mailbox} onNotice={onNotice} first={i === 0} />
      ))}
    </div>
  );
}

function Detail({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="text-meta font-medium text-ink-heading">{label}</dt>
      <dd className="text-body text-ink">{children || <span className="text-ink-muted">—</span>}</dd>
    </div>
  );
}

function DraftCard({ draft, mailbox, onNotice, first }: { draft: EnquiryDraft; mailbox?: string; onNotice: (n: ReactNode) => void; first: boolean }) {
  const { canEdit } = useAuth();
  const queryClient = useQueryClient();
  const [customer, setCustomer] = useState(draft.customer_name ?? "");
  const [showEmails, setShowEmails] = useState(false);
  const f = draft.fields ?? {};
  const firstEmail = draft.emails[0];

  const customers = useQuery({ queryKey: ["names", "customers"], queryFn: () => fetchNames("customers"), staleTime: 300_000, enabled: canEdit });
  const suggestions = useQuery({
    queryKey: ["inbox", "suggest", draft.id],
    queryFn: () => suggestCustomers(draft.customer_name, draft.contact_email),
    staleTime: 300_000,
  });
  const duplicates = useQuery({ queryKey: ["inbox", "duplicates", draft.id], queryFn: () => fetchDraftDuplicates(draft.id) });

  const done = (message: ReactNode) => {
    onNotice(message);
    invalidateAll(queryClient);
  };
  const create = useMutation({
    mutationFn: () => createEnquiryFromDraft(draft.id, draftToPayload(draft, customer)),
    onSuccess: (row) =>
      done(
        <>
          Created{" "}
          <Link to={`/enquiries/${row.id}`} className={refClass}>
            {row.reference}
          </Link>{" "}
          for {shownName(customer)}. Reply to the customer with this reference in the subject, so follow-ups are filed automatically.
        </>,
      ),
  });
  const merge = useMutation({
    mutationFn: (reference: string) => mergeDraft(draft.id, reference),
    onSuccess: (r) =>
      done(
        <>
          The e-mails were added to{" "}
          <Link to={`/enquiries/${r.enquiry_id}`} className={refClass}>
            {r.reference}
          </Link>
          .
        </>,
      ),
  });
  const dismiss = useMutation({
    mutationFn: (reason: string | null) => dismissDraft(draft.id, reason),
    onSuccess: () => done("Marked as not an enquiry. The e-mails are under “Ignored”."),
  });
  const busy = create.isPending || merge.isPending || dismiss.isPending;
  const error = create.error ?? merge.error ?? dismiss.error;

  const typed = customer.trim().toUpperCase();
  const exact = suggestions.data?.find((s) => s.score >= 0.95 && s.name.toUpperCase() === typed);
  const similar = (suggestions.data ?? []).filter((s) => s.name.toUpperCase() !== typed);

  function askMerge(defaultRef = "") {
    const ref = window.prompt("Add these e-mails to which enquiry? (reference, e.g. SL262759)", defaultRef);
    if (ref?.trim()) merge.mutate(ref.trim());
  }
  function askDismiss() {
    const reason = window.prompt("Not an enquiry. Reason (optional):", "");
    if (reason !== null) dismiss.mutate(reason.trim() || null);
  }

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          <span>{shownName(draft.customer_name) || draft.contact_name || draft.contact_email || "Unknown sender"}</span>
          <ConfidenceBadge value={draft.confidence} />
          {draft.emails.length > 1 && <Pill className="bg-table-head text-ink-heading">{draft.emails.length} e-mails</Pill>}
        </span>
      }
      actions={<span className="text-meta tabular-nums text-ink-muted">Received {fmtDateTime(draft.received_at)}</span>}
    >
      <div className="space-y-3">
        {draft.summary && <p className="text-body text-ink">{draft.summary}</p>}
        {firstEmail?.note && <Alert kind="info">{firstEmail.note}</Alert>}

        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <dt className="mb-1 text-meta font-medium text-ink-heading">
              <label htmlFor={`customer-${draft.id}`}>Customer *</label>
            </dt>
            <dd>
              {canEdit ? (
                <input
                  id={`customer-${draft.id}`}
                  className={inputClass}
                  value={customer}
                  onChange={(e) => setCustomer(e.target.value.toUpperCase())}
                  list={`customers-${draft.id}`}
                  placeholder="Customer name"
                  autoComplete="off"
                />
              ) : (
                <span className="text-body text-ink">{shownName(customer) || "—"}</span>
              )}
              <datalist id={`customers-${draft.id}`}>
                {customers.data?.map((n) => <option key={n} value={n} />)}
              </datalist>
              <div className="mt-1 flex flex-wrap gap-x-2 text-meta text-ink-muted">
                {exact ? (
                  <span className="inline-flex items-center gap-1 text-confirmed">
                    <Icon name="check" className="size-3.5" />
                    Existing customer
                  </span>
                ) : typed ? (
                  <span>New customer{similar.length ? ". Or did you mean:" : ""}</span>
                ) : (
                  <span className="text-lost">Enter the customer before creating the enquiry{similar.length ? ". Suggestions:" : ""}</span>
                )}
                {!exact &&
                  similar.map((s) => (
                    <button key={s.id} type="button" className="text-primary hover:underline" disabled={!canEdit} onClick={() => setCustomer(s.name)}>
                      {shownName(s.name)}
                    </button>
                  ))}
              </div>
            </dd>
          </div>
          <Detail label="Contact">
            {[draft.contact_name, draft.contact_designation].filter(Boolean).join(", ")}
            {draft.contact_email && <div className="text-meta text-ink-muted">{draft.contact_email}</div>}
            {draft.contact_phone && <div className="text-meta text-ink-muted">{draft.contact_phone}</div>}
          </Detail>
          <Detail label="Sales person">{shownName(draft.sales_person_name)}</Detail>
          <Detail label="Route">{[f.pol, f.pod].some(Boolean) ? `${shownName(f.pol) || "?"} → ${shownName(f.pod) || "?"}` : null}</Detail>
          <Detail label="Shipment">
            {[f.qty_text, f.shipment_mode && f.shipment_mode !== f.qty_text ? f.shipment_mode : null, f.trade_type].filter(Boolean).join(" · ")}
          </Detail>
          <Detail label="Enquiry date">{fmtDateLong(f.enquiry_date)}</Detail>
          <Detail label="Incoterm">{f.incoterm}</Detail>
          <Detail label="Subject" wide>
            {f.subject && (
              <span title="The reference is added when the enquiry is created">
                <span className="text-ink-muted">SL…</span> {f.subject}
              </span>
            )}
          </Detail>
          {draft.requirements && (
            <Detail label="Requirements" wide>
              <span className="whitespace-pre-wrap">{draft.requirements}</span>
            </Detail>
          )}
        </dl>

        {!!duplicates.data?.length && (
          <Alert kind="warning">
            <div className="mb-1 font-medium">This may already be in the register:</div>
            <ul className="space-y-1">
              {duplicates.data.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2">
                  <Link to={`/enquiries/${d.id}`} className="font-semibold tabular-nums underline">
                    {d.reference}
                  </Link>
                  <span>
                    {fmtDateLong(d.enquiry_date)} · {d.subject ?? shownName(d.customer_name)}
                    {d.same_route && " · same route"}
                  </span>
                  {canEdit && (
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => askMerge(d.reference)}>
                      Add e-mails to {d.reference}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Alert>
        )}
        {error && <Alert>{errorMessage(error)}</Alert>}

        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <>
              <Button
                variant={first ? "primary" : "secondary"}
                loading={create.isPending}
                disabled={busy || !customer.trim()}
                onClick={() => create.mutate()}
                title="Create the enquiry with the details shown"
              >
                {!create.isPending && <Icon name="check" />}
                {create.isPending ? "Creating…" : "Create enquiry"}
              </Button>
              <Link to={`/enquiries/new?draft=${draft.id}`} className={buttonClass("secondary")}>
                <Icon name="edit" />
                Review & edit
              </Link>
              <Button variant="secondary" disabled={busy} onClick={() => askMerge()}>
                Add to existing enquiry…
              </Button>
              <Button variant="ghost" disabled={busy} onClick={askDismiss}>
                Not an enquiry
              </Button>
            </>
          )}
          <Button variant="ghost" className="ml-auto" aria-expanded={showEmails} onClick={() => setShowEmails(!showEmails)}>
            {showEmails ? "Hide e-mail" : `Show e-mail${draft.emails.length > 1 ? `s (${draft.emails.length})` : ""}`}
          </Button>
        </div>

        {showEmails && (
          <div className="space-y-2">
            {draft.emails.map((m) => (
              <EmailView key={m.id} email={m} mailbox={mailbox} showSummary={draft.emails.length > 1} />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

// --- Other tabs -----------------------------------------------------------------

function EmailList({ status, mailbox, onNotice }: { status: EmailStatus; mailbox?: string; onNotice: (n: ReactNode) => void }) {
  const emails = useQuery({ queryKey: ["inbox", "emails", status], queryFn: () => fetchEmails(status), refetchInterval: 60_000 });
  if (emails.isLoading) return <Spinner />;
  if (emails.error)
    return (
      <Alert action={<Button variant="secondary" size="sm" onClick={() => emails.refetch()}>Try again</Button>}>
        Loading the e-mails failed. {errorMessage(emails.error)}
      </Alert>
    );
  if (!emails.data?.length) return <Empty>Nothing here.</Empty>;
  return (
    <div className="space-y-3">
      {emails.data.map((m) => (
        <EmailCard key={m.id} email={m} mailbox={mailbox} onNotice={onNotice} />
      ))}
    </div>
  );
}

// --- Follow-ups and Ignored: the full history as a compact, searchable list -------

const PAGE_SIZE = 50;

function EmailHistory({ status, mailbox, onNotice }: { status: EmailStatus; mailbox?: string; onNotice: (n: ReactNode) => void }) {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const sender = (params.get("sender") ?? "") as "" | "external" | "staff";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const page = Math.max(0, Number(params.get("page") ?? 1) - 1) || 0;
  const [typed, setTyped] = useState(q);
  const [open, setOpen] = useState<string | null>(null);

  function update(changes: Record<string, string>, keepPage = false) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!keepPage) next.delete("page");
    setParams(next, { replace: true });
    setOpen(null);
  }

  // Search as you type, once typing pauses.
  useEffect(() => {
    if (typed.trim() === q) return;
    const t = setTimeout(() => update({ q: typed.trim() }), 350);
    return () => clearTimeout(t);
  }, [typed]);

  const search = { status, q, sender, from, to, page, pageSize: PAGE_SIZE };
  const emails = useQuery({
    queryKey: ["inbox", "history", search],
    queryFn: () => searchEmails(search),
    placeholderData: keepPreviousData,
    refetchInterval: page === 0 ? 60_000 : false,
  });

  // The server fell back to page 1: make the address say so too.
  useEffect(() => {
    if (emails.data?.outOfRange) update({}, false);
  }, [emails.data?.outOfRange]);

  const total = emails.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(q || sender || from || to);
  const today = muscatDate(new Date().toISOString());

  const groups: { day: string; rows: EmailListItem[] }[] = [];
  for (const m of emails.data?.rows ?? []) {
    const day = muscatDate(m.received_at);
    if (groups.at(-1)?.day !== day) groups.push({ day, rows: [] });
    groups.at(-1)!.rows.push(m);
  }

  const pager = (
    <div className="flex items-center gap-1">
      <IconButton icon="chevronLeft" label="Newer e-mails" disabled={page === 0} onClick={() => update({ page: page > 1 ? String(page) : "" }, true)} />
      <span className="min-w-24 text-center text-meta tabular-nums text-ink-heading">
        Page {page + 1} of {pages.toLocaleString("en-GB")}
      </span>
      <IconButton icon="chevronRight" label="Older e-mails" disabled={page + 1 >= pages} onClick={() => update({ page: String(page + 2) }, true)} />
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="relative min-w-60 flex-1 sm:max-w-md">
          <span className="sr-only">Search e-mails</span>
          <Icon name="search" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-muted" />
          <input
            type="search"
            className={`${inputClass} pl-8`}
            placeholder="Search subject, sender or SL reference"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        </label>
        <div role="group" aria-label="Sender" className="inline-flex rounded-control ring-1 ring-inset ring-control">
          {(
            [
              ["", "All"],
              ["external", "External"],
              ["staff", "Colleagues"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={label}
              type="button"
              aria-pressed={sender === value}
              onClick={() => update({ sender: value })}
              className={`h-9 px-3 text-control font-medium first:rounded-l-control last:rounded-r-control ${
                sender === value ? "bg-selected text-primary" : "text-ink-heading hover:bg-row-hover"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-meta text-ink-heading">
          From
          <input type="date" className={`${inputClass} w-36`} value={from} max={to || undefined} onChange={(e) => update({ from: e.target.value })} />
        </label>
        <label className="flex items-center gap-1.5 text-meta text-ink-heading">
          To
          <input type="date" className={`${inputClass} w-36`} value={to} min={from || undefined} onChange={(e) => update({ to: e.target.value })} />
        </label>
        {filtered && (
          <Button
            variant="ghost"
            onClick={() => {
              setTyped("");
              update({ q: "", sender: "", from: "", to: "" });
            }}
          >
            <Icon name="close" />
            Clear
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-meta text-ink-muted" aria-live="polite">
          {emails.isLoading
            ? "Loading…"
            : `${total.toLocaleString("en-GB")} e-mail${total === 1 ? "" : "s"}${filtered ? " match" : ""}${
                total > PAGE_SIZE ? ` · showing ${(page * PAGE_SIZE + 1).toLocaleString("en-GB")}–${Math.min(total, (page + 1) * PAGE_SIZE).toLocaleString("en-GB")}` : ""
              }`}
          {emails.isFetching && !emails.isLoading && <span className="ml-2">Updating…</span>}
        </p>
        {total > PAGE_SIZE && pager}
      </div>

      {emails.error ? (
        <Alert action={<Button variant="secondary" size="sm" onClick={() => emails.refetch()}>Try again</Button>}>
          Loading the e-mails failed. {errorMessage(emails.error)}
        </Alert>
      ) : emails.isLoading ? (
        <Spinner />
      ) : !groups.length ? (
        <Empty>{filtered ? "No e-mails match. Try fewer words or a wider date range." : "Nothing here yet."}</Empty>
      ) : (
        <div className={`overflow-hidden rounded-panel border border-line bg-surface ${emails.isPlaceholderData ? "opacity-60" : ""}`}>
          {groups.map((g) => (
            <section key={g.day} aria-label={dayLabel(g.day, today)}>
              <h3 className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-table-head px-3 py-1.5 text-meta font-semibold text-ink-heading">
                {dayLabel(g.day, today)}
                <span className="font-normal text-ink-muted tabular-nums">{g.rows.length}</span>
              </h3>
              <ul className="divide-y divide-line">
                {g.rows.map((m) => (
                  <HistoryRow
                    key={m.id}
                    email={m}
                    open={open === m.id}
                    onToggle={() => setOpen(open === m.id ? null : m.id)}
                    mailbox={mailbox}
                    onNotice={onNotice}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {total > PAGE_SIZE && !emails.isLoading && <div className="flex justify-end">{pager}</div>}
    </div>
  );
}

function HistoryRow({
  email,
  open,
  onToggle,
  mailbox,
  onNotice,
}: {
  email: EmailListItem;
  open: boolean;
  onToggle: () => void;
  mailbox?: string;
  onNotice: (n: ReactNode) => void;
}) {
  const preview = decodeEntities(email.summary || email.snippet || "").replace(/\s+/g, " ").trim();
  const subject = rowSubject(email.subject, email.enquiry?.reference);
  const files = email.attachments.length;
  return (
    <li className={open ? "bg-selected/40" : ""}>
      <div className="flex items-center gap-3 px-3 py-2 hover:bg-row-hover">
        <span className="w-11 shrink-0 text-meta tabular-nums text-ink-muted">{muscatTime(email.received_at)}</span>
        <span className="w-24 shrink-0">
          {email.enquiry ? (
            <Link to={`/enquiries/${email.enquiry.id}`} className={`${refClass} text-meta`}>
              {email.enquiry.reference}
            </Link>
          ) : (
            <span className="text-meta text-ink-muted">—</span>
          )}
        </span>
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-control text-left focus-visible:outline-2 focus-visible:outline-primary"
        >
          <span className="flex w-44 shrink-0 items-center gap-1.5 truncate max-md:hidden">
            {email.sender_type !== "external" && (
              <span
                className="size-1.5 shrink-0 rounded-full bg-primary"
                title={email.sender_type === "staff" ? "Colleague" : "Pricing mailbox"}
                aria-label={email.sender_type === "staff" ? "Colleague" : "Pricing mailbox"}
              />
            )}
            <span className={`truncate text-body ${email.sender_type === "external" ? "font-semibold text-ink" : "text-ink-heading"}`}>
              {email.from_name || email.from_email || "Unknown sender"}
            </span>
          </span>
          <span className="min-w-0 flex-1 truncate text-body">
            <span className="text-ink" title={email.subject ?? undefined}>
              {subject || "(no subject)"}
            </span>
            {preview && <span className="text-ink-muted"> — {preview}</span>}
          </span>
          {files > 0 && (
            <span className="inline-flex shrink-0 items-center gap-0.5 text-meta tabular-nums text-ink-muted" title={`${files} attachment${files === 1 ? "" : "s"}`}>
              <Icon name="paperclip" className="size-3.5" />
              {files > 1 && files}
            </span>
          )}
          <Icon name={open ? "chevronUp" : "chevronDown"} className="size-4 shrink-0 text-ink-muted" />
        </button>
      </div>
      {open && (
        <div className="border-t border-line bg-page px-3 py-3">
          <EmailCard email={email} mailbox={mailbox} onNotice={onNotice} />
        </div>
      )}
    </li>
  );
}

const MATCH_LABELS: Record<NonNullable<EmailListItem["match_method"]>, string> = {
  reference: "Matched by reference",
  reply: "Reply in the conversation",
  ai: "Read by Claude",
  rule: "Rule",
  manual: "Filed by hand",
};

function EmailCard({ email, mailbox, onNotice }: { email: EmailListItem; mailbox?: string; onNotice: (n: ReactNode) => void }) {
  const { canEdit } = useAuth();
  const queryClient = useQueryClient();
  const [reference, setReference] = useState(email.suggested?.reference ?? email.sl_refs[0] ?? "");
  const done = (message: ReactNode) => {
    onNotice(message);
    invalidateAll(queryClient);
  };

  const link = useMutation({
    mutationFn: (ref: string | null) => linkEmail(email.id, ref),
    onSuccess: (r) =>
      done(
        r.reference ? (
          <>
            Added to{" "}
            <Link to={`/enquiries/${r.enquiry_id}`} className={refClass}>
              {r.reference}
            </Link>
            .
          </>
        ) : (
          "Moved to “Needs review”."
        ),
      ),
  });
  const toDraft = useMutation({
    mutationFn: () => draftFromEmail(email.id),
    onSuccess: () => done("Added to “New enquiries”. Check the details there and create it."),
  });
  const ignore = useMutation({
    mutationFn: (ignored: boolean) => setEmailIgnored(email.id, ignored),
    onSuccess: (_r, ignored) => done(ignored ? "Moved to “Ignored”." : "Moved to “Needs review”."),
  });
  const busy = link.isPending || toDraft.isPending || ignore.isPending;
  const error = link.error ?? toDraft.error ?? ignore.error;

  return (
    <div className="space-y-2 rounded-panel border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2 text-body">
        {email.enquiry && (
          <Link to={`/enquiries/${email.enquiry.id}`} className={refClass}>
            {email.enquiry.reference}
          </Link>
        )}
        {email.status === "awaiting_enquiry" && email.sl_refs.length > 0 && (
          <Pill className="bg-await-bg text-await">
            <Icon name="clock" className="size-3.5" />
            Waiting for {email.sl_refs.join(", ")}
          </Pill>
        )}
        {email.match_method && <Pill className="bg-table-head text-ink-heading">{MATCH_LABELS[email.match_method]}</Pill>}
        <ConfidenceBadge value={email.match_method === "ai" ? email.confidence : null} />
        {email.suggested && email.status === "review" ? (
          <span className="text-ink-muted">
            Probably a follow-up of{" "}
            <Link to={`/enquiries/${email.suggested.id}`} className={refClass}>
              {email.suggested.reference}
            </Link>
          </span>
        ) : (
          email.note && <span className="text-ink-muted">{email.note}</span>
        )}
      </div>

      <EmailView email={email} mailbox={mailbox} />

      {error && <Alert>{errorMessage(error)}</Alert>}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          {email.status !== "linked" && (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (reference.trim()) link.mutate(reference.trim());
              }}
            >
              <input
                aria-label="Enquiry reference"
                className={`${inputClass} w-36 tabular-nums`}
                placeholder="SL26…"
                value={reference}
                onChange={(e) => setReference(e.target.value.toUpperCase())}
              />
              <Button type="submit" variant="secondary" loading={link.isPending} disabled={busy || !reference.trim()}>
                Link to enquiry
              </Button>
            </form>
          )}
          {(email.status === "review" || email.status === "ignored") && (
            <Button variant="secondary" loading={toDraft.isPending} disabled={busy} onClick={() => toDraft.mutate()}>
              It's a new enquiry
            </Button>
          )}
          {email.status === "linked" && (
            <Button variant="ghost" disabled={busy} onClick={() => link.mutate(null)}>
              Wrong enquiry — unlink
            </Button>
          )}
          {email.status === "ignored" ? (
            <Button variant="ghost" disabled={busy} onClick={() => ignore.mutate(false)}>
              Move to review
            </Button>
          ) : (
            email.status !== "linked" && (
              <Button variant="ghost" disabled={busy} onClick={() => ignore.mutate(true)}>
                Ignore
              </Button>
            )
          )}
        </div>
      )}
    </div>
  );
}
