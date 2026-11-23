import { useCallback, useState } from "react";
import type { BriefOverrides, OtherParty } from "../../lib/enquiryBrief";

// Choices a person makes about how one enquiry's e-mails are read ("Treat as customer", "Keep here", "Done by
// phone", "Keep the register's"). They live in this browser only: a convenience, so every access may fail
// (private windows, blocked storage) and the page reads the e-mails without them.

const EMPTY: BriefOverrides = { party: {}, keptThreads: [], dismissed: [] };

function storageKey(enquiryId: string) {
  return `enquiry-brief:${enquiryId}`;
}

function read(enquiryId: string): BriefOverrides {
  try {
    const raw = localStorage.getItem(storageKey(enquiryId));
    if (!raw) return EMPTY;
    const v = JSON.parse(raw) as Partial<BriefOverrides>;
    return {
      party: v.party && typeof v.party === "object" ? v.party : {},
      keptThreads: Array.isArray(v.keptThreads) ? v.keptThreads.filter((t) => typeof t === "string") : [],
      dismissed: Array.isArray(v.dismissed) ? v.dismissed.filter((t) => typeof t === "string") : [],
    };
  } catch {
    return EMPTY;
  }
}

function write(enquiryId: string, value: BriefOverrides) {
  try {
    const empty = !Object.keys(value.party).length && !value.keptThreads.length && !value.dismissed.length;
    if (empty) localStorage.removeItem(storageKey(enquiryId));
    else localStorage.setItem(storageKey(enquiryId), JSON.stringify(value));
  } catch {
    /* not kept; the choice still applies until the page is left */
  }
}

/** This browser's choices for one enquiry, and the setters the page's actions call. */
export function useBriefOverrides(enquiryId: string) {
  const [overrides, setOverrides] = useState<BriefOverrides>(() => read(enquiryId));

  const update = useCallback(
    (change: (prev: BriefOverrides) => BriefOverrides) =>
      setOverrides((prev) => {
        const next = change(prev);
        write(enquiryId, next);
        return next;
      }),
    [enquiryId],
  );

  const treatAs = useCallback(
    (address: string, party: OtherParty) => update((prev) => ({ ...prev, party: { ...prev.party, [address.trim().toLowerCase()]: party } })),
    [update],
  );
  const keepThreads = useCallback(
    (threadIds: string[]) => update((prev) => ({ ...prev, keptThreads: [...new Set([...prev.keptThreads, ...threadIds])] })),
    [update],
  );
  const dismiss = useCallback((id: string) => update((prev) => ({ ...prev, dismissed: [...new Set([...prev.dismissed, id])] })), [update]);
  const undismiss = useCallback((id: string) => update((prev) => ({ ...prev, dismissed: prev.dismissed.filter((d) => d !== id) })), [update]);

  return { overrides, treatAs, keepThreads, dismiss, undismiss };
}
