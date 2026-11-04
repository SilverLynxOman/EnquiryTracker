import { describe, expect, it } from "vitest";
import {
  findDuplicatePairs,
  groupDuplicates,
  keepOrder,
  matchKey,
  pairKey,
  trigramSimilarity,
  trigrams,
  TYPO_SCORE,
  withinOneEdit,
} from "./customerDuplicates";

const customer = (id: string, name: string, enquiries = 0) => ({ id, name, enquiries });

describe("matchKey", () => {
  it("drops legal forms, ampersands and punctuation", () => {
    expect(matchKey("GODREJ & KHIMJI")).toBe("GODREJ KHIMJI");
    expect(matchKey("Godrej Khimji LLC")).toBe("GODREJ KHIMJI");
    expect(matchKey("NARANJEE HIRJEE & CO. LLC")).toBe("NARANJEE HIRJEE");
    expect(matchKey("AL MAHA L.L.C.")).toBe("AL MAHA");
    expect(matchKey("AL-ALAMIA ENGG. & TECH. SERVICES LLC")).toBe("AL ALAMIA ENGG TECH SERVICE");
    expect(matchKey("NATIONAL BISCUIT INDS. LTD. SAOG")).toBe("NATIONAL BISCUIT IND");
  });

  it("drops a plural S, the same way for spaced and joined spellings", () => {
    expect(matchKey("GULF SERVICES & INDUSTRIAL SUPPLIES")).toBe(matchKey("GULF SERVICE & INDUSTRIAL SUPPLIE"));
    expect(matchKey("AL MAS ELECTRICALS").replace(/ /g, "")).toBe(matchKey("ALMAS ELECTRICAL LLC").replace(/ /g, ""));
  });

  it("is empty for a name made only of legal forms", () => {
    expect(matchKey("LLC")).toBe("");
    expect(matchKey("")).toBe("");
  });
});

describe("withinOneEdit", () => {
  it("accepts one insertion, deletion, substitution or swap", () => {
    expect(withinOneEdit("SUPPLY", "SUPLLY")).toBe(true);
    expect(withinOneEdit("EQUIPMET", "EQUIPMENT")).toBe(true);
    expect(withinOneEdit("EQUIPMENT", "EQUIPMET")).toBe(true);
    expect(withinOneEdit("CONSTRUCITON", "CONSTRUCTION")).toBe(true);
    expect(withinOneEdit("SAME", "SAME")).toBe(true);
  });
  it("rejects two edits", () => {
    expect(withinOneEdit("SUPPLY", "SUPLY1")).toBe(false);
    expect(withinOneEdit("ABCDEF", "ABCD")).toBe(false);
    expect(withinOneEdit("ABCD", "BADC")).toBe(false);
  });
});

describe("trigram similarity", () => {
  it("builds pg_trgm trigrams", () => {
    expect(trigrams("ab")).toEqual(["  a", " ab", "ab "]);
    expect(trigrams("A b")).toEqual(["  a", "  b", " a ", " b "]);
  });

  it("matches pg_trgm similarity values", () => {
    // select similarity('word', 'words') → 0.5714286 (4 shared of 7)
    expect(trigramSimilarity(trigrams("word"), trigrams("words"))).toBeCloseTo(4 / 7);
    expect(trigramSimilarity(trigrams("same name"), trigrams("name same"))).toBe(1);
    expect(trigramSimilarity([], trigrams("x"))).toBe(0);
  });
});

