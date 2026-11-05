import type { TradeType } from "./types";

/**
 * Reads our house-style subject back into register fields: "1X40' HC EX-WORKS NINGBO CHINA TO SOHAR OMAN".
 * The requests for rates we send to agents use it, so their replies (Inbox, Waiting for reference) carry it too,
 * wrapped in "RE:", "[EXTERNAL]", the SL reference and the agent's own quote numbers. It is the inverse of
 * buildSubject in supabase/functions/_shared/email/ai.ts. Subjects in any other shape give null: no guessing.
 */
export interface HouseSubject {
  qty_text: string | null;
  /** EXW, FOB, …; "EX-WORKS" is read as EXW. */
  incoterm: string | null;
  pol: string;
  pod: string;
  trade_type: TradeType | null;
  /** The subject without the reference, as the register writes it. */
  subject: string;
}

const CONTAINER = String.raw`\d+\s*[X×*]\s*(?:20|40|45)['’]?(?:\s*(?:HC|HQ|RF|REEFER|OT|FR|GP|DV|NOR|HIGH CUBE))?['’]?`;
const QTY = String.raw`(?:${CONTAINER}(?:\s*[/+&]\s*${CONTAINER})*|AIR|LCL|FCL|COURIER|RO-?RO|BREAK BULK)`;
const INCOTERM = String.raw`(?:EX-?WORKS|EXW|FCA|FOB|FAS|CFR|CNF|CIF|CPT|CIP|DAP|DPU|DDP)`;
const QTY_RE = new RegExp(String.raw`^(${QTY})(?=\s|$)\s*`);
const INCOTERM_RE = new RegExp(String.raw`^(${INCOTERM})(?=\s|$)\s*`);
const WORD = /^[A-Z][A-Z.&'-]*$/;
const PLACE_RE = /^[A-Z][A-Z.&'-]*(?: [A-Z][A-Z.&'-]*){0,4}$/;
/** Words after the port of discharge that start something else ("… TO SOHAR OMAN VIA JEBEL ALI"). */
const STOP = new Set(["VIA", "BY", "FOR", "PO", "REF", "ENQ", "ENQUIRY", "INQUIRY", "RFQ", "URGENT", "QUOTE", "QUOTATION", "RATE", "RATES", "REQUEST", "AND"]);
const PREFIX_RE = /^\s*(?:\[[^\]]*\]\s*[-:]?\s*|(?:re|fw|fwd|aw|r|tr|sv)\s*[:：]\s*|[-:|/]+\s*)/i;

export function parseHouseSubject(raw: string | null | undefined): HouseSubject | null {
  if (!raw) return null;
  let s = raw.replace(/\bSL\s?-?\d{4,}\b/gi, " ");
  for (let prev = ""; prev !== s; ) {
    prev = s;
    s = s.replace(PREFIX_RE, "");
  }
  s = s.toUpperCase().replace(/\s+/g, " ").trim();

  const split = s.match(/^(.*?) TO (.*)$/);
  if (!split) return null;
  let left = split[1];

  const qty = left.match(QTY_RE);
  if (qty) left = left.slice(qty[0].length);
  const inco = left.match(INCOTERM_RE);
  if (inco) left = left.slice(inco[0].length);
  // Without a quantity or an incoterm, "… TO …" is just a sentence ("REPLY TO MR ALI").
  if (!qty && !inco) return null;
  const pol = left.trim();
  if (!PLACE_RE.test(pol)) return null;

  const podWords: string[] = [];
  for (const token of split[2].split(" ")) {
    const word = token.replace(/[,;.:]+$/, "");
    if (!WORD.test(word) || STOP.has(word) || podWords.length === 4) break;
    podWords.push(word);
    if (word !== token) break;
  }
  const pod = podWords.join(" ");
  if (!pod) return null;

  const qtyText = qty ? qty[1].replace(/\s+/g, " ").trim() : null;
  const incoText = inco ? inco[1] : null;
  const incoterm = incoText ? (/^EX-?WORKS$/.test(incoText) ? "EXW" : incoText === "CNF" ? "CFR" : incoText) : null;
  const trade_type: TradeType | null = pod.includes("OMAN") ? "IMP" : pol.includes("OMAN") ? "EXP" : "CT";
  return {
    qty_text: qtyText,
    incoterm,
    pol,
    pod,
    trade_type,
    subject: [qtyText, incoText, `${pol} TO ${pod}`].filter(Boolean).join(" "),
  };
}

/** The first of these subjects, oldest first, that is in house style. */
export function firstHouseSubject(subjects: (string | null | undefined)[]): HouseSubject | null {
  for (const s of subjects) {
    const parsed = parseHouseSubject(s);
    if (parsed) return parsed;
  }
  return null;
}
