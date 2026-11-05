import { describe, expect, it } from "vitest";
import { commissionTotal, describeCommission, mentionsCommission, parseCommission } from "./commission";

describe("parseCommission", () => {
  // Every pattern found in the 2026 register's remarks.
  it.each([
    ["COMMISSION OMR 100", { amount: 100, currency: "OMR", perUnit: false }],
    ["COMMISSION OMR 850.00", { amount: 850, currency: "OMR", perUnit: false }],
    ["COMMISSION OMR 40/CNTR.", { amount: 40, currency: "OMR", perUnit: true }],
    ["COMMISSION USD 130/CNTR.", { amount: 130, currency: "USD", perUnit: true }],
    ["COMMISSION USD 130/40 HC", { amount: 130, currency: "USD", perUnit: true }],
    ["COMMISSION USD 450", { amount: 450, currency: "USD", perUnit: false }],
    ["OMR 200.00 COMMSION", { amount: 200, currency: "OMR", perUnit: false }],
  ])("%s", (remarks, expected) => {
    expect(parseCommission(remarks)).toEqual(expected);
  });

  it("reads other spellings and layouts", () => {
    expect(parseCommission("commission usd 1,200 per container")).toEqual({ amount: 1200, currency: "USD", perUnit: true });
    expect(parseCommission("COMM: RO 25")).toEqual({ amount: 25, currency: "OMR", perUnit: false });
    expect(parseCommission("COMMISION 75 OMR/20'")).toEqual({ amount: 75, currency: "OMR", perUnit: true });
    expect(parseCommission("COMMISSION 40")).toEqual({ amount: 40, currency: null, perUnit: false });
    expect(parseCommission("COMM. OMR 15/CNTR")).toEqual({ amount: 15, currency: "OMR", perUnit: true });
    expect(parseCommission("COMISSION USD 90")).toEqual({ amount: 90, currency: "USD", perUnit: false });
  });

  it("takes the amount after the commission word before any other amount", () => {
    expect(parseCommission("FREIGHT USD 500, COMMISSION OMR 40")).toEqual({ amount: 40, currency: "OMR", perUnit: false });
    expect(parseCommission("RATE VALID 30 DAYS. COMMISSION 60")).toEqual({ amount: 60, currency: null, perUnit: false });
  });

  it("finds nothing without a commission word or an amount", () => {
    expect(parseCommission("USD 500 ALL IN")).toBeNull();
    expect(parseCommission("COMMISSION TO BE CONFIRMED")).toBeNull();
    expect(parseCommission("")).toBeNull();
    expect(parseCommission(null)).toBeNull();
    expect(parseCommission("COMMISSION 12345678901")).toBeNull();
    // Other words that start like it are not commission.
    expect(parseCommission("RECOMMENDED USD 300")).toBeNull();
    expect(parseCommission("COMMODITY: STEEL, USD 300")).toBeNull();
    expect(parseCommission("COMMENT: OMR 50 DISCOUNT")).toBeNull();
    expect(parseCommission("SEE WWW.EXAMPLE.COM USD 50")).toBeNull();
  });
});

describe("commission totals", () => {
  it("multiplies per-container amounts by the containers", () => {
    expect(commissionTotal({ amount: 40, currency: "OMR", perUnit: true }, 3)).toBe(120);
    expect(commissionTotal({ amount: 40, currency: "OMR", perUnit: true }, null)).toBe(40);
    expect(commissionTotal({ amount: 100, currency: "OMR", perUnit: false }, 3)).toBe(100);
  });

  it("describes the commission", () => {
    expect(describeCommission({ amount: 40, currency: "OMR", perUnit: true }, 2)).toBe("OMR 40 per container × 2 = OMR 80");
    expect(describeCommission({ amount: 40, currency: "OMR", perUnit: true }, 1)).toBe("OMR 40 per container");
    expect(describeCommission({ amount: 300, currency: "USD", perUnit: false }, 2)).toBe("USD 300 for the shipment");
    expect(describeCommission({ amount: 60, currency: null, perUnit: false }, null)).toBe("60 for the shipment");
  });
});

describe("mentionsCommission", () => {
  it("spots the word even without an amount", () => {
    expect(mentionsCommission("commission to be confirmed")).toBe(true);
    expect(mentionsCommission("COMMODITY STEEL")).toBe(false);
    expect(mentionsCommission(null)).toBe(false);
  });
});
