import { describe, expect, it } from "vitest";
import { attachmentsForAi, buildRequirements, buildSubject, buildUserText, normaliseAiResult, OUTPUT_SCHEMA } from "./ai.ts";
import { parseGmailMessage } from "./parse.ts";
import { aiAnswer, candidate, emptyContext, gmailMessage } from "./testFixtures.ts";
import type { AttachmentMeta } from "./types.ts";

type Schema = { type?: string; properties?: Record<string, Schema>; required?: string[]; additionalProperties?: boolean };

describe("OUTPUT_SCHEMA", () => {
  it("meets the structured-output rules: closed objects, every property required", () => {
    const check = (s: Schema, path: string) => {
      if (s.type !== "object") return;
      expect(s.additionalProperties, path).toBe(false);
      expect([...(s.required ?? [])].sort(), path).toEqual(Object.keys(s.properties ?? {}).sort());
      for (const [k, v] of Object.entries(s.properties ?? {})) check(v, `${path}.${k}`);
    };
    check(OUTPUT_SCHEMA as unknown as Schema, "$");
  });
});

describe("normaliseAiResult", () => {
  const ctx = emptyContext({ candidates: [candidate()] });

  it("cleans up values and turns blanks into null", () => {
    const r = normaliseAiResult(aiAnswer(), ctx);
    expect(r.classification).toBe("new_enquiry");
    expect(r.sales_person).toBe("VIVEK");
    expect(r.customer.contact_email).toBe("ahmed@example-trading.com");
    expect(r.shipment).toMatchObject({ pol: "NINGBO CHINA", incoterm: "EXW", volume: null, other_details: null, qty_text: "1X40' HC" });
  });

  it("drops what it cannot trust", () => {
    const r = normaliseAiResult(
      aiAnswer({
        confidence: 7,
        related_candidate_id: "not-a-candidate",
        sales_person: "SOMEONE ELSE",
        customer: { company_name: "", contact_name: "", contact_email: "not an email", phone: "", designation: "" },
        shipment: { ...(aiAnswer().shipment as object), trade_type: "UNKNOWN", shipment_mode: "BOAT", incoterm: "FOBX" },
      }),
      ctx,
    );
    expect(r.confidence).toBe(1);
    expect(r.related_candidate_id).toBeNull();
    expect(r.sales_person).toBeNull();
    expect(r.customer.contact_email).toBeNull();
    expect(r.shipment.shipment_mode).toBeNull();
    expect(r.shipment.incoterm).toBeNull();
    // Trade type falls back to the ports: POD in Oman = import.
    expect(r.shipment.trade_type).toBe("IMP");
  });

  it("keeps a valid candidate id and rejects an unknown classification", () => {
    expect(normaliseAiResult(aiAnswer({ classification: "follow_up", related_candidate_id: candidate().id }), ctx).related_candidate_id).toBe(candidate().id);
    expect(() => normaliseAiResult(aiAnswer({ classification: "spam" }), ctx)).toThrow(/classification/);
    expect(() => normaliseAiResult("not json", ctx)).toThrow();
  });
});

describe("subject and requirements", () => {
  const shipment = normaliseAiResult(aiAnswer(), emptyContext()).shipment;

  it("builds the house-style subject", () => {
    expect(buildSubject(shipment)).toBe("1X40' HC EX-WORKS NINGBO CHINA TO SOHAR OMAN");
    expect(buildSubject({ ...shipment, qty_text: null, shipment_mode: "AIR", incoterm: "FCA" })).toBe("AIR FCA NINGBO CHINA TO SOHAR OMAN");
    expect(buildSubject({ ...shipment, pol: null, pod: null })).toBeNull();
  });

  it("lists what has no register column", () => {
    expect(buildRequirements(shipment)).toBe("Commodity: Plastic granules\nIncoterm: EXW\nWeight: 24 t\nPackages: 960 bags\nCargo ready: 15 November");
  });
});

describe("attachments and prompt", () => {
  const file = (filename: string, mime_type: string, size: number, inline = false): AttachmentMeta => ({ filename, mime_type, size, inline });

  it("sends PDFs and real pictures only", () => {
    const list = [
      file("logo.png", "image/png", 5_000, true),
      file("photo.jpg", "image/jpeg", 300_000),
      file("tiny.png", "image/png", 9_000),
      file("rfq.pdf", "application/pdf", 200_000),
      file("rates.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 30_000),
      file("huge.pdf", "application/pdf", 9_000_000),
    ];
    // One file by default, a PDF before pictures; more when asked for, PDFs still first.
    expect(attachmentsForAi(list).map((a) => a.filename)).toEqual(["rfq.pdf"]);
    expect(attachmentsForAi(list, 3).map((a) => a.filename)).toEqual(["rfq.pdf", "photo.jpg"]);
    expect(attachmentsForAi(list.filter((a) => a.mime_type !== "application/pdf")).map((a) => a.filename)).toEqual(["photo.jpg"]);
  });

  it("describes the e-mail, the known customer and the candidates", () => {
    const email = parseGmailMessage(
      gmailMessage({ subject: "Fw: 1x40 HQ", text: "Pls quote\n\nFrom: Client\nSent: today\n\nNeed 1x40 Ningbo", attachments: [{ filename: "rfq.pdf", mimeType: "application/pdf", size: 50_000 }] }),
      { mailbox: "pricing@silverlynx.test", internalDomains: ["silverlynx.test"] },
    );
    const ctx = emptyContext({
      customer: { id: "c1", name: "EXAMPLE TRADING LLC", via: "domain" },
      candidates: [candidate(), candidate({ kind: "draft", id: "d1", reference: null, status: "draft" })],
    });
    const text = buildUserText(email, ctx, [email.attachments[0]], "pricing@silverlynx.test");
    expect(text).toContain("Subject: Fw: 1x40 HQ");
    expect(text).toContain("rfq.pdf (application/pdf, 50 KB) [attached below]");
    expect(text).toContain("Earlier messages quoted or forwarded below it:\nFrom: Client");
    expect(text).toContain("Known customer of this sender: EXAMPLE TRADING LLC (matched by company domain)");
    expect(text).toContain(`- id: ${candidate().id} | SL262700 | 2026-10-30`);
    expect(text).toContain("- id: d1 | pending e-mail enquiry (not yet in the register)");
    expect(text).toContain("Sales persons: AMAL, VIVEK, ZAHRA");
  });
});
