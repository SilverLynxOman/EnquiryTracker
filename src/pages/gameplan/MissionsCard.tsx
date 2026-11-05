import { Link } from "react-router";
import { Icon, type IconName } from "../../components/icons";
import { Button, Card } from "../../components/ui";
import type { GamePlan, Mission, MissionKind } from "../../lib/gamePlan";
import { DEFAULT_VIEW, writeRegisterView } from "../../lib/registerView";

const KIND: Record<MissionKind, { icon: IconName; tile: string; label: string }> = {
  quote: { icon: "send", tile: "bg-await-bg text-await", label: "Quote" },
  follow_up: { icon: "phone", tile: "bg-quoted-bg text-quoted", label: "Follow-up" },
  high_five: { icon: "hand", tile: "bg-flame-soft text-flame-ink", label: "Team" },
};

export interface MissionActions {
  /** May act on missions: it is this person's own plan. */
  self: boolean;
  canEdit: boolean;
  showXp: boolean;
  /** Key of the mission whose action is saving. */
  busy: string | null;
  onMarkQuoted: (m: Mission) => void;
  onFollowUp: (m: Mission, done: boolean) => void;
  onHighFive: () => void;
}

function MissionAction({ m, a }: { m: Mission; a: MissionActions }) {
  if (!a.self) return null;
  const busy = a.busy === m.key;
  if (m.kind === "quote" && !m.done && a.canEdit) {
    return (
      <Button variant="secondary" size="sm" loading={busy} disabled={a.busy !== null && !busy} onClick={() => a.onMarkQuoted(m)}>
        Mark quoted
      </Button>
    );
  }
  if (m.kind === "follow_up") {
    return m.done ? (
      <Button variant="ghost" size="sm" loading={busy} onClick={() => a.onFollowUp(m, false)}>
        Undo
      </Button>
    ) : (
      <Button variant="secondary" size="sm" loading={busy} disabled={a.busy !== null && !busy} onClick={() => a.onFollowUp(m, true)}>
        {!busy && <Icon name="check" />}
        Followed up
      </Button>
    );
  }
  if (m.kind === "high_five" && !m.done) {
    return (
      <Button variant="secondary" size="sm" onClick={a.onHighFive}>
        <Icon name="hand" />
        Give one
      </Button>
    );
  }
  return null;
}

function MissionRow({ m, a }: { m: Mission; a: MissionActions }) {
  const kind = KIND[m.kind];
  return (
    <li className={`flex flex-wrap items-center gap-3 rounded-panel border px-3 py-2.5 ${m.done ? "border-confirmed/25 bg-confirmed-bg" : "border-line bg-surface"}`}>
      <span
        className={`flex size-7 shrink-0 items-center justify-center rounded-full ${m.done ? "bg-confirmed-dot text-white" : "border-2 border-control text-transparent"}`}
        aria-hidden="true"
      >
        <Icon name="check" className="size-4" />
      </span>
      <span className={`flex size-9 shrink-0 items-center justify-center rounded-control ${kind.tile}`} title={kind.label} aria-hidden="true">
        <Icon name={kind.icon} />
      </span>
      <div className="min-w-0 flex-[1_1_14rem]">
        <div className={`text-body font-semibold ${m.done ? "text-ink-muted line-through" : "text-ink"}`}>
          <span className="sr-only">{m.done ? "Done: " : "To do: "}</span>
          {m.enquiryId ? (
            <Link to={`/enquiries/${m.enquiryId}`} className="hover:text-primary hover:underline">
              {m.title}
            </Link>
          ) : (
            m.title
          )}
        </div>
        <div className="text-meta text-ink-muted">{m.detail}</div>
      </div>
      {a.showXp && (
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-meta font-semibold tabular-nums ${m.done ? "bg-surface text-confirmed" : "bg-selected text-primary"}`}>
          +{m.xp} XP
        </span>
      )}
      <MissionAction m={m} a={a} />
    </li>
  );
}

export function MissionsCard({ plan, salesPersonId, actions }: { plan: GamePlan; salesPersonId: string; actions: MissionActions }) {
  const { missions } = plan;
  const done = missions.filter((m) => m.done).length;
  const allDone = missions.length > 0 && done === missions.length;
  const banked = missions.filter((m) => m.done).reduce((sum, m) => sum + m.xp, 0);
  const waitingLink = `/enquiries?${writeRegisterView({ ...DEFAULT_VIEW, status: "new", period: "all", salesPersonId }).toString()}`;
  const extra = plan.moreToQuote + plan.olderWaiting;

  return (
    <Card
      title="Today's game plan"
      actions={
        <span className="text-meta font-medium tabular-nums text-ink-heading">
          {done} of {missions.length} done
        </span>
      }
    >
      <div
        role="progressbar"
        aria-label="Missions done today"
        aria-valuemin={0}
        aria-valuemax={missions.length}
        aria-valuenow={done}
        className="h-2.5 overflow-hidden rounded-full bg-selected"
      >
        <div className="h-full rounded-full bg-primary transition-[width] duration-150" style={{ width: `${missions.length ? (done / missions.length) * 100 : 0}%` }} />
      </div>
      <p className="mt-2 text-meta text-ink-muted">
        Built from the register: quotes to send, quotes to follow up and one for the team. Quotes tick off by themselves once marked quoted.
      </p>
      <ul className="mt-3 space-y-2">
        {missions.map((m) => (
          <MissionRow key={m.key} m={m} a={actions} />
        ))}
      </ul>
      {extra > 0 && (
        <p className="mt-3 text-meta text-ink-muted">
          {extra} more {extra === 1 ? "enquiry is" : "enquiries are"} waiting for a quote.{" "}
          <Link to={waitingLink} className="font-medium text-primary hover:underline">
            See them in the register
          </Link>
        </p>
      )}
      {allDone && (
        <div role="status" className="mt-3 flex items-center gap-3 rounded-panel bg-ink px-4 py-3 text-white">
          <Icon name="trophy" className="size-7 text-vibe-sun" />
          <div>
            <div className="text-title font-semibold">Game plan complete!</div>
            <div className="text-meta text-white/80">{actions.showXp ? `+${banked} XP banked today. ` : ""}See you tomorrow, same energy.</div>
          </div>
        </div>
      )}
    </Card>
  );
}
