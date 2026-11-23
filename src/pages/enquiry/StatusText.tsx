import { useState } from "react";
import { Icon } from "../../components/icons";
import { Button } from "../../components/ui";
import type { ActionButton, StatusText as StatusTextData } from "../../lib/enquiryBrief";
import { ActionBtn, ProofLink, type PageActions } from "./shared";

/** The buttons of the strip: copying is for everyone; a reply needs the mailbox, and the page opens it to be edited and sent there. */
export function statusButtons(text: string, canReply: boolean): ActionButton[] {
  const copy: ActionButton = { id: "copy", label: "Copy", variant: "secondary", copyText: text, copiedToast: "Status text copied." };
  const reply: ActionButton = { id: "reply", label: "Use in a reply", variant: "secondary", sideKey: "customer", copyText: text };
  return canReply ? [copy, reply] : [copy];
}

/**
 * Status for the customer: one or two sentences on where the shipment stands, to copy or to start a reply with. It is
 * built from the e-mails and the register, so it says what each part was read from and asks to be checked first.
 */
export function StatusText({ status, canReply, actions }: { status: StatusTextData | null; canReply: boolean; actions: PageActions }) {
  const [open, setOpen] = useState(false);
  const text = status?.text.trim();
  if (!status || !text) return null;
  const from = status.builtFrom > 0 ? `${status.builtFrom} e-mail${status.builtFrom === 1 ? "" : "s"} and the register` : "the register";
  return (
    <section aria-labelledby="status-text-title" className="rounded-panel border border-line bg-table-head px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 id="status-text-title" className="text-meta font-medium text-ink-muted">
          Status for the customer
        </h2>
        <div className="flex flex-wrap gap-2">
          {statusButtons(text, canReply).map((button) => (
            <ActionBtn key={button.id} button={button} actions={actions} size="sm" />
          ))}
        </div>
      </div>
      <p className="mt-1 whitespace-pre-line break-words text-body text-ink">{text}</p>
      {status.warning && (
        <p className="mt-2 flex items-start gap-1.5 text-meta font-medium text-await">
          <Icon name="alert" className="mt-0.5 size-3.5" />
          <span className="min-w-0 break-words">{status.warning}</span>
        </p>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-x-2">
        <p className="text-meta text-ink-muted">Built from {from} · check it before you send.</p>
        {status.facts.length > 0 && (
          <Button variant="ghost" size="sm" className="-ml-2.5 sm:-ml-1" aria-expanded={open} aria-controls="status-text-facts" onClick={() => setOpen(!open)}>
            <Icon name={open ? "chevronDown" : "chevronRight"} className="size-3.5" />
            Where this comes from
          </Button>
        )}
      </div>
      {status.facts.length > 0 && (
        <ul id="status-text-facts" role="list" hidden={!open} className="mt-1 space-y-1 border-t border-line pt-2 text-meta">
          {status.facts.map((fact, i) => (
            <li key={`${fact.proof.emailId}-${i}`} className="break-words">
              <ProofLink proof={fact.proof} actions={actions}>
                <span className="text-ink">{fact.value}</span>
                <span className="tabular-nums text-ink-muted">
                  {" — "}
                  {fact.proof.who}, {fact.proof.when}
                </span>
              </ProofLink>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
