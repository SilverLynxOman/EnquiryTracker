import { describe, expect, it } from "vitest";
import { base64Size, buildReplyMessage, headerText, parseSendRequest, Refusal } from "./mime.ts";

const ID = "3cafd51b-b7d2-43cc-8347-215e1d71c703";
const ok = { replyToEmailId: ID, to: ["Robert@Example.com"], cc: [], subject: "Re: SL262574 AIR JIANGMEN", body: "Dear Robert,\nNoted." };

describe("parseSendRequest", () => {
  it("accepts a reply, lower-casing and de-duplicating addresses (Cc never repeats To)", () => {
    const r = parseSendRequest({ ...ok, to: ["Robert@Example.com", "robert@example.com"], cc: ["robert@example.com", "ops@example.com"] });
    expect(r.to).toEqual(["robert@example.com"]);
    expect(r.cc).toEqual(["ops@example.com"]);
    expect(r.attachments).toEqual([]);
  });

  it("refuses what cannot be sent, with a message for the person", () => {
    expect(() => parseSendRequest({ ...ok, to: [] })).toThrow("Add at least one address");
    expect(() => parseSendRequest({ ...ok, to: ["not an address"] })).toThrow("is not an e-mail address");
    expect(() => parseSendRequest({ ...ok, body: "  " })).toThrow("The message is empty");
    expect(() => parseSendRequest({ ...ok, replyToEmailId: "x" })).toThrow(Refusal);
    expect(() => parseSendRequest({ ...ok, attachments: [{ filename: "a.pdf", data: "%%%" }] })).toThrow("could not be read");
  });

  it("keeps the subject on one line", () => {
    expect(parseSendRequest({ ...ok, subject: "Re: one\r\nBcc: evil@example.com" }).subject).toBe("Re: one Bcc: evil@example.com");
  });
});

describe("buildReplyMessage", () => {
  const base = {
    from: "pricing@silverlynxoman.com",
    to: ["robert@example.com"],
    cc: ["ops@example.com"],
    subject: "Re: SL262574 AIR JIANGMEN",
    body: "Dear Robert,\nNoted.",
    inReplyTo: "abc@mail.example.com",
    references: ["first@mail.example.com", "abc@mail.example.com"],
    attachments: [],
    date: new Date("2026-11-05T19:00:00Z"),
    boundary: "b1",
  };

  it("threads the reply with In-Reply-To and References", () => {
    const m = buildReplyMessage(base);
    expect(m).toContain("In-Reply-To: <abc@mail.example.com>\r\n");
    expect(m).toContain("References: <first@mail.example.com> <abc@mail.example.com>\r\n");
    expect(m).toContain("Cc: ops@example.com\r\n");
    expect(m).toContain("Content-Type: text/plain; charset=UTF-8");
    const body = m.split("\r\n\r\n")[1]!.replace(/\r\n/g, "");
    expect(atob(body)).toBe("Dear Robert,\r\nNoted.");
  });

  it("adds attachments as a multipart message and encodes non-ASCII names", () => {
    const m = buildReplyMessage({ ...base, subject: "回复: SL262700", attachments: [{ filename: "提单.pdf", mimeType: "application/pdf", data: btoa("PDF") }] });
    expect(m).toContain('Content-Type: multipart/mixed; boundary="b1"');
    expect(m).toContain(`Subject: ${headerText("回复: SL262700")}`);
    expect(headerText("回复")).toMatch(/^=\?UTF-8\?B\?/);
    expect(m).toContain("Content-Disposition: attachment; filename=\"=?UTF-8?B?");
    expect(m.trimEnd().endsWith("--b1--")).toBe(true);
  });
});

describe("base64Size", () => {
  it("measures decoded bytes", () => {
    expect(base64Size(btoa("hello"))).toBe(5);
    expect(base64Size(btoa("hell"))).toBe(4);
  });
});
