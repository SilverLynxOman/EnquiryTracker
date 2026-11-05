import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useAuth } from "../../auth/AuthProvider";
import { Icon, type IconName } from "../../components/icons";
import { Alert, Button, Empty, Spinner, buttonClass, inputClass } from "../../components/ui";
import { draftFromEmail, linkEmail, searchEmails, setEmailIgnored } from "../../lib/api";
import { IGNORE_KINDS, dayLabel, decodeEntities, ignoreKind, muscatTime, rowSubject, senderName, type IgnoreKind } from "../../lib/conversations";
import { gmailThreadUrl, muscatDate } from "../../lib/emailDrafts";
import { errorMessage, fmtDateTime } from "../../lib/format";
import type { EmailListItem } from "../../lib/types";
import { DayPicker, FilterTags, FiltersMenu, ViewToggle, chip, type SenderFilter } from "./ListToolbar";
import {
  Bubble,
  IconTile,
  ListHead,
  ListRow,
  PaneBody,
  PaneHeader,
  PanePlaceholder,
  SearchBox,
  SplitView,
  Tag,
  refClass,
  revealPane,
  useInboxParams,
  useTypedSearch,
} from "./parts";

const DAY_LIMIT = 500;

const KIND_STYLE: Record<IgnoreKind, { icon: IconName; tile: string; short: string }> = {
  bulk: { icon: "inbox", tile: "bg-mode-other-bg text-mode-other", short: "Newsletter" },
  ops: { icon: "ship", tile: "bg-mode-air-bg text-mode-air", short: "Operations" },
  other: { icon: "ban", tile: "bg-cancelled-bg text-cancelled", short: "Not an enquiry" },
  self: { icon: "send", tile: "bg-mode-lcl-bg text-mode-lcl", short: "Sent by us" },
  hand: { icon: "user", tile: "bg-mode-fcl-bg text-mode-fcl", short: "By hand" },
};

function ignoredBy(e: EmailListItem): string {
  if (e.match_method === "manual") return "A colleague, by hand";
  if (e.match_method === "rule") return "Rule";
  if (e.match_method === "ai") return e.confidence != null ? `Claude (${Math.round(e.confidence * 100)}% sure)` : "Claude";
  return "—";
}

