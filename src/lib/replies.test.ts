import { describe, expect, it } from "vitest";
import { composeReply, parseAddresses, quoteEmail, replyRecipients, replySubject } from "./replies";

const ours = ["pricing@silverlynxoman.com"];
const external = {
  sender_type: "external" as const,
  from_email: "Robert@yxl.com",
  from_name: "Robert-YXL",
  to_emails: ["pricing@silverlynxoman.com", "ashwin@silverlynxoman.com"],
  cc_emails: ["ops@yxl.com", "pricing@silverlynxoman.com"],
  subject: "RE: SL262574 AIR EX-WORKS JIANGMEN",
  received_at: "2026-11-05T11:20:00Z",
  body_text: "Dear Ashwin,\nStill waiting for the airline.",
};

describe("replyRecipients", () => {
  it("replies to the sender only", () => {
    expect(replyRecipients(external, ours, false)).toEqual({ to: ["robert@yxl.com"], cc: [] });
  });

  it("reply all keeps everyone except our own mailbox", () => {
    expect(replyRecipients(external, ours, true)).toEqual({ to: ["robert@yxl.com", "ashwin@silverlynxoman.com"], cc: ["ops@yxl.com"] });
  });

  it("answering our own e-mail goes to the people it was sent to", () => {
    const self = { ...external, sender_type: "self" as const, from_email: "pricing@silverlynxoman.com", to_emails: ["robert@yxl.com"], cc_emails: ["ops@yxl.com"] };
    expect(replyRecipients(self, ours, false)).toEqual({ to: ["robert@yxl.com"], cc: [] });
    expect(replyRecipients(self, ours, true)).toEqual({ to: ["robert@yxl.com"], cc: ["ops@yxl.com"] });
  });
});

describe("replySubject", () => {
  it("adds Re: once and keeps the subject", () => {
    expect(replySubject("RE: SL262574 AIR", "SL262574")).toBe("RE: SL262574 AIR");
    expect(replySubject("SL262574 AIR", "SL262574")).toBe("Re: SL262574 AIR");
    expect(replySubject("回复: SL262700 1X40'", "SL262700")).toBe("回复: SL262700 1X40'");
  });

  it("puts the reference in when the subject lacks it", () => {
    expect(replySubject("Rate for Jiangmen", "SL262574")).toBe("Re: SL262574 Rate for Jiangmen");
    expect(replySubject(null, "SL262574")).toBe("Re: SL262574");
  });
});

describe("quoteEmail and composeReply", () => {
  it("quotes the answered e-mail Gmail style, in Oman time", () => {
    expect(quoteEmail(external)).toBe("On Thu, 5 Nov 2026 at 15:20, Robert-YXL <Robert@yxl.com> wrote:\n> Dear Ashwin,\n> Still waiting for the airline.");
  });

  it("puts the signature and the quote under the message", () => {
    expect(composeReply("Noted.\n\n", "Ashwin\nSilver Lynx", "> hi")).toBe("Noted.\n\n-- \nAshwin\nSilver Lynx\n\n> hi");
    expect(composeReply("Noted.", "", null)).toBe("Noted.");
  });
});

describe("parseAddresses", () => {
  it("reads lists typed or pasted in many ways", () => {
    expect(parseAddresses("a@x.com, B@Y.com; Robert <robert@yxl.com>\nc@z.com")).toEqual(["a@x.com", "b@y.com", "robert@yxl.com", "c@z.com"]);
  });
});
