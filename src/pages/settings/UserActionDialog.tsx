import { useMutation } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Dialog } from "../../components/Dialog";
import { Alert, Button, Field, inputClass } from "../../components/ui";
import { type LinkDelivery, updateUser, userAdmin, type UserAdminResult } from "../../lib/api";
import { errorMessage } from "../../lib/format";
import type { UserAccount } from "../../lib/types";
import { generatePassword, userName } from "../../lib/users";
import { LinkBox } from "./LinkBox";

/** What the owner can do to one login from its row menu. */
export type UserAction = "rename" | "resend_invite" | "reset_password" | "set_password" | "access_off" | "access_on" | "make_owner";

/** E-mail the link from Supabase, or show it to send yourself (Supabase's own mailer is limited). */
export function DeliveryChoice({ value, onChange, what }: { value: LinkDelivery; onChange: (v: LinkDelivery) => void; what: string }) {
  const option = (v: LinkDelivery, label: string, hint: string) => (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-control px-1 py-1.5 hover:bg-row-hover">
      <input type="radio" name="delivery" className="mt-0.5 size-4 accent-primary" checked={value === v} onChange={() => onChange(v)} />
      <span>
        <span className="block font-medium">{label}</span>
        <span className="block text-meta text-ink-muted">{hint}</span>
      </span>
    </label>
  );
  return (
    <fieldset>
      <legend className="mb-1 text-meta font-medium text-ink-heading">How should they get the {what}?</legend>
      {option("link", "Show me a link", "Copy it into WhatsApp or an e-mail yourself. Always works.")}
      {option("email", "E-mail it from Supabase", "Needs Supabase e-mail set up (SMTP); its built-in mailer sends only a few an hour.")}
    </fieldset>
  );
}

const TITLES: Record<UserAction, (name: string) => string> = {
  rename: (n) => `Change ${n}'s name`,
  resend_invite: (n) => `Invite ${n} again`,
  reset_password: (n) => `Reset ${n}'s password`,
  set_password: (n) => `Temporary password for ${n}`,
  access_off: (n) => `Turn off ${n}'s access`,
  access_on: (n) => `Turn ${n}'s access back on`,
  make_owner: (n) => `Make ${n} an owner`,
};

