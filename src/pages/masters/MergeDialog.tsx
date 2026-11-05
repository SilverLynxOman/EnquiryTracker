import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Dialog } from "../../components/Dialog";
import { Alert, Button, Field, inputClass } from "../../components/ui";
import { keepOrder } from "../../lib/customerDuplicates";
import { displayName } from "../../lib/display";
import { errorMessage } from "../../lib/format";
import type { MasterSummary, MergeResult } from "../../lib/types";
import type { MasterKind } from "./kinds";

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** Merge two or more rows of one list into one of them. Admins only (the server checks too). */
export function MergeDialog({
  kind,
  rows,
  onClose,
  onMerged,
}: {
  kind: MasterKind;
  rows: MasterSummary[];
  onClose: () => void;
  onMerged: (result: MergeResult) => void;
}) {
  const queryClient = useQueryClient();
  const ordered = [...rows].sort(keepOrder);
  const [keepId, setKeepId] = useState(ordered[0].id);
  const keep = ordered.find((c) => c.id === keepId) ?? ordered[0];
  const [name, setName] = useState(keep.name);
  const others = ordered.filter((c) => c.id !== keep.id);
  // Port names are text on each enquiry: a new standard spelling changes the kept spelling's enquiries too.
  const respelled = kind.key === "ports" && name.trim().replace(/\s+/g, " ").toUpperCase() !== keep.name;
  const moving = (respelled ? ordered : others).reduce((n, c) => n + c.enquiries, 0);
  const contacts = others.reduce((n, c) => n + (c.contacts ?? 0), 0);

  const merge = useMutation({
    mutationFn: () => kind.merge(keep, others, name.trim().toUpperCase() === keep.name ? null : name),
    onSuccess: (result) => {
      // Names appear everywhere: register, reports, pickers.
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
      title={`Merge ${rows.length} ${kind.nouns}`}
      onClose={onClose}
      onSubmit={() => merge.mutate()}
      busy={merge.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={merge.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={merge.isPending} disabled={!name.trim()}>
            {merge.isPending ? "Merging…" : `Merge into one ${kind.noun}`}
          </Button>
        </>
      }
    >
      <fieldset>
        <legend className="mb-1.5 text-meta font-medium text-ink-heading">{kind.keepLabel}</legend>
        <div className="divide-y divide-line rounded-control border border-line">
          {ordered.map((c) => (
            <label key={c.id} className={`flex cursor-pointer items-start gap-3 px-3 py-2 ${c.id === keep.id ? "bg-selected" : "hover:bg-row-hover"}`}>
              <input type="radio" name="keep" className="mt-0.5 size-4 accent-primary" checked={c.id === keep.id} onChange={() => choose(c.id)} />
              <span className="min-w-0 flex-1">
                <span className="block font-medium" title={c.name}>
                  {displayName(c.name)}
                </span>
                <span className="block text-meta text-ink-muted">
                  {plural(c.enquiries, "enquiry", "enquiries")}
                  {!!c.contacts && ` · ${plural(c.contacts, "contact")}`}
                  {c.aliases.length > 0 && ` · ${plural(c.aliases.length, kind.formerNoun)}`}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <Field label={kind.nameLabel} hint="Stored in capitals, like the rest of the register.">
        <input className={`${inputClass} uppercase`} value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>

      <div className="rounded-control bg-table-head px-3 py-2 text-ink-heading">
        <p>
          {plural(moving, "enquiry", "enquiries")}
          {contacts > 0 && ` and ${plural(contacts, "contact")}`} {kind.key === "ports" ? "change to" : "move to"}{" "}
          <strong className="font-semibold text-ink">{displayName(name) || `the kept ${kind.noun}`}</strong>.
        </p>
        <p className="mt-1">
          {kind.mergeNote(others.length)} This cannot be undone from the app.
        </p>
      </div>

      {merge.error && <Alert>Merge failed. {errorMessage(merge.error)}</Alert>}
    </Dialog>
  );
}
