import { Fragment, useId, useState, type ReactNode } from "react";
import { Icon, type IconName } from "../../components/icons";
import { Menu } from "../../components/Menu";
import { Button, buttonClass, Card } from "../../components/ui";
import { daysBetween, displayName } from "../../lib/display";
import { muscatDate } from "../../lib/emailDrafts";
import type { ActionButton, FormPrefill, Handler, OtherParty, PeopleBlock, Person, Phone, Viewer } from "../../lib/enquiryBrief";
import { dayWithWeekday, muscatTime } from "../../lib/enquiryDetails";
import { todayIso } from "../../lib/format";
import type { EnquiryRow } from "../../lib/types";
import type { PageActions } from "./shared";

// Who to call or write to on an enquiry, party by party: the people on its e-mails with what their signatures give
// (role, company, phones, WhatsApp, WeChat), and who on our side writes. Nothing here saves a contact or an agent:
// those buttons open the Edit form with the fields filled in.

/** Agents listed before "Show n more agents". */
const AGENTS_SHOWN = 3;

type Kind = PeopleBlock["kind"];

/** Each party's word, icon and colour, in the order the card lists them. */
const KINDS: Record<Kind, { role: string; icon: IconName; hue: string; order: number }> = {
  customer: { role: "Customer", icon: "user", hue: "text-party-customer", order: 0 },
  agent: { role: "Agent", icon: "ship", hue: "text-party-agent", order: 1 },
  shipper: { role: "Shipper", icon: "package", hue: "text-party-agent", order: 2 },
  carrier: { role: "Carrier", icon: "ship", hue: "text-party-agent", order: 3 },
  other: { role: "External", icon: "users", hue: "text-ink-heading", order: 4 },
  internal: { role: "Our side", icon: "users", hue: "text-ink-heading", order: 5 },
  us: { role: "Our side", icon: "users", hue: "text-ink-heading", order: 5 },
};

const isOurs = (kind: Kind) => kind === "us" || kind === "internal";

/** The letter before a number, as signatures write it, and the word a screen reader hears. */
const PHONES: Record<Phone["label"], { letter: string; word: string }> = {
  mobile: { letter: "M", word: "mobile" },
  office: { letter: "T", word: "office" },
  phone: { letter: "T", word: "phone" },
  fax: { letter: "F", word: "fax" },
};

/** Who an External person can be said to be. */
const TREAT_AS: { party: OtherParty; icon: IconName }[] = [
  { party: "customer", icon: "user" },
  { party: "agent", icon: "ship" },
  { party: "shipper", icon: "package" },
];

/** An address that is safe in a mailto link: nothing after it that could add recipients or text. */
const MAILABLE = /^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/;

/** A link that reads as text until it is pointed at: addresses and numbers are many, and only one colour is for actions. */
const QUIET_LINK = "text-ink-heading underline-offset-2 hover:text-primary hover:underline";

/** A party in the card, with what belongs under it: one under the other in the side column, in two columns when the card is wide. */
const PARTY = "mb-4 min-w-0 break-inside-avoid last:mb-0";

/** A party's people under its heading, and what follows them: both line up with what the heading says. */
const PEOPLE = "divide-y divide-line px-2.5";
const FOOT = "mt-1.5 px-2.5";

const same = (a: string | null | undefined, b: string | null | undefined) => !!a?.trim() && !!b?.trim() && a.trim().toLowerCase() === b.trim().toLowerCase();

const isStamp = (value: string) => /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value));

/** A day as the brief gives it (a date, a timestamp, or words already) → "Sat 07 Nov" on the Oman calendar. */
function dayText(value: string, today: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return dayWithWeekday(value, today);
  return isStamp(value) ? dayWithWeekday(muscatDate(value), today) : value;
}

/** "Wed 04 – Thu 05 Nov", or the one day when both are the same. */
function daySpan(from: string, to: string, today: string): string {
  const first = dayText(from, today);
  const last = dayText(to, today);
  if (first === last) return first;
  const parts = /^(\w{3} \d{2}) (.+)$/.exec(first);
  return parts && last.endsWith(` ${parts[2]}`) ? `${parts[1]} – ${last}` : `${first} – ${last}`;
}

