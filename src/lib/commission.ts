// Commission written in the remarks ("COMMISSION OMR 40/CNTR.", "COMMISSION USD 130/40 HC", "OMR 200.00 COMMSION").
// The database reads it with the same rules on every save (public.parse_commission, migration
// 20261105102158_commission): keep the two in step. This copy shows the result while the remarks are typed.

export interface Commission {
  amount: number;
  /** OMR, USD, AED or EUR; null when the remarks give no currency. */
  currency: string | null;
  /** Per container (or other unit) rather than for the whole shipment. */
  perUnit: boolean;
}

const CURRENCY = "(OMR|USD|AED|EUR|RO)";
const AMOUNT = "([0-9][0-9,]*(?:\\.[0-9]+)?)";
const UNIT = "(\\s*(?:/|PER\\s)\\s*(?:CNTR|CONTAINER|CTR|CONT|UNIT|BOX|TEU|20|40))?";

/** Currency then amount: "OMR 40", "USD130". */
const CURRENCY_FIRST = new RegExp(`\\b${CURRENCY}\\.?\\s*${AMOUNT}${UNIT}`);
/** Amount then currency: "200.00 OMR". */
const AMOUNT_FIRST = new RegExp(`${AMOUNT}\\s*${CURRENCY}\\b${UNIT}`);
/** The word: COMMISSION and its misspellings (COMMISION, COMMSION, COMISSION…), or COMM. Not COMMODITY or COMMENT. */
const WORD = "(?:COM{1,2}I?S{1,2}I?O?NS?|COMM)";
/** The commission word then a bare amount: "COMMISSION 40". */
const WORD_FIRST = new RegExp(`\\b${WORD}\\.?\\s*:?\\s*${AMOUNT}${UNIT}`);
const COMM_WORD = new RegExp(`\\b${WORD}\\b`);

/** The remarks mention commission (even when no amount can be read). */
export const mentionsCommission = (remarks: string | null | undefined) => COMM_WORD.test((remarks ?? "").toUpperCase());

const toNumber = (s: string) => Number(s.replace(/,/g, ""));
const toCurrency = (s: string) => (s === "RO" ? "OMR" : s);

/**
 * The commission in a remarks text, or null when there is none. The text after the commission word is searched
 * first (so "FREIGHT USD 500, COMMISSION OMR 40" gives OMR 40), then the text before it ("OMR 200 COMMSION").
 */
export function parseCommission(remarks: string | null | undefined): Commission | null {
  const found = findCommission(remarks);
  // Larger than the database column holds: a typing slip, not a commission.
  return found && found.amount <= MAX_AMOUNT ? found : null;
}

/** numeric(12,2) holds up to 9,999,999,999.99. */
const MAX_AMOUNT = 9_999_999_999;

function findCommission(remarks: string | null | undefined): Commission | null {
  const text = (remarks ?? "").toUpperCase();
  const at = text.search(COMM_WORD);
  if (at < 0) return null;
  const tail = text.slice(at);
  const head = text.slice(0, at);

  let m = tail.match(CURRENCY_FIRST);
  if (m) return { amount: toNumber(m[2]), currency: toCurrency(m[1]), perUnit: !!m[3] };
  m = tail.match(AMOUNT_FIRST);
  if (m) return { amount: toNumber(m[1]), currency: toCurrency(m[2]), perUnit: !!m[3] };
  m = tail.match(WORD_FIRST);
  if (m) return { amount: toNumber(m[1]), currency: null, perUnit: !!m[2] };
  m = head.match(CURRENCY_FIRST);
  if (m) return { amount: toNumber(m[2]), currency: toCurrency(m[1]), perUnit: !!m[3] };
  m = head.match(AMOUNT_FIRST);
  if (m) return { amount: toNumber(m[1]), currency: toCurrency(m[2]), perUnit: !!m[3] };
  return null;
}

/** Commission for the whole shipment: per-unit amounts times the units (one unit when not known). */
export function commissionTotal(c: Commission, units: number | null | undefined): number {
  return c.perUnit ? c.amount * (units && units > 0 ? units : 1) : c.amount;
}

const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** "OMR 40 per container × 2 = OMR 80", "USD 300 for the shipment". */
export function describeCommission(c: Commission, units: number | null | undefined): string {
  const cur = c.currency ? `${c.currency} ` : "";
  if (!c.perUnit) return `${cur}${money(c.amount)} for the shipment`;
  const n = units && units > 0 ? units : null;
  return n && n > 1
    ? `${cur}${money(c.amount)} per container × ${n} = ${cur}${money(commissionTotal(c, n))}`
    : `${cur}${money(c.amount)} per container`;
}
