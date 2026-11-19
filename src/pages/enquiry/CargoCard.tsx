import { useId } from "react";
import { Icon } from "../../components/icons";
import { Button, Card } from "../../components/ui";
import type { ActionButton, CargoCheck, CargoField, Drift, DriftKind, Viewer } from "../../lib/enquiryBrief";
import { ActionBtn, ProofLink, type PageActions } from "./shared";

// What is known about the cargo and where each fact was read, what is still missing for this kind of shipment,
// and where the e-mails say something else than the register about the shipment, the agent or the dates. Nothing
// here changes the register: "Update…" opens the Edit form with the e-mails' value filled in.

/** The differences this card lists. Status, amounts and the contact are said where they belong on the page. */
const DRIFT_KINDS: ReadonlySet<DriftKind> = new Set<DriftKind>(["quantity", "incoterm", "route", "mode", "direction", "agent", "quoted_date", "confirmed_date", "date_order"]);

const filled = (field: CargoField) => !!field.value?.trim();

/** The fields to list: the ones this kind of shipment needs, and any other the e-mails or the register give. */
export function shownFields(cargo: CargoCheck): CargoField[] {
  return cargo.fields.filter((field) => field.required || filled(field));
}

/** What a difference says when the brief gives no sentence for it. */
function driftText(drift: Drift): string {
  const mail = drift.mail.trim();
  const register = drift.register.trim();
  return drift.text.trim() || [mail && `E-mails say ${mail}`, register && `the register says ${register}`].filter(Boolean).join("; ");
}

/** The differences about the shipment, the agent and the dates, in the brief's order. */
export function cargoDrift(drift: Drift[]): Drift[] {
  return drift.filter((one) => DRIFT_KINDS.has(one.kind) && !!driftText(one));
}

/** "Copy request block": the lines the house sends to agents (POL, POD, unit, commodity, dimensions, weight, pick-up address). */
export function requestBlockButton(cargo: CargoCheck): ActionButton | null {
  const text = cargo.requestBlock.trim();
  return text ? { id: "copy", label: "Copy request block", variant: "secondary", copyText: text, copiedToast: "Request block copied." } : null;
}

/**
 * The questions about what is missing: "Ask the customer" opens a reply to the customer with them for those who
 * send from the mailbox; everyone else copies them.
 */
export function askButton(cargo: CargoCheck, viewer: Viewer): ActionButton | null {
  const text = cargo.askText.trim();
  if (!text) return null;
  return viewer.canReply
    ? { id: "reply", label: "Ask the customer", variant: "secondary", sideKey: "customer", copyText: text }
    : { id: "copy", label: "Copy the questions", variant: "secondary", copyText: text, copiedToast: "Questions copied." };
}

/**
 * What can be done about a difference, for those who may edit: "Update…" opens the Edit form with the e-mails'
 * value filled in, "Keep the register's" puts the difference away.
 */
export function driftButtons(drift: Drift, viewer: Viewer): ActionButton[] {
  if (!viewer.canEdit) return [];
  const update: ActionButton[] = drift.prefill ? [{ id: "edit_prefilled", label: drift.buttonLabel.trim() || "Update…", variant: "secondary", formPrefill: drift.prefill }] : [];
  return [...update, { id: "dismiss", label: "Keep the register's", variant: "ghost", dismissId: drift.id }];
}

/** One fact about the cargo: its value with where it was read, or "Not known" when this kind of shipment needs it. */
function FieldRow({ field, actions }: { field: CargoField; actions: PageActions }) {
  const value = field.value?.trim();
  const source = field.source?.trim();
  return (
    <div className="contents">
      <dt className="pt-px text-meta text-ink-muted">{field.label.trim() || field.key.replace(/_/g, " ")}</dt>
      <dd className="min-w-0 break-words text-body text-ink">
        {value ? (
          <>
            <ProofLink proof={field.proof} actions={actions}>
              {value}
            </ProofLink>
            {source && <span className="block text-meta tabular-nums text-ink-muted">{source}</span>}
          </>
        ) : (
          <span className="inline-flex items-center gap-1 font-medium text-await">
            <Icon name="alert" className="size-3.5" />
            Not known
          </span>
        )}
      </dd>
    </div>
  );
}

