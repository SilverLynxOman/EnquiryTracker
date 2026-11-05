import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useAuth } from "../../auth/AuthProvider";
import { Icon } from "../../components/icons";
import { Alert, Button, Empty, Spinner, buttonClass, inputClass } from "../../components/ui";
import { fetchEmails, fetchEnquiriesByReferences, fetchRelatedEnquiryIds, linkEmail, setEmailIgnored } from "../../lib/api";
import { dayLabel, decodeEntities, groupByReference, muscatTime, referenceSlip, referenceVariants, rowSubject, senderName, type ReferenceGroup } from "../../lib/conversations";
import { daysBetween } from "../../lib/display";
import { muscatDate } from "../../lib/emailDrafts";
import { errorMessage, fmtDateTime } from "../../lib/format";
import { firstHouseSubject } from "../../lib/houseSubject";
import type { EmailListItem, EnquiryRow } from "../../lib/types";
import { FilterTags, FiltersMenu, type SenderFilter } from "./ListToolbar";
import {
  Bubble,
  EnquiryChoice,
  IconTile,
  ListHead,
  ListRow,
  PaneBody,
  PaneHeader,
  PanePlaceholder,
  People,
  SearchBox,
  SectionLabel,
  SplitView,
  Tag,
  matches,
  refClass,
  revealPane,
  useInboxParams,
  useTypedSearch,
} from "./parts";

const WAIT_TILE = "bg-lane-wait/10 text-lane-wait";

function waited(since: string, today: string): string {
  const days = daysBetween(muscatDate(since), today);
  return days <= 0 ? "Since today" : `${days} day${days === 1 ? "" : "s"}`;
}

/** E-mails citing a reference that is not in the register yet, one conversation per reference. */
export function WaitingForReference({ mailbox, onNotice, onDone }: { mailbox?: string; onNotice: (n: ReactNode) => void; onDone: () => void }) {
  const { params, update } = useInboxParams();
  const q = params.get("q") ?? "";
  const sender = (params.get("sender") ?? "") as SenderFilter;
  const filesOnly = params.get("files") === "1";
  const [typed, setTyped] = useTypedSearch(q, update);
  const paneRef = useRef<HTMLDivElement>(null);
  const today = muscatDate(new Date().toISOString());

  const emails = useQuery({ queryKey: ["inbox", "emails", "awaiting_enquiry"], queryFn: () => fetchEmails("awaiting_enquiry", 500), refetchInterval: 60_000 });
  const groups = groupByReference(
    (emails.data ?? []).filter((m) => (!sender || m.sender_type === sender) && matches(q, m.subject, m.from_name, m.from_email, m.snippet, m.sl_refs.join(" "))),
  ).filter((g) => !filesOnly || g.attachments > 0);
  const selected = groups.find((g) => g.reference === params.get("e")) ?? groups[0];
  const mails = groups.reduce((n, g) => n + g.emails.length, 0);
  const filtered = Boolean(q || sender || filesOnly);

  const list = (
    <>
      <ListHead
        tools={
          <>
            <SearchBox value={typed} onChange={setTyped} placeholder="Search SL reference, subject or sender" />
            <FiltersMenu sender={sender} filesOnly={filesOnly} onChange={(c) => update({ ...c, e: "" })} />
          </>
        }
        summary={
          <>
            <span className="font-semibold text-ink">
              {emails.isLoading ? "Loading…" : `${groups.length} reference${groups.length === 1 ? "" : "s"} · ${mails} e-mail${mails === 1 ? "" : "s"}`}
            </span>
            {q && <span className="text-ink-muted">matching “{q}”</span>}
            {emails.isFetching && !emails.isLoading && <span className="text-ink-muted">· updating…</span>}
          </>
        }
        tags={
          <>
            <FilterTags sender={sender} filesOnly={filesOnly} onChange={(c) => update({ ...c, e: "" })} />
            {filtered && (
              <button
                type="button"
                className="px-1 text-[11px] font-semibold text-primary hover:underline"
                onClick={() => {
                  setTyped("");
                  update({ q: "", sender: "", files: "", e: "" });
                }}
              >
                Clear all
              </button>
            )}
          </>
        }
      />
      {emails.error ? (
        <div className="p-3">
          <Alert action={<Button variant="secondary" size="sm" onClick={() => emails.refetch()}>Try again</Button>}>
            Loading the e-mails failed. {errorMessage(emails.error)}
          </Alert>
        </div>
      ) : emails.isLoading ? (
        <Spinner />
      ) : !groups.length ? (
        <div className="p-3">
          <Empty>{filtered ? "No e-mails match. Try fewer filters." : "No e-mails are waiting for a reference."}</Empty>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
          {groups.map((g) => (
            <WaitingRow
              key={g.reference}
              group={g}
              today={today}
              active={g === selected}
              onPick={() => {
                update({ e: g.reference });
                revealPane(paneRef);
              }}
            />
          ))}
        </ul>
      )}
    </>
  );

  return (
    <SplitView
      list={list}
      paneRef={paneRef}
      pane={
        selected ? (
          <WaitingPane key={selected.reference} group={selected} today={today} mailbox={mailbox} onNotice={onNotice} onDone={onDone} />
        ) : (
          !emails.isLoading && <PanePlaceholder>Pick a reference to read its e-mails.</PanePlaceholder>
        )
      }
    />
  );
}

