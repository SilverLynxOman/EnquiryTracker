import { nameKey } from "./normalize";
import type { MasterSummary } from "./types";

// Duplicate finder for the master data: customers, agents and port names. It runs in the browser: comparing every
// pair of a few thousand names takes milliseconds here, while the same self-join in Postgres cannot use a trigram
// index.

/** Words that never tell two companies apart. */
const NOISE_WORDS = new Set(["LLC", "CO", "COMPANY", "SPC", "SAOC", "SAOG", "LTD", "LIMITED", "EST", "ESTABLISHMENT", "AND", "THE"]);

/** For agents, trade words are noise too: `BARRIO LOGISTICS` is `BARRIO`, `SHENZHEN WORLD CARGO` is `SHENZHEN WORLD`. */
export const AGENT_NOISE_WORDS: ReadonlySet<string> = new Set([
  ...NOISE_WORDS,
  "LOGISTICS", "LOGISTIC", "SHIPPING", "SHIPING", "FREIGHT", "CARGO", "GLOBAL", "FORWARDING", "FORWARDERS",
  "INTERNATIONAL", "INTERNATIONA", "INTERNATIO", "INTL",
]);

/**
 * Comparison key: the name key without legal forms (LLC, CO., SAOC…), "&", brackets and dashes, with a plural S
 * dropped from each word. `GODREJ & KHIMJI` and `Godrej Khimji LLC` both give `GODREJ KHIMJI`.
 */
export function matchKey(name: string, noise: ReadonlySet<string> = NOISE_WORDS): string {
  const key = (nameKey(name) ?? "").replace(/[&()/+\-]/g, " ").replace(/\bL L C\b/g, " ");
  return key
    .split(/\s+/)
    .filter((w) => w && !noise.has(w))
    .map((w) => (/[A-Z]{2}S$/.test(w) ? w.slice(0, -1) : w))
    .join(" ");
}

/** Countries as the register writes them after a port (`SOHAR OMAN`, `DURBAN SOUTH AFRICA`). Longest first. */
const COUNTRIES = [
  "UNITED ARAB EMIRATES", "SAUDI ARABIA", "SOUTH AFRICA", "NORTH AFRICA", "SRI LANKA", "SOUTH KOREA", "CZECH REPUBLIC",
  "NEW ZEALAND", "UAE", "KSA", "OMAN", "INDIA", "CHINA", "PAKISTAN", "QATAR", "KUWAIT", "BAHRAIN", "IRAN", "IRAQ",
  "JORDAN", "LEBANON", "EGYPT", "TURKEY", "ITALY", "GERMANY", "SPAIN", "FRANCE", "PORTUGAL", "NETHERLANDS", "BELGIUM",
  "UK", "USA", "CANADA", "BRAZIL", "MEXICO", "VIETNAM", "THAILAND", "MALAYSIA", "SINGAPORE", "INDONESIA", "KOREA",
  "JAPAN", "TAIWAN", "BANGLADESH", "NEPAL", "MYANMAR", "KENYA", "TANZANIA", "NIGERIA", "MOROCCO", "ALGERIA",
  "DJIBOUTI", "MAURITIUS", "GREECE", "POLAND", "SWEDEN", "NORWAY", "DENMARK", "FINLAND", "AUSTRIA", "SWITZERLAND",
  "IRELAND", "RUSSIA", "SLOVENIA", "SLOVAKIA", "SERBIA", "BULGARIA", "LITHUANIA", "AUSTRALIA", "SAUDI", "YEMEN",
  "SUDAN", "PHILIPPINES", "CAMBODIA", "ROMANIA", "HUNGARY", "UKRAINE", "CROATIA",
].sort((a, b) => b.length - a.length);

/** A port name split into place and country: `NHAVA-SHEVA INDIA` is NHAVA SHEVA in INDIA. A bare country is both. */
export function portParts(name: string): { place: string; country: string | null } {
  const key = (nameKey(name) ?? "").replace(/[&()/+\-]/g, " ").replace(/\s+/g, " ").trim();
  for (const c of COUNTRIES) {
    if (key === c) return { place: key, country: c };
    if (key.endsWith(` ${c}`)) return { place: key.slice(0, -c.length - 1), country: c };
  }
  return { place: key, country: null };
}

/** Comparison key for ports: the place, without the country (`SOHAR OMAN` and `SOHAR` match). */
export const portMatchKey = (name: string) => portParts(name).place;

/** Ports in two different countries are never the same place (TANJUNG INDONESIA, TANJUNG MALAYSIA). */
export const portCountry = (name: string) => portParts(name).country;

/** Trigrams as Postgres pg_trgm makes them: lower case, per word, each word padded with two spaces before and one after. */
export function trigrams(text: string): string[] {
  const out = new Set<string>();
  for (const word of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!word) continue;
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  }
  return [...out].sort();
}

/** pg_trgm similarity of two sorted trigram lists: shared / (all distinct). */
export function trigramSimilarity<T extends string | number>(a: ArrayLike<T>, b: ArrayLike<T>): number {
  if (!a.length || !b.length) return 0;
  let i = 0;
  let j = 0;
  let shared = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      shared++;
      i++;
      j++;
    } else if (a[i] < b[j]) i++;
    else j++;
  }
  return shared / (a.length + b.length - shared);
}

/** True when one letter added, removed, replaced, or two neighbours swapped, turns `a` into `b`. */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

/**
 * Score of a one-letter typo (`JA SUPLLY` / `JA SUPPLY`, `MAJAN EQUIPMET`). Trigrams undervalue these in short
 * names, so they get a fixed score: suggested as likely matches, left out of close matches.
 */
