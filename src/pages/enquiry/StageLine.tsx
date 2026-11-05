import { Icon } from "../../components/icons";
import { dayWithWeekday, type Stage, type StageState } from "../../lib/enquiryDetails";

const TONE = { good: "text-confirmed", warn: "text-await", bad: "text-lost" } as const;

const STATE_TEXT: Record<StageState, string> = {
  done: ", done",
  current: ", the current step",
  todo: ", not yet",
  closed: ", closed",
};

function Marker({ state }: { state: StageState }) {
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
  if (state === "closed") {
    return (
      <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-full bg-lost-bg text-lost ring-1 ring-lost/40">
        <Icon name="close" className="size-3" />
      </span>
    );
  }
  return <span aria-hidden="true" className="size-5 shrink-0 rounded-full border-2 border-line bg-surface" />;
}

/** The enquiry's progress: received, quoted, follow-ups, won or lost. */
export function StageLine({ stages, today }: { stages: Stage[]; today: string }) {
  return (
    <section aria-label="Progress" className="rounded-panel border border-line bg-surface p-4">
      <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-0">
        {stages.map((s, i) => {
          const next = stages[i + 1];
          const line = !next ? null : next.state === "todo" ? "bg-line" : next.state === "closed" ? "bg-lost/40" : "bg-primary";
          return (
            <li key={s.key} className="min-w-0 lg:pr-4">
              <div className="flex items-center">
                <Marker state={s.state} />
                {line && <span aria-hidden="true" className={`ml-2 hidden h-0.5 flex-1 lg:block ${line}`} />}
              </div>
              <div className={`mt-2 text-body font-semibold ${s.state === "current" ? "text-primary-hover" : s.state === "todo" ? "text-ink-muted" : "text-ink"}`}>
                {s.label}
                <span className="sr-only">{STATE_TEXT[s.state]}</span>
              </div>
              {s.date && <div className="text-meta tabular-nums text-ink-heading">{dayWithWeekday(s.date, today)}</div>}
              {s.note && <div className={`text-meta ${s.tone ? `font-medium ${TONE[s.tone]}` : "text-ink-muted"}`}>{s.note}</div>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
