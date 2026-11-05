import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useAuth } from "../../auth/AuthProvider";
import { ConfidenceBadge, shownName } from "../../components/EmailView";
import { Icon } from "../../components/icons";
import { Alert, Button, Empty, Spinner, buttonClass, inputClass } from "../../components/ui";
import { createEnquiryFromDraft, dismissDraft, fetchDraftDuplicates, fetchNames, fetchPendingDrafts, mergeDraft, suggestCustomers } from "../../lib/api";
import { dayLabel, modeGroup, muscatTime, type ModeFilter } from "../../lib/conversations";
import { fmtDateLong, shortPort } from "../../lib/display";
import { confidenceLevel, draftToPayload, muscatDate } from "../../lib/emailDrafts";
import { errorMessage, fmtDateTime } from "../../lib/format";
import type { EnquiryDraft } from "../../lib/types";
import { FilterTags, FiltersMenu, toolButton } from "./ListToolbar";
import {
  Bubble,
  DayHeading,
  ListHead,
  ListRow,
  ModeTile,
  PaneBody,
  PaneHeader,
  PanePlaceholder,
  RouteLine,
  SearchBox,
  SectionLabel,
  SplitView,
  Tag,
  matches,
  refClass,
  revealPane,
  shipmentExtra,
  useInboxParams,
  useTypedSearch,
} from "./parts";

const CONFIDENCE_TAG = { high: "bg-confirmed-bg text-confirmed", medium: "bg-await-bg text-await", low: "bg-lost-bg text-lost" };

function draftName(d: EnquiryDraft): string {
  return shownName(d.customer_name) || d.contact_name || d.contact_email || "Unknown sender";
}

function draftRoute(d: EnquiryDraft): string {
  const f = d.fields ?? {};
  const r = f.pol || f.pod ? `${shortPort(f.pol) || "?"} → ${shortPort(f.pod) || "?"}` : (f.subject ?? "");
  return [r, f.qty_text].filter(Boolean).join(" · ");
}

/** New enquiries found in the mailbox: the queue on the left, the selected draft to check and create on the right. */
export function NewEnquiries({ mailbox, onNotice, onDone }: { mailbox?: string; onNotice: (n: ReactNode) => void; onDone: () => void }) {
  const { params, update } = useInboxParams();
  const q = params.get("q") ?? "";
  const mode = (params.get("mode") ?? "") as "" | ModeFilter;
  const newestFirst = params.get("sort") === "new";
  const [typed, setTyped] = useTypedSearch(q, update);
  const paneRef = useRef<HTMLDivElement>(null);
  const today = muscatDate(new Date().toISOString());

  const drafts = useQuery({ queryKey: ["inbox", "drafts"], queryFn: fetchPendingDrafts, refetchInterval: 60_000 });
  const all = drafts.data ?? [];
  const shown = all
    .filter((d) => (!mode || modeGroup(d.fields?.shipment_mode) === mode) && matches(q, d.customer_name, d.contact_name, d.contact_email, d.summary, d.fields?.pol, d.fields?.pod, d.fields?.subject))
    .sort((a, b) => (newestFirst ? -1 : 1) * a.received_at.localeCompare(b.received_at));
  const selected = shown.find((d) => d.id === params.get("e")) ?? shown[0];
  const mails = shown.reduce((n, d) => n + d.emails.length, 0);
  const filtered = Boolean(q || mode);

  const rows: ReactNode[] = [];
  let lastDay = "";
  for (const d of shown) {
    const day = muscatDate(d.received_at);
    if (day !== lastDay) {
      rows.push(<DayHeading key={`day-${day}`} label={dayLabel(day, today)} count={shown.filter((x) => muscatDate(x.received_at) === day).length} />);
      lastDay = day;
    }
    rows.push(
      <DraftRow
        key={d.id}
        draft={d}
        active={d === selected}
        onPick={() => {
          update({ e: d.id });
          revealPane(paneRef);
        }}
      />,
    );
  }

  const list = (
    <>
      <ListHead
        tools={
          <>
            <SearchBox value={typed} onChange={setTyped} placeholder="Search customer, sender or port" />
            <button type="button" className={toolButton(newestFirst)} onClick={() => update({ sort: newestFirst ? "" : "new", e: "" })} title="Change the order">
              <Icon name="clock" className="size-4" />
              {newestFirst ? "Newest first" : "Oldest first"}
            </button>
            <FiltersMenu mode={mode} onChange={(c) => update({ ...c, e: "" })} />
          </>
        }
        summary={
          <>
            <span className="font-semibold text-ink">
              {drafts.isLoading ? "Loading…" : `${shown.length} new enquir${shown.length === 1 ? "y" : "ies"} · ${mails} e-mail${mails === 1 ? "" : "s"}`}
            </span>
            {q && <span className="text-ink-muted">matching “{q}”</span>}
            {drafts.isFetching && !drafts.isLoading && <span className="text-ink-muted">· updating…</span>}
          </>
        }
        tags={
          <>
            <FilterTags mode={mode} onChange={(c) => update({ ...c, e: "" })} />
            {filtered && (
              <button
                type="button"
                className="px-1 text-[11px] font-semibold text-primary hover:underline"
                onClick={() => {
                  setTyped("");
                  update({ q: "", mode: "", e: "" });
                }}
              >
                Clear all
              </button>
            )}
          </>
        }
      />
      {drafts.error ? (
        <div className="p-3">
          <Alert action={<Button variant="secondary" size="sm" onClick={() => drafts.refetch()}>Try again</Button>}>
            Loading the new enquiries failed. {errorMessage(drafts.error)}
          </Alert>
        </div>
      ) : drafts.isLoading ? (
        <Spinner />
      ) : !shown.length ? (
        <div className="p-3">
          <Empty>{filtered ? "No new enquiries match. Try fewer filters." : "No new enquiries waiting. New ones appear here a few minutes after they arrive."}</Empty>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">{rows}</ul>
      )}
    </>
  );

  return (
    <SplitView
      list={list}
      paneRef={paneRef}
      pane={
        selected ? (
          <DraftPane key={selected.id} draft={selected} mailbox={mailbox} onNotice={onNotice} onDone={onDone} />
        ) : (
          !drafts.isLoading && <PanePlaceholder>Pick a new enquiry to check it.</PanePlaceholder>
        )
      }
    />
  );
}

