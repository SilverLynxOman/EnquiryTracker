import { describe, expect, it } from "vitest";
import { cleanText, nameKey, parseExcelDate, parseNumber, parseQty, parseTradeType } from "./normalize";

describe("parseExcelDate", () => {
  it("reads the register's DD.MM.YYYY text", () => {
    expect(parseExcelDate("01.11.2026")).toEqual({ value: "2026-11-01", warning: undefined });
  });

  it("accepts single-digit parts and doubled separators, with a warning", () => {
    expect(parseExcelDate("10.6.2026", 2026).value).toBe("2026-06-10");
    const r = parseExcelDate("30..04.2026", 2026);
    expect(r.value).toBe("2026-04-30");
    expect(r.warning).toBeDefined();
  });

  it("repairs mistyped years from the sheet year", () => {
    expect(parseExcelDate("11.05.206", 2026)).toMatchObject({ value: "2026-05-11" });
    expect(parseExcelDate("13.10.20226", 2026)).toMatchObject({ value: "2026-10-13" });
    expect(parseExcelDate("13.10.20226", 2026).warning).toMatch(/mistyped/);
    expect(parseExcelDate("13.10.20226").error).toBeDefined();
  });

  it("reads Excel serial numbers", () => {
    expect(parseExcelDate(46327).value).toBe("2026-11-01");
  });

  it("rejects impossible dates and blanks", () => {
    expect(parseExcelDate("31.02.2026").error).toBeDefined();
    expect(parseExcelDate("TBA").error).toBeDefined();
    expect(parseExcelDate("")).toEqual({ value: null });
    expect(parseExcelDate(null)).toEqual({ value: null });
  });
});

describe("parseQty", () => {
  const cases: [string, string, number | null, string | null][] = [
    ["1X40'", "FCL", 1, "40"],
    ["2X20'", "FCL", 2, "20"],
    ["10X40'", "FCL", 10, "40"],
    ["1 X 40HC", "FCL", 1, "40HC"],
    ["1 x 20FT", "FCL", 1, "20"],
    ["2X40 RF", "FCL", 2, "40RF"],
    ["1X20 OT", "FCL", 1, "20OT"],
    ["1X40 FR", "FCL", 1, "40FR"],
    ["15x40'", "FCL", 15, "40"],
    ["1X20' / 1X40'", "FCL", 1, "20/40"],
    ["1X20' + 1X40'", "FCL", 2, "20+40"],
    ["LCL", "LCL", null, null],
    ["AIR", "AIR", null, null],
    ["COURIER", "COURIER", null, null],
    ["RORO", "RORO", null, null],
    ["BREAK", "BREAK_BULK", null, null],
    ["AIR / LCL", "MULTI", null, null],
    ["AIR / SEA", "MULTI", null, null],
  ];
  it.each(cases)("%s → %s", (text, mode, units, type) => {
    expect(parseQty(text)).toEqual({ mode, units, containerType: type });
  });

  it("returns nulls for blank input", () => {
    expect(parseQty(null)).toEqual({ mode: null, units: null, containerType: null });
  });
});

describe("parseNumber", () => {
  it("handles numbers, text numbers, separators and junk", () => {
    expect(parseNumber(7060).value).toBe(7060);
    expect(parseNumber("12,510").value).toBe(12510);
    expect(parseNumber("OMR 40").value).toBe(40);
    expect(parseNumber(".").error).toBeDefined();
    expect(parseNumber(null).value).toBeNull();
  });
});

describe("names and codes", () => {
  it("nameKey ignores punctuation, case and spacing", () => {
    expect(nameKey("A.V. FREIGHT")).toBe(nameKey("A. V. FREIGHT"));
    expect(nameKey(" consol  club ")).toBe("CONSOL CLUB");
    expect(nameKey("   ")).toBeNull();
  });

  it("parseTradeType", () => {
    expect(parseTradeType("IMP")).toBe("IMP");
    expect(parseTradeType("export")).toBe("EXP");
    expect(parseTradeType("CT")).toBe("CT");
    expect(parseTradeType("AIR")).toBeNull();
  });

  it("cleanText collapses whitespace", () => {
    expect(cleanText("  SL262731   LCL  ")).toBe("SL262731 LCL");
    expect(cleanText("   ")).toBeNull();
  });
});
