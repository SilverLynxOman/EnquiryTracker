import type { DocKind } from "./types";

// Every regular expression the enquiry brief reads e-mails with, by name. Settled against real mail: change one only with a test.

/* Scope and cleaning */
export const SL_REF = /\bSL\s?-?(\d{6})\b/gi;
export const QUOTED_HEADER_LEAK = /\n\s*-{3,}\s*(?:Original|Original Message|回复的原邮件)\s*-{3,}|(?:^|\n)[ \t>*_]*(?:From|De|Von|Da|发件人)\s*[:：]\*?\s*[^\n]{0,200}\n[ \t>*_]*(?:Sent|Envoyé|Gesendet|Inviato|发送日期|发送时间)\s*[:：]/i;
// Starts at the text's start, a ". " or a new line. Only the first new line of a run of blank lines is a start (the
// ones after it reach the same place), and "warm prompt" takes spaces after its stars only: a long run of blank or
// space-only lines is read once instead of once per line.
export const BOILERPLATE = /(?:^|(?<!(?:^|\n|\. )[^\S\n]*)\n|\. )\s*(?:disclaimer\s*:|important notice|war risk advisory|transit delays are beyond our control|all of quotations are subject to|due to the (?:prevailing|ongoing|current) geopolitical|note\s*:\s*due to the ongoing|kindly note an important oman customs notice|please note that algerian week ?end|p\.s\.?\s*:|this (?:e-?mail|message) (?:and any attachments )?(?:is|are) confidential|(?:p\s+)?please consider the environment before printing|according to (?:article|art\.) [^\n]{0,40}\b(?:gdpr|regulation)\b|if you (?:have )?received this (?:e-?mail|message|communication) (?:by mistake|in error)|订舱请主动告知|我司财务要求|如果阁下对我司|(?:\*{1,3}\s*)?warm prompt\b|特别提醒|\d\s*[.、．]\s*目的国规定)[\s\S]*$/i;
export const LINK_WRAPPERS = /<https?:\/\/(?:secure-web\.cisco\.com|urlsand\.esvalabs\.com)\/[^>]{0,3000}>|<?https?:\/\/secure-web\.cisco\.com\/\S+>?|<?https?:\/\/urlsand\.esvalabs\.com\/\S+>?|<(?:mailto|tel):[^>]+>|\[cid:[^\]]+\]/gi;
export const GREETING = /^\s*(?:dear|hi|hello|hey|derar?)\b[^\n,]{0,40}[,\n]\s*(?:good (?:day|morning|afternoon|evening)|greetings)?[!., ]*/i;
// SIGN_OFF = the existing list in enquiryDetails.ts OR this extension; cut at whichever matches first.
export const SIGN_OFF_EXISTING = /(?:^|\n)[ \t*_]*(?:best regards|kind regards|warm regards|with regards|regards|thanks\s*(?:&|and)\s*(?:best\s+)?regards|many thanks|thank you|thanks|rgds|br|cheers|sincerely|grazie e saluti)[\s,.!…*?_-]*(?:\n|$)[\s\S]*$/i;
export const SIGN_OFF_EXTRA = /(?:^|\n)[ \t*_]*(?:thanking\s+you|with\s+(?:best\s+)?regards|thanks\s+with\s+regards|thanks\s*&\s*b\.?\s*regards|rgds|grazie\s+e\s+saluti|cordiali\s+saluti|bien\s+cordialement|cordialement|sincères\s+salutations|pozdrawiam|mit\s+freundlichen\s+gr(?:ü|ue)(?:ß|ss)en|med\s+v(?:ä|a)nlig\s+h(?:ä|a)lsning|saludos|i\.a\.|at\s+yr\s+disposal|look(?:ing)?\s+forward\s+(?:for|to)\s+your\s+(?:valuable\s+)?(?:booking|support|positive))[\s,.!…*?_:-]*(?:\n|$)[\s\S]*$/i;