function DraftRow({ draft, active, onPick }: { draft: EnquiryDraft; active: boolean; onPick: () => void }) {
  const level = confidenceLevel(draft.confidence);
  const files = draft.emails.reduce((n, m) => n + m.attachments.length, 0);
  return (
    <ListRow
      active={active}
      onPick={onPick}
      tile={<ModeTile mode={draft.fields?.shipment_mode} />}
      top={
        <>
          <span className={`truncate text-body font-bold ${draft.customer_name ? "text-ink" : "text-ink-muted"}`}>{draftName(draft)}</span>
          {draft.customer_id ? (
            <Tag className="bg-confirmed-bg text-confirmed max-sm:hidden" icon="check" title="Already a customer">
              Customer
            </Tag>
          ) : draft.customer_name ? (
            <Tag className="bg-selected text-primary max-sm:hidden">New customer</Tag>
          ) : null}
        </>
      }
      time={muscatTime(draft.received_at)}
      line2={draftRoute(draft) || "Route not found"}
      line3={
        <>
          {draft.contact_name && <span className="font-semibold text-ink">{draft.contact_name}: </span>}
          {draft.summary || draft.emails[0]?.subject}
        </>
      }
      side={
        <>
          {level && draft.confidence != null && (
            <Tag className={CONFIDENCE_TAG[level]} title="How sure the automatic reading is">
              {Math.round(draft.confidence * 100)}%
            </Tag>
          )}
          <span className="inline-flex items-center gap-1 text-[11px] text-ink-muted tabular-nums">
            {draft.emails.length > 1 && `${draft.emails.length} e-mails`}
            {files > 0 && (
              <>
                <Icon name="paperclip" className="size-3" />
                {files}
              </>
            )}
          </span>
        </>
      }
    />
  );
}

function Detail({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2 lg:col-span-4" : ""}>
      <dt className="text-meta font-medium text-ink-heading">{label}</dt>
      <dd className="text-body text-ink">{children || <span className="text-await">Not found</span>}</dd>
    </div>
  );
}

