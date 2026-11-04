import { describe, expect, it } from "vitest";
import {
  decodeBase64Url,
  decodeBytes,
  decodeEncodedWords,
  extractSlRefs,
  htmlToText,
  muscatDate,
  parseAddressList,
  parseGmailMessage,
  QUOTE_MARKER,
  splitQuoted,
  storedBody,
} from "./parse.ts";
import { b64url, gmailMessage } from "./testFixtures.ts";

const opts = { mailbox: "pricing@silverlynx.test", internalDomains: ["silverlynx.test"] };

describe("decoding", () => {
  it("decodes base64url bodies in their charset", () => {
    expect(decodeBytes(decodeBase64Url(b64url("Rate for 1×40' — Sohar")), "utf-8")).toBe("Rate for 1×40' — Sohar");
    // "运费" (freight) in GBK
    expect(decodeBytes(new Uint8Array([0xd4, 0xcb, 0xb7, 0xd1]), "gbk")).toBe("运费");
    expect(decodeBytes(new TextEncoder().encode("abc"), "no-such-charset")).toBe("abc");
  });

  it("decodes RFC 2047 encoded headers", () => {
    expect(decodeEncodedWords("=?UTF-8?B?5Zue5aSN77yaRlc6IFNMMjYyNTE3?=")).toBe("回复：FW: SL262517");
    expect(decodeEncodedWords("=?ISO-8859-1?Q?R=E9ponse_rapide?= ok")).toBe("Réponse rapide ok");
    expect(decodeEncodedWords("plain subject")).toBe("plain subject");
  });

  it("parses address lists with quoted names", () => {
    expect(parseAddressList(`"Khan, Ahmed" <Ahmed@Example-Trading.com>, 'Maria' <pricing@silverlynx.test>; ops@agent.example`)).toEqual([
      { name: "Khan, Ahmed", email: "ahmed@example-trading.com" },
      { name: "Maria", email: "pricing@silverlynx.test" },
      { name: null, email: "ops@agent.example" },
    ]);
    expect(parseAddressList(null)).toEqual([]);
  });

  it("turns HTML into readable text", () => {
    const html = "<html><head><style>p{color:red}</style></head><body><p>Dear Sir,</p><div>POL&nbsp;: XIAMEN<br>POD : SOHAR</div><table><tr><td>A</td><td>B</td></tr></table>&amp; &#8364;5</body></html>";
    expect(htmlToText(html)).toBe("Dear Sir,\nPOL : XIAMEN\nPOD : SOHAR\nA\tB\n\n& €5");
  });
});

describe("splitQuoted", () => {
  it("cuts at an Outlook header block", () => {
    const body = "Please find shipper detail below.\n\nFrom: Ahmed Khan <ahmed@example-trading.com>\nSent: Tuesday, November 3, 2026 10:08 AM\nTo: Pricing\nSubject: RE: rate\n\nold text";
    const { newText, quotedText } = splitQuoted(body);
    expect(newText).toBe("Please find shipper detail below.");
    expect(quotedText.startsWith("From: Ahmed Khan")).toBe(true);
  });

  it("cuts at Gmail's 'On … wrote:' (also when wrapped) and drops > lines", () => {
    expect(splitQuoted("Thanks, noted.\n> earlier\n\nOn Mon, 13 Jul 2026 at 13:02, Ahmed Khan <\nahmed@example-trading.com> wrote:\n> quoted").newText).toBe("Thanks, noted.");
  });

  it("cuts at separators and forwarded banners, whichever comes first", () => {
    expect(splitQuoted("Noted\n________________________________\nFrom: X\nSent: Y").newText).toBe("Noted");
    expect(splitQuoted("FYI\n---------- Forwarded message ---------\nFrom: a").newText).toBe("FYI");
    expect(splitQuoted("Hi\n-----Original Message-----\nFrom: a").newText).toBe("Hi");
    expect(splitQuoted("好的\n\n发件人: 张三\n发送时间: 2026年11月3日").newText).toBe("好的");
    expect(splitQuoted("Just one message").quotedText).toBe("");
  });
});