/* Noise, kinds, attention */
export const NOISE_SUBJECT = /^(?:automatic\s+reply|auto(?:matic)?[- ]?reply|autoreply|risposta\s+automatica|réponse\s+automatique|autosvar|abwesenheitsnotiz|out\s+of\s+(?:the\s+)?office|undeliverable|delivery\s+(?:status|failure)|read:|自动回复)/i;
export const NOISE_TEXT = /\b(?:out\s+of\s+(?:the\s+)?office|fuori ufficio|annual\s+leave|away\s+from\s+(?:the\s+)?office|limited\s+access\s+to\s+(?:my\s+)?e-?mails?|in a training|response will be delayed|this is an automated)\b/i;
export const NOISE_SENDER = /^(?:mailer-daemon|postmaster|no-?reply|do-?not-?reply)[\w.+-]*@/i;
// A colleague added to the thread: "++@Reena", "Adding Air Team", "Looping in our ops". Not "Adding to the below…".
export const LOOP_IN = /(?:^|\n|[.!]\s+)\s*(?:dear[^,\n]{0,30},?\s*)?(?:\+\+|(?:adding|looping|copying|cc(?:ing|'ing)?|including)\b(?!\s+(?:to|that|below|above|more|further|some|all|these|this|it|here|on|the\s+(?:below|above|same|charges?|rates?|details?|costs?))\b))/i;
// Case-sensitive on purpose: a capitalised word is the name of the person thanked. Test it on text whose ACK_WORDS are lower-cased.
export const ACK = /^\s*(?:well |duly )?(?:noted|received|thank(?:s| you)|ok(?:ay)?|sure|many thanks)\b(?:[,.! ]*(?:your (?:mail|message|e-?mail)|the same|below|with (?:many )?thanks|thanks|thank you|and|well noted|noted|received|for (?:the|your) (?:prompt )?(?:update|mail|e-?mail|message|confirmation|information|info|support|reply|response)|we (?:will|shall) (?:keep you posted|update|revert|check)|will (?:update|updated|revert|check|keep you posted|do)(?: you)?(?: accordingly| shortly| soon)?|[A-Z][a-z]+))*[.! ]*$/;
export const ACK_WORDS = /\b(?:well|duly|noted|received|thanks?|you|your|many|ok|okay|sure|mail|message|e-?mail|the|same|below|with|and|for|prompt|update|updated|confirmation|information|info|support|reply|response|we|will|shall|keep|posted|revert|check|do|accordingly|shortly|soon)\b/gi;
export const FYI = /^\s*(?:fyi|fyr|for your (?:reference|information))\b[.! ]*$/i;
// "Please note / find / see / refer / proceed / wait" inform or instruct; they ask for something only when the sentence goes on "… and advise".
// "Awaiting SO from carrier" is news about someone else, not a request to the reader.
export const REQUEST = /\?(?=\s|$)|\b(?:please|pls|plz|kindly)\b(?!\s+(?:(?:kindly|also|do)\s+)?(?:note|find|fine|be\s+(?:informed|advised|noted)|see|refer|proceed|go\s?-?ahead|wait(?:ing)?|feel\s+free)\b)|\b(?:please|pls|plz|kindly)\s+(?:(?:kindly|also|do)\s+)?(?:note|find|see|refer|proceed|go\s?-?ahead)\b[^.?!\n]{0,120}(?:\b(?:and|then)\s+(?:advise|confirm|revert|share|send|provide|arrange|approve|update|check|let us know)|[&,/]\s*(?:advise|confirm|revert|share|send|provide|arrange|approve|check))\b|\b(?:kind reminder|gentle reminder|awaiting(?![^.?!\n]{0,60}\bfrom\s+(?:the\s+|our\s+)?(?:carrier|shipper|agent|liner?|shipping\s+line|origin|supplier|vendor|customer|consignee|airline|customs)\b)|appreciate|request you|could you|can you|would you|let us know|look(?:ing)? forward to (?:your|receiving))\b|(?<!\bthank(?:s| you)(?: a lot| very much)? )\bfor (?:your )?(?:kind )?(?:approval|confirmation|review|comments?)\b/im;
export const PROMISE = /\b(?:we|i|our team|agent) (?:will|shall|would|are going to|is going to) (?:update|revert|share|check|keep you (?:posted|updated|informed)|get back|confirm|send|advise|quote)\b|\bwill (?:update|revert|share|check|get back|advise|confirm|send)\b(?:\s+(?:you|to you|back|accordingly|once)\b|(?:\s+[\w']+){0,3}?\s+(?:by|within|tomorrow|today|soon|shortly|asap|later)\b)|\b(?:will|shall) keep you (?:posted|updated|informed)\b|\bworking on it\b|\bonce (?:received|available|we get|confirmed)\b/i;
export const CHASE = /\b(?:kind|gentle|friendly|2nd|second)?\s*reminder\b|(?<!\bif\s+)\b(?:any|please|pls|kindly)\s+update\b|\bupdate (?:on|regarding)\b|\bawaiting (?:your|the)?\s*(?:reply|response|revert|feedback|confirmation|update|quote|quotation|rates?)\b|\bstill (?:waiting|awaiting|pending)\b|\bwhat.?s the (?:\w+ ){0,2}(?:status|update)\b|\bstatus of\b|\b(?:please|pls|plz|kindly)\s+revert\b|\bfollow(?:ing)?[ -]?up\b(?!\s+with\b)|(?<!\bif\s+)\bany (?:news|feedback|update|indication)\b|\bis this (?:matter|enquiry|inquiry) still (?:active|open)\b|\bhad a chance to review\b|^\s*REMINDER\s*$/im;
// Not "for any urgent matters please call" (where to reach someone), not "we will revert asap" (their promise), not a footer's "delete it immediately".
export const ESCALATION = /(?<!\b(?:for|any|if|in case of)\s+)\burgent(?:ly)?\b|(?<!\b(?:will|shall|if you (?:have|need|require)|in error)\b[^.?!\n]{0,60})\b(?:asap|at the earliest|immediately)\b|\btoday itself\b|\bwithout (?:any )?(?:further )?delay\b|\btime is critical\b|\bshouldn.?t be delayed\b|\bnot responding\b|\bno response\b|\bnot acceptable\b|\b(?:cannot|can'?t) accept\b|\bunacceptable\b|\btoo (?:late|high)\b|\blose this business\b|\bdisappoint\w*|\bcomplain\w*|\bescalat\w*|^\s*\**\s*(?:very )?urgent\b/im;
export const DEADLINE_CLOCK = /\b(?:by|before|latest by|until)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm|hrs|h|noon))\b/i;
export const DEADLINE_DAY = /\b(?:by|before|within)\s+(today|tomorrow|eod|cob|noon|end of (?:the |this )?(?:day|week)|this (?:evening|afternoon)|(?:mon|tues|wednes|thurs|fri|satur|sun)day)\b/i;
export const DEADLINE_SPAN = /\bwithin\s+(\d+)\s*(?:hours?|hrs|days?|working days?)\b/i;
export const DEADLINE_TODAY = /\b(?:finali[sz]ing|closing) (?:this|the) (?:shipment|order|booking) today\b/i;
export const HOLD = /\b(?:please|pls|kindly)\s+hold\b|\bon\s+hold\b|\bhold\s+(?:the|this)\s+(?:shipment|booking)\b|\bunder\s+(?:internal\s+)?review\b|\bnot\s+(?:yet\s+)?finali[sz]ed\b|\bpostponed?\b|\bdeferred\b|\bcargo (?:is )?not (?:yet )?ready\b|\b(?:other|another)\s+forwarder\b|\bplanning\s+via\b|\bfor quotation only\b|\bsubject to approval\b/i;
export const SOFT_LOST = /\b(?:other|another)\s+forwarder\b|\bplanning\s+via\b|\bfor quotation only\b/i;
export const CANCELLED = /\bcancel(?:l?ed|lation)?\b|\bamend (?:this|the) booking\b|\bnext vessel\b/i; // confirmed jobs only; skip sentences with "hold the cheque" / "tracking seems"
export const BOUNCE_FROM = /mailer-daemon|postmaster/i;
export const BOUNCE_SUBJECT = /delivery status notification|undeliverable|undelivered mail|mail delivery fail|message blocked|returned mail/i; // not "undelivered cargo"
export const BOUNCE_BODY = /message blocked|wasn'?t delivered|address not found|5\.7\.1|5\.1\.1/i;
export const BOUNCE_ADDRESS = /(?:Final-Recipient:\s*rfc822;\s*|Your message to\s*<?|wasn'?t delivered to\s*<?)([\w.+-]+@[\w.-]+)/i;
export const DELEGATE = /(?:my colleague|please contact|pls contact|kindly contact|reach out to|contact sales support)\s*:?\s*([^\n@]{0,60}?)\s*[–\-:]?\s*([\w.+-]+@[\w.-]+)/i;
export const HOLIDAY = /\b(?:office|team) (?:will remain|will be|is|are|remains) closed?\b|\bpublic holiday\b|\b(?:diwali|deepavali|eid|chinese new year|national day)\b|\bdue to weekend at origin\b/i;

/* Money */
export const TOKEN_A = /(?<![\w-])(OMR|RO|USD|US\$|EUR|EURO?S?|INR|AED|GBP|CNY|RMB|SEK|ZAR|SAR|QAR|Rs\.?)\.?\s{0,2}:?\s{0,2}(\d{1,3}(?:[ ,.]\d{3})+(?:[.,]\d{1,3})?|\d+(?:[.,]\d{1,3})?)(?:\s?\/-)?(?![\d])/gi;
export const TOKEN_B = /(?<![\w])([€$£₹])\s?(\d{1,3}(?:[ ,.]\d{3})+(?:[.,]\d{1,3})?|\d+(?:[.,]\d{1,3})?)/g;
export const TOKEN_C = /(?<![\w.,])(\d{1,3}(?:[ ,.]\d{3})+(?:[.,]\d{1,3})?|\d+(?:[.,]\d{1,3})?)\s?(OMR|RO|USD|Usd|usd|EUR|INR|AED|SEK|€|\$)(?![\w])/g;
export const BARE_LINE = /^\s*([A-Z][A-Za-z /&()-]{2,40}?)\s*:\s*(\d{1,5}(?:\.\d{1,3})?)\s*$/m;
export const UNIT_SUFFIX = /^\s*(?:\/-)?\s*(?:(?:\/|per|x|×)\s*(?:(?:\d{1,2}\s?[x×]\s?)?(?:20|40|45)\s?['’]?\s?(?:GP|HC|HQ|OT|OTHC|RF|FR|DV|DC|ST|FT)?(?:\s?\(?HC\)?)?|cntr\.?|cnt|container|cntnr|ctr|box|teu|feu|kgs?|k|kilo|cw|cbm|m3|w\/m|rt|tons?|mt|pallet|plt|pkg|package|set|doc|b\/?l|awb|hawb|shpt|shipment|trailer|truck|trip|collection|day|hour|hr|month)\b|all\s?-?\s?in(?:clusive)?|lump\s?sum|lumpsum|flat)/i;
export const LINE_LABEL = /(?:ocean|sea|air)\s?freight|\bo\/f\b|\ba\/f\b|lcl\s?\+\s?do|\bdo\s?(?:fee|charges?)\b|delivery order|\bcfs\b|\b[od]?thc\b|customs?\s?(?:clearance|declaration|duty)|\bclearan[a-z]*\b|trucking|transport(?:ation)?|haulage|inland|\bvgm\b|bank\s?commission|\bb\/?l\s?fee|\bams\b|\bawb\b|\b[hm]awb\b|handling|pick\s?-?up|ex-?works?|\bexw\b|\bex-w\b|\blocals?\b|local charges|port charges|pol charges|pod charges|destinat\w+|palleti[sz]ation|pallet|aviation|\bduty\b|\bvat\b|bill of entry|\bboe\b|inspection|insurance|\bgri\b|\bwrs\b|war risk|\bpss\b|\bbaf\b|\bbas\b|\bebs\b|\bcaf\b|surcharge|\bcod\b|change of destination|\bced\b|admin(?:istration)?\s?fee|amendment|detention|demurrage|storage|free\s?time|door\s?to\s?(?:door|port|\w+ port)|port\s?to\s?(?:door|port)|airport\s?to\s?airport|shipping line charges/i;
// Each run of spaces has one place to go: the indent stays on its own line (whitespace but no line break), and the
// spaces after the scope go to the first of OMR, ":" or OMR/RO that follows them. money.ts builds PRICE_LINES from this source.
export const OUR_PRICE_LINE = /^[^\S\r\n\u2028\u2029]*(?:AIR\s+|LCL\s+|SEA\s+|COURIER\s+)?(?:FOB\s+|EXW\s+)?(DOOR TO DOOR|DOOR TO PORT|DOOR TO \w+ PORT|PORT TO PORT|PORT TO DOOR|AIRPORT TO AIRPORT)(?:\s+CHARGES)?\s*(?:OMR\s*)?(?::\s*)?(?:(?:OMR|RO)\s*)?([\d.,]+)(?:\s*\/\s*(\d{2}\s*[A-Z]{0,3}|KG|CBM|CNTR))?/im;
export const MAIN_LINE = /(?:ocean|air|sea)\s?freight|o\/f|a\/f|door to|port to|airport to|all in|ex-?works? \+ ocean/i;
export const OPTION_SPLIT = /\b(?:O\/F|OCEAN FREIGHT|AIR FREIGHT|Option\s*\d)\b/i;
export const SOFT = /\bat\s?act[au]als?\b|\bas per actuals?\b|\bactuals?\b|\bif (?:applicable|required|requested|any)\b|\bapprox\.?\b|\bappx\.?\b|\baround\b|\babout\b|\bestimat\w+|\btentative\b|\bsubject to\b/i;
export const EXCLUDED = /\b(?:liabilit\w*|limitation|damage claims?|million|\bmio\b|cents? per pound|\bSDR\b|\bSZR\b|ADSp|Schadenfall|fines? of|misdeclaration|exchange rate|iata rate|\brate of 1\b|standard trading conditions|insurance coverage)\b|\b1(?:\.0+)?\s?(?:USD|US\$|EUR|OMR|GBP|AED)\s?=/i;
export const WEIGHT_BREAK = /\+\s?\d{2,4}\s?\/?\s?kgs?\b|\b\d{2,4}\s?kg\s?\+|\bM\s?\/\s?N\b|\b1:\d{3}\b/i;
export const VALIDITY = /\b(?:validity|valid(?:ity)?\s*(?:till|until|upto|up to|for|thru|through|to|is|on)?|expiry(?:\s*date)?|expires?|expiration|rates?\s+(?:are\s+)?valid(?:\s+(?:till|until|for))?)\s*[:\-–/]?\s*(?:(?:date|till|until|upto|up\s?to|for)\s*:?\s*)?((?:\d{1,2}(?:st|nd|rd|th)?[\s./-]*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?[\s./,-]*\d{0,4})|(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*-?\s*\d{1,2}(?:st|nd|rd|th)?(?:[\s,-]*\d{4})?)|(?:\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?)|(?:\d{4}-\d{2}-\d{2})|(?:\d+\s*(?:calendar\s*)?(?:days?|weeks?|wks?|hours?|hrs?))|(?:end of (?:the )?(?:month|week)|till sailing|said sailings?))/i;
export const VALIDITY_NEG = /\bno validity\b|validity can(?:'t| ?not) be provided|\bsubject to change\b/i;
export const TRANSIT = /\b(?:transit\s*time|transit|t\/t|tt)\s*[:\-–]?\s*(?:is\s*)?(?:approx\.?|appx\.?|abt\.?|about|around|est(?:imated|\.)?)?\s*(\d{1,3}(?:\s*(?:-|–|to|\/)\s*\d{1,3})?)\s*(days?|wks?|weeks?|hrs?|hours?)|\bin\s+abt\.?\s*(\d+)\s*days\b|\b(?:TT|TRANSIT)\s*:?\s*(direct(?:\s+flight)?)/i;
export const FREE_TIME = /\b(\d{1,2})\s*days?\s*(?:free|det(?:ention)?|dem(?:urrage)?|combined)(?:\s*(?:time|days?))?(?:\s*(?:at|@)\s*(?:pod|destination|cfs))?|\bfree\s?(?:time|days?)(?:\s*(?:at|@)\s*pod)?\s*[:\-]?\s*(\d{1,2})\s*days?(?:\s*det)?|\bfree\s+of\s+containers?\s+for\s+(\d+)\s*days|\bwe\s+need\s+(\d+)\s+days\s+free\b|\b(\d{1,2})\s*free\s*days\b/i;
export const CARRIER = /\b(MSC|MAERSK|MEARSK|MSK|HAPAG(?:[\s-]LLOYD)?|HAPAG LOYD|HPL|KMTC|CMA(?:[\s-]CGM)?|COSCO|OOCL|EVERGREEN|EMC|EGLV|YANG\s?MING|YML|PIL|WAN\s?HAI|ZIM|HMM|SITC|INTERASIA|ESL|ASYAD|KAWA|SAFEEN|UASC|UNIFEEDER|SEALAND|TURKON|ARKAS|X-PRESS|EMIRATES(?:\s?(?:SHIPPING|LINE|AIRLINES?|SKY\s?CARGO))?|TURKISH(?:\s?AIRLINES?)?|OMAN\s?AIR(?:LINES?)?|AIR\s?INDIA|QATAR\s?AIRWAYS|ETIHAD|INDIGO|SALAM\s?AIR|SAUDIA|LUFTHANSA|CARGOLUX|DHL|FEDEX|UPS|ARAMEX|TNT)\b/i;
export const CARRIER_CODE = /(?<=\b(?:CARRIER|AIRLINE|LINE|A\/L|VIA|WITH|ON|BY|FM)\s{0,2}:?\s{0,2})(ONE|HL|EK|QR|WY|TK|G9|Y9|AI|EY)\b/; // case-sensitive
export const CARRIER_OPTION_LINE = /^\s*[*•-]?\s*(MAERSK|MSC|CMA ?CGM|COSCO|OOCL|ONE|HAPAG|HPL|EVERGREEN|KMTC|ESL|ASYAD|NVOCC|EMIRATES|EK|QR|QATAR|WY|OMAN AIR|TK|G9|Y9)\b\s*(?:(?:O\/F|A\/F|OCEAN FREIGHT|AIR FREIGHT)\s*)?[:：-]/im;
export const EQUIPMENT_A = /\b(\d{1,2})\s?[x×*]\s?(20|40|45)\s?['’]?\s?(GP|HC|HQ|OT|OTHC|RF|FR|DV|DC|ST|STD|REEFER|OPEN\s?TOP|FLAT\s?RACK|HIGH\s?CUBE|FT)?(?:\s?\(?HC\)?)?/gi;
export const EQUIPMENT_B = /\b(20|40|45)\s?['’]?\s?(GP|HC|HQ|OT|OTHC|RF|FR|DV|DC|FT|OT\s?HC|HR)\b/g; // "40HR" is a typo of 40HC
export const BASIS = /\b(?:quoted rate based on|based on)\s+(?:final\s+cargo\s+)?(?:volume|chargeable\s?weight|cw|gross\s?weight)?(?:\s+of)?\s*:?\s*([\d.,]+)\s*(cbm|m3|kgs?)\b(?:\s*[|/]\s*(?:chargeable\s?weight\s*)?([\d.,]+)\s*kgs?)?(?:\s*[|/]\s*(\d+)\s*(?:packages?|pkgs?|pallets?|boxes))?/i;
export const CW = /\b(?:cw|c\.w\.|chargeable\s?weight|gr\.?\s?wt\.?|gross\s?weight|g\.?w\.?)\s*:?\s*([\d.,]+)\s*kgs?\b/i;

/* Roles */
export const OFFER_CUE = /\b(?:please|pls|plz|kindly)\s+(?:find|confirm)\b[^.]{0,40}\b(?:our|below|the)\b[^.]{0,30}\b(?:offer|quote|quotation|rates?)\b|\bour (?:best |final |revised |most competitive )?(?:offer|quote|quotation|rates?)\b|\bfinal rate will be\b|\brevised (?:rate|offer|quote|charges)\b/i;
export const FINAL = /\bfinal (?:offer|rate|price)\b/i;
export const REVISED = /\brevised\b/i;
export const TARGET = /\b(?:customer'?s? )?target(?:\s+(?:rate|price|budget))?\s*(?:is|:|-|–|of)?\s*(?:about|around|approx\.?)?\s*(?:OMR|USD|US\$|EUR|RO|\$|€)?\s*\d[\d,.]*/i;
export const PUSH = /\b(?:please|pls|kindly)\s+(?:support|match|re-?check|revert)\b|\bcan you do\b|\bbest you can\b/i;
export const TARGET_NEG = /don['’]?t have a target|no target/i;
export const AGREED = /\b(?:agreed|confirmed|final)\s+(?:rate|price|buy|buying)\b|\bconfirmed based on\b|\bbased on the (?:below )?agreed\b|\bplease proceed\b/i;
export const AGENT_RATE_EXCLUDE = /\b(?:invoice|debit note|DN amount|customs? duty|customs declaration|liabilit\w+|liable|limited to the sum|payment|outstanding|credit (?:period|limit)|cheque|PDC|change of destination|COD charges|detention charges|storage charges|penalty|exchange rate|=\s*\d)\b/i;
export const POST_BOOKING = /\b(?:additional|extra|amendment|non[\s-]?stackable|storage|detention|demurrage|COD|change of destination|CED|re-?validation|surcharge|fine|penalty|administration fee|invoicing fee|admin cost)\b[\s\S]{0,80}\b(?:charges?|fees?|costs?|surcharges?)\b|\bwill be (?:additional|billed|charged|applicable)\b|\bproceed to bill\b|\bhas applied\b/i;
export const PAPERWORK = /\b(?:invoice|debit\s?note|credit\s?note|\bDN\b|PDC|post[\s-]?dated|cheque|payment|remittance|TT copy|swift|bank details|receipt|outstanding|overdue|advance payment)\b/i;
export const RATE_REQUEST = /\b(?:please|pls|plz|kindly)\s+(?:advise|share|send|provide|quote)\b[^.?!\n]{0,60}\b(?:(?:ocean|air|sea)\s*freight\s*)?(?:quote|quotation|rates?|offer|price)\b|\blooking\s+forward\s+to\s+(?:know|receive|receiving)\s+your\s+(?:best\s+)?(?:offer|rates?|quote)|\bawaiting\s+(?:the\s+|your\s+)?quote|\bkindly\s+share\s+quotation|\bmatch\s+target|\bfinal\s+quote/i;
export const REQUEST_BLOCK = /^\s*(?:POL|POD|AOL|AOD|UNIT|QTY\.?|GR\.?\s*WT\.?|COMMODITY|DIMENSIONS|PICK\s*UP\s+ADDRESS|COLLECTION\s+ADDRESS|TEMPERATURE)\s*:/im; // on our mails only
export const AGENT_ACK = /\b(?:we |i )?(?:will|shall)\s+(?:check(?: with [^.]{0,30})?\s*(?:and|&)\s*)?(?:share|update|revert|send|advise|provide)\b[^.]{0,40}\b(?:rates?|quote|quotation|offer|best)\b|\bworking on (?:it|this|the rates?|your (?:request|enquiry))\b|\bfollowing up (?:with )?(?:the )?(?:airline|carrier|line|shipper)[^.]{0,30}\brates?\b|\bwaiting\s+for\s+(?:the\s+)?(?:shipping\s+)?lines?\b/i;
export const AGENT_DECLINE = /\bno space\b|\bnot accepted\b|\btoo (?:big|large|heavy)\b|\b(?:can(?:no|')?t|cannot|unable to|not able to) (?:load|accept|quote|offer|serve|support|handle|move|carry)\b|\bwe (?:can )?only (?:load|quote|offer|serve|consol\w*) (?:from|via|ex)\b|\bno (?:direct )?(?:service|consol(?:idation)?|sailing|flight|option)\b(?! fee)|\bregret (?:to inform|that we)\b/i;
export const AGENT_QUESTION = /\b(?:please|pls|plz|kindly|could you|can you|may we have)\b[^.?!\n]{0,40}\b(?:advise|share|provide|confirm|send|give|let us know)\b[^.?!\n]{0,60}\b(?:dimensions?|dims?|weight|gr\.?\s*wt|cbm|volume|commodity|hs ?code|cargo ready|ready date|readiness|pick ?-?up address|collection address|zip ?code|postal code|incoterm|no\.? of (?:boxes|pallets|packages|pieces|pcs|cartons)|packing list|stackable|hazardous|dg\b|msds|second pick ?up)/i;

/* Yes and won */
/** Sentences in which a customer accepts: "Go ahead", "Please proceed with the booking", "It is approved", "Confirmed." */
export const YES = [
  /\bgo ?-?a?head\b/i,
  /\b(?:please|pls|plz|kindly|you (?:can|may)|ok(?:ay)? to|go and|let'?s|let us)\s+proceed\b/i,
  /\bproceed(?:ing)? with (?:the |this |your |our )?(?:shipment|booking|order|job|quote|quotation|offer|rates?)\b/i,
  /\bwe (?:hereby |do )?(?:confirm|accept|approve)\b/i,
  // A decision word on its own or leading into the go-ahead; not an adjective ("Agreed sailing date already over").
  /^(?:ok(?:ay)?[,.]?\s+)?(?:confirmed|approved|accepted|agreed)(?=\s*(?:[.!,;:-]|$)|\s+(?:and|&|with|to|from|for|as|please|pls|plz|kindly|thanks?|thank you|go ahead|proceed)\b)/i,
  /\b(?:it|this|that|rates?|quote|quotation|offer|price|order|shipment|booking) (?:is|are|has been|have been) (?:confirmed|approved|accepted|agreed)\b/i,
  /\b(?:please|pls|plz|kindly) (?:book|arrange the shipment)\b/i,
  /\baccept(?:ed)? (?:your|the) (?:offer|quote|quotation|rates?)\b/i,
];
/** A condition or a question turns a "yes" sentence into something else: "once confirmed", "can we go ahead?". */
export const NOT_YES = /\b(?:not|once|if|unless|whether|when|until|receipt|received)\b|n't\b|\?\s*$/i;
export const BETTER_RATE = /\b(?:discount|better (?:rate|price|offer)|more competitive|reduce|reduction|revise (?:the )?(?:rate|price|quote)|re-? ?check)\b/i;
export const YES_EXTRA = /\b(?:here ?by )?nominated\b|\bnominate (?:you|silver ?lynx)\b|\bwe have (?:hereby )?confirmed\b|\bconfirmed (?:&|and) proceed\b|\bconfirmed hereby\b|\bshare (?:the |your )?(?:forwarder|agent|counterpart) details\b|\bgo\s?-?a?head\b/i;
export const WON_OURS = /\b(?:this|the|the said)\s+shipment\s+is\s+confirmed\b|\bwe\s+(?:hereby\s+)?confirm\s+(?:this|the said)\s+shipment\b|\b(?:please|kindly)\s+proceed\s+(?:this|with\s+(?:the|this))\s+(?:shipment|booking)\b|\b(?:many\s+)?thanks?\s+(?:you\s+)?for\s+(?:the|your)\s+(?:below\s+)?(?:confirmation|nomination)\b|\b(?:SHIPPER|CONSIGNEE|AGENT)(?:'S)?\s+(?:CONTACT\s+)?DETAILS\s*:?|\bplease\s+find\s+(?:below\s+)?(?:our\s+)?agent(?:'s)?\s+details\b|\bagreed\s+rate\b[^\n]{0,40}(?:USD|EUR|OMR)\s*[\d.,]+/i;
export const APPROVAL = /^\s*(?:Approved|Approve|Confirmed|OK to proceed|Go ahead)\b[^\n]{0,40}$/im;
export const APPROVAL_ASK = /please approve|kindly approve|for your approval/i;

/* Milestones: text (t), filename (f). SO, CAN, DO, DN are case-sensitive where written so. */
export const MILESTONES = {
  booked:   { t: /\bbooking (note|details|confirmation|received|placed)\b|\barranged the booking\b|\breceived (?:the )?(?:shipper['’]?s? )?booking\b|\b(?:have|has|had|already|been) booked\b|\bthank you for the nomination\b/i, f: /booking|_bc\b|bc\.pdf|托书|ebkg/i },
  booking_hold: { t: /\bbooking (is )?on hold\b/i },
  so:       { t: /\bS\/O\b|\bSO\b(?=\s*(status|details|released|release|no|number|:|copy|from|to|pending))|\b(release|released|share|update|confirm) (the )?(SO|S\/O)\b|\bshipping order\b|\brelease order\b|\bRLS\b(?= issued)|\bawaiting SO\b|\bSO (is )?pending\b|\b[Ss]tatus (?:OF|Of|of) (?:the )?SO\b|\bno SO\b/, f: /\bso\b|s\/o|shipping order|release|托书/i },
  so_released: { t: /\b(?:SO|S\/O)\b[^.\n]{0,30}\b(?:[Rr]eleased|RELEASED|[Ii]ssued|ISSUED|[Aa]ttached|ATTACHED)\b|\b(?:[Ii]ssued|ISSUED) (?:the )?S\/?O\b|\b[Ff]ind [Aa]ttach(?:ed)? (?:the )?SO\b|\b(?:[Oo]btained|[Gg]ot|[Rr]eceived) (?:the |an? )?S\/?O\b/, s: /\bs\/?ol? ?released?/i }, // s: the stage tag an agent puts in front of the subject ("so release Re: …")
  so_number: { t: /\b(?:S\/O|SO)\s*(?:NO\.?|NUMBER|No\.?)?\s*[:：.#]\s*((?=[A-Z0-9]*\d)[A-Z]{2,6}[A-Z0-9]{4,16})/ },
  so_carrier_number: { t: /\b(ESL|ASD|EGLV|KMTC|MEDU|MAEU|HLCU|ONEY|COSU|OOLU)[A-Z]{0,6}\d{6,12}\b/ },
  space_etd: { t: /\b(space|rollover|roll ?over|rolled|blank sailing|no space)\b|\b(vessel|vsl|v\/v|voyage|voy)\b|\bETD\b|\b(sailing|cut ?off|cy close|gate (in|open|clos\w*)|closing)\b|\b(other|another|any other) (carrier|line)\b|\binventory\b|\bequipment\b/i },
  stuffed:  { t: /\b(stuffing|stuffed|cross stuffing)\b|\b(already )?(finished )?loaded\b|\bloading (finished|completed|done)\b/i },
  sailed:   { t: /\b(vessel |shipment )?(has )?(sailed|departed)( on| from)?\b|\bATD\b/i },
  cargo_not_ready: { t: /\bcargo (is )?not ready\b|\bnot (yet )?picked up\b/i },
  bl_draft: { t: /\b(bl|b\/l|hbl|mbl|awb|awbl)s? ?drafts?\b|\bdrafts? (bl|b\/l|hbl|mbl|awb)s?\b|\bbl instruction|shipping instruction|\bupdate SI\b/i, f: /draft|_bl_draft|\(hbl draft\)|\(mbl draft\)|liner bl draft/i },
  bl_data:  { t: /\b(hs ?code|12 digit|vat no|customs code|C00\d+|OM\d{8,})\b|\bcontainer (and|&) seal( number)?\b|\bseal (no|number)\b/i },
  bl_approved: { t: /\b(bl|b\/l|hbl|mbl|awb|drafts?)\b[^.]{0,40}\b(ok|okay|fine|checked|approved|confirmed|in order)\b|\bok to proceed\b|\bok from our side\b|^\s*(ok|approved|confirmed|noted and approved)\b/im },
  bl_approval_asked: { t: /\b(kindly|please|pls) check and (confirm|approve|revert)\b|\bconfirm (us )?your approval\b|\btake final approval from shipper\b/i }, // never counts as approved
  bl_final: { t: /\bfinal (bl|hbl|mbl|awb|awbl)\b/i, s: /\b[mh]bl release\b/i, f: /telex|tlx|surrender|swb|seaway|express|_obd|hbl obd|mbl obd|bl_original|^org-|ohbl|nnhbl|hbl|mbl|hawb|mawb|awb|billoflading|提单/i },
  telex:    { t: /\b(telex|tlx|surrender(ed)?|sea ?way ?bill|swb|express (bl|b\/l|release))\b/i },
  originals: { t: /\b(obl|ohbl|original (bl|b\/l|hbl|mbl)|org bl|originals?)\b|\bHBL (is )?(ORG|original)\b/i }, // strip "Original Message" headers first
  lc:       { t: /\bunder l\/c\b|\bletter of credit\b|\bdirect mbl\b/i },
  pre_alert: { t: /\bpre.?alert\b/i, s: /\b[Pp][Rr][Ee].?[Aa][Ll][Ee][Rr][Tt]\b|\bPA(?=\s*(?:\/\/|R[Ee]\s*:|:))/, f: /pre.?alert|^\d+\.pa\b|pa atd eta/i }, // first mail only
  eta:      { t: /\bETA\b|\b(arrival|arrived|arrive[sd]?|reached|discharged?|berthing)\b|\bshipment arrived (mct|muscat|sohar|salalah)\b/i },
  arrived:  { t: /\b(arrived|reached|discharged|berthed)\b|\bshipment arrived (mct|muscat|sohar|salalah)\b/i }, // not when the sentence is "cargo arrival notice"
  transshipment: { t: /\b(trans.?ship\w*|t\/s|feeder|hub|congestion)\b/i },
  can_do:   { t: /\bcargo arrival notice\b|\bCAN\b(?=\s*(and|attached|copy|upon|shortly|reminder|payment|,|\.))|\bdelivery order\b|\bD\/O\b|\bDO\b(?=\s*(attached|will share|validity|valdity|copy|issued|\)|,|\.))|\bmanifest (done|updated|processing)\b|\b(FC|freight certificate)\b|\bendorsed BL\b|\b3 letter code\b|\boman aviation system\b/, f: /^can\b|cancb|delivery_order|_do\.pdf|-do\.pdf|mdo|hdo|slmdo|manifest|^fc\.pdf|freight cert/i },
  customs_docs: { t: /documents? for (customs? )?clearance|for cc\b|final commercial documents/i },
  authorization_asked: { t: /arrange authorization/i },               // ours: not done
  authorization_done:  { t: /authori[sz]ation (?:has |have |is |was )?(?:already |now )?(?:been )?(?:successfully )?(?:done|completed|activated)|successfully completed/i },
  hs_brand: { t: /\bhs ?code\b|\bbrand\b|\bregister(ed)? (the shipment )?under\b/i },
  bayan:    { t: /\bbayan\b|\bdeclaration\b|\bBOE\b|\bbill of entry\b/i, f: /declarationprint|bayan|declaration|form_b|exm\d|customs|paymentonline/i },
  duty:     { t: /\b(duty|vat)\b[^.]{0,20}(exempt\w*|at actuals|postpone|deferr?al|paid)|\bduty exempt\b|\bpayment slip\b|\bpay(ment)? (directly )?to customs\b/i },
  delivery_requested: { t: /\b(arrange|kindly arrange|please arrange)( to)? deliver(y)?\b|\bdeliver(y|ed)? (to|at) (our )?([A-Z][\w ]{2,30}? ?(store|warehouse|factory|site|yard|plant))|\btransport(ation)? (to|charges|from)\b|\bby road\b|\btemperature control|without pallets\b/i },
  delivered: { t: /\b(has been |have been )?delivered\b|\bdelivery (completed|done)\b|\breceived the (cargo|goods|shipment|material)\b/i }, // shown as a sub-step only; the node stays "not written" in this build
  closing:  { t: /\bdebit note\b|\bDN\b|\bcredit note\b|\bshare your DN\b|\bto close (the )?job\b|\bSOA\b|\boutstanding\b|\bPDC\b|\bcheques?\b|\bremittance\b|\bpayment\b|\bpaid\b/, f: /debit|credit note|dbnote|\bdn\b|soa|payment|pdc|cheque|receipt|remittance|inv|fattura/i },
  cod:      { t: /\bchange of destination\b|\bCOD\b(?=[^.]{0,40}destination)|\b(BAS|BAF|CED)\b/ },
  detention: { t: /\b(detention|demurrage|storage( charges| invoice)?|port (and )?storage fees)\b|\bDO validity\b/i },
  // air
  awb:      { t: /\b(final )?(awb|awbl|hawb|mawb)\b|\bair ?way ?bill\b/i },
  flight:   { t: /\bflight\b|\bscheduled to depart\b|\bMCT\b/i },
  air_customs: { t: /\bweight matching\b|\bchargeable weight\b/i },
  // courier
  waybill:  { t: /\b(?:waybill|awb)\s*(number|no\.?|#)?\s*:?\s*(\d{10,12})\b|\b\d{3}-\d{8}\b/i },
  picked_up: { t: /\bpickup (window|confirmation)\b|\blabel\b/i },
  in_transit: { t: /\bin transit\b|\btracking\b/i },
  // steps that only one set of milestones has
  gate_in:  { t: /\bgated ?-?in\b|\bgate ?-?in (?:is |was |has been )?(?:done|completed|confirmed)\b/i },
  collected: { t: /\b(?:cargo|shipment|goods|material|consignment) (?:has been |have been |was |were |is |are |already )?(?:collected|picked ?-?up)\b|\b(?:collected|picked ?-?up) (?:the |your )?(?:cargo|shipment|goods|material|consignment)\b|\b(?:pick ?-?up|collection) (?:is |was |has been )?(?:done|completed)\b/i },
} as const;

/* Dates and numbers */
// (1) ETD, ETA or ATD, then what stands between it and the date on the same line (a port, "is updated as") · (2) the date: 2026-11-15, 12.11.2026, 12th Nov, 21-NOV, Oct.30, 16th, tomorrow
export const SHIP_DATE = /\b(ETD|ETA|ATD)\b[^0-9\n]{0,40}?(\d{4}[.\/-]\d{1,2}[.\/-]\d{1,2}|\d{1,2}(?:st|nd|rd|th)\b(?![ .\/-]{0,3}(?:\d|[A-Z]{3}))|\d{1,2}(?:st|nd|rd|th)?[ .\/-]{0,3}(?:\d{1,2}|[A-Z]{3,9})(?:[ .\/-]?\d{2,4})?|\b(?:today|tomorrow|tmrw)\b|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b[ .\/-]{0,2}\d{1,2}(?:st|nd|rd|th)?(?:,? ?\d{4})?)/i;
export const CUTOFF = /(?:gate clos\w*|cut.?off|cy clos\w*|si ?(?:&|and) ?vgm cut ?off)\b[^\d\n]{0,40}?(\d{1,2}(?:st|nd|rd|th)?\b[^\n]{0,28}?)(?=\s{2,}|\s+(?:and|ET[AD])\b|\s*[,;]|\.?\s*$)/im;
export const AGENT_JOB_PAREN = /[（(]\s*([A-Z]{2,6}\d{6,12}[A-Z]?)\s*[）)]/;
export const AGENT_JOB_PREFIX = /\b(HP(SH|SZ|XM|NB|QD|GZ|LY)(OM|SO)\d{7}[AB]?|GDWV\d{8}|KWS[A-Z]{3}\d{8}|WLCT[A-Z]{2}\d{9}|JASC\d{7}|ABSOH\d{8}|ENQ\d{10,}|MB\d{10,}[A-Z]{0,2}|YX\d{8})\b/;
export const VESSEL = /\b(?:(?:VSL|Vsl|vsl|V\/V|v\/v|M\/V|m\/v)[ \t]*[.:：]+|(?:VESSEL|Vessel|vessel)(?: (?:NAME|Name|name))?(?: ?\/ ?(?:VOYAGE|Voyage|VOY|Voy)\.?)?[ \t]*[:：])[ \t]*([A-Z0-9][A-Z0-9 ]{2,30}?)(?=\s*[\/(]|\s+V\.|\s+ETD|[,.]|\s*$)/m; // the name in capitals, as written
export const CONTAINER = /\b[A-Z]{3}[UJZ]\d{7}\b/;
export const PO = /\bPO(?![A-Za-z])\s*(?:NO\.?\s*)?[-:#]?\s*((?=[A-Z0-9\/-]*\d)[A-Z0-9][A-Z0-9\/-]{3,})\b/i; // a number with a digit in it: not "POLYESTER", not "PO BOX"
export const BL_NO = /\b(MBL|HBL|MB\/L|HB\/L|B\/L|BL)\s*(?:NO\.?)?(?:\s*[:：.#])+\s*((?=[A-Z0-9]*\d)[A-Z0-9]{6,20})\b/i;
export const BOOKING_NO = /\b(?:BKK?G?|BK|BOOKING)\s*(?:NO\.?|NUMBER|REF\.?)?(?:\s*[:：#])+\s*((?=[A-Z0-9]*\d)[A-Z0-9]{6,20})\b/i;
export const AWB_NO = /\b\d{3}-\d{8}\b/;
export const CUSTOMS_CODE = /\bC00\d{5,}\b/;

/* Cargo */
export const CARGO_WEIGHT = /\b(?:gr(?:oss)?\.?\s*w(?:eigh)?t\.?|net weight|cargo wt\.?|weight|chargeable weight|CW)\s*[:：]?\s*(\d[\d,]*(?:\.\d+)?)\.?\s*(kgs?|kilos?|tons?|mt)\b/i; // "2,892. kgs" keeps its weight
export const CARGO_DIMS = /(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(cm|mm|m|inch|in)\b(?:\s*[x×*]\s*(\d+)\s*(?:ctns?|cartons?|boxes|pallets?|pkgs?))?/i;
export const CARGO_VOLUME = /(\d[\d,]*(?:\.\d+)?)\s*(?:cbm|m3|m³)\b/i;
export const CARGO_PACKAGES = /(\d+)\s*(?:x\s*)?(?:pallets?|cartons?|ctns?|boxes|cases?|crates?|drums?|bundles?|rolls?|packages?|pkgs?|pcs|pieces|wooden boxes)\b/i;
export const CARGO_HS = /\bHS\s*-?\s*code\s*[:：]?\s*(\d{4,12}(?:[. ]\d{2,4}){0,3})/i;
export const CARGO_COMMODITY = /\b(?:commodity|material|cargo|goods|description|product)[ \t]*[:：][ \t]*([^\n]{3,80})/i; // on its own line: "cargo :" over "AOL : …" is no commodity
export const CARGO_ADDRESS = /\b(?:pick ?-?up|collection|shipper|factory|delivery) (?:address|location)\s*[:：]?\s*([^\n]{10,200})/i;
export const CARGO_READY = /\b(?:cargo|material|goods|shipment|items?) (?:is|are|will be|expected to be) ready(?: (?:on|by|for (?:pick ?up|collection|handover|dispatch)))?\s*[:：]?\s*([^\n.]{0,40})|\blaycan\b\s*[:：]?\s*([^\n]{5,40})/i;
export const CARGO_STACK_DG = /\b(non[- ]?stackable|stackable|non[- ]?dg|non[- ]?haz\w*|\bDG\b|hazardous|dangerous goods|IMO\s*\d|UN\s?\d{4}|MSDS)\b/i;
export const CARGO_INCOTERM = /\b(EXW|EX-?WORKS|FOB|FCA|CFR|CIF|DAP|DDP|CPT)\b/;

/* People */
export const CARRIER_DOMAIN = /(?:^|\.)(?:hlag|hapag-lloyd|cma-cgm|maersk|sealand(?:oman)?|msc|one-line|evergreen-line|cosco(?:shipping)?|oocl|hmm21|zim|yangming|pilship|kmtc|wanhai|sitc|unifeeder|emirates|omanair|qatarairways|etihad|dhl|fedex|ups|aramex)\.(?:com|net|co|cn|om|ae)$/;
export const PORT_DOMAINS = /(?:^|\.)(?:hutchisonportssohar|salalahport|soharport|dpworld|asyad|omanairports)\./;
export const FORWARDER_WORDS = /logist|cargo|shipping|freight|forward|consol|trans|ship|sped|fracht|express|lcl|nvocc/;
export const GREETING_NAME = /^\s*(?:Dear|Hi|Hello|Dera|Derar|Good (?:day|morning|afternoon))\s*,?\s*(?:Mr\.?|Ms\.?|Mrs\.?|Madam|Sir)?\s*@?'?([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\b/;
export const SIG_SIGNOFF = /^[ \t*_]*(?:(?:Best|Kind|Warm|With kind|Thanks (?:&|and) (?:Best |B\.)?)\s*)?(?:Regards|Rgds|B\.Regards|Thanks|Thank you|Thanking You|Cheers|Grazie e Saluti|Cordiali saluti|Med vänlig hälsning|祝好)\s*[!,.…]*\s*(?:\/\s*Thanks & Best Regards)?\s*$/im;
// A name of up to four words ("Anwar K. S.", "Rashid Ahmad.", "Mohammed Al Balushi"), then "(Mr)", a role after "|", "/"
// or "," and trailing stars. A dot belongs to a word ("K.", "Ahmad.") or to the gap between two words (". "), never to
// both, and each run of spaces has one place to go: a line with a long run of dots or spaces fails at once instead of
// trying every way to split the run.
const NAME_WORD = String.raw`[\p{L}'\-]+(?:\.+[\p{L}'\-]+)*`;
/** The rest of a name after its first word, with at most `gaps` more gaps (a run of spaces and dots) allowed. */
const nameRest = (gaps: number): string =>
  gaps === 0 ? String.raw`\.*` : String.raw`(?:\.* [ .]*(?:${NAME_WORD}${nameRest(gaps - 1)}|(?<=\.))|\.*)`;
export const SIG_NAME = new RegExp(
  String.raw`^[ \t*_\-]*([A-Z](?=[\p{L}.'\-])[\p{L}'\-]*(?:\.+[\p{L}'\-]+)*${nameRest(3)})\s*(?:\((?:Mr|Ms|Mrs)\)\s*)?(?:[|/,]\s*(.{2,60})[ \t*_]*|[*_][ \t*_]*)?$`,
  "imu",
);
export const SIG_DESIGNATION = /^(?!.*[@<>\[\]])(?!.*https?:)(?!.*\b(?:LLC|L\.L\.C|Ltd|LTD|Pvt|S\.p\.A|S\.r\.l|GmbH|SPC|SAOG|Inc|B\.V)\b)[^\n]{3,70}\b(?:Manager|Executive|Officer|Supervisor|Coordinator|Head|Director|Engineer|Specialist|Controller|Clerk|Assistant|Asst\.?|Sr\.?|Senior|Deputy|Leader|In-?charge|Procurement|Purchase|Logistics|Operations?|Pricing|Sales|BD|CEO|GM|Owner|Partner|Dept\.?|Department|Division)\b/im;
export const SIG_COMPANY = /^(?=.*\b(?:LLC|L\.L\.C\.?|Co\.?,? ?Ltd\.?|LTD|Limited|Pvt\.? Ltd|S\.p\.A\.?|S\.r\.l\.?|GmbH|SPC|SAOG|SAOC|Est\.?|Inc\.?|B\.V\.?|Sp\.? z o\.o|Corp\.?|\(Pty\) Ltd|Joint Partnership)\b)[^\n@]{4,90}$/im;
export const DISPLAY_SPLIT = /^\s*(.+?)\s*(?:\s[-–|]\s|,\s|\s*\[|\s*\()\s*(.+?)\s*[\])]?\s*$/;
export const ROLE_LOCAL = /^(purchase\d*|procurement\d*|logistics?|sales\d*|accounts?|quality|stores|docs?\d*|ops?\d*|cs\d*|info|marketing\d*|export|import|pricing|reception|admin|mkt\d*|overseas\d*|ov\d+-\w+|op\d+)$/;
export const PHONE_LABELLED = /(?:^|[\s|,;(\-])(Mob(?:ile)?|MOB(?:ILE)?|Cell|CELL|Tel(?:ephone)?|TEL(?:EPHONE)?|Phone|PHONE|Ph|PH|HP|Handphone|GSM|Direct(?: line)?|DIRECT(?: LINE)?|Office(?: Phone)?|OFFICE|Fax|FAX|M|T|C|O)\s*(?:No\.?|NO\.?|Number)?\s*[.:：]\s*\n?\s*(\+?\s?\(?\d[\d\s\-./()]{6,22}\d)/; // "TEL :", "MOB：", "-TEL : + 86 575 …" as Chinese signatures write them
export const PHONE_INTL = /(?<![\w+])(\+|00)\d{1,3}[\s\-]?\(?\d[\d\s\-.()]{6,16}\d(?!\w)/;
export const WHATSAPP_A = /\b(?:WhatsApp|Whats ?app|What app|WA)(?:\s*(?:No\.?|Number))?\s*[:：]?\s*(\+?\d[\d\s\-./()]{7,22})/i;
export const WHATSAPP_B = /(\+?\d[\d\s\-./()]{7,22})\s*\(\s*(?:we ?cha[rt]t?\s*(?:&|and|\/)\s*)?what ?s?app\s*\)/i;
export const WHATSAPP_MULTI = /(?:WECHAT|SKYPE|WHATSAPP|MOB|Mobile)(?:\s*\/\s*(?:WECHAT|SKYPE|WHATSAPP|Wechat ID|MOB))+\s*[:：]\s*(\+?[\d\s\-]{8,20})/i;
export const WECHAT = /(?:We ?[Cc]hat|WECHAT|微信)(?:\s*ID)?\s*[:：]\s*([A-Za-z0-9_\-+][A-Za-z0-9_\-+ ]{4,40})/;
export const SHIPPER_BLOCK = /\b(VENDOR|SHIPPER|SUPPLIER|CONSIGNEE|NOTIFY)(?:['’]S)?\s*(NAME|DETAILS|ADDRESS|CONTACT)\b\s*:?|\bCONTACT PERSON\s*:?\s*([^\n]{2,60})|\b(?:PICK ?-?UP|COLLECTION) ADDRESS\b\s*:?|ready for collection at (?:the following address)?|shipper(?:['’]s)? contact details|(?:please|pls) find below (?:the )?contact details/i;
export const AGENT_BLOCK = /\bAGENT(?:['’]S)?\s*(?:DETAILS|CONTACT|ADDRESS)\s*:?|revised agent (?:address|details)/i;
export const LOOP_IN_NAME = /^\s*(?:\+\+|Adding|Looping(?: in)?|Copying|Including)\s*@?'?([^\n<,]{2,60})/im;

/* Documents */
export const SIGNATURE_IMAGE = /^(?:image\d{2,3}(?:\([\d-]+\))?\.(?:png|jpg|jpeg|gif)|[0-9A-F]{8}@[0-9A-F]{8}\.[0-9A-F]{16}(?:\.png)?|Outlook-[\w-]+\.(?:png|jpg)|InsertPic_[\w]+\.(?:png|jpg)|Catch[0-9A-F]*\.jpg|oledata\.mso|~WRD\d+\.jpg|icon\.png|APO\d*(?:-\d)?\.png|In\.jpg|yt1\.jpg|attachment\.(?:html|plain|global-headers)|cid[\w-]*)$/i;
export const DOC_KINDS: [DocKind, RegExp][] = [ // first match wins
  ["invoice_payment", /(?:invoice|\binv\b|\binv[ _]|debit|credit note|\bdn\b|^dn\d|dbnote|rec(?:ei|ie)pt|payment|voucher|cheque|\bpdc\b|fattura|\bsoa\b|statement|storage|bank details)/i],
  ["packing",         /(?:packing|\bpkl\b|\bpl\b|p ?list|plist|\bci\b|ci&pl|cipl|commercial)/i],
  ["customs_do",      /(?:msds|\bcoo\b|certificate|\bcert|\bcoa\b|hs ?code|customs|bayan|declarationprint|declaration|delivery[ _]?order|\bdo\b|[ _-]do\.|mdo|hdo|slmdo|gatepass|\bexit\b|cepa|\bfta\b|form[ _]b|exm\d|health|apostil|decree|\bvat\b)/i],
  ["pre_alert_can",   /(?:pre.?alert|arrival|\bcan\b|^can[ (]|cancb|notice|manifest|\bpa\b|\batd\b|\beta\b|^fc\.|freight cert)/i],
  ["booking_so",      /(?:\bso\b|s\/o|shipping order|booking|\bbkg\b|\bbc\b|托书|shipping instruction|\bsi[ _-]|vgm|release|ebkg)/i],
  ["bl_awb",          /(?:\bbl\b|_bl_|[ _-]bl[ _.(-]|^bl|hbl|mbl|bill ?of ?lading|b\/l|draft|telex|\btlx|seaway|\bswb\b|\b[hm]?awb|surrender|express bl|obd|\bobl\b|提单|正本|polizza|bl instruction)/i],
  ["quote",           /(?:quot|offer|\brate|tariff|proposal|pricing)/i],
];
// A carrier's "_POD.PDF" is "other" (port of discharge), never proof of delivery: test /_pod\.pdf$/i before DOC_KINDS.
