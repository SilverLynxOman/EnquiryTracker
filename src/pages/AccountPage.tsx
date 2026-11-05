import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthProvider";
import { Alert, Button, Card, Field, inputClass } from "../components/ui";
import { supabase } from "../lib/supabase";
import { ROLE_META } from "../lib/users";

export default function AccountPage() {
  const { session, profile, mustSetPassword, passwordSet } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setMessage({ kind: "error", text: "Use at least 8 characters." });
    if (password !== confirm) return setMessage({ kind: "error", text: "The two passwords do not match." });
    setBusy(true);
    // Also clears the "temporary password" mark the owner's reset leaves (null removes the key).
    const { error } = await supabase.auth.updateUser({ password, data: { must_change_password: null } });
    setBusy(false);
    if (error) setMessage({ kind: "error", text: error.message });
    else {
      setMessage({ kind: "success", text: "Password saved. Use it with your e-mail address to sign in from now on." });
      passwordSet();
      setPassword("");
      setConfirm("");
    }
  }

  return (
    <div className="grid max-w-3xl gap-4 md:grid-cols-2">
      {mustSetPassword && (
        <div className="md:col-span-2">
          <Alert kind="warning">
            {session?.user.user_metadata?.must_change_password
              ? "Choose your own password now. You signed in with a temporary password from the owner."
              : "Choose a password now. You are signed in from an e-mail link, and you will need this password to sign in next time."}
          </Alert>
        </div>
      )}
      <Card title="Your account">
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-meta text-ink-muted">Name</dt>
            <dd>{profile?.full_name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-meta text-ink-muted">E-mail</dt>
            <dd>{session?.user.email}</dd>
          </div>
          <div>
            <dt className="text-meta text-ink-muted">Role</dt>
            <dd>{profile ? ROLE_META[profile.role].label : "—"}</dd>
          </div>
        </dl>
      </Card>
      <Card title="Set a new password">
        <form onSubmit={changePassword} className="space-y-3">
          {message && <Alert kind={message.kind}>{message.text}</Alert>}
          <Field label="New password">
            <input className={inputClass} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="Repeat new password">
            <input className={inputClass} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save password"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
