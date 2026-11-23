import { describe, expect, it } from "vitest";
import { BOILERPLATE, OUR_PRICE_LINE, SIG_NAME } from "./patterns";

// The three patterns as they stood before each run of dots or spaces got a single place to go. They read the same
// lines; they only took exponential (or quadratic) time to give up on a line that does not match. Used on short
// strings only, to check that the new patterns match exactly what the old ones did.
const BEFORE = {
  SIG_NAME: /^[ \t*_\-]*([A-Z][\p{L}.'\-]+(?:[ .]+[\p{L}.'\-]+){0,3})(?:\s*\((?:Mr|Ms|Mrs)\))?\s*(?:[|/,]\s*(.{2,60}))?[ \t*_]*$/imu,
  OUR_PRICE_LINE:
    /^\s*(?:AIR\s+|LCL\s+|SEA\s+|COURIER\s+)?(?:FOB\s+|EXW\s+)?(DOOR TO DOOR|DOOR TO PORT|DOOR TO \w+ PORT|PORT TO PORT|PORT TO DOOR|AIRPORT TO AIRPORT)(?:\s+CHARGES)?\s*(?:OMR)?\s*:?\s*(?:OMR|RO)?\s*([\d.,]+)(?:\s*\/\s*(\d{2}\s*[A-Z]{0,3}|KG|CBM|CNTR))?/im,
  BOILERPLATE:
    /(?:^|\n|\. )\s*(?:disclaimer\s*:|important notice|war risk advisory|transit delays are beyond our control|all of quotations are subject to|due to the (?:prevailing|ongoing|current) geopolitical|note\s*:\s*due to the ongoing|kindly note an important oman customs notice|please note that algerian week ?end|p\.s\.?\s*:|this (?:e-?mail|message) (?:and any attachments )?(?:is|are) confidential|(?:p\s+)?please consider the environment before printing|according to (?:article|art\.) [^\n]{0,40}\b(?:gdpr|regulation)\b|if you (?:have )?received this (?:e-?mail|message|communication) (?:by mistake|in error)|订舱请主动告知|我司财务要求|如果阁下对我司|\*{0,3}\s*warm prompt\b|特别提醒|\d\s*[.、．]\s*目的国规定)[\s\S]*$/i,
};

/** The same pattern as money.ts builds it (PRICE_LINES): every line, with the place of each group. */
const priceLines = (re: RegExp) => new RegExp(re.source, "gimd");

function timed<T>(run: () => T): { ms: number; result: T } {
  const start = performance.now();
  const result = run();
  return { ms: performance.now() - start, result };
}

const NBSP = "\u00a0";

/** A fixed pseudo-random sequence, so the comparisons below test the same strings on every run. */
function sequence(seed: number) {
  let s = seed;
  return <T,>(xs: readonly T[]): T => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return xs[s % xs.length];
  };
}

describe("SIG_NAME", () => {
  const read = (line: string) => {
    const m = SIG_NAME.exec(line);
    return m ? [m[1], m[2] ?? null] : null;
  };

  it("gives up at once on a long run of dots or spaces", () => {
    for (const line of ["Tom" + ".".repeat(36) + "!", "Tom" + ".".repeat(5000) + "!", "Tom" + ". ".repeat(2000) + "!", "Tom" + " ".repeat(5000) + "!", "Tom | ab" + " ".repeat(5000) + "!"]) {
      const { ms, result } = timed(() => SIG_NAME.exec(line));
      expect(result).toBeNull();
      expect(ms).toBeLessThan(50);
    }
  });

  it("still reads names, roles and the lines it never read", () => {
    expect(read("Anwar K. S.")).toEqual(["Anwar K. S.", null]);
    expect(read("Rashid Ahmad.")).toEqual(["Rashid Ahmad.", null]);
    expect(read("Rashid Ahmad. ")).toEqual(["Rashid Ahmad.", null]);
    expect(read("Reena")).toEqual(["Reena", null]);
    expect(read("Mohammed Al Balushi")).toEqual(["Mohammed Al Balushi", null]);
    expect(read("Mohammed Al Balushi Ahmed")).toEqual(["Mohammed Al Balushi Ahmed", null]);
    expect(read("BASIL IQBAL")).toEqual(["BASIL IQBAL", null]);
    expect(read("Jean-Luc O'Neil")).toEqual(["Jean-Luc O'Neil", null]);
    expect(read("J. Smith")).toEqual(["J. Smith", null]);
    expect(read("Tom (Mr)")).toEqual(["Tom", null]);
    expect(read("Tom (Mrs) | Ops")).toEqual(["Tom", "Ops"]);
    expect(read("Reena | Sales Executive")).toEqual(["Reena", "Sales Executive"]);
    expect(read("Anwar K. S. / Pricing Manager")).toEqual(["Anwar K. S.", "Pricing Manager"]);
    expect(read("** Rashid Ahmad **")).toEqual(["Rashid Ahmad", null]);
    expect(read("- Reena")).toEqual(["Reena", null]);
    expect(read("Tom . . Smith . K.")).toEqual(["Tom . . Smith . K.", null]);
    // Five words, a one-letter first word, a stray mark: not a name, as before.
    expect(read("Mohammed Al Balushi Ahmed Said")).toBeNull();
    expect(read("J Smith")).toBeNull();
    expect(read("A .B")).toBeNull();
    expect(read("Tom!")).toBeNull();
  });

  it("matches exactly what the old pattern matched", () => {
    const alphabet = ["A", "b", ".", " ", "-"];
    const lines = [""];
    for (let length = 1; length <= 7; length++) {
      for (const line of lines.filter((l) => l.length === length - 1)) for (const c of alphabet) lines.push(line + c);
    }
    const pick = sequence(7);
    const bits = ["Tom", "K.", " ", ".", " . ", "Al", "O'Neil", "(Mr)", " | ", "/", ",", "Sales", "*", "_", "\t", NBSP, "1", "!", "\n"];
    for (let i = 0; i < 20000; i++) {
      let line = pick(["", " ", "*", "-"]);
      for (let j = 0; j < 6; j++) line += pick(bits);
      lines.push(line);
    }
    const differ = lines.filter((line) => JSON.stringify(BEFORE.SIG_NAME.exec(line)) !== JSON.stringify(SIG_NAME.exec(line)));
    expect(differ).toEqual([]);
  });
});

