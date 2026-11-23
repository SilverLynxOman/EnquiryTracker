import { QUOTE_MARKER } from "../emailDrafts";
import { enquiry } from "../testFixtures";
import type { EnquiryRow } from "../types";
import type { BriefInput, MailInput } from "./types";

// Helpers for the tests of the enquiry brief: timestamps on the Oman clock, e-mails and register rows with
// defaults, and the conversation of one real enquiry (SL262784) with its wording kept and its phone numbers made up.

/** The ISO UTC timestamp of an Oman wall-clock time: oman("2026-11-05 15:11") is 11:11 UTC. */
export function oman(wall: string): string {
  const [day, time = "00:00"] = wall.trim().split(/[ T]/);
  return new Date(`${day}T${time.length === 5 ? `${time}:00` : time}+04:00`).toISOString();
}

let seq = 0;

/**
 * An e-mail filed to the default row(): an outside sender writing to the pricing mailbox on one thread whose subject
 * carries the row's reference. With a subject that does not carry it, pass sl_refs: [] as the mailbox would store it.
 */
export function mail(over: Partial<MailInput> = {}): MailInput {
  seq++;
  return {
    id: `m${seq}`,
    mailbox_id: null,
    gmail_message_id: `g${seq}`,
    gmail_thread_id: "t1",
    sender_type: "external",
    from_email: "someone@example.com",
    from_name: null,
    to_emails: ["pricing@silverlynxoman.com"],
    cc_emails: [],
    subject: "RE: SL262700 LCL SHANGHAI CHINA TO SOHAR OMAN",
    received_at: oman("2026-11-05 10:00"),
    snippet: null,
    body_text: "",
    sl_refs: ["SL262700"],
    attachments: [],
    status: "linked",
    classification: "follow_up",
    match_method: "reference",
    confidence: 1,
    summary: null,
    note: null,
    suggested_enquiry_id: null,
    enquiry_id: "SL262700",
    draft_id: null,
    ...over,
  };
}

/** A register row: SL262700, LCL import Shanghai to Sohar, received Sun 01 Nov 2026, waiting for a quote. */
export function row(over: Partial<EnquiryRow> = {}): EnquiryRow {
  return enquiry({ reference: "SL262700", enquiry_date: "2026-11-01", ...over });
}

/** What buildBrief takes, as a manager on the pricing mailbox sees it on Mon 09 Nov 2026 at 18:00 Oman. */
export function input(enquiryRow: EnquiryRow, emails: MailInput[], over: Partial<BriefInput> = {}): BriefInput {
  return {
    row: enquiryRow,
    emails,
    followUps: [],
    now: oman("2026-11-09 18:00"),
    viewer: { canEdit: true, canReply: true, me: null },
    mailbox: "pricing@silverlynxoman.com",
    ...over,
  };
}

// --- SL262784: Oman Textiles, LCL FOB Ningbo to Sohar ---------------------------------------------------------

const ANWAR_SIGNATURE = `Thanks & Regards

Anwar K. S.

M: +968 9000 0102

E:  <mailto:operation2@silverlynxoman.com> operation2@silverlynxoman.com

SILVER LYNX CO, LLC

P.O. 844, P.C. 116, Muscat Int. Center

Office No. 103 & 104, Near Ruwi Sheraton Hotel

Muscat, Sultanate of Oman.

Web :  <http://secure-web.cisco.com/1y3JtYqDJKry_CLBYK0PhyvZhBiWQHBU_6ANuLZqSzZoRpl6aWYZAaf6WRauZf5Np0E/http%3A%2F%2Fwww.silverlynxoman.com%2F> www.silverlynxoman.com

An ISO Certified Company 9001 | ISO 14001 | ISO 45001`;