/** Mail that is not about an enquiry, a day at a time: the list on the left, the e-mail and the way back on the right. */
export function Ignored({ mailbox, onNotice, onDone, listView }: { mailbox?: string; onNotice: (n: ReactNode) => void; onDone: () => void; listView: ReactNode }) {
  const { params, update } = useInboxParams();
  const today = muscatDate(new Date().toISOString());
  const view = params.get("view") === "list" ? "list" : "threads";
  const q = params.get("q") ?? "";
  const day = params.get("day") || today;
  const sender = (params.get("sender") ?? "") as SenderFilter;
  const filesOnly = params.get("files") === "1";
  const kind = (params.get("kind") ?? "") as "" | IgnoreKind;
  const [typed, setTyped] = useTypedSearch(q, update);
  const paneRef = useRef<HTMLDivElement>(null);

  const search = { status: "ignored" as const, q, sender, from: q ? "" : day, to: q ? "" : day, page: 0, pageSize: DAY_LIMIT };
  const emails = useQuery({
    queryKey: ["inbox", "history", "ignored-day", search],
    queryFn: () => searchEmails(search),
    placeholderData: keepPreviousData,
    refetchInterval: day === today ? 60_000 : false,
    enabled: view === "threads",
  });
  const all = (emails.data?.rows ?? []).filter((m) => !filesOnly || m.attachments.length > 0);
  const counts = all.reduce<Record<string, number>>((c, m) => ((c[ignoreKind(m)] = (c[ignoreKind(m)] ?? 0) + 1), c), {});
  const shown = kind ? all.filter((m) => ignoreKind(m) === kind) : all;
  const selected = shown.find((m) => m.id === params.get("e")) ?? shown[0];
  const filtered = Boolean(q || sender || filesOnly || kind);

  if (view === "list")
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-end gap-2 text-meta text-ink-muted">
          Every e-mail, newest first
          <ViewToggle view={view} onChange={(v) => update({ view: v === "threads" ? "" : v })} labels={{ threads: "A day at a time" }} />
        </div>
        {listView}
      </div>
    );

  const list = (
    <>
      <ListHead
        tools={
          <>
            <SearchBox value={typed} onChange={setTyped} placeholder="Search subject or sender" />
            <DayPicker status="ignored" day={day} today={today} sender={sender} searching={!!q} onPick={(d) => update({ day: d >= today ? "" : d, e: "" })} />
            <FiltersMenu sender={sender} filesOnly={filesOnly} onChange={(c) => update({ ...c, e: "" })} />
            <ViewToggle view={view} onChange={(v) => update({ view: v === "threads" ? "" : v })} labels={{ threads: "A day at a time" }} />
          </>
        }
        chips={IGNORE_KINDS.filter((k) => counts[k.key]).map((k) => (
          <button key={k.key} type="button" aria-pressed={kind === k.key} className={chip(kind === k.key)} onClick={() => update({ kind: kind === k.key ? "" : k.key, e: "" })}>
            <Icon name={KIND_STYLE[k.key].icon} className="size-3.5" />
            {k.label}
            <span className="font-bold tabular-nums">{counts[k.key]}</span>
          </button>
        ))}
        summary={
          <>
            <span className="font-semibold text-ink">{emails.isLoading ? "Loading…" : `${shown.length} e-mail${shown.length === 1 ? "" : "s"}`}</span>
            <span className="text-ink-muted">{q ? `matching “${q}”, all dates` : dayLabel(day, today)}</span>
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
                  update({ q: "", sender: "", files: "", kind: "", e: "" });
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
          <Empty>{filtered ? "No e-mails match. Try fewer filters." : `Nothing ignored ${day === today ? "yet today" : "on this day"}.`}</Empty>
        </div>
      ) : (
        <ul className={`min-h-0 flex-1 divide-y divide-line overflow-y-auto ${emails.isPlaceholderData ? "opacity-60" : ""}`}>
          {shown.map((m) => (
            <IgnoredRow
              key={m.id}
              email={m}
              searching={!!q}
              active={m === selected}
              onPick={() => {
                update({ e: m.id });
                revealPane(paneRef);
              }}
            />
          ))}
        </ul>
      )}
      {(emails.data?.rows.length ?? 0) >= DAY_LIMIT && (
        <p className="border-t border-line px-3 py-2 text-meta text-ink-muted">
          Showing the latest {DAY_LIMIT} e-mails. Narrow the search, or use “Every e-mail” to page through all of them.
        </p>
      )}
    </>
  );

  return (
    <SplitView
      list={list}
      paneRef={paneRef}
      pane={
        selected ? (
          <IgnoredPane key={selected.id} email={selected} mailbox={mailbox} onNotice={onNotice} onDone={onDone} />
        ) : (
          !emails.isLoading && <PanePlaceholder>Pick an e-mail to read it.</PanePlaceholder>
        )
      }
    />
  );
}