/** One action on one login, confirmed in a dialog. A link or password to pass on is shown before it closes. */
export function UserActionDialog({
  action,
  user,
  onClose,
  onDone,
}: {
  action: UserAction;
  user: UserAccount;
  onClose: () => void;
  /** Saved: the notice to show. The page reads the list again. */
  onDone: (message: string) => void;
}) {
  const name = userName(user);
  const [delivery, setDelivery] = useState<LinkDelivery>("link");
  const [fullName, setFullName] = useState(user.full_name ?? "");
  const [password, setPassword] = useState(generatePassword);
  /** The link or password to pass on, once the action has been carried out. */
  const [handOver, setHandOver] = useState<{ result: UserAdminResult; value: string } | null>(null);

  const run = useMutation({
    mutationFn: async (): Promise<UserAdminResult> => {
      switch (action) {
        case "rename":
          await updateUser(user.id, { full_name: fullName.trim().replace(/\s+/g, " ") });
          return { message: `Name changed to ${fullName.trim()}.` };
        case "make_owner":
          await updateUser(user.id, { role: "owner" });
          return { message: `${name} is now an owner.` };
        case "resend_invite":
        case "reset_password":
          return userAdmin({ action, userId: user.id, delivery });
        case "set_password":
          return userAdmin({ action, userId: user.id, password });
        case "access_off":
        case "access_on":
          return userAdmin({ action: "set_access", userId: user.id, enabled: action === "access_on" });
      }
    },
    onSuccess: (result) => {
      if (result.link) setHandOver({ result, value: result.link });
      else if (action === "set_password") setHandOver({ result, value: password });
      else onDone(result.message);
    },
  });

  if (handOver) {
    const what = action === "set_password" ? "temporary password" : action === "resend_invite" ? "invitation link" : "password reset link";
    const message =
      action === "set_password"
        ? `Your temporary password for the Silver Lynx Enquiry Tracker is ${handOver.value} — sign in with ${user.email} at ${window.location.origin} and choose your own.`
        : action === "resend_invite"
          ? `You're invited to the Silver Lynx Enquiry Tracker. Open this link to choose your password: ${handOver.value}`
          : `Open this link to choose a new password for the Silver Lynx Enquiry Tracker: ${handOver.value}`;
    return (
      <Dialog
        title={TITLES[action](name)}
        onClose={() => onDone(handOver.result.message)}
        footer={<Button onClick={() => onDone(handOver.result.message)}>Done</Button>}
      >
        <Alert kind="success">{handOver.result.message}</Alert>
        <LinkBox value={handOver.value} what={what} person={name} message={message} />
        <p className="text-meta text-ink-muted">
          {action === "set_password"
            ? "It is not shown again. They are asked to choose their own password when they sign in."
            : "The link works once and expires after an hour (Supabase's default), so send it now."}
        </p>
      </Dialog>
    );
  }

  const danger = action === "access_off";
  const submitLabel: Record<UserAction, string> = {
    rename: "Save name",
    resend_invite: delivery === "link" ? "Make a new link" : "Send the invitation",
    reset_password: delivery === "link" ? "Make a reset link" : "Send the reset e-mail",
    set_password: "Set this password",
    access_off: "Turn access off",
    access_on: "Turn access on",
    make_owner: "Make owner",
  };

  let body: ReactNode;
  switch (action) {
    case "rename":
      body = (
        <Field label="Name" hint="As it appears in the app, e.g. on follow-ups and the team voyage.">
          <input className={inputClass} value={fullName} onChange={(e) => setFullName(e.target.value)} required autoFocus />
        </Field>
      );
      break;
    case "resend_invite":
      body = (
        <>
          <p>
            {name} ({user.email}) has not accepted the invitation yet. A new link replaces the old one.
          </p>
          <DeliveryChoice value={delivery} onChange={setDelivery} what="invitation" />
        </>
      );
      break;
    case "reset_password":
      body = (
        <>
          <p>
            {name} ({user.email}) gets a link to choose a new password. Their current password keeps working until they do.
          </p>
          <DeliveryChoice value={delivery} onChange={setDelivery} what="reset link" />
        </>
      );
      break;
    case "set_password":
      body = (
        <>
          <p>
            Sets a password for {name} straight away, to give them yourself. They are asked to choose their own when they sign in. Their current
            password stops working.
          </p>
          <Field label="Temporary password" hint="At least 8 characters.">
            <div className="flex gap-2">
              <input
                className={`${inputClass} min-w-0 flex-1 font-mono`}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
                autoComplete="off"
                spellCheck={false}
              />
              <Button variant="secondary" onClick={() => setPassword(generatePassword())}>
                New one
              </Button>
            </div>
          </Field>
        </>
      );
      break;
    case "access_off":
      body = (
        <>
          <p>
            {name} is signed out of the app at once and cannot sign in again until you turn access back on. Their enquiries, follow-ups and
            history stay as they are.
          </p>
          <p className="rounded-control bg-table-head px-3 py-2 text-ink-heading">Use this when someone leaves, or for a login that should not be used.</p>
        </>
      );
      break;
    case "access_on":
      body = <p>{name} can sign in again with their e-mail address and password, with the role and sales person shown in the table.</p>;
      break;
    case "make_owner":
      body = (
        <>
          <p>
            Owners manage every login in Settings, including yours: they can invite people, change roles, reset passwords and turn access off.
          </p>
          <p className="rounded-control bg-table-head px-3 py-2 text-ink-heading">
            To hand over, make {name} an owner, then change your own role or ask {name} to.
          </p>
        </>
      );
      break;
  }

  return (
    <Dialog
      title={TITLES[action](name)}
      onClose={onClose}
      onSubmit={() => run.mutate()}
      busy={run.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={run.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant={danger ? "danger" : "primary"}
            loading={run.isPending}
            disabled={(action === "rename" && !fullName.trim()) || (action === "set_password" && password.trim().length < 8)}
          >
            {submitLabel[action]}
          </Button>
        </>
      }
    >
      {body}
      {run.error && <Alert>{errorMessage(run.error)}</Alert>}
    </Dialog>
  );
}
