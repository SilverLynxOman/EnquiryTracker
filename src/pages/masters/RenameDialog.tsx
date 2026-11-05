import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Dialog } from "../../components/Dialog";
import { Alert, Button, Field, inputClass } from "../../components/ui";
import { displayName } from "../../lib/display";
import { errorMessage } from "../../lib/format";
import type { MasterSummary } from "../../lib/types";
import type { MasterKind } from "./kinds";

export function RenameDialog({
  kind,
  row,
  onClose,
  onRenamed,
}: {
  kind: MasterKind;
  row: MasterSummary;
  onClose: () => void;
  onRenamed: (name: string) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(row.name);
  const rename = useMutation({
    mutationFn: () => kind.rename(row, name),
    onSuccess: () => {
      void queryClient.invalidateQueries();
      onRenamed(name.trim().toUpperCase());
    },
  });
  const unchanged = name.trim().toUpperCase() === row.name;

  return (
    <Dialog
      title={`Rename ${kind.noun}`}
      onClose={onClose}
      onSubmit={() => (unchanged ? onClose() : rename.mutate())}
      busy={rename.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={rename.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={rename.isPending} disabled={!name.trim()}>
            {rename.isPending ? "Saving…" : "Save name"}
          </Button>
        </>
      }
    >
      <Field label={`${kind.column} name`} hint={`Now: ${displayName(row.name)}. ${kind.renameHint}`}>
        <input className={`${inputClass} uppercase`} value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </Field>
      {rename.error && <Alert>{errorMessage(rename.error)}</Alert>}
    </Dialog>
  );
}
