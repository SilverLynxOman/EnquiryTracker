import type { Currency, StaffMember } from "./types";

// Who is who at Silver Lynx, which domain is which agent, and the exchange rates the page converts with.

export const STAFF: Record<string, StaffMember> = {
  operation3: { mailbox: "operation3", name: "Abdul Waheed", role: "Operations", handles: true },
  operation:  { mailbox: "operation",  name: "Ashwin Luiz",  role: "Operations", handles: true },
  operation2: { mailbox: "operation2", name: "Anwar K. S.",  role: "Operations", handles: true },
  operation1: { mailbox: "operation1", name: "Aamir Shahzad", role: "Operations", handles: true },
  pricing:    { mailbox: "pricing",    name: "Maria Britto", role: "Pricing", handles: true },
  info:       { mailbox: "info",       name: "Maria Britto", role: "Pricing", handles: true },
  pricing1:   { mailbox: "pricing1",   name: "Fahad Asad",   role: "Pricing", handles: true },
  "asst.bdm": { mailbox: "asst.bdm",   name: "Vivek Bhaskaran", role: "Sales", salesName: "VIVEK", handles: true },
  sales3:     { mailbox: "sales3",     name: "Sahan",        role: "Sales", salesName: "SAHAN", handles: true },
  sales5:     { mailbox: "sales5",     name: "Ashwin Luiz",  role: "Operations", handles: true },
  sales7:     { mailbox: "sales7",     name: "Jittu Jacob",  role: "Sales", salesName: "JITTU", handles: true },
  sales8:     { mailbox: "sales8",     name: "Ayan Ahmed",   role: "Sales", handles: true },
  sales9:     { mailbox: "sales9",     name: "Shiyad Ahamed", role: "Sales", salesName: "SHIYAD", handles: true },
  sales6:     { mailbox: "sales6",     name: "Sowbhagya Anilkumar Sachu", role: "Sales", salesName: "SOWBHAGYA", handles: true },
  sales1:     { mailbox: "sales1",     name: "Mahmud",       role: "Sales", handles: true },
  marketing:  { mailbox: "marketing",  name: "Fida Ali",     role: "Sales", salesName: "FIDA", handles: true },
  ali:        { mailbox: "ali",        name: "M K Ali",      role: "Management", handles: false },
  "m.bd":     { mailbox: "m.bd",       name: "Prasad",       role: "Management", handles: false },
  hashif:     { mailbox: "hashif",     name: "Hashif TM",    role: "Management", handles: false },
  cs:         { mailbox: "cs",         name: "Haider Ali",   role: "Customer service", handles: false },
  cs1:        { mailbox: "cs1",        name: "Customer service", role: "Customer service", handles: false },
  akp:        { mailbox: "akp",        name: "Customs clearance", role: "Customs clearance", handles: false },
  accounts:   { mailbox: "accounts",   name: "Rameez Ahmed", role: "Accounts", handles: false },
  accountsreceivable: { mailbox: "accountsreceivable", name: "Kripa", role: "Accounts", handles: false },
  finance:    { mailbox: "finance",    name: "Bilal",        role: "Accounts", handles: false },
  "silverlynxco@gmail.com": { mailbox: "silverlynxco@gmail.com", name: "Ali Hassan", role: "Management", handles: false },
};

export const AGENT_DOMAINS: Record<string, string> = {
  "consolclub.com": "CONSOLE CLUB", "flgshipping.net": "FRONTLINE", "cssmuscat.com": "CSS", "wincologistics.com": "WINCO",
  "sancologistics.com": "SANCO", "jasclog.com": "JA SUPPLY", "jaintrans.com": "JA SUPPLY", "yxcargo.com": "YUXING",
  "rcsworldwide.com": "RCS", "fastlogisticscargo.com": "FAST FORWARD", "maloneshipping.com": "MALONE", "alpagulogistics.com": "ALPAGU",
  "avfsindia.com": "A.V. FREIGHT", "avaglobal.in": "AVA GLOBAL", "salservices.in": "SAL AIR & SEA", "wwl.cn": "WWL",
  "intnordic.com": "INTER NORDIC", "vdmcargosolutions.com": "VDM CARGO", "marsa-ship.com": "MARSA", "cdcitalia.it": "CDC ITALIA",
  "lanciashipping.com": "LANCIA", "easterngatewayshipping.com": "LANCIA", "yqn.com": "YQN", "mantoria.com": "MANTORIA",
  "dinamikacargo.com": "PT. DINAMIKA", "jwlk.co.kr": "J WORLD", "mleurope.com": "MLE",
};
// A seed name is used only when agentNames (when given) contains it after nameKey(); otherwise the side shows the domain.

export const USD_PER: Record<Currency, number> = {
  USD: 1, OMR: 2.6, AED: 0.2723, SAR: 0.2667, QAR: 0.2747,           // pegged
  EUR: 1.08, GBP: 1.27, INR: 0.012, CNY: 0.14, SEK: 0.095, ZAR: 0.055, // approximate: every figure using them is labelled "about" and never sets a colour
};

/** OMR → USD as the register does. */
export const USD_PER_OMR = 2.6;
