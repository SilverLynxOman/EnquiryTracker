import type { ReactNode } from "react";
import { Icon } from "../../components/icons";
import type { BriefStage, Proof } from "../../lib/enquiryBrief";
import { dayWithWeekday, type Stage, type StageState } from "../../lib/enquiryDetails";
import { ProofLink, proofTitle, type PageActions } from "./shared";

const TONE = { good: "text-confirmed", warn: "text-await", bad: "text-lost", flag: "text-not-genuine" } as const;

const STATE_TEXT: Record<StageState, string> = {
  done: ", done",
  current: ", the current step",
  todo: ", not yet",
  closed: ", closed",
};

function Marker({ state, flag, byMail }: { state: StageState; flag: boolean; byMail: boolean }) {
  if (byMail && state !== "closed") {
    return <span aria-hidden="true" className="size-5 shrink-0 rounded-full border-2 border-dashed border-primary bg-surface" />;
  }
  if (state === "done") {
    return (
      <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-white">
        <Icon name="check" className="size-3" />
      </span>
    );
  }
  if (state === "current") {
    return (
      <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-full border-[3px] border-primary bg-surface">
        <span className="size-1.5 rounded-full bg-primary" />
      </span>
    );
  }
  if (state === "closed" && flag) {
    return (
      <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-full bg-not-genuine-bg text-not-genuine ring-1 ring-not-genuine/40">
        <Icon name="flag" className="size-3" />
      </span>
    );
  }
  if (state === "closed") {
    return (
      <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-full bg-lost-bg text-lost ring-1 ring-lost/40">
        <Icon name="close" className="size-3" />
      </span>
    );
  }
  return <span aria-hidden="true" className="size-5 shrink-0 rounded-full border-2 border-line bg-surface" />;
}

/** A line read from an e-mail: a button that opens that e-mail when the page can, else the text with who wrote it and when. */
function FromMail({ proof, actions, children }: { proof: Proof | null; actions?: Pick<PageActions, "onOpenMail">; children: ReactNode }) {
  if (!proof) return <>{children}</>;
  if (!actions) return <span title={proofTitle(proof)}>{children}</span>;
  return (
    <ProofLink proof={proof} actions={actions}>
      {children}
    </ProofLink>
  );
}

/**
 * The enquiry's progress: received, quoted, follow-ups, won or lost. A step the e-mails show and the register does not
 * has a dashed marker and opens the e-mail it was read from. Whatever is passed as children sits under the steps, in
 * the same panel.
 */
export function StageLine({
  stages,
  today,
  actions,
  children,
}: {
  stages: (Stage | BriefStage)[];
  today: string;
  /** Opens the e-mail a step was read from; without it the step says where it was read on hover. */
  actions?: Pick<PageActions, "onOpenMail">;
  /** More about the progress, under a rule (the shipment's steps). */
  children?: ReactNode;
}) {
  return (
    <section aria-label="Progress" className="rounded-panel border border-line bg-surface p-4">
      <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-0">
        {stages.map((s, i) => {
          const next = stages[i + 1];
          const line = !next
            ? null
            : next.state === "todo"
              ? "bg-line"
              : next.state === "closed"
                ? next.tone === "flag"
                  ? "bg-not-genuine/40"
                  : "bg-lost/40"
                : "bg-primary";
          const read = "byMail" in s ? s : null;
          const byMail = !!read?.byMail && s.state !== "closed";
          const proof = read?.proof ?? null;
          const registerNote = read?.registerNote?.trim() || null;
          return (
            <li key={s.key} className="min-w-0 lg:pr-4">
              <div className="flex items-center">
                <Marker state={s.state} flag={s.tone === "flag"} byMail={byMail} />
                {line && <span aria-hidden="true" className={`ml-2 hidden h-0.5 flex-1 lg:block ${line}`} />}
              </div>
              <div className={`mt-2 text-body font-semibold ${s.state === "current" ? "text-primary-hover" : s.state === "todo" && !byMail ? "text-ink-muted" : "text-ink"}`}>
                {s.label}
                <span className="sr-only">
                  {STATE_TEXT[s.state]}
                  {byMail && ", read from an e-mail, not in the register"}
                </span>
              </div>
              {s.date && (
                <div className="text-meta tabular-nums text-ink-heading">
                  {/* The day is the register's unless the step was read from an e-mail; the e-mail opens from the line below. */}
                  <FromMail proof={byMail ? proof : null} actions={s.note || registerNote ? undefined : actions}>
                    {dayWithWeekday(s.date, today)}
                  </FromMail>
                </div>
              )}
              {s.note && (
                <div className={`break-words text-meta ${s.tone ? `font-medium ${TONE[s.tone]}` : "text-ink-muted"}`}>
                  <FromMail proof={registerNote ? null : proof} actions={actions}>
                    {s.note}
                  </FromMail>
                </div>
              )}
              {registerNote && (
                <div className="break-words text-meta tabular-nums text-await">
                  <FromMail proof={proof} actions={actions}>
                    {registerNote}
                  </FromMail>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {children && <div className="mt-4 border-t border-line pt-3">{children}</div>}
    </section>
  );
}