describe("OUR_PRICE_LINE", () => {
  const read = (line: string) => {
    const m = OUR_PRICE_LINE.exec(line);
    return m ? [m[1], m[2], m[3] ?? null] : null;
  };

  it("gives up at once on a long run of spaces after the scope", () => {
    for (const text of ["PORT TO PORT" + " ".repeat(300) + "USD 1200", "DOOR TO DOOR" + " \t".repeat(5000) + "USD 1200", "PORT TO PORT :" + " ".repeat(5000) + "x"]) {
      const { ms, result } = timed(() => OUR_PRICE_LINE.exec(text));
      expect(result).toBeNull();
      expect(ms).toBeLessThan(50);
    }
    // money.ts reads every line with the same source; thousands of blank lines are read once.
    const { ms, result } = timed(() => [...("\n".repeat(12000) + "x").matchAll(priceLines(OUR_PRICE_LINE))]);
    expect(result).toEqual([]);
    expect(ms).toBeLessThan(50);
  });

  it("still reads the price lines of our quotes", () => {
    expect(read("PORT TO PORT : OMR 339.000")).toEqual(["PORT TO PORT", "339.000", null]);
    expect(read("DOOR TO DOOR: RO 450")).toEqual(["DOOR TO DOOR", "450", null]);
    expect(read("PORT TO PORT OMR : 120")).toEqual(["PORT TO PORT", "120", null]);
    expect(read("PORT TO PORT : 359.000")).toEqual(["PORT TO PORT", "359.000", null]);
    expect(read("AIR AIRPORT TO AIRPORT : OMR 1.250 / KG")).toEqual(["AIRPORT TO AIRPORT", "1.250", "KG"]);
    expect(read("LCL PORT TO DOOR CHARGES : OMR 85.000 / CBM")).toEqual(["PORT TO DOOR", "85.000", "CBM"]);
    expect(read("SEA FOB PORT TO PORT OMR 210 / 20GP")).toEqual(["PORT TO PORT", "210", "20GP"]);
    expect(read("DOOR TO SOHAR PORT : OMR 400")).toEqual(["DOOR TO SOHAR PORT", "400", null]);
    expect(read("  door to port omr: ro 12,500.00/40 HC")).toEqual(["door to port", "12,500.00", "40 HC"]);
    expect(read("PORT TO PORT CHARGES OMR 300")).toEqual(["PORT TO PORT", "300", null]);
    expect(read("PORT TO PORT    :    OMR    359")).toEqual(["PORT TO PORT", "359", null]);
    expect(read("\tPORT TO PORT\t:\t359")).toEqual(["PORT TO PORT", "359", null]);
    expect(read("EXW DOOR TO DOOR : 1,200.000")).toEqual(["DOOR TO DOOR", "1,200.000", null]);
    expect(read("COURIER DOOR TO DOOR RO 25")).toEqual(["DOOR TO DOOR", "25", null]);
    // Another currency, no figure, words before the scope: not one of our price lines, as before.
    expect(read("PORT TO PORT : USD 1200")).toBeNull();
    expect(read("PORT TO PORT: TBA")).toBeNull();
    expect(read("Total PORT TO PORT : 120")).toBeNull();

    const mail = "Dear Sir,\nPlease find our offer:\n\nPORT TO PORT : OMR 339.000\n  DOOR TO DOOR : 450.000 / 20GP\n\n\nAIRPORT TO AIRPORT RO 1.250/KG\nRegards";
    const found = [...mail.matchAll(priceLines(OUR_PRICE_LINE))].map((m) => [m[1], m[2], m.indices?.[2]]);
    expect(found).toEqual([
      ["PORT TO PORT", "339.000", [53, 60]],
      ["DOOR TO DOOR", "450.000", [78, 85]],
      ["AIRPORT TO AIRPORT", "1.250", [117, 122]],
    ]);
  });

  it("finds the same lines and figures as the old pattern", () => {
    const pick = sequence(11);
    const bits = ["PORT TO PORT", "DOOR TO DOOR", "AIRPORT TO AIRPORT", "DOOR TO MUSCAT PORT", " ", "  ", "\t", "\n", "\r\n", ":", " : ", "OMR", "RO", "USD", " CHARGES", "339.000", "1,200", " / ", "20GP", "KG", "AIR ", "FOB ", "x", NBSP, "."];
    // Only the groups and their places: the old match could also start on a blank line above the price line.
    const groups = (re: RegExp, text: string) => JSON.stringify([...text.matchAll(priceLines(re))].map((m) => [m.slice(1), m.indices?.slice(1)]));
    const differ: string[] = [];
    for (let i = 0; i < 20000; i++) {
      let text = "";
      for (let j = 0, n = 1 + (i % 9); j < n; j++) text += pick(bits);
      if (groups(BEFORE.OUR_PRICE_LINE, text) !== groups(OUR_PRICE_LINE, text) || BEFORE.OUR_PRICE_LINE.test(text) !== OUR_PRICE_LINE.test(text)) differ.push(text);
    }
    expect(differ).toEqual([]);
  });
});

