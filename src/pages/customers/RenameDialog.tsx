import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Dialog } from "../../components/Dialog";
import { Alert, Button, Field, inputClass } from "../../components/ui";
import { renameCustomer } from "../../lib/api";
import { displayName } from "../../lib/display";
import { errorMessage } from "../../lib/format";
import type { CustomerSummary } from "../../lib/types";

export function RenameDialog({
  customer,
  onClose,
  onRenamed,
}: {
  customer: CustomerSummary;
  onClose: () => void;
  onRenamed: (name: string) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(customer.name);
  const rename = useMutation({
    mutationFn: () => renameCustomer(customer.id, name),
    onSuccess: () => {
      void queryClient.invalidateQueries();
      onRenamed(name.trim().toUpperCase());
    },
  });
  const unchanged = name.trim().toUpperCase() === customer.name;

  return (
    <Dialog
      title="Rename customer"
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
      <Field label="Customer name" hint={`Now: ${displayName(customer.name)}. The current name is remembered, so imports and e-mails that use it still find this customer.`}>
        <input className={`${inputClass} uppercase`} value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </Field>
      {rename.error && <Alert>{errorMessage(rename.error)}</Alert>}
    </Dialog>
  );
}