/** A moment as the brief gives it → "Mon 09:25" within six days of today, "Mon 02 Nov, 09:25" before that; words stay as written. */
function shortWhen(value: string, today: string): string {
  if (!isStamp(value)) return dayText(value, today);
  const day = muscatDate(value);
  const full = dayWithWeekday(day, today);
  return Math.abs(daysBetween(day, today)) <= 6 ? `${full.slice(0, 3)} ${muscatTime(value)}` : `${full}, ${muscatTime(value)}`;
}

const copyButton = (label: string, text: string, toast: string): ActionButton => ({ id: "copy", label, variant: "ghost", copyText: text, copiedToast: toast });

/**
 * "Save as contact" for a customer's person who is not the enquiry's contact yet, for those who may edit. It opens
 * the Edit form with the name, address and number filled in; the person saves there.
 */
export function saveContactButton(person: Person, row: EnquiryRow, viewer: Viewer): ActionButton | null {
  if (!viewer.canEdit || !person.canSave || same(person.email, row.contact_email)) return null;
  const phone = person.phones.find((p) => p.label === "mobile") ?? person.phones.find((p) => p.label !== "fax");
  const replaces = row.contact_name || row.contact_email || row.contact_phone;
  const formPrefill: FormPrefill = person.prefill ?? {
    ...(person.name?.trim() ? { contact_name: person.name.trim() } : {}),
    contact_email: person.email,
    ...(phone ? { contact_phone: phone.display } : {}),
    ...(replaces ? { replace: ["contact_name", "contact_email", "contact_phone"] } : {}),
    notes: [`Contact ${person.name?.trim() || person.email}, from the signature on their e-mails`],
  };
  return { id: "edit_prefilled", label: "Save as contact", variant: "secondary", formPrefill };
}

/** "Treat as customer / agent / shipper" for an External person, for those who may edit. The choice stays in this browser. */
export function treatAsButtons(person: Person, viewer: Viewer): ActionButton[] {
  if (!viewer.canEdit || person.party !== "other") return [];
  const address = person.email.trim().toLowerCase();
  return TREAT_AS.map(({ party }): ActionButton => ({ id: "treat_as", label: `Treat as ${party}`, variant: "ghost", address, party }));
}

/**
 * "Set as this enquiry's agent" for an agent whose name in the register is known and is not the enquiry's agent
 * already, for those who may edit. It opens the Edit form with the agent filled in.
 */
export function agentButton(block: PeopleBlock, row: EnquiryRow, viewer: Viewer): ActionButton | null {
  const formPrefill = block.agentPrefill;
  if (!viewer.canEdit || !formPrefill?.agent_name?.trim() || same(formPrefill.agent_name, row.agent_name)) return null;
  return { id: "edit_prefilled", label: "Set as this enquiry's agent", variant: "secondary", formPrefill };
}

interface Chip {
  text: string;
  /** Said in red with a warning icon (a bounced address); everything else is quiet. */
  bad: boolean;
  title?: string;
}

/** What is worth knowing about a person besides how to reach them. */
function personChips(person: Person, row: EnquiryRow): Chip[] {
  const chips: Chip[] = [];
  if (same(person.email, row.contact_email)) chips.push({ text: "enquiry's contact", bad: false, title: "The contact saved on this enquiry" });
  if (person.sharedDesk) chips.push({ text: "shared desk", bad: false, title: "An address that several people read" });
  for (const raw of person.chips) {
    const text = raw.trim();
    if (text && !chips.some((chip) => same(chip.text, text))) chips.push({ text, bad: /bounce/i.test(text) });
  }
  return chips;
}

/** "last wrote Mon 09:25 · we replied Mon 11:15". */
function whenLine(person: Person, today: string): string {
  const wrote = person.lastWrote ? `last wrote ${shortWhen(person.lastWrote, today)}` : person.party !== "us" && person.wrote === 0 ? "no e-mail from them on file" : "";
  const replied = person.lastWeReplied ? `we replied ${shortWhen(person.lastWeReplied, today)}` : "";
  return [wrote, replied].filter(Boolean).join(" · ");
}

