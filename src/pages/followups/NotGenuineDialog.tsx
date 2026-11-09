import { useId, useState } from "react";
import { Dialog } from "../../components/Dialog";
import { Alert, Button, Field, inputClass } from "../../components/ui";
import { errorMessage } from "../../lib/format";
import { NOT_GENUINE_REASONS, notGenuineReason } from "../../lib/followUps";

const OTHER = "Other";

/**
 * Closes the selected enquiries as not genuine: fake, a competitor checking our rates, contact details that don't
 * work. Only the sales person can tell, so they pick the reason; a note is optional, or required with "Other".
 */
export function NotGenuineDialog({
  count,
  references,
  customer,
  saving,
  error,
  onClose,
  onConfirm,
}: {
  count: number;
  /** Up to a few references to name in the dialog; the rest are counted. */
  references: string[];
  /** For one enquiry: its customer, named under the title. */
  customer?: string;
  saving: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [choice, setChoice] = useState("");
  const [note, setNote] = useState("");
  const name = useId();
  const what = count === 1 ? (references[0] ?? "1 enquiry") : `${count.toLocaleString()} enquiries`;
  const named = references.slice(0, 5);
  const more = count - named.length;
  const reason = notGenuineReason(choice === OTHER ? "" : choice, note);
  const missingNote = choice === OTHER && !note.trim();

  return (
    <Dialog
      title={`Mark ${what} as not genuine`}
      onClose={onClose}
      onSubmit={() => reason && onConfirm(reason)}
      busy={saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving} disabled={!reason}>
            {saving ? "Saving…" : "Mark not genuine"}
          </Button>
        </>
      }
    >
      {count === 1 && customer ? (
        <p className="text-ink-heading">{customer}. Why isn't it a real enquiry?</p>
      ) : (
        named.length > 0 && (
          <p>
            <span className="font-medium tabular-nums">{named.join(", ")}</span>
            {more > 0 && ` and ${more.toLocaleString()} more`}. Why aren't they real enquiries?
          </p>
        )
      )}
      <fieldset className="space-y-1.5">
        <legend className="mb-1.5 text-meta font-medium text-ink-heading">Reason</legend>
        {[...NOT_GENUINE_REASONS, OTHER].map((r) => (
          <label
            key={r}
            className={`flex min-h-10 cursor-pointer items-center gap-2.5 rounded-control border px-3 ${
              choice === r ? "border-primary bg-selected font-medium" : "border-line hover:bg-row-hover"
            }`}
          >
            <input type="radio" name={name} value={r} checked={choice === r} onChange={() => setChoice(r)} className="size-4 accent-primary" required />
            {r}
          </label>
        ))}
      </fieldset>
      <Field
        label={choice === OTHER ? "What is it?" : "Note (optional)"}
        hint={missingNote ? "Say why, so a manager reading it later understands." : undefined}
      >
        <input
          className={inputClass}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. same e-mail domain as another forwarder, phone switched off"
          maxLength={200}
        />
      </Field>
      <p className="rounded-control bg-table-head px-3 py-2 text-meta text-ink-heading">
        {count === 1 ? "It moves" : "They move"} to <strong className="font-semibold text-ink">Not genuine</strong> in the register and
        stop counting in enquiries, conversion, quote speed and reports. Nothing is deleted. Managers see how many each person marks.{" "}
        <strong className="font-semibold text-ink">Reopen</strong> undoes it.
      </p>
      {error != null && <Alert>Could not mark {count === 1 ? "it" : "them"} as not genuine. {errorMessage(error)}</Alert>}
    </Dialog>
  );
}
