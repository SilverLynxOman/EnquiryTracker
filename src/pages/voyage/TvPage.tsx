import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Logo } from "../../components/icons";
import { fmtDayMonth } from "../../lib/display";
import { errorMessage, todayIso } from "../../lib/format";
import { MODE_LABELS } from "../../lib/types";
import { dayLabel, laneLabel, monthLabel } from "../../lib/workdays";
import { CREW_BG, TeamShip } from "./TeamShip";
import { comparedWithLastMonth, shipLabel, shipSlots, useTeamVoyage } from "./TeamVoyage";

const REFRESH = 120_000;

function Tile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-panel bg-tv-panel px-5 py-3">
      <dt className="text-title text-tv-muted">{label}</dt>
      <dd className="text-tv-figure font-bold tabular-nums">{value}</dd>
    </div>
  );
}

/** The team voyage for the office screen: no navigation, big type, refreshes itself every two minutes. */
export default function TvPage() {
  const [today, setToday] = useState(todayIso);
  useEffect(() => {
    const t = setInterval(() => setToday(todayIso()), 60_000);
    return () => clearInterval(t);
  }, []);
  const v = useTeamVoyage(today, REFRESH);
  const byId = new Map(v.crew.map((c) => [c.id, c]));
  // Sized to fit a 1920 × 1080 screen without scrolling: nobody scrolls a wall screen.
  const latest = [...v.wins].reverse().slice(0, 4);
  const crew = v.crew.slice(0, 8);
  const left = Math.max(0, v.target - v.loaded);

  return (
    <div className="min-h-screen bg-tv-page text-white">
      <header className="flex flex-wrap items-center gap-x-8 gap-y-2 px-8 py-5">
        <div className="flex items-center gap-3 text-tv font-semibold">
          <Logo className="h-7 w-11" />
          Enquiry Tracker
        </div>
        <p className="text-tv text-tv-muted">
          {dayLabel(today)} · day {v.pace.day} of {v.pace.total}
        </p>
        <Link to="/" className="ml-auto rounded-control px-3 py-2 text-body font-medium text-tv-muted hover:bg-tv-panel hover:text-white">
          Exit TV view
        </Link>
      </header>

      <main className="space-y-5 px-8 pb-8">
        {v.error ? (
          <p role="alert" className="rounded-panel bg-tv-panel p-6 text-tv">
            The voyage could not be loaded. {errorMessage(v.error)}
          </p>
        ) : v.loading ? (
          <p role="status" className="text-tv text-tv-muted">
            Loading the voyage…
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div>
                <p className="text-tv font-semibold text-ship-sun">The {monthLabel(v.month)} voyage</p>
                <h1 className="text-tv-figure font-extrabold">
                  {v.loaded} of {v.target} containers loaded
                </h1>
                <p className="text-tv text-tv-muted">
                  {left > 0 ? `${left} to go.` : "Goal reached!"} {comparedWithLastMonth(v) ?? "One container for every confirmed job."}
                </p>
              </div>
              <dl className="flex flex-wrap gap-4">
                {v.lastPoint && <Tile label={`${v.lastMonthLabel} at this point`} value={v.lastPoint.byNow} />}
                {v.record && <Tile label={`Record, ${monthLabel(v.record.month)}`} value={v.record.confirmed} />}
                <Tile label="Working days left" value={Math.max(0, v.pace.total - v.pace.done)} />
              </dl>
            </div>

            <TeamShip rock slots={shipSlots(v.wins, v.crew, v.target)} label={shipLabel(v)} />

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="rounded-panel bg-tv-panel p-6">
                <h2 className="mb-3 text-tv font-semibold">Just loaded</h2>
                {latest.length === 0 ? (
                  <p className="text-title text-tv-muted">The first container of the month is up for grabs.</p>
                ) : (
                  <ul className="divide-y divide-white/10">
                    {latest.map((w) => {
                      const member = byId.get(w.sales_person_id ?? "");
                      return (
                        <li key={w.id} className="flex items-center gap-4 py-3">
                          <span className={`stripes h-6 w-10 shrink-0 rounded-[3px] ${CREW_BG[member?.colour ?? 0]}`} aria-hidden="true" />
                          <div className="min-w-0">
                            <div className="text-tv font-semibold">{member?.name ?? "Unassigned"} loaded a container</div>
                            <div className="text-title text-tv-muted">
                              {[w.shipment_mode ? MODE_LABELS[w.shipment_mode] : null, laneLabel(w.pol, w.pod), w.confirmed_date ? fmtDayMonth(w.confirmed_date, today) : null]
                                .filter(Boolean)
                                .join(" · ")}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <section className="rounded-panel bg-tv-panel p-6">
                <h2 className="mb-3 text-tv font-semibold">The crew</h2>
                <ul className="grid grid-cols-2 gap-x-6 gap-y-2">
                  {crew.map((m) => (
                    <li key={m.id || "unassigned"} className="flex items-center gap-3 text-tv">
                      <span className={`stripes h-5 w-8 shrink-0 rounded-[3px] ${CREW_BG[m.colour] ?? CREW_BG[0]}`} aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">{m.name}</span>
                      <span className="font-bold tabular-nums">{m.wins}</span>
                    </li>
                  ))}
                </ul>
                {v.crew.length > crew.length && <p className="mt-2 text-title text-tv-muted">and {v.crew.length - crew.length} more on the board</p>}
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