export const TYPO_SCORE = 0.8;
/** Shorter names are too easily one letter apart (`SOHAR` / `SAHAR`). */
const TYPO_MIN_LENGTH = 6;

export interface DuplicatePair {
  a: string;
  b: string;
  /** 1 when the names only differ in punctuation, legal form or a plural S. */
  score: number;
}

/** Order-independent key of a pair of customer ids. */
export const pairKey = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);

/** Default similarity for a suggestion. Below this, too many different companies look alike (AL MAHA / AL AMANA). */
export const DEFAULT_MIN_SCORE = 0.75;

/**
 * Pairs of customers whose names probably mean the same company, best first. A pair counts when the comparison
 * keys are equal once spaces are removed (`AL MAHA` / `ALMAHA`), when their trigram similarity, with or without
 * spaces, reaches `minScore`, or when they are one typo apart (TYPO_SCORE). Pairs in `dismissed` (see pairKey) are
 * left out.
 */
export interface MatchRules {
  /** Comparison key of a name; default matchKey (company names). */
  keyOf?: (name: string) => string;
  /** Names in two different scopes (e.g. countries) are never paired; null means no scope. */
  scopeOf?: (name: string) => string | null;
}

export function findDuplicatePairs(
  customers: Pick<MasterSummary, "id" | "name">[],
  dismissed: ReadonlySet<string> = new Set(),
  minScore = DEFAULT_MIN_SCORE,
  rules: MatchRules = {},
): DuplicatePair[] {
  const keyOf = rules.keyOf ?? ((n: string) => matchKey(n));
  // Trigrams as sorted numbers: comparing numbers is several times faster than comparing strings.
  const ids = new Map<string, number>();
  const encode = (text: string) =>
    Int32Array.from(trigrams(text), (t) => {
      let n = ids.get(t);
      if (n === undefined) ids.set(t, (n = ids.size));
      return n;
    }).sort();
  const items = customers.map((c) => {
    const key = keyOf(c.name);
    const flat = key.replace(/ /g, "");
    return { id: c.id, flat, scope: rules.scopeOf?.(c.name) ?? null, words: encode(key), joined: encode(flat) };
  });
  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < items.length; i++) {
    const x = items[i];
    if (!x.flat) continue;
    for (let j = i + 1; j < items.length; j++) {
      const y = items[j];
      if (!y.flat) continue;
      if (x.scope && y.scope && x.scope !== y.scope) continue;
      let score: number;
      if (x.flat === y.flat) score = 1;
      else {
        // Similarity can never exceed the ratio of the two sizes: skip the counting when that is already too low.
        const fitsWords = Math.min(x.words.length, y.words.length) >= minScore * Math.max(x.words.length, y.words.length);
        const fitsJoined = Math.min(x.joined.length, y.joined.length) >= minScore * Math.max(x.joined.length, y.joined.length);
        const typo =
          TYPO_SCORE >= minScore && Math.min(x.flat.length, y.flat.length) >= TYPO_MIN_LENGTH && withinOneEdit(x.flat, y.flat);
        if (!fitsWords && !fitsJoined && !typo) continue;
        score = Math.max(
          fitsWords ? trigramSimilarity(x.words, y.words) : 0,
          fitsJoined ? trigramSimilarity(x.joined, y.joined) : 0,
          typo ? TYPO_SCORE : 0,
        );
        if (score < minScore) continue;
      }
      if (dismissed.has(pairKey(x.id, y.id))) continue;
      pairs.push({ a: x.id, b: y.id, score });
    }
  }
  return pairs.sort((p, q) => q.score - p.score);
}

export interface DuplicateGroup<T> {
  /** Customers linked by likely-duplicate pairs, in keepOrder: the first is the one to keep by default. */
  members: T[];
  /** Best pair score inside the group. */
  score: number;
}

/**
 * Joins pairs into groups (A~B and B~C give one group A, B, C), sorted by the name of their first member.
 */
export function groupDuplicates<T extends Pick<MasterSummary, "id" | "name" | "enquiries">>(
  customers: T[],
  pairs: DuplicatePair[],
): DuplicateGroup<T>[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    // Path compression.
    while (parent.get(x) !== root) {
      const next = parent.get(x)!;
      parent.set(x, root);
      x = next;
    }
    return root;
  };
  for (const p of pairs) {
    if (!parent.has(p.a)) parent.set(p.a, p.a);
    if (!parent.has(p.b)) parent.set(p.b, p.b);
    const ra = find(p.a);
    const rb = find(p.b);
    if (ra !== rb) parent.set(ra, rb);
  }

  const byId = new Map(customers.map((c) => [c.id, c]));
  const groups = new Map<string, DuplicateGroup<T>>();
  for (const p of pairs) {
    const root = find(p.a);
    const g = groups.get(root) ?? { members: [], score: 0 };
    g.score = Math.max(g.score, p.score);
    groups.set(root, g);
  }
  for (const id of parent.keys()) {
    const c = byId.get(id);
    if (c) groups.get(find(id))?.members.push(c);
  }
  const out = [...groups.values()].filter((g) => g.members.length > 1);
  for (const g of out) g.members.sort(keepOrder);
  return out.sort((x, y) => x.members[0].name.localeCompare(y.members[0].name));
}

/** Most enquiries first; on a tie, the longest (most complete) name. The first is the customer to keep by default. */
export function keepOrder(x: Pick<MasterSummary, "name" | "enquiries">, y: Pick<MasterSummary, "name" | "enquiries">): number {
  return y.enquiries - x.enquiries || y.name.length - x.name.length || x.name.localeCompare(y.name);
}
