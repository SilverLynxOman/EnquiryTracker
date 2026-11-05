import { describe, expect, it } from "vitest";
import { standardPortName } from "./ports";

describe("standardPortName", () => {
  const map = new Map([
    ["NHAVA-SHEVA INDIA", "NHAVA SHEVA INDIA"],
    ["NHAVA SHEVA INDIA", "NHAVA SHEVA INDIA"],
    ["SOHAR", "SOHAR OMAN"],
  ]);

  it("turns a known spelling into the standard name, ignoring case and punctuation", () => {
    expect(standardPortName(map, "nhava-sheva india")).toBe("NHAVA SHEVA INDIA");
    expect(standardPortName(map, "Sohar")).toBe("SOHAR OMAN");
    expect(standardPortName(map, "NHAVA SHEVA, INDIA")).toBe("NHAVA SHEVA INDIA");
  });

  it("leaves unknown and empty values alone", () => {
    expect(standardPortName(map, "JEBEL ALI UAE")).toBe("JEBEL ALI UAE");
    expect(standardPortName(map, null)).toBe(null);
    expect(standardPortName(new Map(), "SOHAR")).toBe("SOHAR");
  });
});