const ASHWIN_SIGNATURE = `Thanks & Regards,

Ashwin Luiz
Cell : 90000103

SILVER LYNX CO LLC

P.O. 844, P.C. 116, Muscat Int. Center, Office No. 103 & 104, Near Ruwi Sheraton Hotel, Muscat, Sultanate of Oman.

Web    :   <http://www.silverlynxoman.com/> www.silverlynxoman.com

Branch offices: Salalah & Sohar

Freight Forwarder | NVOCC | Customs Broker | Projects Handling & Heavy Equipment | GCC transporters

Global Reach with local expertise.`;

const FAHID_SIGNATURE = `Best regards,

Fahid K V

Oman Textile Mills

www.omantextiles.com <http://www.omzest.com/>

Cell: +968 9000 0104`;

const FRONTLINE_DISCLAIMER = `Disclaimer:
Due to the prevailing geopolitical situation and the temporary closure of GCC airspace and seaports, airline and shipping line operations across the region are experiencing significant disruptions. Most carriers have implemented war-risk surcharges, emergency conflict surcharges, and Peak Season Surcharges (PSS).
Freight rates across all modes of transportation are subject to immediate review and possible revision by the respective carriers under the prevailing circumstances. All rates are strictly subject to reconfirmation at the time of booking.
[cid:image003.jpg@01DD6D01.80146CC0]
[cid:image004.jpg@01DD6D01.80146CC0]`;

const MANU_TAIL = `Thanking You..!

${FRONTLINE_DISCLAIMER}`;

const REENA_TAIL = `Transit delays are beyond our control, arrival date subject to change without prior notice

Note:
${FRONTLINE_DISCLAIMER}`;

const ORIGIN_AGENT = `Yoyo
Overseas Customer Service

Shanghai WE-CAN INTERNATIONAL LOGISTICS CO.,LTD.
SHANGHAI
Floor 20TH, Building A, CapitalMall HongKou Plaza
No. 388, JiangWan Road (West), Shanghai China.

NINGBO WE-CAN SUPPLY CHAIN
NINGBO
Room 416,No.68, Heji Street,Fuming Township,YinZhou District,
Ningbo City,Zhejiang Province,China

TEL:+86 13000000105
EMAIL：overseas04@we-can.sh.cn<mailto:overseas04@we-can.sh.cn>
BRANCHES : NINGBO, NANJING
WCA MEMBER: ID 69914`;

const SHIPPER = `Aedan Sourcing Co. Ltd - China.

ROOM 1103 MINSHANG BUILDING No 679- YUHUI ROAD CBD KEQIAO SHAOXING ZHEJIANG CHINA -312030
-TEL : + 86 575 80000106   Mob：+86 13000000107  – /Email – office5 <mailto:ravi@aslchina.net> @aslchina.net

Contact Person : Tina`;

/** The same block as our own mail passed it on: wrapped again, the link broken over two lines, the full-width colon lost. */
const SHIPPER_FORWARDED = `Aedan Sourcing Co. Ltd - China.

ROOM 1103 MINSHANG BUILDING No 679- YUHUI ROAD CBD KEQIAO SHAOXING ZHEJIANG
CHINA -312030
-TEL : + 86 575 80000106   Mob${String.fromCharCode(0xfffd).repeat(3)}+86 13000000107  - /Email - office5 <mailto:
ravi@aslchina.net> @aslchina.net

Contact Person : Tina`;

const PALLET_QUESTION = `Shipper says pallet is not needed for the fabric if consignee has valid customs clearance qualification. Please check and confirm.

Cargo ：
 Fabrics > 85% of synthetic staple fiber, bleached or not; HS Code 55129100
100%Polyester;300D/96F/1×300D/96F/1 slightly intermingled,Raw White,Semi Dull,68×
64;Twill 2/2;200 GSM;63"(greige width);Leno Selvedge(OTM QUALITY #GE-4036)`;

