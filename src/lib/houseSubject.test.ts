import { describe, expect, it } from "vitest";
import { firstHouseSubject, parseHouseSubject } from "./houseSubject";

describe("parseHouseSubject", () => {
  it("reads an air ex-works subject", () => {
    expect(parseHouseSubject("SL262785 AIR EX-WORKS USA TO MUSCAT OMAN")).toEqual({
      qty_text: "AIR",
      incoterm: "EXW",
      pol: "USA",
      pod: "MUSCAT OMAN",
      trade_type: "IMP",
      subject: "AIR EX-WORKS USA TO MUSCAT OMAN",
    });
  });

  it("drops reply prefixes, tags and the agent's own numbers", () => {
    const r = parseHouseSubject("RE: [EXTERNAL] SL265517 // 1x40 RF ex-works Netherlands to Sohar Oman rtm-q-042875");
    expect(r).toMatchObject({ qty_text: "1X40 RF", pol: "NETHERLANDS", pod: "SOHAR OMAN", subject: "1X40 RF EX-WORKS NETHERLANDS TO SOHAR OMAN" });
  });

  it("stops the port of discharge at separators and stop words", () => {
    expect(parseHouseSubject("LCL EX-WORKS SHANGHAI CHINA TO SOHAR OMAN //ENQ1020126007124//")?.pod).toBe("SOHAR OMAN");
    expect(parseHouseSubject("1X20' FOB JEBEL ALI UAE TO SOHAR OMAN VIA DUBAI")?.pod).toBe("SOHAR OMAN");
    expect(parseHouseSubject("1X20' FOB JEBEL ALI UAE TO SOHAR OMAN, URGENT")?.pod).toBe("SOHAR OMAN");
  });

  it("reads several containers and a missing incoterm", () => {
    expect(parseHouseSubject("2X40' HC + 1X20' QINGDAO CHINA TO SOHAR OMAN")).toMatchObject({ qty_text: "2X40' HC + 1X20'", incoterm: null, pol: "QINGDAO CHINA" });
  });

  it("sets the trade type from the ports", () => {
    expect(parseHouseSubject("1X40' FOB SOHAR OMAN TO MUNDRA INDIA")?.trade_type).toBe("EXP");
    expect(parseHouseSubject("1X40' FOB NINGBO CHINA TO JEBEL ALI UAE")?.trade_type).toBe("CT");
  });

  it("gives null for subjects in another shape", () => {
    expect(parseHouseSubject("QINGDAO - SOHAR 40 HQ -QINGDAO QUANLIN MACHINERY- PO - 26SOM0321")).toBeNull();
    expect(parseHouseSubject("[EXTERNAL]-Re: PO-647 - GASTECH / SL262789")).toBeNull();
    expect(parseHouseSubject("Please reply to Mr Ali")).toBeNull();
    expect(parseHouseSubject("AIR EX-WORKS 12 PALLETS TO MUSCAT")).toBeNull();
    expect(parseHouseSubject(null)).toBeNull();
  });
});

describe("firstHouseSubject", () => {
  it("takes the first subject that parses", () => {
    expect(firstHouseSubject(["Booking order", "RE: SL262787 1X40 EX-WORKS HUNAN CHINA TO SOHAR OMAN"])?.pol).toBe("HUNAN CHINA");
    expect(firstHouseSubject(["Booking order"])).toBeNull();
  });
});