/** A quiet copy button at the end of a line: as large to press as any icon button, and it keeps the line's height. */
function CopyIcon({ what, text, toast, actions }: { what: string; text: string; toast: string; actions: PageActions }) {
  const label = `Copy ${what}`;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => actions.onAction(copyButton(label, text, toast))}
      className="-my-1 inline-flex size-8 shrink-0 items-center justify-center rounded-control text-ink-muted transition-colors duration-150 hover:bg-row-hover hover:text-ink"
    >
      <Icon name="copy" className="size-3.5" />
    </button>
  );
}

/** An e-mail address: a link that starts an e-mail, and a button that copies it. Long ones are cut, whole in the tooltip. */
function AddressLine({ email, strong = false, actions }: { email: string; strong?: boolean; actions: PageActions }) {
  const look = strong ? "text-body font-medium text-ink underline-offset-2 hover:text-primary hover:underline" : QUIET_LINK;
  return (
    <span className="flex min-h-6 min-w-0 items-center gap-1">
      {MAILABLE.test(email) ? (
        <a href={`mailto:${email}`} title={email} className={`min-w-0 truncate ${look}`}>
          {email}
        </a>
      ) : (
        <span title={email} className={`min-w-0 truncate ${strong ? "text-body font-medium text-ink" : "text-ink-heading"}`}>
          {email}
        </span>
      )}
      <CopyIcon what={email} text={email} toast={`${email} copied.`} actions={actions} />
    </span>
  );
}

/**
 * A number: a link that calls it, a link to WhatsApp when the number is a mobile that takes it, and a button that
 * copies it (for a desk phone). A fax is only shown.
 */
function PhoneLine({ phone, actions }: { phone: Phone; actions: PageActions }) {
  const digits = phone.digits.replace(/\D/g, "");
  const kind = PHONES[phone.label];
  const fax = phone.label === "fax";
  const number = (
    <>
      <span aria-hidden="true">{kind.letter} </span>
      {phone.display}
    </>
  );
  return (
    <li className="flex min-h-6 flex-wrap items-center gap-x-1.5 tabular-nums">
      {digits && !fax ? (
        <a href={`tel:+${digits}`} className={QUIET_LINK}>
          <span className="sr-only">Call {kind.word} </span>
          {number}
        </a>
      ) : (
        <span className="text-ink-heading">
          <span className="sr-only">{kind.word} </span>
          {number}
        </span>
      )}
      {(phone.whatsapp || phone.whatsappGuessed) && digits && (
        <>
          <span aria-hidden="true" className="text-ink-muted">
            ·
          </span>
          <a href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer" className="font-medium text-primary underline-offset-2 hover:text-primary-hover hover:underline">
            {phone.whatsappGuessed ? "WhatsApp?" : "WhatsApp"}
            <span className="sr-only">{phone.whatsappGuessed ? " (a mobile; not said to take WhatsApp)" : ""} {phone.display}</span>
          </a>
        </>
      )}
      {!fax && <CopyIcon what={phone.display} text={phone.display} toast={`${phone.display} copied.`} actions={actions} />}
    </li>
  );
}

/** How to reach a person: address, numbers, WeChat. */
function ContactLines({ person, withAddress, actions }: { person: Person; withAddress: boolean; actions: PageActions }) {
  const wechat = person.wechat?.trim();
  const address = withAddress && !!person.email.trim();
  if (!address && !person.phones.length && !wechat) return null;
  return (
    <ul role="list" className="mt-1 space-y-0.5 text-meta">
      {address && (
        <li>
          <AddressLine email={person.email} actions={actions} />
        </li>
      )}
      {person.phones.map((phone, i) => (
        <PhoneLine key={`${phone.digits}-${i}`} phone={phone} actions={actions} />
      ))}
      {wechat && (
        <li className="flex min-h-6 min-w-0 items-center gap-1">
          <span className="min-w-0 truncate text-ink-heading" title={wechat}>
            <span className="text-ink-muted">WeChat </span>
            {wechat}
          </span>
          <CopyIcon what={`WeChat ID ${wechat}`} text={wechat} toast="WeChat ID copied." actions={actions} />
        </li>
      )}
    </ul>
  );
}

