import { Icon } from "../../components/icons";
import { Button, Card } from "../../components/ui";
import { WINDOW_MAX, WINDOW_MIN } from "../../lib/quoteWindow";

/** The viewer's own settings: the win window's length (their mode filter and order are remembered as they use them). */
export function WindowSettings({
  windowDays,
  suggested,
  custom,
  onChange,
  onReset,
}: {
  windowDays: number;
  /** The window their own wins suggest. */
  suggested: number;
  /** They chose their own length. */
  custom: boolean;
  onChange: (days: number) => void;
  onReset: () => void;
}) {
  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2">
          <Icon name="sliders" className="size-4 text-ink-muted" />
          Make it yours
        </span>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-ink">Win window</p>
          <p className="text-meta text-ink-muted">{custom ? `Your wins suggest ${suggested} days` : "Set from your own wins"}</p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="secondary" size="sm" className="w-8 px-0 text-body" aria-label="Shorter win window" disabled={windowDays <= WINDOW_MIN} onClick={() => onChange(windowDays - 1)}>
            −
          </Button>
          <span className="w-16 text-center font-semibold tabular-nums text-ink" aria-live="polite">
            {windowDays} days
          </span>
          <Button variant="secondary" size="sm" className="w-8 px-0 text-body" aria-label="Longer win window" disabled={windowDays >= WINDOW_MAX} onClick={() => onChange(windowDays + 1)}>
            +
          </Button>
        </div>
      </div>
      {custom && (
        <Button variant="ghost" size="sm" className="mt-2 -ml-2.5" onClick={onReset}>
          Use {suggested} days, from my wins
        </Button>
      )}
      <p className="mt-3 text-meta text-ink-muted">Your mode filter and order are remembered too. Only you see these settings.</p>
    </Card>
  );
}
