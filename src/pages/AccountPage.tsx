import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthProvider";
import { Alert, Button, Card, Field, inputClass } from "../components/ui";
import { supabase } from "../lib/supabase";

export default function AccountPage() {
  const { session, profile } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setMessage({ kind: "error", text: "Use at least 8 characters." });
    if (password !== confirm) return setMessage({ kind: "error", text: "The two passwords do not match." });
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) setMessage({ kind: "error", text: error.message });
    else {
      setMessage({ kind: "success", text: "Password updated." });
      setPassword("");
      setConfirm("");
    }
  }

  return (
    <div className="grid max-w-3xl gap-4 md:grid-cols-2">
      <Card title="Your account">
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-xs text-slate-500">Name</dt>
            <dd>{profile?.full_name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">E-mail</dt>
            <dd>{session?.user.email}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Role</dt>
            <dd className="capitalize">{profile?.role ?? "—"}</dd>
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
