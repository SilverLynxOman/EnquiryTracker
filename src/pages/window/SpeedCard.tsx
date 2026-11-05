import { Card } from "../../components/ui";

interface Share {
  share: number;
  count: number;
}

/** Fewer quotes than this and a percentage says little. */
const MIN_QUOTES = 5;

function Bar({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div>
      <div className={`flex justify-between gap-2 text-meta ${strong ? "font-semibold text-ink" : "text-ink-muted"}`}>
        <span>{label}</span>
        <span className="tabular-nums">{value}%</span>
      </div>
      <div aria-hidden="true" className={`mt-1 h-2 rounded-full ${strong ? "bg-selected" : "bg-table-head"}`}>
        <div className={`h-2 rounded-full ${strong ? "bg-primary" : "bg-cancelled-dot"}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

/** How quickly this person quotes, next to the team. */
export function SpeedCard({ mine, team, label, days }: { mine: Share; team: Share; label: string; days: number }) {
  const pct = (s: Share) => Math.round(s.share * 100);
  return (
    <Card title="Quick quotes">
      {mine.count < MIN_QUOTES ? (
        <p className="text-meta text-ink-muted">Too few quotes in the last {days} days to compare yet.</p>
      ) : (
        <div className="space-y-3">
          <Bar label={label} value={pct(mine)} strong />
          <Bar label="Team" value={pct(team)} />
        </div>
      )}
      <p className="mt-3 text-meta text-ink-muted">Enquiries from the last {days} days quoted by the end of the next working day.</p>
    </Card>
  );
}