function IgnoredRow({ email, searching, active, onPick }: { email: EmailListItem; searching: boolean; active: boolean; onPick: () => void }) {
  const k = KIND_STYLE[ignoreKind(email)];
  const text = decodeEntities(email.summary || email.snippet || "").replace(/\s+/g, " ").trim();
  const today = muscatDate(new Date().toISOString());
  return (
    <ListRow
      active={active}
      onPick={onPick}
      tile={<IconTile icon={k.icon} className={k.tile} />}
      top={<span className="truncate text-body font-bold text-ink">{senderName(email)}</span>}
      time={`${searching ? `${dayLabel(muscatDate(email.received_at), today).replace(/ \d{4}$/, "")} ` : ""}${muscatTime(email.received_at)}`}
      line2={rowSubject(email.subject) || "(no subject)"}
      line3={text}
      side={
        <>
          <Tag className="bg-cancelled-bg text-cancelled">{k.short}</Tag>
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

function IgnoredPane({ email, mailbox, onNotice, onDone }: { email: EmailListItem; mailbox?: string; onNotice: (n: ReactNode) => void; onDone: () => void }) {
  const { canEdit } = useAuth();
  const [reference, setReference] = useState<string | null>(null);
  const kindKey = ignoreKind(email);
  const k = KIND_STYLE[kindKey];
  const name = senderName(email);

  const done = (message: ReactNode) => {
    onNotice(message);
    onDone();
  };
  const unignore = useMutation({ mutationFn: () => setEmailIgnored(email.id, false), onSuccess: () => done("Moved to “Needs review”.") });
  const toDraft = useMutation({
    mutationFn: () => draftFromEmail(email.id),
    onSuccess: () => done("Added to “New enquiries”. Check the details there and create it."),
  });
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
  const busy = unignore.isPending || toDraft.isPending || link.isPending;
  const error = unignore.error ?? toDraft.error ?? link.error;

  return (
    <article aria-label={`Ignored e-mail from ${name}`} className="flex flex-col gap-3 lg:min-h-0 lg:flex-1">
      <PaneHeader
        tile={<IconTile icon={k.icon} className={k.tile} size="lg" />}
        facts={[
          ["Received", fmtDateTime(email.received_at)],
          ["Ignored by", ignoredBy(email)],
          ["Files", email.attachments.length || "None"],
        ]}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[1.25rem] font-extrabold text-ink">{name}</span>
          <Tag className="bg-cancelled-bg text-cancelled" icon="ban">
            Ignored
          </Tag>
          <Tag className={k.tile}>{IGNORE_KINDS.find((x) => x.key === kindKey)!.label}</Tag>
        </div>
        {email.from_email && <div className="text-meta text-ink-muted">{email.from_email}</div>}
      </PaneHeader>

      <PaneBody
        title={rowSubject(email.subject) || "(no subject)"}
        actions={
          <>
            {canEdit && (
              <>
                <Button variant="secondary" loading={unignore.isPending} disabled={busy} onClick={() => unignore.mutate()}>
                  {!unignore.isPending && <Icon name="refresh" />}
                  Move to review
                </Button>
                <Button variant="secondary" loading={toDraft.isPending} disabled={busy} onClick={() => toDraft.mutate()}>
                  {!toDraft.isPending && <Icon name="plus" />}
                  It's a new enquiry
                </Button>
                {reference === null ? (
                  <Button variant="secondary" disabled={busy} onClick={() => setReference("")}>
                    <Icon name="merge" />
                    Link to enquiry…
                  </Button>
                ) : (
                  <form
                    className="flex items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (reference.trim()) link.mutate(reference.trim());
                    }}
                  >
                    <input
                      aria-label="Enquiry reference"
                      autoFocus
                      className={`${inputClass} w-32 tabular-nums`}
                      placeholder="SL26…"
                      value={reference}
                      onChange={(e) => setReference(e.target.value.toUpperCase())}
                    />
                    <Button type="submit" variant="secondary" loading={link.isPending} disabled={busy || !reference.trim()}>
                      Link
                    </Button>
                    <Button variant="ghost" onClick={() => setReference(null)}>
                      Cancel
                    </Button>
                  </form>
                )}
              </>
            )}
            <a href={gmailThreadUrl(email.gmail_thread_id, mailbox)} target="_blank" rel="noreferrer" className={buttonClass("ghost", "md", "ml-auto")}>
              Open in Gmail
              <Icon name="external" className="size-3.5" />
            </a>
          </>
        }
      >
        {error && <Alert>{errorMessage(error)}</Alert>}
        {(email.note || email.summary) && (
          <Alert kind="info">
            <span className="font-semibold">Why it was ignored:</span> {email.note || email.summary}
          </Alert>
        )}
        <Bubble email={email} mailbox={mailbox} />
      </PaneBody>
    </article>
  );
}