/** A difference in words; the part read from the e-mails opens the e-mail it was read from. */
function DriftLine({ drift, actions }: { drift: Drift; actions: PageActions }) {
  const text = driftText(drift);
  const mail = drift.mail.trim();
  const at = mail ? text.indexOf(mail) : -1;
  if (!drift.proof || at < 0) {
    return (
      <ProofLink proof={drift.proof} actions={actions}>
        {text}
      </ProofLink>
    );
  }
  return (
    <>
      {text.slice(0, at)}
      <ProofLink proof={drift.proof} actions={actions} className="font-medium">
        {mail}
      </ProofLink>
      {text.slice(at + mail.length)}
    </>
  );
}

export interface CargoCardProps {
  cargo: CargoCheck;
  /** Every difference between the e-mails and the register; the card lists those about the shipment, the agent and the dates. */
  drift: Drift[];
  viewer: Viewer;
  actions: PageActions;
}

/**
 * Cargo: the checklist of what a rate needs (commodity, weight, volume, dimensions and the like) with where each
 * was read and what is not known yet, the request block to copy for agents, the questions for the customer, and
 * what the e-mails changed against the register.
 */
export function CargoCard({ cargo, drift, viewer, actions }: CargoCardProps) {
  const id = useId();
  const fields = shownFields(cargo);
  const known = fields.some(filled);
  const missing = fields.filter((field) => !filled(field));
  const warning = cargo.warning?.trim();
  const changes = cargoDrift(drift);
  const request = requestBlockButton(cargo);
  // Without anything about the cargo on file there may be no e-mail of the customer's to answer either.
  const ask = known ? askButton(cargo, viewer) : null;
  return (
    <Card title="Cargo">
      {known ? (
        <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-2">
          {fields.map((field) => (
            <FieldRow key={field.key} field={field} actions={actions} />
          ))}
        </dl>
      ) : (
        <>
          <p className="text-body text-ink-muted">Nothing about the cargo in the e-mails yet.</p>
          {missing.length > 0 && (
            <p className="mt-1.5 flex items-start gap-1 text-meta font-medium text-await">
              <Icon name="alert" className="mt-0.5 size-3.5" />
              <span className="min-w-0 break-words">Not known: {missing.map((field) => field.label.trim() || field.key.replace(/_/g, " ")).join(" · ")}</span>
            </p>
          )}
        </>
      )}
      {warning && (
        <p className="mt-3 flex items-start gap-1.5 rounded-control border border-await/25 bg-await-bg px-3 py-2 text-meta font-medium text-await">
          <Icon name="alert" className="mt-0.5 size-3.5" />
          <span className="min-w-0 break-words">{warning}</span>
        </p>
      )}
      {(request || ask) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {request && <ActionBtn button={request} actions={actions} size="sm" />}
          {ask && <ActionBtn button={ask} actions={actions} size="sm" />}
        </div>
      )}
      {changes.length > 0 && (
        <section aria-labelledby={`${id}-changes`} className="mt-4 border-t border-line pt-3">
          <h3 id={`${id}-changes`} className="mb-2 text-meta font-semibold text-ink-heading">
            What the e-mails changed
          </h3>
          <ul role="list" className="space-y-3">
            {changes.map((one) => {
              const buttons = driftButtons(one, viewer);
              return (
                <li key={one.id}>
                  <p className="break-words text-body text-ink">
                    <DriftLine drift={one} actions={actions} />
                  </p>
                  {buttons.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {buttons.map((button, i) => (
                        <Button
                          key={button.id}
                          variant={button.variant}
                          size="sm"
                          // A borderless button that comes first is pulled left, so its words line up with the sentence above it.
                          className={i === 0 && button.variant === "ghost" ? "-ml-2.5" : ""}
                          loading={!!actions.busy[button.id]}
                          onClick={() => actions.onAction(button)}
                        >
                          {button.label}
                          <span className="sr-only">: {driftText(one)}</span>
                        </Button>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </Card>
  );
}