const CUSTOMER_REQUEST = `---------- Forwarded message ---------
From: Fahid, OTM <purchase_otm@omzest.com>
Date: Wed, 4 Nov 2026, 2:35 pm
Subject: Request for Sea Freight Quotation - FOB Ningbo to Sohar (LCL)
To: sales 7 <sales7@silverlynxoman.com>
Cc: Raghavan Ramachandran <raghavan_otm@omzest.com>

Dear Jeethu,

Please provide your best quotation for sea freight charges on an *LCL basis
from FOB Ningbo Port to Sohar Port, Oman*, along with the estimated transit
time, as per the shipment details below.

*Please mention the destination charges separately, along with all
applicable local charges at Sohar Port.*

The packing list is attached for your reference.

1.

Port of Loading

Ningbo port

2.

Port of Discharge

Sohar Port, Oman

3.

Shipment Date

10-Nov-2026  - Approx

6.

Material

Fabric rolls

7.

No of Rolls

41 rolls

8.

Net Weight

2,886 kgs

9

Gross Weight

2,892. kgs

10

CBM

6 CBM (approx.)

11

Remarks

FOB Ningbo port

12

Factory Address

*Aedan Sourcing Co. Ltd*

*Room 1103,Minshang Building No.679,Yuhui Road CBD,keqiao, Shaoxing*

*Zhejiang, CHINA-312030*

Best regards,

*Fahid K V*

*Oman Textile Mills*

www.omantextiles.com <http://www.omzest.com/>

*Cell: +968 9000 0104*`;

const FINAL_OFFER = `SEA FOB

PORT TO PORT        :  OMR 339.000

LCL + DO                 : OMR 132.000

CFS CHARGES      : AT ACTUALS

POL                             :   NINGBO

POD                            :   SOHAR

TRANSIT TIME            :   35 DAYS`;

const OFFER_NOTES = `•             Quoted rate based on volume 6 CBM | 41 Packages.

•             Quoted rate based on General | Stackable cargo | Non DG.

•             If any variation in weight or height (dimension) then the rates will vary.`;

/** A body as the mailbox stores it: what the sender wrote, the marker, then the quoted history. */
const withHistory = (text: string, earlier: string) => `${text}\n\n${QUOTE_MARKER}\n${earlier}`;

const OPERATION2 = "operation2@silverlynxoman.com";
const OPERATION = "operation@silverlynxoman.com";
const SALES7 = "sales7@silverlynxoman.com";
const PRICING = "pricing@silverlynxoman.com";
const FAHID = "purchase_otm@omzest.com";
const RAGHAVAN = "raghavan_otm@omzest.com";
const MANU = "manukrishna@flgshipping.net";
const ABINAND = "abinand@flgshipping.net";
const REENA = "reena@flgshipping.net";
const FLG_DESK = "cs2lclom@flgshipping.net";

const CUSTOMER_SUBJECT = "RE: SL262784 // Request for Sea Freight Quotation - FOB Ningbo to Sohar (LCL)";
const AGENT_SUBJECT = "RE: SL262784 // LCL FOB NINGBO CHINA TO SOHAR OMAN";
const AGENT_JOB_SUBJECT = "RE: ENQ1020126007139//ABSOH26110504//SL262784 // LCL FOB NINGBO CHINA TO SOHAR OMAN";

const BOOKING_FORM = {
  filename: "BOOKING FORM -320348- (1).xls",
  mime_type: "application/vnd.ms-excel",
  size: 30720,
  skipped: null,
};

/**
 * The conversation of SL262784 as the mailbox holds it (Wed 04 to Mon 09 Nov 2026): the register still says
 * "new" while the e-mails show a quote, a final offer, the customer's nomination, the agent's rates coming down
 * and the SO. Eleven e-mails with the customer, thirteen with Frontline on three Gmail threads plus its
 * "adding a colleague" note, and the sales person's forward. Texts as written, the long disclaimers shortened and
 * the phone numbers made up. Two short notes of ours are left out: "Noted." to Frontline (Thu 08:16) and "Noted, we
 * shall proceed without palletization" to the customer (Sun 09:11).
 */