function WaitingRow({ group, today, active, onPick }: { group: ReferenceGroup; today: string; active: boolean; onPick: () => void }) {
  const last = group.latest;
  const text = decodeEntities(last.summary || last.snippet || "").replace(/\s+/g, " ").trim();
  const n = group.emails.length;
  const day = muscatDate(last.received_at);
  return (
    <ListRow
      active={active}
      onPick={onPick}
      tile={<IconTile icon="clock" className={WAIT_TILE} />}
      top={
        <>
          <span className="text-body font-bold tabular-nums text-lane-wait">{group.reference}</span>
          <Tag className="bg-lane-wait/10 text-lane-wait max-sm:hidden">Not in register</Tag>
        </>
      }
      time={`${day === today ? "" : `${dayLabel(day, today).replace(/ \d{4}$/, "")} `}${muscatTime(last.received_at)}`}
      line2={rowSubject(last.subject, group.reference) || "(no subject)"}
      line3={
        <>
          <span className="font-semibold text-ink">{senderName(last)}:</span> {text}
        </>
      }
      side={
        <>
          <Tag className={n >= 4 ? "bg-lane-wait text-white" : "bg-lane-wait/10 text-lane-wait"} title={`Waiting ${waited(group.since, today).toLowerCase()}`}>
            {n} waiting
          </Tag>
          <People emails={group.emails} />
        </>
      }
    />
  );
}

/**
 * Register enquiries the customer probably meant by `ref`. References are issued in sequence, so a real one
 * nearly always has neighbours one digit away: a near reference counts only when the same Gmail conversation
 * or sender was filed to it before, or when `ref` has the wrong number of digits to be a reference at all.
 */
async function findTypoMatches(ref: string, emails: EmailListItem[]): Promise<{ enquiry: EnquiryRow; reasons: string[] }[]> {
  const rows = await fetchEnquiriesByReferences(referenceVariants(ref));
  if (!rows.length) return [];
  const malformed = !/^SL\d{6}$/.test(ref);
  const threads = [...new Set(emails.map((m) => m.gmail_thread_id))].slice(0, 3);
  const senders = [...new Set(emails.filter((m) => m.sender_type === "external" && m.from_email).map((m) => m.from_email!))].slice(0, 3);
  const related = await Promise.all([
    ...threads.map((t) => fetchRelatedEnquiryIds(t, null)),
    ...senders.map((s) => fetchRelatedEnquiryIds("", s)),
  ]);
  const inThread = new Set(related.flatMap((r) => r.thread));
  const bySender = new Set(related.flatMap((r) => r.sender.map((s) => s.id)));
  return rows
    .map((e) => ({
      enquiry: e,
      reasons: [
        `${ref} with ${referenceSlip(ref, e.reference)}`,
        inThread.has(e.id) ? "same Gmail conversation" : null,
        bySender.has(e.id) ? "same sender" : null,
      ].filter((x): x is string => !!x),
    }))
    .filter((c) => malformed || c.reasons.length > 1)
    .sort((a, b) => b.reasons.length - a.reasons.length);
}

/**
 * The new-enquiry form for `ref`, filled from its e-mails (oldest first): the day the first one arrived as the
 * enquiry date, and the first subject in house style for the quantity, ports and trade type.
 */
function newEnquiryLink(ref: string, oldestFirst: EmailListItem[]): string {
  const params = new URLSearchParams({ reference: ref });
  if (oldestFirst[0]) params.set("date", muscatDate(oldestFirst[0].received_at));
  const house = firstHouseSubject(oldestFirst.map((m) => m.subject));
  if (house) params.set("subject", house.subject);
  return `/enquiries/new?${params}`;
}

