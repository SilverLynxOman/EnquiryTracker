import { Fragment } from "react";
import { Dialog } from "../../components/Dialog";
import { Alert, Button } from "../../components/ui";
import { displayName } from "../../lib/display";
import type { UserAccount } from "../../lib/types";
import { userName } from "../../lib/users";

/** Asked before a second login is linked to a sales person: move the link to this login, or keep both. */
export function SharedLinkDialog({
  user,
  salesPersonName,
  others,
  saving,
  error,
  onMove,
  onLinkBoth,
  onClose,
}: {
  user: UserAccount;
  salesPersonName: string | null;
  /** The logins already linked to the sales person. */
  others: UserAccount[];
  /** The choice being saved. */
  saving: "move" | "both" | null;
  error: string | null;
  onMove: () => void;
  onLinkBoth: () => void;
  onClose: () => void;
}) {
  const name = userName(user);
  const person = displayName(salesPersonName) || "This sales person";
  const busy = saving !== null;

  return (
    <Dialog
      title={`${person} is already linked`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={onLinkBoth} loading={saving === "both"} disabled={busy}>
            {saving === "both" ? "Saving…" : others.length === 1 ? "Link both" : "Link all"}
          </Button>
          <Button onClick={onMove} loading={saving === "move"} disabled={busy}>
            {saving === "move" ? "Saving…" : `Move to ${name}`}
          </Button>
        </>
      }
    >
      <p>
        {others.map((o, i) => (
          <Fragment key={o.id}>
            {i > 0 && (i === others.length - 1 ? " and " : ", ")}
            <strong className="font-semibold">{userName(o)}</strong>
            {o.email && <span className="text-ink-muted"> ({o.email})</span>}
          </Fragment>
        ))}{" "}
        {others.length === 1 ? "is" : "are"} already linked to {person}.
      </p>
      <p className="rounded-control bg-table-head px-3 py-2 text-ink-heading">
        Logins linked to the same sales person open the same open quotes page, and their follow-ups count as {person}'s. Usually each sales
        person has one login.
      </p>
      <p>
        <strong className="font-semibold">Move to {name}</strong> removes the link from {others.length === 1 ? "the other login" : "the other logins"}.
      </p>
      {error && <Alert>{error}</Alert>}
    </Dialog>
  );
}
