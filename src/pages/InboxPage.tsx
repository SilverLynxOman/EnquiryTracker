import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { ConfidenceBadge, EmailView, Pill } from "../components/EmailView";
import { Alert, Button, Card, Empty, Spinner, inputClass } from "../components/ui";
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
  mergeDraft,
  setEmailIgnored,
  suggestCustomers,
} from "../lib/api";
import { draftToPayload } from "../lib/emailDrafts";
import { errorMessage, fmtDate, fmtDateTime } from "../lib/format";
import type { EmailListItem, EmailStatus, EnquiryDraft, InboxCounts, SyncResult } from "../lib/types";

type Tab = "drafts" | "review" | "awaiting" | "linked" | "ignored";

const TABS: { key: Tab; label: string; count?: (c: InboxCounts) => number; hint: string }[] = [
  { key: "drafts", label: "New enquiries", count: (c) => c.drafts, hint: "New enquiries found in the mailbox. Check the details and create them in the register." },
  { key: "review", label: "Needs review", count: (c) => c.review, hint: "E-mails the system could not file with confidence. Link each to its enquiry, turn it into a new enquiry, or ignore it." },
  {
    key: "awaiting",
    label: "Waiting for reference",
    count: (c) => c.awaiting,
    hint: "E-mails citing an SL reference that is not in the register yet. They are linked automatically as soon as that enquiry is entered or imported.",
  },
  { key: "linked", label: "Recent follow-ups", hint: "The latest e-mails added to existing enquiries." },
  { key: "ignored", label: "Ignored", hint: "Newsletters, invoices, notices and other mail that is not about an enquiry." },
];

const STATUS_OF_TAB: Record<Exclude<Tab, "drafts">, EmailStatus> = {
  review: "review",
  awaiting: "awaiting_enquiry",
  linked: "linked",
  ignored: "ignored",
};

