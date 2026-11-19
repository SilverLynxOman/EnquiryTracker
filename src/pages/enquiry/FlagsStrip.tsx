import { useState } from "react";
import { Icon } from "../../components/icons";
import { Button } from "../../components/ui";
import type { ActionButton, Flag, FlagKind } from "../../lib/enquiryBrief";
import { ActionBtn, ProofLink, proofTitle, TONE_BOX, TONE_TEXT, type PageActions } from "./shared";

/** Rows shown before "and n more". */
const SHOWN = 3;

/** The longest sentence a row shows. */
const SENTENCE = 140;

/** Flags raised by the writer's own words: their sentence is shown in quotation marks. */
const QUOTED: ReadonlySet<FlagKind> = new Set<FlagKind>(["hold", "cancelled", "urgent", "complaint"]);

/** Only the Now card holds a filled button. */
const outlined = (button: ActionButton): ActionButton => (button.variant === "primary" ? { ...button, variant: "secondary" } : button);

/**
 * The buttons of a flag this reader may use. Opening the e-mail and copying are for everyone; replying needs the
 * mailbox, moving e-mails needs the mailbox and the right to edit, and everything else the right to edit. A bounce
 * and e-mails of another enquiry cannot be put away.
 */
export function flagButtons(flag: Flag, canEdit: boolean, canReply: boolean): ActionButton[] {
  return flag.buttons
    .filter((button) => {
      switch (button.id) {
        case "open_mail":
        case "copy":
          return true;
        case "reply":
          return canReply;
        case "move_mails":
        case "wrong_enquiry":
          return canEdit && canReply;
        case "dismiss":
          return canEdit && flag.kind !== "wrong_enquiry" && flag.kind !== "bounced";
        default:
          return canEdit;
      }
    })
    .map(outlined);
}

/** The row's ground and the colour of its icon and label. An answered flag is quiet; a hold is grey, as a cancelled status is. */
function look(flag: Flag): { box: string; label: string } {
  if (flag.cleared) return { box: "border-line bg-surface", label: "text-ink-muted" };
  if (flag.kind === "hold") return { box: "border-cancelled/25 bg-cancelled-bg", label: "text-cancelled" };
  return { box: TONE_BOX[flag.tone], label: TONE_TEXT[flag.tone] };
}

/** The flag's sentence, cut to length, in quotation marks when it is what someone wrote. */
function shownSentence(flag: Flag): string {
  const text = flag.sentence.trim();
  if (!text) return "";
  const short = text.length > SENTENCE ? `${text.slice(0, SENTENCE - 1).trimEnd()}…` : text;
  return QUOTED.has(flag.kind) && !/^[“"'‘]/.test(short) ? `“${short}”` : short;
}

/** One flag: what it is, the sentence, who wrote it and when, whether it was answered, and its buttons. */
function FlagRow({ flag, actions, canEdit, canReply }: { flag: Flag; actions: PageActions; canEdit: boolean; canReply: boolean }) {
  const { box, label } = look(flag);
  const buttons = flagButtons(flag, canEdit, canReply);
  const sentence = shownSentence(flag);
  const who = flag.who.trim();
  const when = flag.when.trim();
  const source = (who || when) && (
    <>
      {who && (when ? `${who}, ` : who)}
      {when && <span className="whitespace-nowrap">{when}</span>}
    </>
  );
  // The row's own "Show e-mail" button opens the e-mail; without one, who and when do.
  const linked = !!flag.proof && !buttons.some((button) => button.id === "open_mail");
  return (
    <li className={`flex items-start gap-2 rounded-control border px-3 py-1.5 text-body ${box}`}>
      <Icon name={flag.icon} className={`mt-2 size-4 ${label}`} />
      {/* The buttons sit beside the text, or under it and in line with it when the row is narrow. */}
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3">
        <p className="min-w-0 flex-1 basis-64 break-words py-1.5" title={flag.proof && !linked ? proofTitle(flag.proof) : undefined}>
          <strong className={`font-semibold ${label}`}>{flag.label}</strong>
          {sentence && <span className={flag.cleared ? "text-ink-muted" : "text-ink"}>{` · ${sentence}`}</span>}
          {source && (
            <span className="text-meta tabular-nums text-ink-muted">
              {" · "}
              {linked ? (
                <ProofLink proof={flag.proof} actions={actions}>
                  {source}
                </ProofLink>
              ) : (
                source
              )}
            </span>
          )}
          {flag.cleared && (
            <span className="text-meta tabular-nums text-ink-muted">
              {" · "}
              <span className="whitespace-nowrap">{flag.clearedText?.trim() || "answered"}</span>
            </span>
          )}
        </p>
        {buttons.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {buttons.map((button, i) => (
              // A borderless button that comes first is pulled left, so its words line up with the text above it.
              <span key={`${button.id}-${i}`} className={`flex ${i === 0 && button.variant === "ghost" ? "-ml-2.5" : ""}`}>
                <ActionBtn button={button} actions={actions} size="sm" />
              </span>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * What the e-mails say that changes how to read the enquiry: on hold, cancelled, urgent, a complaint, a bounced
 * address, an out-of-office reply, two currencies for one amount, a deadline, e-mails of another enquiry, a closed
 * origin. Open ones first; answered ones stay a day, muted.
 */
export function FlagsStrip({ flags, actions, canEdit, canReply }: { flags: Flag[]; actions: PageActions; canEdit: boolean; canReply: boolean }) {
  const [all, setAll] = useState(false);
  if (!flags.length) return null;
  const ordered = [...flags.filter((flag) => !flag.cleared), ...flags.filter((flag) => flag.cleared)];
  const more = ordered.length - SHOWN;
  return (
    <section aria-label="Flags">
      <ul role="list" className="space-y-1.5">
        {(all ? ordered : ordered.slice(0, SHOWN)).map((flag) => (
          <FlagRow key={flag.id} flag={flag} actions={actions} canEdit={canEdit} canReply={canReply} />
        ))}
      </ul>
      {more > 0 && (
        <Button variant="ghost" size="sm" className="mt-1" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? (
            "Show fewer"
          ) : (
            <span>
              {`and ${more} more`}
              <span className="sr-only"> flags</span>
            </span>
          )}
        </Button>
      )}
    </section>
  );
}
