import { describe, expect, it } from "vitest";
import { enquiry } from "../testFixtures";
import type { ParsedRow } from "./register";
import { diffRow } from "./diff";

function parsed(over: Partial<ParsedRow>): ParsedRow {
  return {
    sheet: "OCT", rowNumber: 5, reference: "SL262421", enquiry_date: "2026-10-01", enquiry_date_inferred: false,
    quoted_date: null, confirmed_date: null, customer_name: "TEST CUSTOMER LLC", subject: null, trade_type: null,
    qty_text: null, shipment_mode: null, units: null, container_type: null, buy_rate: null, buy_total: null,
    sell_rate: null, sell_total: null, excel_profit: null, pol: null, pod: null, agent_name: null,
    sales_person_name: null, remarks: null, issues: [], ...over,
  };
}

describe("import diff and fields edited in the app", () => {
  const stored = enquiry({ reference: "SL262421", enquiry_date: "2026-10-01", quoted_date: "2026-10-05", sell_total: 100, sales_person_name: "ASHWIN" });

  it("lists a difference in an app-edited field as kept, not as a change", () => {
    const item = diffRow(parsed({ quoted_date: "2026-10-09", sell_total: 150 }), { ...stored, app_edited_fields: ["quoted_date"] });
    expect(item.kind).toBe("changed");
    expect(item.changes.map((c) => c.field)).toEqual(["sell_total"]);
    expect(item.kept).toEqual([{ field: "quoted_date", label: "Quoted date", from: "05.10.2026", to: "09.10.2026" }]);
  });

  it("treats a row whose only differences are kept as unchanged", () => {
    const item = diffRow(parsed({ quoted_date: "2026-10-09" }), { ...stored, app_edited_fields: ["quoted_date"] });
    expect(item.kind).toBe("unchanged");
    expect(item.kept).toHaveLength(1);
  });

  it("maps name fields to their database columns", () => {
    const item = diffRow(parsed({ sales_person_name: "FIDA" }), { ...stored, app_edited_fields: ["sales_person_id"] });
    expect(item.kind).toBe("unchanged");
    expect(item.kept.map((c) => c.field)).toEqual(["sales_person_name"]);
  });

  it("applies every difference when nothing was edited in the app", () => {
    const item = diffRow(parsed({ quoted_date: "2026-10-09" }), { ...stored, app_edited_fields: [] });
    expect(item.kind).toBe("changed");
    expect(item.kept).toEqual([]);
  });

  it("marks rows that are not stored yet as new", () => {
    expect(diffRow(parsed({}), undefined)).toMatchObject({ kind: "new", changes: [], kept: [] });
  });
});