function Chips({ chips }: { chips: Chip[] }) {
  if (!chips.length) return null;
  return (
    <ul role="list" className="mt-1.5 flex flex-wrap gap-1">
      {chips.map((chip) => (
        <li
          key={chip.text}
          title={chip.title}
          className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-meta font-medium ${chip.bad ? "bg-lost-bg text-lost" : "bg-table-head text-ink-heading"}`}
        >
          {chip.bad && <Icon name="alert" className="size-3.5" />}
          <span className="min-w-0 break-words">{chip.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** The time where a person is ("Ningbo 15:32"), beside their name. */
function LocalTime({ text }: { text: string }) {
  return (
    <span className="mt-px inline-flex shrink-0 items-center gap-1 text-meta tabular-nums text-ink-muted" title="The time where they are">
      <Icon name="clock" className="size-3.5" />
      {text}
      <span className="sr-only"> local time</span>
    </span>
  );
}

/** One person: who they are, how to reach them, when they last wrote, and what can be done about them. */
function PersonItem({ person, row, viewer, actions, today }: { person: Person; row: EnquiryRow; viewer: Viewer; actions: PageActions; today: string }) {
  const name = person.name?.trim() ?? "";
  const shown = name || person.email || "this person";
  const role = [person.designation, person.company]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" · ");
  const when = whenLine(person, today);
  const save = saveContactButton(person, row, viewer);
  const treat = treatAsButtons(person, viewer);
  return (
    <li className="py-2.5 first:pt-2 last:pb-0">
      <div className="flex items-start justify-between gap-2">
        {name || !person.email.trim() ? (
          <p className="min-w-0 break-words text-body font-medium text-ink">{name || "Name not given"}</p>
        ) : (
          <AddressLine email={person.email} strong actions={actions} />
        )}
        {person.localTime?.trim() && <LocalTime text={person.localTime.trim()} />}
      </div>
      {role && <p className="break-words text-meta text-ink-muted">{role}</p>}
      <ContactLines person={person} withAddress={!!name} actions={actions} />
      {when && <p className="mt-1 text-meta tabular-nums text-ink-muted">{when}</p>}
      <Chips chips={personChips(person, row)} />
      {(save || treat.length > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {save && (
            <Button variant="secondary" size="sm" loading={!!actions.busy[save.id]} onClick={() => actions.onAction(save)}>
              {save.label}
              <span className="sr-only">: {shown}</span>
            </Button>
          )}
          {treat.length > 0 && (
            <Menu
              label={`Treat as… (${shown})`}
              trigger={
                <>
                  Treat as…
                  <Icon name="chevronDown" className="size-3.5" />
                </>
              }
              // Without a button before it, its words start where the person's lines start.
              triggerClassName={buttonClass("ghost", "sm", save ? "" : "-ml-2.5")}
              header={<span className="text-meta text-ink-muted">Kept in this browser, for this enquiry</span>}
              items={treat.map((button, i) => ({ label: button.label, icon: TREAT_AS[i].icon, onSelect: () => actions.onAction(button) }))}
            />
          )}
        </div>
      )}
    </li>
  );
}

/** A party's heading: its word in the party's colour, then who it is and where the enquiry stands with them. */
function BlockHead({ id, kind, title, note }: { id: string; kind: Kind; title: string; note: string }) {
  const { role, icon, hue } = KINDS[kind];
  const mark: { icon: IconName; look: string } | null = /^agreed/i.test(note)
    ? { icon: "check", look: "text-confirmed" }
    : /^paused/i.test(note)
      ? { icon: "pause", look: "text-ink-muted" }
      : /^declined/i.test(note)
        ? { icon: "ban", look: "text-ink-muted" }
        : null;
  return (
    <h3 id={id} className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-control bg-table-head px-2.5 py-1.5 text-meta">
      <Icon name={icon} className={`size-3.5 ${hue}`} />
      <span className={`font-semibold ${hue}`}>{role}</span>
      {title && (
        <span className="min-w-0 break-words font-medium text-ink">
          <span aria-hidden="true" className="font-normal text-ink-muted">
            ·{" "}
          </span>
          {title}
        </span>
      )}
      {note && (
        <span className={`inline-flex min-w-0 items-center gap-1 font-medium tabular-nums ${mark?.look ?? "text-ink-muted"}`}>
          {mark ? (
            <Icon name={mark.icon} className="size-3.5" />
          ) : (
            <span aria-hidden="true" className="font-normal">
              ·
            </span>
          )}
          <span className="min-w-0 break-words">{note}</span>
        </span>
      )}
    </h3>
  );
}

/** The people who were only copied, folded behind their number. */
function CopiedToggle({ count, open, controls, onToggle }: { count: number; open: boolean; controls: string; onToggle: () => void }) {
  return (
    <Button variant="ghost" size="sm" className="-ml-2.5" aria-expanded={open} aria-controls={controls} onClick={onToggle}>
      <Icon name={open ? "chevronDown" : "chevronRight"} className="size-3.5" />
      <span className="tabular-nums">
        +{count} copied
        <span className="sr-only"> {count === 1 ? "person" : "people"}</span>
      </span>
    </Button>
  );
}

function CopiedList({ id, open, copied }: { id: string; open: boolean; copied: PeopleBlock["copied"] }) {
  return (
    <ul id={id} role="list" hidden={!open} className="mt-1 space-y-1 text-meta">
      {copied.map((one, i) => {
        const name = one.name.trim();
        return (
          <li key={`${one.email}-${i}`} className="flex min-w-0 flex-wrap gap-x-1.5">
            {name && !same(name, one.email) && <span className="min-w-0 break-words text-ink">{name}</span>}
            {MAILABLE.test(one.email) ? (
              <a href={`mailto:${one.email}`} title={one.email} className={`min-w-0 truncate ${QUIET_LINK}`}>
                {one.email}
              </a>
            ) : (
              <span title={one.email} className="min-w-0 truncate text-ink-heading">
                {one.email}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Writers first, in the order the brief gives them. */
const writersFirst = (persons: Person[]) => [...persons].sort((a, b) => Number(b.wrote > 0) - Number(a.wrote > 0));

/** One outside party: the customer, an agent, the shipper, a carrier, or someone not placed yet. */
function PartyBlock({ block, row, viewer, actions, today }: { block: PeopleBlock; row: EnquiryRow; viewer: Viewer; actions: PageActions; today: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const { role } = KINDS[block.kind];
  const name = displayName(block.title);
  const title = same(name, role) ? "" : name;
  const agent = agentButton(block, row, viewer);
  const persons = writersFirst(block.persons);
  return (
    <section aria-labelledby={`${id}-head`}>
      <BlockHead id={`${id}-head`} kind={block.kind} title={title} note={block.note?.trim() ?? ""} />
      {persons.length > 0 && (
        <ul role="list" className={PEOPLE}>
          {persons.map((person, i) => (
            <PersonItem key={`${person.email}-${i}`} person={person} row={row} viewer={viewer} actions={actions} today={today} />
          ))}
        </ul>
      )}
      {(block.copied.length > 0 || agent) && (
        <div className={FOOT}>
          <div className="flex flex-wrap items-center gap-1.5">
            {block.copied.length > 0 && <CopiedToggle count={block.copied.length} open={open} controls={`${id}-copied`} onToggle={() => setOpen(!open)} />}
            {agent && (
              <Button variant="secondary" size="sm" loading={!!actions.busy[agent.id]} onClick={() => actions.onAction(agent)}>
                {agent.label}
                <span className="sr-only">: {title || role}</span>
              </Button>
            )}
          </div>
          {block.copied.length > 0 && <CopiedList id={`${id}-copied`} open={open} copied={block.copied} />}
        </div>
      )}
    </section>
  );
}

/** A colleague on the enquiry: the name, what they do here, and how to reach them when the e-mails give it. */
function Colleague({ name, lines, person, address, actions }: { name: string; lines: ReactNode[]; person: Person | null; address: string | null; actions: PageActions }) {
  return (
    <li className="py-2.5 first:pt-2 last:pb-0">
      <p className="min-w-0 break-words text-body font-medium text-ink">{name}</p>
      <p className="break-words text-meta text-ink-muted">
        {lines.map((line, i) => (
          <Fragment key={i}>
            {i > 0 && " · "}
            {line}
          </Fragment>
        ))}
      </p>
      {person ? (
        <ContactLines person={person} withAddress actions={actions} />
      ) : (
        address && (
          <div className="mt-1 text-meta">
            <AddressLine email={address} actions={actions} />
          </div>
        )
      )}
    </li>
  );
}

/**
 * Our side: who handles the enquiry and since when, who did before, whether the sales person is on the e-mails,
 * and any other colleague who wrote.
 */
function OurSide({
  handler,
  staff,
  copied,
  row,
  viewer,
  actions,
  today,
}: {
  handler: Handler | null;
  staff: Person[];
  copied: PeopleBlock["copied"];
  row: EnquiryRow;
  viewer: Viewer;
  actions: PageActions;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const named = new Set<Person>();
  /** The colleague's own entry among the people of the e-mails, by mailbox or by name. */
  const find = (mailbox: string | null | undefined, name: string): Person | null => {
    const box = mailbox?.trim().toLowerCase();
    const found = staff.find((p) => (box && (p.email.toLowerCase() === box || p.email.toLowerCase().split("@")[0] === box)) || same(p.name, name)) ?? null;
    if (found) named.add(found);
    return found;
  };
  const address = (mailbox: string | null | undefined) => (mailbox?.includes("@") ? mailbox.trim() : null);

  const sales = handler?.salesPerson ?? null;
  const salesIsHandler = !!handler && !!sales && (same(sales.mailbox, handler.mailbox) || same(displayName(sales.name), handler.name));
  const entries: ReactNode[] = [];
  if (handler) {
    const since = handler.since.trim() ? <span className="tabular-nums">handling since {dayText(handler.since.trim(), today)}</span> : "handling this enquiry";
    entries.push(
      <Colleague
        key="handler"
        name={handler.name}
        lines={[handler.role, since, salesIsHandler && "the sales person"].filter(Boolean)}
        person={find(handler.mailbox, handler.name)}
        address={address(handler.mailbox)}
        actions={actions}
      />,
    );
    handler.previous.forEach((before, i) => {
      entries.push(
        <Colleague
          key={`before-${i}`}
          name={before.name}
          lines={[before.role, <span className="tabular-nums">handled {daySpan(before.from, before.to, today)}</span>].filter(Boolean)}
          person={find(null, before.name)}
          address={null}
          actions={actions}
        />,
      );
    });
    if (sales && !salesIsHandler) {
      entries.push(
        <Colleague
          key="sales"
          name={displayName(sales.name)}
          lines={["Sales person", sales.onThread ? "on the e-mails" : <span className="font-medium text-ink-heading">not on the e-mails</span>]}
          person={find(sales.mailbox, displayName(sales.name))}
          address={address(sales.mailbox)}
          actions={actions}
        />,
      );
    }
  }
  const others = writersFirst(staff.filter((person) => !named.has(person)));
  const greets = handler?.customerGreets?.trim();
  return (
    <section aria-labelledby={`${id}-head`}>
      <BlockHead id={`${id}-head`} kind="us" title="" note="" />
      {(entries.length > 0 || others.length > 0) && (
        <ul role="list" className={PEOPLE}>
          {entries}
          {others.map((person, i) => (
            <PersonItem key={`${person.email}-${i}`} person={person} row={row} viewer={viewer} actions={actions} today={today} />
          ))}
        </ul>
      )}
      {greets && (
        <p className="mx-2.5 mt-2.5 break-words border-t border-line pt-2 text-meta text-ink-muted">
          The customer writes to <span className="font-medium text-ink-heading">{greets}</span>.
        </p>
      )}
      {copied.length > 0 && (
        <div className={FOOT}>
          <CopiedToggle count={copied.length} open={open} controls={`${id}-copied`} onToggle={() => setOpen(!open)} />
          <CopiedList id={`${id}-copied`} open={open} copied={copied} />
        </div>
      )}
    </section>
  );
}

export interface PeopleCardProps {
  /** The people of the e-mails, one block per party. */
  people: PeopleBlock[];
  /** Who on our side writes; null when nobody has yet. */
  handler: Handler | null;
  row: EnquiryRow;
  viewer: Viewer;
  actions: PageActions;
  /** Oman's date, to say "Mon 09:25" for this week's e-mails. */
  today?: string;
}

/**
 * People: who to call per party, in this order: Customer, Agents, Shipper, Carrier, External, Our side. Writing,
 * calling and copying are for everyone; saving a contact, setting the agent and saying who an External person is
 * are for those who may edit.
 */
export function PeopleCard({ people, handler, row, viewer, actions, today = todayIso() }: PeopleCardProps) {
  const [allAgents, setAllAgents] = useState(false);
  const outside = people
    .filter((block) => !isOurs(block.kind) && (block.persons.length > 0 || block.copied.length > 0 || !!agentButton(block, row, viewer)))
    .sort((a, b) => KINDS[a.kind].order - KINDS[b.kind].order);
  const ours = people.filter((block) => isOurs(block.kind));
  const staff = ours.flatMap((block) => block.persons).filter((person, i, all) => all.findIndex((other) => same(other.email, person.email)) === i);
  const staffCopied = ours.flatMap((block) => block.copied).filter((one, i, all) => all.findIndex((other) => same(other.email, one.email)) === i);
  const hasOurs = !!handler || staff.length > 0 || staffCopied.length > 0;

  if (!outside.length && !hasOurs) {
    return (
      <Card title="People">
        <p className="text-body text-ink-muted">Nobody has written yet. Contacts appear from the e-mails' signatures.</p>
      </Card>
    );
  }

  const agents = outside.filter((block) => block.kind === "agent");
  const more = agents.length - AGENTS_SHOWN;
  const folded = new Set(more > 0 && !allAgents ? agents.slice(AGENTS_SHOWN) : []);
  const lastAgent = agents.filter((block) => !folded.has(block)).at(-1);
  return (
    <Card title="People" className="@container">
      <div className="@min-[640px]:columns-2 @min-[640px]:gap-x-8">
        {outside
          .filter((block) => !folded.has(block))
          .map((block, i) => (
            <div key={`${block.kind}-${block.sideKey ?? block.title}-${i}`} className={PARTY}>
              <PartyBlock block={block} row={row} viewer={viewer} actions={actions} today={today} />
              {more > 0 && block === lastAgent && (
                <div className="mt-2">
                  <Button variant="ghost" size="sm" aria-expanded={allAgents} onClick={() => setAllAgents(!allAgents)}>
                    <Icon name={allAgents ? "chevronUp" : "chevronDown"} className="size-3.5" />
                    {allAgents ? "Show fewer agents" : `Show ${more} more agent${more === 1 ? "" : "s"}`}
                  </Button>
                </div>
              )}
            </div>
          ))}
        {hasOurs && (
          <div className={PARTY}>
            <OurSide handler={handler} staff={staff} copied={staffCopied} row={row} viewer={viewer} actions={actions} today={today} />
          </div>
        )}
      </div>
      {outside.length > 0 && (
        <p className="mt-4 border-t border-line pt-3 text-meta text-ink-muted">Read from the e-mails' signatures{viewer.canEdit ? ", so check before you save." : "."}</p>
      )}
    </Card>
  );
}