export function sl262784(): { row: EnquiryRow; emails: MailInput[] } {
  const enquiryRow = enquiry({
    reference: "SL262784",
    enquiry_date: "2026-11-04",
    customer_name: "OMAN TEXTILES",
    subject: "SL262784 LCL FOB NINGBO CHINA TO SOHAR OMAN",
    trade_type: "IMP",
    qty_text: "LCL",
    shipment_mode: "LCL",
    pol: "NINGBO CHINA",
    pod: "SOHAR OMAN",
    sales_person_id: "s7",
    sales_person_name: "JITTU",
    source: "import",
    created_at: "2026-11-04T10:40:00Z",
    updated_at: "2026-11-04T10:40:00Z",
  });

  let n = 0;
  const filed = (at: string, over: Partial<MailInput>): MailInput => {
    n++;
    const id = String(n).padStart(2, "0");
    return mail({
      id: `sl84-${id}`,
      gmail_message_id: `g-sl84-${id}`,
      received_at: oman(at),
      sl_refs: ["SL262784"],
      enquiry_id: enquiryRow.id,
      ...over,
    });
  };
  const anwar = { sender_type: "staff" as const, from_email: OPERATION2, from_name: "Anwar" };
  const ashwin = { sender_type: "staff" as const, from_email: OPERATION, from_name: "Ashwin luiz" };
  const fahid = { from_email: FAHID, from_name: "Fahid, OTM" };
  const manu = { from_email: MANU, from_name: "Manukrishna VK" };
  const reena = { from_email: REENA, from_name: "Reena Aneesh" };

  const forward = { gmail_thread_id: "1a1a6242a4c3cd19", subject: "Fwd: Request for Sea Freight Quotation - FOB Ningbo to Sohar (LCL)" };
  const firstAsk = { gmail_thread_id: "1a1a6e18ae341bf3" };
  const rates = { gmail_thread_id: "1a1a9ec9301e976a", subject: AGENT_SUBJECT };
  const job = { gmail_thread_id: "1a1ab9b1ea7a5d8b", subject: AGENT_JOB_SUBJECT };
  const customer = { gmail_thread_id: "1a1a9ef8c9e3481b", subject: CUSTOMER_SUBJECT };

  const toFrontline = { to_emails: [MANU, ABINAND], cc_emails: [PRICING] };
  const fromManu = { to_emails: [OPERATION2, ABINAND], cc_emails: [PRICING] };
  const toCustomer = { to_emails: [FAHID], cc_emails: [SALES7, PRICING, RAGHAVAN] };
  const fromCustomer = { to_emails: [OPERATION2], cc_emails: [SALES7, PRICING, RAGHAVAN] };
  const jobToAshwin = { to_emails: [OPERATION, MANU, ABINAND], cc_emails: [PRICING, FLG_DESK, OPERATION2] };
  const jobFromAshwin = { to_emails: [REENA, MANU, ABINAND], cc_emails: [PRICING, FLG_DESK, OPERATION2] };
  const ashwinToCustomer = { to_emails: [FAHID], cc_emails: [SALES7, PRICING, OPERATION2, RAGHAVAN] };
  const customerToAshwin = { to_emails: [OPERATION], cc_emails: [SALES7, PRICING, OPERATION2, RAGHAVAN] };

  const emails: MailInput[] = [
    // Wed 04 Nov: the sales person forwards the customer's request; operations asks Frontline.
    filed("2026-11-04 14:38", {
      ...forward,
      sender_type: "staff",
      from_email: SALES7,
      from_name: "sales 7",
      to_emails: [OPERATION2],
      sl_refs: [],
      classification: "new_enquiry",
      match_method: "ai",
      body_text: `\n\n${QUOTE_MARKER}\n${CUSTOMER_REQUEST}`,
      attachments: [
        { filename: "DOCS ASL OTM 320348.pdf", mime_type: "application/pdf", size: 252718, storage_path: "2026/11/1a1a6242a4c3cd19/1-DOCS_ASL_OTM_320348.pdf", skipped: null },
      ],
    }),
    filed("2026-11-04 18:05", {
      ...firstAsk,
      ...anwar,
      ...toFrontline,
      subject: "LCL FOB NINGBO CHINA TO SOHAR OMAN",
      sl_refs: [],
      classification: "new_enquiry",
      match_method: "ai",
      body_text: `Dear Manu

Please advise the quote for below sea shipment on FOB TERMS.

NINGBO - SOHAR

Material

Fabric rolls

No of Rolls

41 rolls

Net Weight

2,886 kgs

Gross Weight

2,892. kgs

CBM

6 CBM

${ANWAR_SIGNATURE}`,
    }),

    // Thu 05 Nov: Frontline's rate, our offer and final offer, the nomination, the buy pushed down, the booking.
    filed("2026-11-05 07:11", {
      ...firstAsk,
      ...manu,
      ...fromManu,
      subject: "RE: LCL FOB NINGBO CHINA TO SOHAR OMAN",
      sl_refs: [],
      match_method: "reply",
      body_text: withHistory(
        `Dear Team,

Greetings !!!

Thanks for below enquiry.

Based on   6 CBM , pleased to offer as below - Stackable, Non DG rates ;

POR               : NINGBO

POL                : SHANGHAI

POD                : SOHAR

TERM             : FOB

TRANSIT        :  25-35  DAYS FROM THE DATE OF SAILING,MAY CHANGE

OCEAN FREIGHT                                      : OMR  309/- All in for  6 CBM

LCL + DO CHARGES                               : OMR   117/- All in for  6 CBM

NOTE: Quoted rates are not valid and no validity can be provided as the charges may change vessel by vessel

Due to the current geopolitical situation in the Middle East, all quoted freight rates, surcharges, and transit times are subject to change without prior notice.

1)No rate validity can be provided, and subject to change based on transport availability.

2) Considering the current war-like situation, insurance coverage is currently not available. Therefore, any movement of cargo will need to be undertaken strictly at the customer's own risk and responsibility

FLG Shipping & Logistics shall not be held liable for any delays, losses, or additional expenses arising from circumstances beyond its reasonable control.

${MANU_TAIL}`,
        `From: Anwar <operation2@silverlynxoman.com>
Sent: Wednesday, November 4, 2026 6:06 PM
To: Manukrishna VK <manukrishna@flgshipping.net>; Abinand <abinand@flgshipping.net>
Cc: 'Silver Lynx Pricing' <pricing@silverlynxoman.com>
Subject: LCL FOB NINGBO CHINA TO SOHAR OMAN

Dear Manu

Please advise the quote for below sea shipment on FOB TERMS.`,
      ),
    }),
    filed("2026-11-05 08:20", {
      ...customer,
      ...anwar,
      to_emails: [FAHID, RAGHAVAN],
      cc_emails: [SALES7, PRICING],
      body_text: `Dear Sir

Good day

Please find below our offer.

SEA FOB

PORT TO PORT        :  OMR 359.000

POL                             :   NINGBO

POD                            :   SOHAR

TRANSIT TIME            :   35 DAYS

${OFFER_NOTES}

${ANWAR_SIGNATURE}`,
    }),
    filed("2026-11-05 08:44", {
      ...customer,
      ...fahid,
      ...fromCustomer,
      body_text: withHistory(
        `Dear Anwar,

Please share the destination charges for our reference.

${FAHID_SIGNATURE}`,
        `From: Anwar <operation2@silverlynxoman.com>
Sent: Thursday, November 5, 2026 8:20 AM
To: 'Fahid, OTM' <purchase_otm@omzest.com>; 'Raghavan Ramachandran' <raghavan_otm@omzest.com>
Subject: RE: SL262784 // Request for Sea Freight Quotation - FOB Ningbo to Sohar (LCL)

Dear Sir

Good day

Please find below our offer.

SEA FOB

PORT TO PORT        :  OMR 359.000`,
      ),
    }),
    filed("2026-11-05 08:46", {
      ...customer,
      ...anwar,
      ...toCustomer,
      body_text: `Dear Sir

Please find below.

LCL + DO: OMR 132.000

CFS CHARGES: AT ACTUALS

${ANWAR_SIGNATURE}`,
    }),
    filed("2026-11-05 09:37", {
      ...customer,
      ...anwar,
      to_emails: [FAHID, RAGHAVAN],
      cc_emails: [SALES7, PRICING],
      body_text: `Dear Sir

Good day

Please find below our final offer.

${FINAL_OFFER}

${OFFER_NOTES}

${ANWAR_SIGNATURE}`,
    }),
    filed("2026-11-05 15:11", {
      ...customer,
      ...fahid,
      ...fromCustomer,
      body_text: withHistory(
        `Dear Anwar,

You are here by nominated to arrange for collection of cargo immediately.

Please advise your agent details.

${FINAL_OFFER}

${FAHID_SIGNATURE}`,
        `From: Anwar <operation2@silverlynxoman.com>
Sent: Thursday, November 5, 2026 9:37 AM
To: 'Fahid, OTM' <purchase_otm@omzest.com>; 'Raghavan Ramachandran' <raghavan_otm@omzest.com>
Cc: 'sales 7' <sales7@silverlynxoman.com>; 'Silver Lynx Pricing' <pricing@silverlynxoman.com>
Subject: RE: SL262784 // Request for Sea Freight Quotation - FOB Ningbo to Sohar (LCL)

Dear Sir

Good day

Please find below our final offer.

${FINAL_OFFER}`,
      ),
    }),
    filed("2026-11-05 15:17", {
      ...rates,
      ...anwar,
      ...toFrontline,
      body_text: `Dear Manu

Please support for below.

OCEAN FREIGHT                                      : OMR  285/- All in for
6 CBM

LCL + DO CHARGES                               : OMR   117/- All in for  6
CBM

${ANWAR_SIGNATURE}`,
    }),
    filed("2026-11-05 15:27", {
      ...rates,
      ...manu,
      ...fromManu,
      body_text: `Dear Anwar,

Pls let us proceed with below. Its our best.

OCEAN FREIGHT                                      : OMR  303/- All in for  6 CBM

LCL + DO CHARGES                               : OMR   117/- All in for  6 CBM

${MANU_TAIL}`,
    }),
    filed("2026-11-05 15:35", {
      ...rates,
      ...manu,
      ...fromManu,
      body_text: `Dear Anwar,

Pls support with below:

OCEAN FREIGHT                                      : OMR  298/- All in for  6 CBM

LCL + DO CHARGES                               : OMR   117/- All in for  6 CBM

Agent:
${ORIGIN_AGENT}

${MANU_TAIL}`,
    }),
    filed("2026-11-05 15:37", {
      ...customer,
      ...anwar,
      to_emails: [FAHID],
      cc_emails: [SALES7, PRICING, RAGHAVAN, OPERATION],
      body_text: `Dear Sir

Good day

Thank you for the confirmation, find below the agent details.

Please share the shipper contact details.

Agent:

${ORIGIN_AGENT}

${ANWAR_SIGNATURE}`,
    }),
    filed("2026-11-05 16:02", {
      ...customer,
      ...fahid,
      to_emails: [OPERATION2],
      cc_emails: [SALES7, PRICING, RAGHAVAN, OPERATION],
      body_text: `Dear Anwar,

Please find below Contact details for your reference.

${SHIPPER}

${FAHID_SIGNATURE}`,
    }),
    filed("2026-11-05 16:04", {
      ...rates,
      ...anwar,
      to_emails: [MANU, ABINAND],
      cc_emails: [PRICING, OPERATION],
      body_text: `Dear Manu

Please proceed this shipment.

${SHIPPER_FORWARDED}

CONSIGNEE: OMAN TEXTILES MILLS

${ANWAR_SIGNATURE}`,
    }),
    filed("2026-11-05 16:06", {
      ...job,
      ...manu,
      to_emails: [OPERATION2, ABINAND, REENA],
      cc_emails: [PRICING, OPERATION, FLG_DESK],
      body_text: `Dear Anwar,

Noted. Will updated.

++@Reena Aneesh<mailto:reena@flgshipping.net> pls.

${MANU_TAIL}`,
    }),

    // Fri 06 to Sun 08 Nov: the origin's question about pallets goes round.
    filed("2026-11-06 07:41", {
      ...job,
      ...manu,
      to_emails: [OPERATION2, ABINAND, REENA],
      cc_emails: [PRICING, OPERATION, FLG_DESK],
      body_text: `Dear Anwar,

${PALLET_QUESTION}

${MANU_TAIL}`,
    }),
    filed("2026-11-07 10:01", {
      ...customer,
      ...ashwin,
      ...ashwinToCustomer,
      body_text: `Dear Sir,

Please find below message from origin and advise to proceed further

‘’

${PALLET_QUESTION}

‘’

${ASHWIN_SIGNATURE}`,
    }),
    filed("2026-11-07 15:42", {
      ...job,
      ...reena,
      to_emails: [MANU, OPERATION2, ABINAND],
      cc_emails: [PRICING, OPERATION, FLG_DESK],
      body_text: `Dear Anwar

Awaiting reply on below .

${REENA_TAIL}`,
    }),
    filed("2026-11-08 08:54", {
      ...customer,
      ...fahid,
      ...customerToAshwin,
      body_text: `Dear Ashwin,

This clarification should be obtained directly by your nominated agent, as they are responsible for handling the shipment and coordinating with the origin team.

I am not the right person to confirm this matter. Please coordinate with your agent and advise us based on the applicable Oman customs regulations.

We nominated your agent to handle these matters, so please avoid simply forwarding every query to us for clarification.

${FAHID_SIGNATURE}`,
    }),
    filed("2026-11-08 09:10", {
      ...job,
      ...ashwin,
      ...jobFromAshwin,
      body_text: `Dear Reena,

Please proceed without palletization

${ASHWIN_SIGNATURE}`,
    }),

    // Mon 09 Nov: the customer complains, the SO is issued and passed on.
    filed("2026-11-09 08:59", {
      ...job,
      ...reena,
      ...jobToAshwin,
      body_text: `Dear Ashwin

Noted your message will keep you posted .

${REENA_TAIL}`,
    }),
    filed("2026-11-09 09:25", {
      ...customer,
      ...fahid,
      ...customerToAshwin,
      body_text: `Dear Ashwin,

Our vendor has informed us that the material is ready for handover, but your team is not responding.

Kindly check with your team and provide an urgent update on the handover status.

${FAHID_SIGNATURE}`,
    }),
    filed("2026-11-09 10:58", {
      ...job,
      ...reena,
      ...jobToAshwin,
      body_text: `Dear Ashwin,

Agent have received the shipper's booking  and issued S/O to the shipper accordingly.
Please refer to the following cargo details and confirm to proceed.

SHANGHAI-Sohar
shpt will arrive at agent w/h bfr 11.16

[cid:image007.jpg@01DD6FDA.184FF5B0]

${REENA_TAIL}`,
      attachments: [{ ...BOOKING_FORM, storage_path: "2026/11/1a1bf1a77945b7fa/1-BOOKING_FORM_-320348-_1.xls" }],
    }),
    filed("2026-11-09 11:13", {
      ...job,
      ...ashwin,
      ...jobFromAshwin,
      body_text: `Dear Reena,

Please proceed

${ASHWIN_SIGNATURE}`,
    }),
    filed("2026-11-09 11:15", {
      ...customer,
      ...ashwin,
      ...ashwinToCustomer,
      body_text: `Dear Sir,

Please note we have received the shipper's booking as attached and issued S/O to the shipper accordingly.

We shall update you further once shipper hand over cargo

${ASHWIN_SIGNATURE}`,
      attachments: [{ ...BOOKING_FORM, storage_path: "2026/11/1a1bf2967d38a8e1/1-BOOKING_FORM_-320348-_1.xls" }],
    }),
    filed("2026-11-09 11:29", {
      ...job,
      ...reena,
      ...jobToAshwin,
      body_text: `Noted with thanks Ashwin

${REENA_TAIL}`,
    }),
  ];

  return { row: enquiryRow, emails };
}
