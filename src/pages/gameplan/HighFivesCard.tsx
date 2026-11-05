import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Icon } from "../../components/icons";
import { Alert, Button, Card, inputClass, Spinner } from "../../components/ui";
import { fetchHighFives, fetchSalesPersons, giveHighFive } from "../../lib/api";
import { displayName, fmtDayMonth, initials } from "../../lib/display";
import { addDays, errorMessage } from "../../lib/format";
import type { HighFive } from "../../lib/types";

export function senderName(h: HighFive): string {
  return displayName(h.sender?.name) || h.giver?.full_name || "A teammate";
}

/** High-fives received in the last two weeks, and a form to give one. */
export function HighFivesCard({
  salesPersonId,
  name,
  self,
  mySalesPersonId,
  today,
  selectId,
  onGiven,
}: {
  salesPersonId: string;
  name: string;
  /** The viewer's own plan: they choose whom to thank. Otherwise the high-five goes to this plan's person. */
  self: boolean;
  mySalesPersonId: string | null;
  today: string;
  /** id of the first form control, so the plan's high-five mission can move focus here. */
  selectId: string;
  onGiven: (to: string) => void;
}) {
  const queryClient = useQueryClient();
  const since = addDays(today, -14);
  const received = useQuery({ queryKey: ["plan", "high-fives", salesPersonId, since], queryFn: () => fetchHighFives(since, salesPersonId, 10) });
  const persons = useQuery({ queryKey: ["sales-persons"], queryFn: fetchSalesPersons, enabled: self });
  const teammates = (persons.data ?? []).filter((p) => p.id !== mySalesPersonId);
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("");
  const target = self ? to : salesPersonId;
  const targetName = self ? displayName(teammates.find((p) => p.id === to)?.name) : name;

  const give = useMutation({
    mutationFn: () => giveHighFive({ to: target, from: mySalesPersonId, message: message.trim() || null, day: today }),
    onSuccess: () => {
      for (const key of ["plan", "voyage"]) queryClient.invalidateQueries({ queryKey: [key] });
      setMessage("");
      setTo("");
      onGiven(targetName);
    },
  });

  return (
    <Card title="High-fives" actions={<span className="text-meta text-ink-muted">last two weeks</span>}>
      {received.error ? (
        <Alert>High-fives could not be loaded. {errorMessage(received.error)}</Alert>
      ) : received.isLoading ? (
        <Spinner />
      ) : !received.data?.length ? (
        <p className="text-body text-ink-muted">{self ? "No high-fives for you yet this fortnight. Give one: they come back." : `No high-fives for ${name} yet this fortnight.`}</p>
      ) : (
        <ul className="space-y-2">
          {received.data.map((h) => (
            <li key={h.id} className="flex gap-3 rounded-panel bg-flame-soft px-3 py-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface text-meta font-semibold text-flame-ink" aria-hidden="true">
                {initials(senderName(h))}
              </span>
              <div className="min-w-0">
                <div className="text-meta text-ink-muted">
                  <span className="font-semibold text-ink">{senderName(h)}</span> · {fmtDayMonth(h.given_on, today)}
                </div>
                <p className="text-body text-ink">{h.message || "High-five!"}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {(!self || teammates.length > 0) && (
        <form
          className="mt-4 space-y-2 border-t border-line pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (target) give.mutate();
          }}
        >
          {self ? (
            <label className="block">
              <span className="mb-1 block text-meta font-medium text-ink-heading">Give a high-five to</span>
              <select id={selectId} value={to} onChange={(e) => setTo(e.target.value)} className={inputClass}>
                <option value="">Choose a teammate…</option>
                {teammates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {displayName(p.name)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="text-meta font-medium text-ink-heading">Give {name} a high-five</p>
          )}
          <label className="block">
            <span className="sr-only">Message (optional)</span>
            <input
              id={self ? undefined : selectId}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={140}
              placeholder="Say thanks or well done (optional)"
              className={inputClass}
            />
          </label>
          <Button type="submit" variant="secondary" loading={give.isPending} disabled={!target}>
            {!give.isPending && <Icon name="hand" />}
            Send high-five
          </Button>
          {give.error && <p className="text-meta text-lost">The high-five could not be sent. {errorMessage(give.error)}</p>}
        </form>
      )}
    </Card>
  );
}