function invalidateAll(qc: QueryClient) {
  for (const key of ["inbox", "register", "dashboard", "names", "enquiry-emails"]) qc.invalidateQueries({ queryKey: [key] });
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
  });

  const current = TABS.find((t) => t.key === tab)!;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-lg font-semibold">E-mail inbox</h1>
        {mailbox && (
          <span className="text-sm text-slate-500">
            {mailbox.email} · {mailbox.last_synced_at ? `last checked ${fmtDateTime(mailbox.last_synced_at)}` : "not checked yet"}
          </span>
        )}
        {canEdit && (
          <Button className="ml-auto" variant="secondary" disabled={check.isPending} onClick={() => check.mutate()}>
            {check.isPending ? "Checking mail…" : "Check mail now"}
          </Button>
        )}
      </div>

      {!counts.isLoading && !counts.error && !mailbox && (
        <Alert kind="info">
          The mailbox is not connected yet. Follow “E-mail intake” in the README to connect Gmail; new mail is then read every few minutes.
        </Alert>
      )}
      {mailbox?.last_error && <Alert kind="warning">The last mail check reported a problem: {mailbox.last_error}</Alert>}
      {counts.error && <Alert>{errorMessage(counts.error)}</Alert>}
      {check.error && <Alert>{errorMessage(check.error)}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <nav className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => {
          const n = t.count && counts.data ? t.count(counts.data) : null;
          const active = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setNotice(null);
                setParams(t.key === "drafts" ? {} : { tab: t.key }, { replace: true });
              }}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${active ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-600 hover:text-slate-900"}`}
            >
              {t.label}
              {n != null && n > 0 && <span className="ml-1.5 rounded-full bg-indigo-100 px-1.5 py-0.5 text-xs text-indigo-700">{n}</span>}
            </button>
          );
        })}
      </nav>
      <p className="text-sm text-slate-500">{current.hint}</p>

      {tab === "drafts" ? (
        <DraftList mailbox={mailbox?.email} onNotice={setNotice} />
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
  if (drafts.error) return <Alert>{errorMessage(drafts.error)}</Alert>;
  if (!drafts.data?.length) return <Empty>No new enquiries waiting. 🎉</Empty>;
  return (
    <div className="space-y-4">
      {drafts.data.map((d) => (
        <DraftCard key={d.id} draft={d} mailbox={mailbox} onNotice={onNotice} />
      ))}
    </div>
  );
}

function Detail({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="text-sm text-slate-900">{children || <span className="text-slate-400">—</span>}</dd>
    </div>
  );
}

function DraftCard({ draft, mailbox, onNotice }: { draft: EnquiryDraft; mailbox?: string; onNotice: (n: ReactNode) => void }) {
  const { canEdit } = useAuth();
  const queryClient = useQueryClient();
  const [customer, setCustomer] = useState(draft.customer_name ?? "");
  const [showEmails, setShowEmails] = useState(false);
  const f = draft.fields ?? {};
  const first = draft.emails[0];

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
          <Link to={`/enquiries/${row.id}`} className="font-mono font-semibold underline">
            {row.reference}
          </Link>{" "}
          for {row.subject ? row.subject.replace(row.reference, "").trim() : customer.toUpperCase()}. Reply to the customer with this reference in the subject so
          follow-ups are filed automatically.
        </>,
      ),
  });
  const merge = useMutation({
    mutationFn: (reference: string) => mergeDraft(draft.id, reference),
    onSuccess: (r) =>
      done(
        <>
          The e-mails were added to{" "}
          <Link to={`/enquiries/${r.enquiry_id}`} className="font-mono font-semibold underline">
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

  const exact = suggestions.data?.find((s) => s.score >= 0.95 && s.name.toUpperCase() === customer.trim().toUpperCase());
  const similar = (suggestions.data ?? []).filter((s) => s.name.toUpperCase() !== customer.trim().toUpperCase());

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
          <span>{draft.customer_name ?? draft.contact_name ?? draft.contact_email ?? "Unknown sender"}</span>
          <ConfidenceBadge value={draft.confidence} />
          {draft.emails.length > 1 && <Pill className="bg-slate-100 text-slate-600 ring-slate-200">{draft.emails.length} e-mails</Pill>}
        </span>
      }
      actions={<span className="text-xs text-slate-500">received {fmtDateTime(draft.received_at)}</span>}
    >
      <div className="space-y-3">
        {draft.summary && <p className="text-sm text-slate-700">{draft.summary}</p>}
        {first?.note && <Alert kind="info">{first.note}</Alert>}

        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium text-slate-500">Customer *</dt>
            <dd>
              {canEdit ? (
                <input
                  className={inputClass}
                  value={customer}
                  onChange={(e) => setCustomer(e.target.value.toUpperCase())}
                  list={`customers-${draft.id}`}
                  placeholder="Customer name"
                />
              ) : (
                <span className="text-sm">{customer || "—"}</span>
              )}
              <datalist id={`customers-${draft.id}`}>
                {customers.data?.map((n) => <option key={n} value={n} />)}
              </datalist>
              <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-slate-500">
                {exact ? (
                  <span className="text-emerald-700">✓ Existing customer</span>
                ) : customer.trim() ? (
                  <span>New customer{similar.length ? ". Or did you mean:" : ""}</span>
                ) : (
                  <span className="text-rose-600">Enter the customer before creating the enquiry{similar.length ? ". Suggestions:" : ""}</span>
                )}
                {!exact &&
                  similar.map((s) => (
                    <button key={s.id} type="button" className="text-indigo-600 hover:underline" disabled={!canEdit} onClick={() => setCustomer(s.name)}>
                      {s.name}
                    </button>
                  ))}
              </div>
            </dd>
          </div>
          <Detail label="Contact">
            {[draft.contact_name, draft.contact_designation].filter(Boolean).join(", ")}
            {draft.contact_email && <div className="text-xs text-slate-500">{draft.contact_email}</div>}
            {draft.contact_phone && <div className="text-xs text-slate-500">{draft.contact_phone}</div>}
          </Detail>
          <Detail label="Sales person">{draft.sales_person_name}</Detail>
          <Detail label="Route">{[f.pol, f.pod].some(Boolean) ? `${f.pol ?? "?"} → ${f.pod ?? "?"}` : null}</Detail>
          <Detail label="Qty / mode">{[f.qty_text, f.shipment_mode && f.shipment_mode !== f.qty_text ? f.shipment_mode : null, f.trade_type].filter(Boolean).join(" · ")}</Detail>
          <Detail label="Enquiry date">{fmtDate(f.enquiry_date)}</Detail>
          <Detail label="Incoterm">{f.incoterm}</Detail>
          <Detail label="Subject" wide>
            {f.subject && (
              <span className="font-mono text-xs">
                <span className="text-slate-400" title="The reference is issued when the enquiry is created">
                  SL······
                </span>{" "}
                {f.subject}
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
                  <Link to={`/enquiries/${d.id}`} className="font-mono underline">
                    {d.reference}
                  </Link>
                  <span>
                    {fmtDate(d.enquiry_date)} · {d.subject ?? d.customer_name}
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
              <Button disabled={busy || !customer.trim()} onClick={() => create.mutate()} title="Create the enquiry with the details shown">
                {create.isPending ? "Creating…" : "Create enquiry"}
              </Button>
              <Link
                to={`/enquiries/new?draft=${draft.id}`}
                className="inline-flex items-center rounded-md bg-white px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50"
              >
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
          <button type="button" className="ml-auto text-sm text-indigo-600 hover:underline" onClick={() => setShowEmails(!showEmails)}>
            {showEmails ? "Hide e-mail" : `Show e-mail${draft.emails.length > 1 ? `s (${draft.emails.length})` : ""}`}
          </button>
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
  if (emails.error) return <Alert>{errorMessage(emails.error)}</Alert>;
  if (!emails.data?.length) return <Empty>Nothing here.</Empty>;
  return (
    <div className="space-y-3">
      {status !== "review" && status !== "awaiting_enquiry" && emails.data.length >= 100 && (
        <p className="text-xs text-slate-500">Showing the latest 100.</p>
      )}
      {emails.data.map((m) => (
        <EmailCard key={m.id} email={m} mailbox={mailbox} onNotice={onNotice} />
      ))}
    </div>
  );
}

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
            <Link to={`/enquiries/${r.enquiry_id}`} className="font-mono font-semibold underline">
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
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {email.enquiry && (
          <Link to={`/enquiries/${email.enquiry.id}`} className="font-mono font-semibold text-indigo-700 hover:underline">
            {email.enquiry.reference}
          </Link>
        )}
        {email.status === "awaiting_enquiry" && email.sl_refs.length > 0 && (
          <Pill className="bg-amber-50 text-amber-800 ring-amber-200">waiting for {email.sl_refs.join(", ")}</Pill>
        )}
        {email.match_method && <Pill className="bg-white text-slate-600 ring-slate-200">{MATCH_LABELS[email.match_method]}</Pill>}
        <ConfidenceBadge value={email.match_method === "ai" ? email.confidence : null} />
        {email.suggested && email.status === "review" ? (
          <span className="text-slate-600">
            Probably a follow-up of{" "}
            <Link to={`/enquiries/${email.suggested.id}`} className="font-mono underline">
              {email.suggested.reference}
            </Link>
          </span>
        ) : (
          email.note && <span className="text-slate-600">{email.note}</span>
        )}
      </div>

      <EmailView email={email} mailbox={mailbox} />

      {error && <Alert>{errorMessage(error)}</Alert>}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          {email.status !== "linked" && (
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (reference.trim()) link.mutate(reference.trim());
              }}
            >
              <input
                className={`${inputClass} w-36 font-mono`}
                placeholder="SL26…"
                value={reference}
                onChange={(e) => setReference(e.target.value.toUpperCase())}
              />
              <Button type="submit" variant="secondary" className="whitespace-nowrap" disabled={busy || !reference.trim()}>
                Link to enquiry
              </Button>
            </form>
          )}
          {(email.status === "review" || email.status === "ignored") && (
            <Button variant="secondary" disabled={busy} onClick={() => toDraft.mutate()}>
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

const MATCH_LABELS: Record<NonNullable<EmailListItem["match_method"]>, string> = {
  reference: "matched by reference",
  reply: "reply in the conversation",
  ai: "read by Claude",
  rule: "rule",
  manual: "filed by hand",
};
