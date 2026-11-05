import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useAuth } from "../../auth/AuthProvider";
import { ConfidenceBadge } from "../../components/EmailView";
import { Icon } from "../../components/icons";
import { Alert, Button, Empty, Spinner, inputClass } from "../../components/ui";
import { draftFromEmail, fetchEmails, fetchEnquiriesByIds, fetchEnquiriesByReferences, fetchRelatedEnquiryIds, linkEmail, setEmailIgnored } from "../../lib/api";
import { dayLabel, decodeEntities, muscatTime, referenceSlip, referenceVariants, rowSubject, senderName } from "../../lib/conversations";
import { fmtDateLong } from "../../lib/display";
import { muscatDate } from "../../lib/emailDrafts";
import { errorMessage, fmtDateTime } from "../../lib/format";
import type { EmailListItem, EnquiryRow } from "../../lib/types";
import { FilterTags, FiltersMenu, type SenderFilter } from "./ListToolbar";
import {
  Avatar,
  Bubble,
  DayHeading,
  EnquiryChoice,
  ListHead,
  ListRow,
  PaneBody,
  PaneHeader,
  PanePlaceholder,
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

export const READ_BY: Record<NonNullable<EmailListItem["match_method"]>, string> = {
  reference: "SL reference",
  reply: "Reply in the conversation",
  ai: "Claude",
  rule: "Rule",
  manual: "By hand",
};

/** E-mails the system could not file: the list on the left, the e-mail and the enquiries it may belong to on the right. */
export function NeedsReview({ mailbox, onNotice, onDone }: { mailbox?: string; onNotice: (n: ReactNode) => void; onDone: () => void }) {
  const { params, update } = useInboxParams();
  const q = params.get("q") ?? "";
  const sender = (params.get("sender") ?? "") as SenderFilter;
  const filesOnly = params.get("files") === "1";
  const [typed, setTyped] = useTypedSearch(q, update);
  const paneRef = useRef<HTMLDivElement>(null);
  const today = muscatDate(new Date().toISOString());

  const emails = useQuery({ queryKey: ["inbox", "emails", "review"], queryFn: () => fetchEmails("review", 500), refetchInterval: 60_000 });
  const shown = (emails.data ?? []).filter(
    (m) =>
      (!sender || m.sender_type === sender) &&
      (!filesOnly || m.attachments.length > 0) &&
      matches(q, m.subject, m.from_name, m.from_email, m.snippet, m.summary, m.sl_refs.join(" "), m.suggested?.reference),
  );
  const selected = shown.find((m) => m.id === params.get("e")) ?? shown[0];
  const guessed = shown.filter((m) => m.suggested).length;
  const filtered = Boolean(q || sender || filesOnly);

  const rows: ReactNode[] = [];
  let lastDay = "";
  for (const m of shown) {
    const day = muscatDate(m.received_at);
    if (day !== lastDay) {
      rows.push(<DayHeading key={`day-${day}`} label={dayLabel(day, today)} count={shown.filter((x) => muscatDate(x.received_at) === day).length} />);
      lastDay = day;
    }
    rows.push(
      <ReviewRow
        key={m.id}
        email={m}
        active={m === selected}
        onPick={() => {
          update({ e: m.id });
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
            <SearchBox value={typed} onChange={setTyped} placeholder="Search subject, sender or SL reference" />
            <FiltersMenu sender={sender} filesOnly={filesOnly} onChange={(c) => update({ ...c, e: "" })} />
          </>
        }
        summary={
          <>
            <span className="font-semibold text-ink">
              {emails.isLoading ? "Loading…" : `${shown.length} e-mail${shown.length === 1 ? "" : "s"}`}
            </span>
            {!emails.isLoading && guessed > 0 && <span className="text-ink-muted">· {guessed} with a likely enquiry</span>}
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
      ) : !shown.length ? (
        <div className="p-3">
          <Empty>{filtered ? "No e-mails match. Try fewer filters." : "Nothing to review. Every e-mail has been filed."}</Empty>
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
          <ReviewPane key={selected.id} email={selected} mailbox={mailbox} onNotice={onNotice} onDone={onDone} />
        ) : (
          !emails.isLoading && <PanePlaceholder>Pick an e-mail to review it.</PanePlaceholder>
        )
      }
    />
  );
}

function ReviewRow({ email, active, onPick }: { email: EmailListItem; active: boolean; onPick: () => void }) {
  const name = senderName(email);
  const text = decodeEntities(email.summary || email.snippet || "").replace(/\s+/g, " ").trim();
  return (
    <ListRow
      active={active}
      onPick={onPick}
      tile={<Avatar name={name} type={email.sender_type} className="size-10 text-[12px]" />}
      top={
        <>
          <span className="truncate text-body font-bold text-ink">{name}</span>
          {email.sender_type !== "external" && <Tag className="bg-selected text-primary max-sm:hidden">{email.sender_type === "staff" ? "Colleague" : "Mailbox"}</Tag>}
        </>
      }
      time={muscatTime(email.received_at)}
      line2={rowSubject(email.subject) || "(no subject)"}
      line3={text}
      side={
        <>
          {email.suggested ? (
            <Tag className="bg-quoted-bg text-quoted" title="Probably about this enquiry">
              {email.suggested.reference}?
            </Tag>
          ) : email.sl_refs.length ? (
            <Tag className="bg-await-bg text-await" title="Reference in the e-mail that is not in the register">
              {email.sl_refs[0]}
            </Tag>
          ) : (
            <Tag className="bg-cancelled-bg text-cancelled">No match</Tag>
          )}
          {email.attachments.length > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[11px] text-ink-muted tabular-nums">
              <Icon name="paperclip" className="size-3" />
              {email.attachments.length}
            </span>
          )}
        </>
      }
    />
  );
}

interface Candidate {
  enquiry: EnquiryRow;
  reasons: string[];
}

/** Enquiries this e-mail may be about, strongest first, with the reasons in words. */
async function findCandidates(email: EmailListItem): Promise<Candidate[]> {
  const reasons = new Map<string, string[]>();
  const add = (id: string, why: string) => {
    const list = reasons.get(id);
    if (!list) reasons.set(id, [why]);
    else if (!list.includes(why)) list.push(why);
  };
  const written = email.sl_refs.map((r) => r.toUpperCase());
  const variants = new Map<string, string>(); // variant → what the e-mail wrote
  for (const w of written) for (const v of referenceVariants(w)) if (!variants.has(v)) variants.set(v, w);

  const [related, byRef] = await Promise.all([
    fetchRelatedEnquiryIds(email.gmail_thread_id, email.sender_type === "external" ? email.from_email : null),
    fetchEnquiriesByReferences([...written, ...variants.keys()]),
  ]);

  for (const id of related.thread) add(id, "Same Gmail conversation");
  for (const row of byRef) if (written.includes(row.reference)) add(row.id, "Reference in the e-mail");
  if (email.suggested) add(email.suggested.id, email.match_method === "ai" ? "Claude's best guess" : "Suggested");
  const first = senderName(email).split(/\s+/)[0];
  for (const s of related.sender.slice(0, 3)) add(s.id, `${first} wrote about it on ${fmtDateLong(muscatDate(s.at))}`);
  // References are issued in sequence, so being one digit away means little on its own: it counts only for a
  // reference with the wrong number of digits, or for an enquiry already connected some other way.
  for (const row of byRef) {
    const w = variants.get(row.reference);
    if (w && (reasons.has(row.id) || !/^SL\d{6}$/.test(w))) add(row.id, `Close to ${w} in the e-mail (${referenceSlip(w, row.reference)})`);
  }

  const ids = [...reasons.keys()].slice(0, 5);
  const known = new Map(byRef.map((r) => [r.id, r]));
  const missing = ids.filter((id) => !known.has(id));
  for (const r of await fetchEnquiriesByIds(missing)) known.set(r.id, r);
  return ids.flatMap((id) => (known.get(id) ? [{ enquiry: known.get(id)!, reasons: reasons.get(id)! }] : []));
}

function ReviewPane({ email, mailbox, onNotice, onDone }: { email: EmailListItem; mailbox?: string; onNotice: (n: ReactNode) => void; onDone: () => void }) {
  const { canEdit } = useAuth();
  const [reference, setReference] = useState(email.suggested?.reference ?? email.sl_refs[0] ?? "");
  const name = senderName(email);

  const candidates = useQuery({ queryKey: ["inbox", "candidates", email.id], queryFn: () => findCandidates(email), staleTime: 60_000 });

  const done = (message: ReactNode) => {
    onNotice(message);
    onDone();
  };
  const link = useMutation({
    mutationFn: (ref: string) => linkEmail(email.id, ref),
    onSuccess: (r) =>
      done(
        <>
          Added to{" "}
          <Link to={`/enquiries/${r.enquiry_id}`} className={refClass}>
            {r.reference}
          </Link>
          .
        </>,
      ),
  });
  const toDraft = useMutation({
    mutationFn: () => draftFromEmail(email.id),
    onSuccess: () => done("Added to “New enquiries”. Check the details there and create it."),
  });
  const ignore = useMutation({
    mutationFn: () => setEmailIgnored(email.id, true),
    onSuccess: () => done("Moved to “Ignored”."),
  });
  const busy = link.isPending || toDraft.isPending || ignore.isPending;
  const error = link.error ?? toDraft.error ?? ignore.error;

  return (
    <article aria-label={`E-mail from ${name}`} className="flex flex-col gap-3 lg:min-h-0 lg:flex-1">
      <PaneHeader
        tile={<Avatar name={name} type={email.sender_type} className="size-13 text-title" />}
        facts={[
          ["Received", fmtDateTime(email.received_at)],
          ["Read by", email.match_method ? READ_BY[email.match_method] : "—"],
          [
            "SL refs found",
            email.sl_refs.length ? (
              <span className="rounded bg-await-bg px-1 text-await tabular-nums">{email.sl_refs.join(", ")}</span>
            ) : (
              "None"
            ),
          ],
        ]}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[1.25rem] font-extrabold text-ink">{name}</span>
          <Tag className="bg-await-bg text-await" icon="alert">
            Needs review
          </Tag>
          <ConfidenceBadge value={email.match_method === "ai" ? email.confidence : null} />
        </div>
        {email.from_email && <div className="text-meta text-ink-muted">{email.from_email}</div>}
      </PaneHeader>

      <PaneBody
        title={rowSubject(email.subject) || "(no subject)"}
        actions={
          canEdit && (
            <>
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (reference.trim()) link.mutate(reference.trim());
                }}
              >
                <input
                  aria-label="Enquiry reference"
                  className={`${inputClass} w-32 tabular-nums`}
                  placeholder="SL26…"
                  value={reference}
                  onChange={(e) => setReference(e.target.value.toUpperCase())}
                />
                <Button type="submit" loading={link.isPending && link.variables === reference.trim()} disabled={busy || !reference.trim()}>
                  Link to enquiry
                </Button>
              </form>
              <Button variant="secondary" loading={toDraft.isPending} disabled={busy} onClick={() => toDraft.mutate()}>
                {!toDraft.isPending && <Icon name="plus" />}
                It's a new enquiry
              </Button>
              <Button variant="ghost" className="ml-auto" loading={ignore.isPending} disabled={busy} onClick={() => ignore.mutate()}>
                Ignore
              </Button>
            </>
          )
        }
      >
        {error && <Alert>{errorMessage(error)}</Alert>}
        {email.note && (
          <Alert kind="info">
            <span className="font-semibold">Why it's here:</span> {email.note}
          </Alert>
        )}

        <SectionLabel line={false}>Which enquiry is it about?</SectionLabel>
        {candidates.isLoading ? (
          <Spinner label="Looking for likely enquiries…" />
        ) : candidates.error ? (
          <Alert>{errorMessage(candidates.error)}</Alert>
        ) : !candidates.data?.length ? (
          <p className="text-meta text-ink-muted">No likely enquiry found. Type a reference below, turn it into a new enquiry, or ignore it.</p>
        ) : (
          <div className="space-y-2">
            {candidates.data.map((c, i) => (
              <EnquiryChoice
                key={c.enquiry.id}
                enquiry={c.enquiry}
                reasons={c.reasons}
                best={i === 0}
                action={
                  canEdit && (
                    <Button
                      variant={i === 0 ? "primary" : "secondary"}
                      size="sm"
                      loading={link.isPending && link.variables === c.enquiry.reference}
                      disabled={busy}
                      onClick={() => link.mutate(c.enquiry.reference)}
                    >
                      <Icon name="check" className="size-3.5" />
                      Link
                    </Button>
                  )
                }
              />
            ))}
          </div>
        )}

        <SectionLabel>The e-mail</SectionLabel>
        <Bubble email={email} mailbox={mailbox} />
      </PaneBody>
    </article>
  );
}