function DraftPane({ draft, mailbox, onNotice, onDone }: { draft: EnquiryDraft; mailbox?: string; onNotice: (n: ReactNode) => void; onDone: () => void }) {
  const { canEdit } = useAuth();
  const [customer, setCustomer] = useState(draft.customer_name ?? "");
  const [merging, setMerging] = useState(false);
  const [mergeRef, setMergeRef] = useState("");
  const f = draft.fields ?? {};
  const firstEmail = draft.emails[0];
  const files = draft.emails.reduce((n, m) => n + m.attachments.length, 0);

  const customers = useQuery({ queryKey: ["names", "customers"], queryFn: () => fetchNames("customers"), staleTime: 300_000, enabled: canEdit });
  const suggestions = useQuery({
    queryKey: ["inbox", "suggest", draft.id],
    queryFn: () => suggestCustomers(draft.customer_name, draft.contact_email),
    staleTime: 300_000,
  });
  const duplicates = useQuery({ queryKey: ["inbox", "duplicates", draft.id], queryFn: () => fetchDraftDuplicates(draft.id) });

  const done = (message: ReactNode) => {
    onNotice(message);
    onDone();
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

  function askDismiss() {
    const reason = window.prompt("Not an enquiry. Reason (optional):", "");
    if (reason !== null) dismiss.mutate(reason.trim() || null);
  }

  return (
    <article aria-label={`New enquiry from ${draftName(draft)}`} className="flex flex-col gap-3 lg:min-h-0 lg:flex-1">
      <PaneHeader
        tile={<ModeTile mode={f.shipment_mode} size="lg" />}
        facts={[
          ["From", draft.contact_name || draft.contact_email],
          ["Received", fmtDateTime(draft.received_at)],
          ["On this draft", `${draft.emails.length} e-mail${draft.emails.length === 1 ? "" : "s"}${files ? ` · ${files} file${files === 1 ? "" : "s"}` : ""}`],
        ]}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-[1.25rem] font-extrabold ${draft.customer_name ? "text-ink" : "text-ink-muted"}`}>{draftName(draft)}</span>
          <Tag className="bg-selected text-primary" icon="inbox">
            New enquiry
          </Tag>
          <ConfidenceBadge value={draft.confidence} />
        </div>
        {(f.pol || f.pod) && <RouteLine pol={f.pol} pod={f.pod} extra={shipmentExtra(f)} />}
      </PaneHeader>

      <PaneBody
        title={f.subject ? <>SL… {f.subject}</> : (firstEmail?.subject ?? "New enquiry")}
        aside="Read from the e-mail. Check before creating."
        actions={
          canEdit && (
            <>
              <Button loading={create.isPending} disabled={busy || !customer.trim()} onClick={() => create.mutate()} title="Create the enquiry with the details shown">
                {!create.isPending && <Icon name="check" />}
                {create.isPending ? "Creating…" : "Create enquiry"}
              </Button>
              <Link to={`/enquiries/new?draft=${draft.id}`} className={buttonClass("secondary")}>
                <Icon name="edit" />
                Review & edit
              </Link>
              {merging ? (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (mergeRef.trim()) merge.mutate(mergeRef.trim());
                  }}
                >
                  <input
                    aria-label="Add to which enquiry"
                    autoFocus
                    className={`${inputClass} w-32 tabular-nums`}
                    placeholder="SL26…"
                    value={mergeRef}
                    onChange={(e) => setMergeRef(e.target.value.toUpperCase())}
                  />
                  <Button type="submit" variant="secondary" loading={merge.isPending} disabled={busy || !mergeRef.trim()}>
                    Add
                  </Button>
                  <Button variant="ghost" onClick={() => setMerging(false)}>
                    Cancel
                  </Button>
                </form>
              ) : (
                <Button variant="secondary" disabled={busy} onClick={() => setMerging(true)}>
                  <Icon name="merge" />
                  Add to existing…
                </Button>
              )}
              <Button variant="ghost" className="ml-auto" disabled={busy} onClick={askDismiss}>
                Not an enquiry
              </Button>
            </>
          )
        }
      >
        {error && <Alert>{errorMessage(error)}</Alert>}
        {firstEmail?.note && <Alert kind="info">{firstEmail.note}</Alert>}
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
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => merge.mutate(d.reference)}>
                      Add e-mails to {d.reference}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Alert>
        )}

        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <dt className="mb-1 text-meta font-medium text-ink-heading">
              <label htmlFor={`customer-${draft.id}`}>Customer *</label>
            </dt>
            <dd>
              {canEdit ? (
                <input
                  id={`customer-${draft.id}`}
                  className={`${inputClass} ${customer.trim() ? "" : "border-await bg-await-bg"}`}
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
          <Detail label="Route">{f.pol || f.pod ? `${shownName(f.pol) || "?"} → ${shownName(f.pod) || "?"}` : null}</Detail>
          <Detail label="Shipment">
            {[f.qty_text, f.shipment_mode && f.shipment_mode !== f.qty_text ? f.shipment_mode : null, f.trade_type].filter(Boolean).join(" · ")}
          </Detail>
          <Detail label="Enquiry date">{fmtDateLong(f.enquiry_date)}</Detail>
          <Detail label="Incoterm">{f.incoterm}</Detail>
          {draft.requirements && (
            <Detail label="Requirements" wide>
              <span className="whitespace-pre-wrap">{draft.requirements}</span>
            </Detail>
          )}
        </dl>

        <SectionLabel>{draft.emails.length > 1 ? `The ${draft.emails.length} e-mails` : "The e-mail"}</SectionLabel>
        {draft.emails.map((m) => (
          <Bubble key={m.id} email={m} mailbox={mailbox} />
        ))}
      </PaneBody>
    </article>
  );
}
