import type { Lifecycle } from "../../lib/masterActivity";
import type { MasterSummary } from "../../lib/types";
import { DEFAULT_VIEW, writeRegisterView } from "../../lib/registerView";

export const th = "sticky top-0 z-10 h-10 border-b border-line bg-table-head px-3 text-left text-meta font-medium whitespace-nowrap text-ink-heading";
export const td = "border-b border-line px-3 py-2 align-middle";

/**
 * The register searched for this customer over all dates. The register search drops brackets and commas, so the
 * name is cut before the first one: "THILAL TRD (TATCO)" searches "THILAL TRD".
 */
export function enquiriesLink(name: string): string {
  const q = name.split(/[(),%*"\\]/)[0].trim();
  return `/enquiries?${writeRegisterView({ ...DEFAULT_VIEW, period: "all", q }).toString()}`;
}

/** One row of a master list: the summary view's counts plus what the activity fetch adds. */
export interface MasterRow extends MasterSummary {
  first_enquiry: string | null;
  /** Enquiries in each of the last 12 months, oldest first; empty while the activity is loading. */
  monthly: number[];
  /** The sales person on most of its enquiries. */
  top_sales: string | null;
  life: Lifecycle;
  /** In a possible-duplicate group that is still to be reviewed. */
  duplicate: boolean;
}
