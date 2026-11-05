import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Dialog } from "../../components/Dialog";
import { Alert, Button, Field, inputClass } from "../../components/ui";
import { type LinkDelivery, userAdmin, type UserAdminResult } from "../../lib/api";
import { displayName } from "../../lib/display";
import { errorMessage } from "../../lib/format";
import type { NamedRef, Role, UserAccount } from "../../lib/types";
import { INVITE_ROLES, joinNames, linkedTo, ROLE_META, userName } from "../../lib/users";
import { LinkBox } from "./LinkBox";
import { DeliveryChoice } from "./UserActionDialog";

/** Invite someone: their e-mail address, name, role and sales person; the link is e-mailed or shown to send. */
export function InviteDialog({
  users,
  salesPersons,
  onClose,
  onDone,
}: {
  users: UserAccount[];
  salesPersons: NamedRef[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [salesPersonId, setSalesPersonId] = useState("");
  const [delivery, setDelivery] = useState<LinkDelivery>("link");
  const [sent, setSent] = useState<UserAdminResult | null>(null);

  const address = email.trim().toLowerCase();
  const existing = users.find((u) => u.email?.toLowerCase() === address);
  const taken = salesPersonId ? linkedTo(users, salesPersonId, "").map(userName) : [];
  const person = salesPersons.find((p) => p.id === salesPersonId);
  const ownOnly = !!salesPersonId && (role === "editor" || role === "viewer");

  const invite = useMutation({
    mutationFn: () => userAdmin({ action: "invite", email: address, fullName, role, salesPersonId: salesPersonId || null, delivery }),
    onSuccess: (result) => (result.link ? setSent(result) : onDone(result.message)),
  });

  const who = fullName.trim() || address;
  if (sent?.link) {
    return (
      <Dialog title={`Invite ${who}`} onClose={() => onDone(sent.message)} footer={<Button onClick={() => onDone(sent.message)}>Done</Button>}>
        <Alert kind="success">{sent.message} They appear in the table as invited until they open it.</Alert>
        <LinkBox
          value={sent.link}
          what="invitation link"
          person={who}
          message={`You're invited to the Silver Lynx Enquiry Tracker. Open this link to choose your password: ${sent.link}`}
        />
        <p className="text-meta text-ink-muted">
          The link works once and expires after an hour (Supabase's default). If it runs out, use “Invite again” in their row menu.
        </p>
      </Dialog>
    );
  }

  return (
    <Dialog
      title="Invite someone"
      onClose={onClose}
      onSubmit={() => invite.mutate()}
      busy={invite.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={invite.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={invite.isPending} disabled={!address || !!existing}>
            {invite.isPending ? "Inviting…" : delivery === "link" ? "Make the invitation link" : "Send the invitation"}
          </Button>
        </>
      }
    >
      <Field label="E-mail address" hint={existing ? undefined : "Their work address: they sign in with it."}>
        <input
          className={inputClass}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
          autoComplete="off"
          aria-invalid={!!existing || undefined}
        />
      </Field>
      {existing && (
        <Alert kind="warning">
          {userName(existing)} already has a login with this address. Use their row menu to invite them again or reset their password.
        </Alert>
      )}
      <Field label="Name" hint="As it should appear in the app.">
        <input className={inputClass} value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="off" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Role">
          <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {INVITE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_META[r].label}: {ROLE_META[r].can}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Sales person">
          <select className={inputClass} value={salesPersonId} onChange={(e) => setSalesPersonId(e.target.value)}>
            <option value="">Not linked (pricing, management)</option>
            {salesPersons.map((p) => (
              <option key={p.id} value={p.id}>
                {displayName(p.name)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {(ownOnly || taken.length > 0) && (
        <p className="rounded-control bg-table-head px-3 py-2 text-ink-heading">
          {ownOnly && `As ${ROLE_META[role].article} ${ROLE_META[role].label.toLowerCase()} linked to ${displayName(person?.name)}, they see only ${displayName(person?.name)}'s enquiries. `}
          {taken.length > 0 && `${joinNames(taken)} ${taken.length === 1 ? "is" : "are"} already linked to ${displayName(person?.name)}; both logins will be.`}
        </p>
      )}
      <DeliveryChoice value={delivery} onChange={setDelivery} what="invitation" />
      {invite.error && <Alert>{errorMessage(invite.error)}</Alert>}
    </Dialog>
  );
}
