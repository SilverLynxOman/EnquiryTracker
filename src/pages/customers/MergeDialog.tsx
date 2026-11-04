import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Dialog } from "../../components/Dialog";
import { Alert, Button, Field, inputClass } from "../../components/ui";
import { mergeCustomers } from "../../lib/api";
import { keepOrder } from "../../lib/customerDuplicates";
import { displayName } from "../../lib/display";
import { errorMessage } from "../../lib/format";
import type { CustomerSummary, MergeResult } from "../../lib/types";

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** Merge two or more customers into one of them. Admins only (the server checks too). */
export function MergeDialog({
  customers,
  onClose,
  onMerged,
}: {
  customers: CustomerSummary[];
  onClose: () => void;
  onMerged: (result: MergeResult) => void;
}) {
  const queryClient = useQueryClient();
  const ordered = [...customers].sort(keepOrder);
  const [keepId, setKeepId] = useState(ordered[0].id);
  const keep = ordered.find((c) => c.id === keepId) ?? ordered[0];
  const [name, setName] = useState(keep.name);
  const others = ordered.filter((c) => c.id !== keep.id);
  const moving = others.reduce((n, c) => n + c.enquiries, 0);
  const contacts = others.reduce((n, c) => n + c.contacts, 0);

  const merge = useMutation({
    mutationFn: () => mergeCustomers(keep.id, others.map((c) => c.id), name.trim() === keep.name ? null : name),
    onSuccess: (result) => {
      // Customer names appear everywhere: register, reports, pickers.
      void queryClient.invalidateQueries();
      onMerged(result);
    },
  });

  const choose = (id: string) => {
    setKeepId(id);
    setName(ordered.find((c) => c.id === id)?.name ?? "");
  };

  return (
    <Dialog
      title={`Merge ${customers.length} customers`}
      onClose={onClose}
      onSubmit={() => merge.mutate()}
      busy={merge.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={merge.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={merge.isPending} disabled={!name.trim()}>
            {merge.isPending ? "Merging…" : `Merge into one customer`}
          </Button>
        </>
      }
    >
      <fieldset>
        <legend className="mb-1.5 text-meta font-medium text-ink-heading">Customer to keep</legend>
        <div className="divide-y divide-line rounded-control border border-line">
          {ordered.map((c) => (
            <label key={c.id} className={`flex cursor-pointer items-start gap-3 px-3 py-2 ${c.id === keep.id ? "bg-selected" : "hover:bg-row-hover"}`}>
              <input
                type="radio"
                name="keep"
                className="mt-0.5 size-4 accent-primary"
                checked={c.id === keep.id}
                onChange={() => choose(c.id)}
              />
              <span className="min-w-0 flex-1">
                <span className="block font-medium" title={c.name}>
                  {displayName(c.name)}
                </span>
                <span className="block text-meta text-ink-muted">
                  {plural(c.enquiries, "enquiry", "enquiries")}
                  {c.contacts > 0 && ` · ${plural(c.contacts, "contact")}`}
                  {c.aliases.length > 0 && ` · ${plural(c.aliases.length, "former name")}`}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <Field label="Name after the merge" hint="Stored as typed, in capitals like the other customers.">
        <input className={`${inputClass} uppercase`} value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>

      <div className="rounded-control bg-table-head px-3 py-2 text-ink-heading">
        <p>
          {plural(moving, "enquiry", "enquiries")}
          {contacts > 0 && ` and ${plural(contacts, "contact")}`} move to <strong className="font-semibold text-ink">{displayName(name) || "the kept customer"}</strong>.{" "}
          {others.length === 1 ? "The other customer is" : `The other ${others.length} customers are`} then deleted.
        </p>
        <p className="mt-1">
          Their names are remembered as former names, so Excel imports and e-mails that still use them go to the kept customer.
          This cannot be undone from the app.
        </p>
      </div>

      {merge.error && <Alert>Merge failed. {errorMessage(merge.error)}</Alert>}
    </Dialog>
  );
}