describe("findDuplicatePairs", () => {
  const list = [
    customer("1", "GODREJ & KHIMJI"),
    customer("2", "GODREJ KHIMJI"),
    customer("3", "SYNERGIES CASTINGS"),
    customer("4", "SYNERGIES CASTING"),
    customer("5", "ALMAHA BUILDING MATERIAL"),
    customer("6", "AL MAHA BUILDING MATERIAL LLC"),
    customer("7", "ELEGANT WINDOS"),
    customer("8", "ELEGANT WINDOWS"),
    customer("9", "AL AMANA BUILDING MATERIAL"),
    customer("10", "OMAN CABLES"),
  ];

  it("finds spelling, suffix and spacing variants", () => {
    const found = findDuplicatePairs(list).map((p) => pairKey(p.a, p.b));
    expect(found).toEqual(expect.arrayContaining([pairKey("1", "2"), pairKey("3", "4"), pairKey("5", "6"), pairKey("7", "8")]));
  });

  it("does not pair different companies with similar names", () => {
    const found = findDuplicatePairs(list).map((p) => pairKey(p.a, p.b));
    expect(found).not.toContain(pairKey("6", "9"));
    expect(found).not.toContain(pairKey("5", "9"));
    expect(found.some((k) => k.includes("10"))).toBe(false);
  });

  it("scores names that differ only in punctuation or legal form as 1, best first", () => {
    const pairs = findDuplicatePairs(list);
    expect(pairs[0].score).toBe(1);
    expect(pairs.find((p) => pairKey(p.a, p.b) === pairKey("1", "2"))?.score).toBe(1);
    expect(pairs.find((p) => pairKey(p.a, p.b) === pairKey("7", "8"))!.score).toBeLessThan(1);
  });

  it("pairs one-letter typos that trigrams undervalue, but only in names of six letters or more", () => {
    const typos = [
      customer("a", "JA SUPLLY"),
      customer("b", "JA SUPPLY"),
      customer("c", "MAJAN EQUIPMET"),
      customer("d", "MAJAN EQUIPMENT LLC"),
      customer("e", "SOHAR"),
      customer("f", "SAHAR"),
    ];
    const pairs = findDuplicatePairs(typos);
    expect(pairs.map((p) => pairKey(p.a, p.b))).toEqual(expect.arrayContaining([pairKey("a", "b"), pairKey("c", "d")]));
    expect(pairs.find((p) => pairKey(p.a, p.b) === pairKey("a", "b"))?.score).toBe(TYPO_SCORE);
    expect(pairs.some((p) => pairKey(p.a, p.b) === pairKey("e", "f"))).toBe(false);
    // Close matches (0.85) leave typos out.
    expect(findDuplicatePairs(typos, new Set(), 0.85).some((p) => pairKey(p.a, p.b) === pairKey("a", "b"))).toBe(false);
  });

  it("leaves out pairs marked as different companies", () => {
    const found = findDuplicatePairs(list, new Set([pairKey("2", "1")])).map((p) => pairKey(p.a, p.b));
    expect(found).not.toContain(pairKey("1", "2"));
    expect(found).toContain(pairKey("3", "4"));
  });

  it("accepts a lower threshold", () => {
    expect(findDuplicatePairs(list, new Set(), 0.6).length).toBeGreaterThan(findDuplicatePairs(list).length);
  });
});

describe("groupDuplicates", () => {
  it("joins chains of pairs and puts the customer to keep first", () => {
    const list = [
      customer("a", "ADVANCE OILFIELD TECHNOLOGY", 2),
      customer("b", "ADVANCE OILFIELDS TECHNOLOGY LLC", 10),
      customer("c", "ADVANCE OILFIED TECHNOLOGY CO. LLC", 5),
      customer("d", "OMAN CABLES", 3),
      customer("e", "OMAN CABLE", 1),
    ];
    const groups = groupDuplicates(list, findDuplicatePairs(list));
    expect(groups).toHaveLength(2);
    expect(groups[0].members.map((m) => m.id)).toEqual(["b", "c", "a"]);
    expect(groups[1].members.map((m) => m.id)).toEqual(["d", "e"]);
    expect(groups[1].score).toBe(1);
  });

  it("ignores pairs of customers that are no longer listed", () => {
    const groups = groupDuplicates([customer("a", "X", 1)], [{ a: "a", b: "gone", score: 1 }]);
    expect(groups).toEqual([]);
  });
});

describe("keepOrder", () => {
  it("prefers more enquiries, then the longer name", () => {
    const sorted = [customer("1", "AL SABBAGH TRADING", 6), customer("2", "AL SABBAGH TRADING LLC", 6), customer("3", "AL SABBAGH", 18)].sort(keepOrder);
    expect(sorted.map((c) => c.id)).toEqual(["3", "2", "1"]);
  });
});