describe("extractSlRefs", () => {
  it("finds references in the register's format, subject first, without duplicates", () => {
    expect(extractSlRefs("RE: SL262713 1X20' QINGDAO", "see also sl 262700 and SL-262713")).toEqual(["SL262713", "SL262700"]);
    expect(extractSlRefs("PO 26SOM0398 //SL262525 1X40'")).toEqual(["SL262525"]);
    expect(extractSlRefs("SL2610000 seven digits")).toEqual(["SL2610000"]);
  });

  it("ignores look-alikes", () => {
    expect(extractSlRefs("BSL262713, SL26SOM0398, SL123, SL1626001, ISL2627001")).toEqual([]);
  });
});

describe("parseGmailMessage", () => {
  it("extracts headers, text, references and attachments", () => {
    const parsed = parseGmailMessage(
      gmailMessage({
        id: "g1",
        threadId: "t1",
        from: "Ahmed Khan <Ahmed@example-trading.com>",
        to: "asst.bdm@silverlynx.test, Pricing <pricing@silverlynx.test>",
        cc: "ops@agent.example",
        subject: "RE: SL262700 1X40' NINGBO CHINA TO SOHAR OMAN",
        text: "Please confirm booking.\n\nFrom: Pricing\nSent: Monday\nTo: Ahmed\n\nOur offer SL262650",
        inReplyTo: "<abc@silverlynx.test>",
        references: "<root@example-trading.com> <abc@silverlynx.test>",
        date: "2026-11-04T21:30:00Z",
        attachments: [
          { filename: "image001.png", mimeType: "image/png", size: 4_000, contentId: "<image001.png@01DC>", disposition: "inline" },
          { filename: "Packing list.pdf", mimeType: "application/pdf", size: 120_000 },
        ],
      }),
      opts,
    );
    expect(parsed).toMatchObject({
      gmail_message_id: "g1",
      gmail_thread_id: "t1",
      sender_type: "external",
      from_email: "ahmed@example-trading.com",
      from_name: "Ahmed Khan",
      to_emails: ["asst.bdm@silverlynx.test", "pricing@silverlynx.test"],
      cc_emails: ["ops@agent.example"],
      in_reply_to: "<abc@silverlynx.test>",
      reference_ids: ["<root@example-trading.com>", "<abc@silverlynx.test>"],
      rfc_message_id: "<g1@mail.example>",
      new_text: "Please confirm booking.",
      received_at: "2026-11-04T21:30:00.000Z",
      is_bulk: false,
    });
    // The quoted SL262650 belongs to an earlier message and is not used for matching.
    expect(parsed.sl_refs).toEqual(["SL262700"]);
    expect(parsed.attachments.map((a) => [a.filename, a.inline])).toEqual([
      ["image001.png", true],
      ["Packing list.pdf", false],
    ]);
    expect(storedBody(parsed)).toBe(`Please confirm booking.${QUOTE_MARKER}From: Pricing\nSent: Monday\nTo: Ahmed\n\nOur offer SL262650`);
  });

  it("classifies senders and spots bulk mail", () => {
    expect(parseGmailMessage(gmailMessage({ from: "pricing@silverlynx.test" }), opts).sender_type).toBe("self");
    expect(parseGmailMessage(gmailMessage({ from: "Ops <operation3@SilverLynx.test>" }), opts).sender_type).toBe("staff");
    expect(parseGmailMessage(gmailMessage({ extraHeaders: { "List-Unsubscribe": "<mailto:x@y>" } }), opts).is_bulk).toBe(true);
    expect(parseGmailMessage(gmailMessage({ labels: ["INBOX", "CATEGORY_PROMOTIONS"] }), opts).is_bulk).toBe(true);
    expect(parseGmailMessage(gmailMessage({ extraHeaders: { "Auto-Submitted": "auto-replied" } }), opts).is_bulk).toBe(true);
    expect(parseGmailMessage(gmailMessage({ extraHeaders: { "Auto-Submitted": "no" } }), opts).is_bulk).toBe(false);
  });

  it("falls back to the HTML body", () => {
    const parsed = parseGmailMessage(gmailMessage({ text: undefined, html: "<p>Need rate <b>2x20</b> Jebel Ali to Sohar</p>" }), opts);
    expect(parsed.new_text).toBe("Need rate 2x20 Jebel Ali to Sohar");
  });
});

describe("muscatDate", () => {
  it("uses Oman's calendar day", () => {
    expect(muscatDate("2026-11-04T19:59:00Z")).toBe("2026-11-04");
    expect(muscatDate("2026-11-04T20:01:00Z")).toBe("2026-11-05");
  });
});
