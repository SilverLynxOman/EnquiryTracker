import type { ReactNode } from "react";
import * as api from "../../lib/api";
import { AGENT_NOISE_WORDS, findDuplicatePairs, matchKey, portCountry, portMatchKey, type DuplicatePair } from "../../lib/customerDuplicates";
import type { MasterSummary, MergeResult, NotDuplicatePair, PortSummary } from "../../lib/types";

// What differs between the three master lists (customers, agents, port names). The page, tables and dialogs in
// this folder are shared.

export type MasterKey = "customers" | "agents" | "ports";

export interface MasterKind {
  key: MasterKey;
  /** Tab label: "Customers". */
  title: string;
  /** One row, as a column heading: "Customer". */
  column: string;
  noun: string;
  nouns: string;
  /** Label for the remembered names under each row, and one of them. */
  formerLabel: string;
  formerNoun: string;
  /** Why a group's names count as the same when the comparison keys are equal. */
  sameReason: string;
  searchPlaceholder: string;
  /** Radio group label in the merge dialog. */
  keepLabel: string;
  /** Name field label in the merge dialog. */
  nameLabel: string;
  /** What happens to the others, and why imports keep working, after a merge. */
  mergeNote: (others: number) => string;
  renameHint: string;
  /** Only admins may rename (renaming a port rewrites its enquiries). */
  renameNeedsAdmin: boolean;
  /** Optional extra column (contacts, POL / POD use). */
  extra?: { header: string; cell: (row: MasterSummary) => ReactNode };
  fetchSummaries: () => Promise<MasterSummary[]>;
  fetchNotDuplicates: () => Promise<NotDuplicatePair[]>;
  markDistinct: (ids: string[]) => Promise<number>;
  undoNotDuplicate: (pair: Pick<NotDuplicatePair, "a" | "b">) => Promise<void>;
  merge: (keep: MasterSummary, others: MasterSummary[], name: string | null) => Promise<MergeResult>;
  rename: (row: MasterSummary, name: string) => Promise<void>;
  findPairs: (rows: MasterSummary[], dismissed: ReadonlySet<string>, minScore: number) => DuplicatePair[];
}

const others = (n: number, noun: string) => (n === 1 ? `The other ${noun} is` : `The other ${n} ${noun}s are`);

export const CUSTOMERS: MasterKind = {
  key: "customers",
  title: "Customers",
  column: "Customer",
  noun: "customer",
  nouns: "customers",
  formerLabel: "Former names",
  formerNoun: "former name",
  sameReason: "same name apart from punctuation or legal form",
  searchPlaceholder: "Search customer or former name",
  keepLabel: "Customer to keep",
  nameLabel: "Name after the merge",
  mergeNote: (n) =>
    `${others(n, "customer")} then deleted. Their names are remembered as former names, so Excel imports and e-mails that still use them go to the kept customer.`,
  renameHint: "The current name is remembered, so imports and e-mails that use it still find this customer.",
  renameNeedsAdmin: false,
  extra: { header: "Contacts", cell: (r) => r.contacts || "—" },
  fetchSummaries: api.fetchCustomerSummaries,
  fetchNotDuplicates: api.fetchCustomerNotDuplicates,
  markDistinct: api.markCustomersDistinct,
  undoNotDuplicate: api.undoCustomerNotDuplicate,
  merge: (keep, rest, name) => api.mergeCustomers(keep.id, rest.map((r) => r.id), name),
  rename: (row, name) => api.renameCustomer(row.id, name),
  findPairs: (rows, dismissed, min) => findDuplicatePairs(rows, dismissed, min),
};

export const AGENTS: MasterKind = {
  key: "agents",
  title: "Agents",
  column: "Agent",
  noun: "agent",
  nouns: "agents",
  formerLabel: "Former names",
  formerNoun: "former name",
  sameReason: "same name apart from punctuation or a word like Logistics or Freight",
  searchPlaceholder: "Search agent or former name",
  keepLabel: "Agent to keep",
  nameLabel: "Name after the merge",
  mergeNote: (n) =>
    `${others(n, "agent")} then deleted. Their names are remembered as former names, so Excel imports that still use them go to the kept agent.`,
  renameHint: "The current name is remembered, so imports that use it still find this agent.",
  renameNeedsAdmin: false,
  fetchSummaries: api.fetchAgentSummaries,
  fetchNotDuplicates: api.fetchAgentNotDuplicates,
  markDistinct: api.markAgentsDistinct,
  undoNotDuplicate: api.undoAgentNotDuplicate,
  merge: (keep, rest, name) => api.mergeAgents(keep.id, rest.map((r) => r.id), name),
  rename: (row, name) => api.renameAgent(row.id, name),
  findPairs: (rows, dismissed, min) => findDuplicatePairs(rows, dismissed, min, { keyOf: (n) => matchKey(n, AGENT_NOISE_WORDS) }),
};

export const PORTS: MasterKind = {
  key: "ports",
  title: "Ports",
  column: "Port",
  noun: "port",
  nouns: "ports",
  formerLabel: "Other spellings",
  formerNoun: "other spelling",
  sameReason: "same place apart from punctuation or the country",
  searchPlaceholder: "Search port or other spelling",
  keepLabel: "Spelling to keep",
  nameLabel: "Standard name",
  mergeNote: (n) =>
    `${n === 1 ? "The other spelling is" : `The other ${n} spellings are`} remembered: whenever one is typed or imported again, the standard name is used instead.`,
  renameHint: "Every enquiry with this spelling changes to the new one, and the old spelling is remembered for future imports.",
  renameNeedsAdmin: true,
  extra: {
    header: "POL / POD",
    cell: (r) => {
      const p = r as PortSummary;
      return `${p.as_pol.toLocaleString()} / ${p.as_pod.toLocaleString()}`;
    },
  },
  fetchSummaries: api.fetchPortSummaries,
  fetchNotDuplicates: api.fetchPortNotDuplicates,
  markDistinct: api.markPortsDistinct,
  undoNotDuplicate: api.undoPortNotDuplicate,
  merge: (keep, rest, name) => api.mergePorts([keep.id, ...rest.map((r) => r.id)], name ?? keep.name),
  rename: (row, name) => api.mergePorts([row.id], name).then(() => undefined),
  findPairs: (rows, dismissed, min) => findDuplicatePairs(rows, dismissed, min, { keyOf: portMatchKey, scopeOf: portCountry }),
};

export const MASTER_KINDS = [CUSTOMERS, AGENTS, PORTS];