function WaitingPane({
  group,
  today,
  mailbox,
  onNotice,
  onDone,
}: {
  group: ReferenceGroup;
  today: string;
  mailbox?: string;
  onNotice: (n: ReactNode) => void;
  onDone: () => void;
}) {
  const { canEdit } = useAuth();
  const [other, setOther] = useState<string | null>(null);
  const messages = [...group.emails].reverse();
  const n = messages.length;
  const latest = group.latest;
  const ref = group.reference;

  const near = useQuery({
    queryKey: ["inbox", "near-references", ref, messages.length],
    queryFn: () => findTypoMatches(ref, messages),
    staleTime: 60_000,
  });

  const done = (message: ReactNode) => {
    onNotice(message);
    onDone();
  };
  const linkAll = useMutation({
    mutationFn: async (target: string) => {
      let r: { enquiry_id: string | null; reference: string | null } = { enquiry_id: null, reference: null };
      for (const m of messages) r = await linkEmail(m.id, target);
      return r;
    },
    onSuccess: (r) =>
      done(
        <>
          {n} e-mail{n === 1 ? "" : "s"} added to{" "}
          <Link to={`/enquiries/${r.enquiry_id}`} className={refClass}>
            {r.reference}
          </Link>
          .
        </>,
      ),
  });
  const ignoreAll = useMutation({
    mutationFn: async () => {
      for (const m of messages) await setEmailIgnored(m.id, true);
    },
    onSuccess: () => done(`${n} e-mail${n === 1 ? "" : "s"} moved to “Ignored”.`),
  });
  const busy = linkAll.isPending || ignoreAll.isPending;
  const error = linkAll.error ?? ignoreAll.error;
  const files = messages.reduce((x, m) => x + m.attachments.length, 0);

  return (
    <article aria-label={`E-mails waiting for ${ref}`} className="flex flex-col gap-3 lg:min-h-0 lg:flex-1">
      <PaneHeader
        tile={<IconTile icon="clock" className={WAIT_TILE} size="lg" />}
        facts={[
          ["First e-mail", fmtDateTime(group.since)],
          ["Waiting", waited(group.since, today)],
          ["On this reference", `${n} e-mail${n === 1 ? "" : "s"}${files ? ` · ${files} file${files === 1 ? "" : "s"}` : ""}`],
        ]}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[1.25rem] font-extrabold tabular-nums text-lane-wait">{ref}</span>
          <Tag className="bg-lane-wait/10 text-lane-wait" icon="clock">
            Not in the register yet
          </Tag>
        </div>
        <p className="text-meta text-ink-muted">These e-mails are filed automatically as soon as {ref} is entered or imported.</p>
      </PaneHeader>

      <PaneBody
        title={rowSubject(latest.subject, ref) || "(no subject)"}
        aside={`${n} e-mail${n === 1 ? "" : "s"}`}
        actions={
          canEdit && (
            <>
              {/^SL\d{6}$/.test(ref) && (
                <Link to={newEnquiryLink(ref, messages)} className={buttonClass("primary")}>
                  <Icon name="plus" />
                  Enter {ref} now
                </Link>
              )}
              {other === null ? (
                <Button variant="secondary" disabled={busy} onClick={() => setOther("")}>
                  <Icon name="merge" />
                  Link to another enquiry…
                </Button>
              ) : (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (other.trim()) linkAll.mutate(other.trim());
                  }}
                >
                  <input
                    aria-label="Link to which enquiry"
                    autoFocus
                    className={`${inputClass} w-32 tabular-nums`}
                    placeholder="SL26…"
                    value={other}
                    onChange={(e) => setOther(e.target.value.toUpperCase())}
                  />
                  <Button type="submit" variant="secondary" loading={linkAll.isPending} disabled={busy || !other.trim()}>
                    Link all {n}
                  </Button>
                  <Button variant="ghost" onClick={() => setOther(null)}>
                    Cancel
                  </Button>
                </form>
              )}
              <Button variant="ghost" className="ml-auto" loading={ignoreAll.isPending} disabled={busy} onClick={() => ignoreAll.mutate()}>
                {n === 1 ? "Ignore" : `Ignore all ${n}`}
              </Button>
            </>
          )
        }
      >
        {error && <Alert>{errorMessage(error)}</Alert>}
        {!!near.data?.length && (
          <div className="space-y-2">
            <SectionLabel line={false}>Did they mean another enquiry?</SectionLabel>
            {near.data.slice(0, 3).map(({ enquiry: e, reasons }, i) => (
              <EnquiryChoice
                key={e.id}
                enquiry={e}
                reasons={reasons}
                best={i === 0}
                action={
                  canEdit && (
                    <Button variant={i === 0 ? "primary" : "secondary"} size="sm" loading={linkAll.isPending && linkAll.variables === e.reference} disabled={busy} onClick={() => linkAll.mutate(e.reference)}>
                      <Icon name="check" className="size-3.5" />
                      Link all {n}
                    </Button>
                  )
                }
              />
            ))}
          </div>
        )}

        <ol className="space-y-3">
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const dayOf = muscatDate(m.received_at);
            return (
              <li key={m.id} className="space-y-3">
                {(!prev || muscatDate(prev.received_at) !== dayOf) && <SectionLabel>{dayLabel(dayOf, today)}</SectionLabel>}
                <Bubble email={m} mailbox={mailbox} />
              </li>
            );
          })}
        </ol>
      </PaneBody>
    </article>
  );
}