describe("BOILERPLATE", () => {
  it("gives up at once on hundreds of blank lines", () => {
    for (const text of ["Hi\n" + `${NBSP}\n`.repeat(1000) + "end", "Hi\n" + " \n".repeat(6000) + "end", "Hi\n" + "\n".repeat(12000) + "end", "Hi\n" + " ".repeat(12000) + "end"]) {
      const { ms, result } = timed(() => text.replace(BOILERPLATE, ""));
      expect(result).toBe(text);
      expect(ms).toBeLessThan(50);
    }
    // After the blank lines, the footer is still cut.
    const footer = "Hi\n" + `${NBSP}\n`.repeat(1000) + "Disclaimer: this e-mail is private";
    const { ms, result } = timed(() => footer.replace(BOILERPLATE, ""));
    expect(result).toBe("Hi");
    expect(ms).toBeLessThan(50);
  });

  it("still cuts the same footers from the same place", () => {
    const cut = (text: string) => text.replace(BOILERPLATE, "");
    expect(cut("Dear Sir,\nPlease see rates.\n\nDisclaimer: this is private")).toBe("Dear Sir,\nPlease see rates.");
    expect(cut("Thanks. \n\nDisclaimer: x")).toBe("Thanks");
    expect(cut("Rates attached.\n\n\nIMPORTANT NOTICE: blah\nmore")).toBe("Rates attached.");
    expect(cut("Hello\n \n \n War risk advisory applies")).toBe("Hello");
    expect(cut("Hi. P.S.: call me")).toBe("Hi");
    expect(cut(`Regards\n${NBSP}\nPlease consider the environment before printing`)).toBe("Regards");
    expect(cut("Regards\n*** Warm prompt: 1")).toBe("Regards");
    expect(cut("Regards\n**\n\nwarm prompt here")).toBe("Regards");
    expect(cut("Regards\n warm prompt")).toBe("Regards");
    expect(cut("x\n1、目的国规定 abc")).toBe("x");
    expect(cut("Line one\r\n\r\nThis email is confidential and intended")).toBe("Line one\r");
    expect(cut("x.\t\nDisclaimer: y")).toBe("x.\t");
    expect(cut("no boilerplate here\n\n\n")).toBe("no boilerplate here\n\n\n");
    expect("Thanks. \n\nDisclaimer: x".search(BOILERPLATE)).toBe(6);
  });

  it("matches the same text as the old pattern", () => {
    const pick = sequence(13);
    const bits = ["Disclaimer:", "Important notice", "P.S.:", "warm prompt", "**", "*", " ", "  ", "\n", "\r\n", "\t", NBSP, ". ", ".", "x", "this email is confidential", "1. 目的国规定", "according to art. 5 GDPR", "p ", "please consider the environment before printing"];
    const differ: string[] = [];
    for (let i = 0; i < 20000; i++) {
      let text = "";
      for (let j = 0, n = 1 + (i % 8); j < n; j++) text += pick(bits);
      const before = BEFORE.BOILERPLATE.exec(text);
      const after = BOILERPLATE.exec(text);
      if (before?.index !== after?.index || before?.[0] !== after?.[0]) differ.push(text);
    }
    expect(differ).toEqual([]);
  });
});
