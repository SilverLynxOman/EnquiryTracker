import type { ReactNode } from "react";
import { Icon } from "../../components/icons";
import { Button } from "../../components/ui";
import type { ActionButton, ActionId, Proof, Tone } from "../../lib/enquiryBrief";

// What every card of the enquiry page shares: the actions the page handles, the tone classes, a value that
// shows where it was read, and a button built from the brief's ActionButton.

export interface PageActions {
  /** Scroll to the e-mail in the conversation, expand it, and switch the view when it is on another side. */
  onOpenMail: (emailId: string) => void;
  /** The page maps the button's id to its mutation, navigation, reply or copy. */
  onAction: (button: ActionButton) => void;
  /** Actions in flight: the matching button shows a spinner. */
  busy: Partial<Record<ActionId, boolean>>;
}

/** Text colour of a tone (status is always text plus an icon, never colour alone). */
export const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-ink-heading",
  primary: "text-primary-hover",
  good: "text-confirmed",
  warn: "text-await",
  bad: "text-lost",
  flag: "text-not-genuine",
  info: "text-lane-mail",
};

/** Border and ground of a tinted box in a tone. */
export const TONE_BOX: Record<Tone, string> = {
  neutral: "border-line bg-table-head",
  primary: "border-primary/25 bg-selected",
  good: "border-confirmed/25 bg-confirmed-bg",
  warn: "border-await/25 bg-await-bg",
  bad: "border-lost/25 bg-lost-bg",
  flag: "border-not-genuine-line bg-not-genuine-bg",
  info: "border-lane-mail/25 bg-lane-mail-bg",
};

/** Who wrote it, when, and the sentence: the tooltip of everything read from an e-mail. */
export function proofTitle(proof: Proof): string {
  const sentence = proof.sentence ? ` · “${proof.sentence}”` : "";
  const file = proof.file ? ` · ${proof.file}` : "";
  return `${proof.who} · ${proof.when}${sentence}${file}`;
}

/**
 * A value read from an e-mail: a button that opens the e-mail it was read from and says who wrote it and when on
 * hover or focus. Without a proof it renders the children as plain text.
 */
export function ProofLink({
  proof,
  actions,
  children,
  className = "",
}: {
  proof: Proof | null | undefined;
  actions: Pick<PageActions, "onOpenMail">;
  children: ReactNode;
  className?: string;
}) {
  if (!proof) return <span className={className}>{children}</span>;
  return (
    <button
      type="button"
      title={proofTitle(proof)}
      aria-label={undefined}
      onClick={() => actions.onOpenMail(proof.emailId)}
      className={`rounded-[3px] text-left underline decoration-line decoration-dotted underline-offset-4 hover:decoration-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${className}`}
    >
      {children}
      <span className="sr-only">
        {" "}
        (from {proof.who}, {proof.when}; opens the e-mail)
      </span>
    </button>
  );
}

/**
 * One of the brief's buttons. Only the Now card passes a primary one: every other button on the page is quiet. A
 * label carrying a long name ("Chase frontline.shipping.operations@gmail.com") wraps inside the button at phone width.
 */
export function ActionBtn({
  button,
  actions,
  size = "md",
  id,
  full = false,
}: {
  button: ActionButton;
  actions: PageActions;
  size?: "sm" | "md";
  id?: string;
  /** Full width (the Now card's button at phone width). */
  full?: boolean;
}) {
  return (
    <Button
      id={id}
      variant={button.variant}
      size={size}
      loading={!!actions.busy[button.id]}
      wrap
      className={full ? "w-full sm:w-auto" : ""}
      onClick={() => actions.onAction(button)}
    >
      {button.id === "copy" && <Icon name="copy" className="size-3.5" />}
      {button.label}
    </Button>
  );
}
