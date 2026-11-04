import { useState } from "react";
import { Dialog } from "../../components/Dialog";
import { Alert, Button, Field, inputClass } from "../../components/ui";
import { errorMessage } from "../../lib/format";
import { LOST_REASONS } from "../../lib/followUps";

/** Confirms closing the selected enquiries as lost, with one reason for all of them. */
export function MarkLostDialog({
  count,
  references,
  saving,
  error,
  onClose,
  onConfirm,
}: {
  count: number;
  /** Up to a few references to name in the dialog; the rest are counted. */
  references: string[];
  saving: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState(LOST_REASONS[0]);
  const what = count === 1 ? "1 enquiry" : `${count.toLocaleString()} enquiries`;
  const named = references.slice(0, 5);
  const more = count - named.length;

  return (
    <Dialog
      title={`Mark ${what} as lost`}
      onClose={onClose}
      onSubmit={() => onConfirm(reason)}
      busy={saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving} disabled={!reason.trim()}>
            {saving ? "Saving…" : `Mark ${what} as lost`}
          </Button>
        </>
      }
    >
      {named.length > 0 && (
        <p>
          <span className="font-medium tabular-nums">{named.join(", ")}</span>
          {more > 0 && ` and ${more.toLocaleString()} more`}
        </p>
      )}
      <Field label="Reason" hint="Saved on each enquiry and shown in its history. Pick a suggestion or type your own.">
        <input className={inputClass} list="lost-reasons" value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus />
      </Field>
      <datalist id="lost-reasons">
        {LOST_REASONS.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
      <p className="rounded-control bg-table-head px-3 py-2 text-ink-heading">
        They move to <strong className="font-semibold text-ink">Lost</strong> in the register and leave this list. You can undo this
        straight after. If a customer confirms later, entering the confirmation date makes it a confirmed job again.
      </p>
      {error != null && <Alert>Could not mark them as lost. {errorMessage(error)}</Alert>}
    </Dialog>
  );
}
