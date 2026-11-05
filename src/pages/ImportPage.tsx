import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import type { WorkBook } from "xlsx";
import { useAuth } from "../auth/AuthProvider";
import { Alert, Button, Card, Empty, Spinner, inputClass } from "../components/ui";
import { createImportBatch, fetchExistingByReferences, fetchImportBatches, fetchPortNameMap, runImportChunk, uploadImportFile } from "../lib/api";
import { buildAnalysis, type DiffItem, type ImportAnalysis } from "../lib/excel/diff";
import { standardPortName } from "../lib/ports";
import { listRegisterSheets, parseWorkbookSheets, readWorkbook, type ParsedRow, type SheetInfo } from "../lib/excel/register";
import { errorMessage, fmtDate, fmtDateTime, fmtMoney } from "../lib/format";

const CHUNK_SIZE = 250;
const MAX_ROWS_SHOWN = 500;

type Tab = "new" | "changed" | "unchanged" | "issues";

export default function ImportPage() {
  const { canEdit } = useAuth();
  const queryClient = useQueryClient();
  const batches = useQuery({ queryKey: ["import-batches"], queryFn: fetchImportBatches });

  const [file, setFile] = useState<File | null>(null);
  const [workbook, setWorkbook] = useState<WorkBook | null>(null);
  const [sheets, setSheets] = useState<SheetInfo[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [tab, setTab] = useState<Tab>("new");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ fileName: string; inserted: number; updated: number; unchanged: number; failed: number; leftOut: number } | null>(null);
  /** References the person unticked in the preview: not imported. */
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");

  async function onFile(f: File | null) {
    setFile(f);
    setWorkbook(null);
    setSheets([]);
    setSelected([]);
    setAnalysis(null);
    setExcluded(new Set());
    setFilter("");
    setError(null);
    setResult(null);
    if (!f) return;
    setBusy("Reading workbook…");
    try {
      const wb = readWorkbook(await f.arrayBuffer());
      const infos = listRegisterSheets(wb, f.name);
      setWorkbook(wb);
      setSheets(infos);
      setSelected(infos.filter((s) => s.suggested).map((s) => s.name));
      if (!infos.length) setError("No register sheets found. A register sheet has a header row containing “MY REFERENCE”.");
    } catch (e) {
      setError(`Could not read the file: ${errorMessage(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function analyse() {
    if (!workbook) return;
    setError(null);
    setResult(null);
    setBusy("Checking rows against the register…");
    try {
      const chosen = sheets.filter((s) => selected.includes(s.name));
      const parsed = parseWorkbookSheets(workbook, chosen);
      const [existing, portNames] = await Promise.all([
        fetchExistingByReferences([...new Set(parsed.rows.map((r) => r.reference))]),
        fetchPortNameMap(),
      ]);
      // Known port spellings become the standard name, as the database does on save, so they are not changes.
      const rows = parsed.rows.map((r) => ({ ...r, pol: standardPortName(portNames, r.pol), pod: standardPortName(portNames, r.pod) }));
      const next = buildAnalysis(rows, existing, parsed.skipped, chosen.map((s) => s.name));
      setAnalysis(next);
      setExcluded(new Set());
      setFilter("");
      setTab(next.items.some((i) => i.kind === "new") ? "new" : next.items.some((i) => i.kind === "changed") ? "changed" : "issues");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function commit() {
    if (!analysis || !file) return;
    const toSend = analysis.items.filter((i) => i.kind !== "unchanged" && !excluded.has(i.row.reference));
    const leftOut = analysis.items.filter((i) => i.kind !== "unchanged" && excluded.has(i.row.reference));
    const unchanged = analysis.items.filter((i) => i.kind === "unchanged").length;
    setError(null);
    setBusy(`Importing 0 of ${toSend.length}…`);
    let inserted = 0;
    let updated = 0;
    let done = 0;
    try {
      let storagePath: string | null = null;
      try {
        storagePath = await uploadImportFile(file);
      } catch {
        // Keeping a copy of the original file is a convenience; the import itself can proceed.
      }
      const warnings = [
        ...leftOut.map(({ row: r }) => ({ sheet: r.sheet, row: r.rowNumber, reference: r.reference, level: "warning", message: "Left out by the person importing" })),
        ...[...analysis.invalid, ...analysis.items.map((i) => i.row)].flatMap((r) =>
          r.issues.map((issue) => ({ sheet: r.sheet, row: r.rowNumber, reference: r.reference, ...issue })),
        ),
      ].slice(0, 1000);
      const batch = await createImportBatch({
        file_name: file.name,
        sheet_names: analysis.sheetNames,
        rows_in_file: analysis.rowsInFile,
        unchanged,
        skipped: analysis.skipped + analysis.invalid.length + leftOut.length,
        warnings,
        storage_path: storagePath,
      });
      for (let i = 0; i < toSend.length; i += CHUNK_SIZE) {
        const chunk = toSend.slice(i, i + CHUNK_SIZE);
        const res = await runImportChunk(batch.id, chunk.map((item) => item.payload));
        inserted += res.inserted;
        updated += res.updated;
        done += chunk.length;
        setBusy(`Importing ${done} of ${toSend.length}…`);
      }
      setResult({ fileName: file.name, inserted, updated, unchanged, failed: 0, leftOut: leftOut.length });
      setAnalysis(null);
    } catch (e) {
      // Each chunk is its own transaction: chunks before the failing one are saved.
      setError(`Import stopped after ${done} of ${toSend.length} rows: ${errorMessage(e)}. Re-running the import is safe — saved rows will show as unchanged.`);
      if (done) setResult({ fileName: file.name, inserted, updated, unchanged, failed: toSend.length - done, leftOut: leftOut.length });
    } finally {
      setBusy(null);
      queryClient.invalidateQueries({ queryKey: ["import-batches"] });
      queryClient.invalidateQueries({ queryKey: ["register"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      queryClient.invalidateQueries({ queryKey: ["plan"] });
      queryClient.invalidateQueries({ queryKey: ["voyage"] });
      queryClient.invalidateQueries({ queryKey: ["names"] });
      queryClient.invalidateQueries({ queryKey: ["sales-persons"] });
    }
  }

  const counts = analysis && {
    new: analysis.items.filter((i) => i.kind === "new").length,
    changed: analysis.items.filter((i) => i.kind === "changed").length,
    newIncluded: analysis.items.filter((i) => i.kind === "new" && !excluded.has(i.row.reference)).length,
    changedIncluded: analysis.items.filter((i) => i.kind === "changed" && !excluded.has(i.row.reference)).length,
    leftOut: analysis.items.filter((i) => i.kind !== "unchanged" && excluded.has(i.row.reference)).length,
    kept: analysis.items.reduce((n, i) => n + i.kept.length, 0),
    unchanged: analysis.items.filter((i) => i.kind === "unchanged").length,
    errors: analysis.invalid.length,
    warnings: analysis.items.filter((i) => i.row.issues.length > 0).length,
  };

  return (
    <div className="space-y-4">
      <Card title="1. Choose the Excel file">
        <div className="space-y-3 text-sm text-ink-muted">
          <p>
            Upload the <b>daily report</b> or the <b>monthly enquiries workbook</b>. The layout must match the register (header row with
            “MY REFERENCE”, columns A–S). Rows are matched on <b>MY REFERENCE</b>:
          </p>
          <ul className="list-inside list-disc space-y-0.5">
            <li>a new reference creates an enquiry; an existing one is updated with the values in the sheet;</li>
            <li>blank cells never erase values already saved (clear values in the app instead);</li>
            <li>values changed in the app are never overwritten, and enquiries created in the app are left alone;</li>
            <li>you can untick any new or changed row before importing;</li>
            <li>rows with errors are listed and skipped; pre-numbered empty rows are ignored;</li>
            <li>nothing is saved until you press <b>Import</b>.</li>
          </ul>
          <input
            type="file"
            accept=".xlsx,.xlsm,.xls"
            disabled={!!busy}
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            className="block text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-primary-hover"
          />
        </div>
      </Card>

      {busy && <Spinner label={busy} />}
      {error && <Alert>{error}</Alert>}
      {result && (
        <Alert kind={result.failed ? "warning" : "success"}>
          <b>{result.fileName}</b>: {result.inserted} new, {result.updated} updated, {result.unchanged} unchanged
          {result.failed ? `, ${result.failed} not imported` : ""}
          {result.leftOut ? `, ${result.leftOut} left out` : ""}.
        </Alert>
      )}

      {sheets.length > 0 && (
        <Card
          title="2. Select sheets"
          actions={
            <Button onClick={analyse} disabled={!selected.length || !!busy}>
              Analyse {selected.length} sheet{selected.length === 1 ? "" : "s"}
            </Button>
          }
        >
          <div className="flex flex-wrap gap-2">
            {sheets.map((s) => (
              <label
                key={s.name}
                className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm ${selected.includes(s.name) ? "border-primary/40 bg-selected" : "border-line"}`}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(s.name)}
                  onChange={(e) => {
                    setAnalysis(null);
                    setSelected((prev) => (e.target.checked ? [...prev, s.name] : prev.filter((n) => n !== s.name)));
                  }}
                />
                <span className="font-medium">{s.name}</span>
                <span className="text-meta text-ink-muted">
                  {s.candidateRows} rows · {s.contextYear}
                </span>
              </label>
            ))}
          </div>
          {sheets.some((s) => !s.suggested) && (
            <p className="mt-2 text-meta text-ink-muted">
              Summary sheets (DATA…) are not pre-selected: their rows repeat the month sheets.
            </p>
          )}
        </Card>
      )}

      {analysis && counts && (
        <Card
          title="3. Review and import"
          actions={
            <Button onClick={commit} disabled={!canEdit || !!busy || counts.newIncluded + counts.changedIncluded === 0}>
              Import {counts.newIncluded} new + {counts.changedIncluded} changed
            </Button>
          }
        >
          {!canEdit && <Alert kind="warning">You need the editor role to import.</Alert>}
          <div className="mb-3 flex flex-wrap gap-2 text-sm">
            <TabButton active={tab === "new"} onClick={() => setTab("new")} label="New" count={counts.new} tone="confirmed" />
            <TabButton active={tab === "changed"} onClick={() => setTab("changed")} label="Changed" count={counts.changed} tone="await" />
            <TabButton active={tab === "unchanged"} onClick={() => setTab("unchanged")} label="Unchanged" count={counts.unchanged} tone="neutral" />
            <TabButton
              active={tab === "issues"}
              onClick={() => setTab("issues")}
              label="Errors / warnings"
              count={counts.errors + counts.warnings}
              tone={counts.errors ? "lost" : "neutral"}
            />
            <span className="ml-auto self-center text-meta text-ink-muted">
              {analysis.rowsInFile} rows read · {analysis.skipped} empty pre-numbered rows ignored
            </span>
          </div>
          {counts.kept > 0 && (
            <div className="mb-3">
              <Alert kind="info">
                {counts.kept} value{counts.kept === 1 ? " differs" : "s differ"} from the sheet but {counts.kept === 1 ? "was" : "were"} changed in the app, so the app&rsquo;s{" "}
                {counts.kept === 1 ? "value is" : "values are"} kept. They are listed under the rows as <i>Kept</i>.
              </Alert>
            </div>
          )}
          {tab === "issues" ? (
            <IssuesTable invalid={analysis.invalid} warned={analysis.items.filter((i) => i.row.issues.length > 0).map((i) => i.row)} />
          ) : (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <label className="w-72 max-w-full">
                  <span className="sr-only">Find a row by reference or customer</span>
                  <input className={inputClass} type="search" placeholder="Find by reference or customer" value={filter} onChange={(e) => setFilter(e.target.value)} />
                </label>
                {tab !== "unchanged" && (
                  <span className="text-meta text-ink-muted">
                    Untick rows you do not want to import.{counts.leftOut ? ` ${counts.leftOut} left out.` : ""}
                  </span>
                )}
              </div>
              <DiffTable
                items={analysis.items.filter((i) => i.kind === tab && matches(i, filter))}
                showChanges={tab === "changed"}
                selectable={tab !== "unchanged"}
                excluded={excluded}
                onToggle={(refs, include) =>
                  setExcluded((prev) => {
                    const next = new Set(prev);
                    for (const r of refs) {
                      if (include) next.delete(r);
                      else next.add(r);
                    }
                    return next;
                  })
                }
              />
            </>
          )}
        </Card>
      )}

      <Card title="Recent imports">
        {batches.isLoading ? (
          <Spinner />
        ) : !batches.data?.length ? (
          <Empty>No imports yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-meta text-ink-heading font-medium">
                <tr className="border-b border-line">
                  <th className="py-1.5 pr-3">When</th>
                  <th className="pr-3">File</th>
                  <th className="pr-3">Sheets</th>
                  <th className="pr-3 text-right">New</th>
                  <th className="pr-3 text-right">Updated</th>
                  <th className="pr-3 text-right">Unchanged</th>
                  <th className="text-right">Skipped</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {batches.data.map((b) => (
                  <tr key={b.id} className="border-b border-line">
                    <td className="whitespace-nowrap py-1.5 pr-3">{fmtDateTime(b.created_at)}</td>
                    <td className="pr-3">{b.file_name}</td>
                    <td className="pr-3 text-meta text-ink-muted">{b.sheet_names.join(", ")}</td>
                    <td className="pr-3 text-right">{b.inserted}</td>
                    <td className="pr-3 text-right">{b.updated}</td>
                    <td className="pr-3 text-right">{b.unchanged}</td>
                    <td className="text-right">{b.skipped}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

const TONES = {
  confirmed: "bg-confirmed-bg text-confirmed",
  await: "bg-await-bg text-await",
  lost: "bg-lost-bg text-lost",
  neutral: "bg-table-head text-ink-heading",
} as const;

const matches = (item: DiffItem, filter: string) => {
  const q = filter.trim().toUpperCase();
  return !q || item.row.reference.includes(q) || item.row.customer_name.toUpperCase().includes(q);
};

function KeptList({ item }: { item: DiffItem }): ReactNode {
  if (!item.kept.length) return null;
  return item.kept.map((c) => (
    <div key={c.field} className="text-ink-muted">
      <span className="font-medium text-await">Kept</span> {c.label}: {c.from} (edited in the app; the sheet has {c.to})
    </div>
  ));
}

function TabButton({ active, onClick, label, count, tone }: { active: boolean; onClick: () => void; label: string; count: number; tone: keyof typeof TONES }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-md px-3 py-1.5 ${active ? "bg-white shadow ring-1 ring-control" : "text-ink-muted hover:bg-row-hover"}`}
    >
      {label}
      <span className={`rounded-full px-2 text-meta font-semibold ${TONES[tone]}`}>{count}</span>
    </button>
  );
}

function DiffTable({
  items,
  showChanges,
  selectable,
  excluded,
  onToggle,
}: {
  items: DiffItem[];
  showChanges: boolean;
  selectable: boolean;
  excluded: Set<string>;
  onToggle: (references: string[], include: boolean) => void;
}) {
  if (!items.length) return <Empty>Nothing in this list.</Empty>;
  const shown = items.slice(0, MAX_ROWS_SHOWN);
  const refs = items.map((i) => i.row.reference);
  const included = refs.filter((r) => !excluded.has(r)).length;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-meta">
        <thead className="bg-table-head text-left text-ink-heading font-medium">
          <tr>
            {selectable && (
              <th className="w-8 px-2 py-1.5">
                <input
                  type="checkbox"
                  aria-label={included === refs.length ? "Untick all rows in this list" : "Tick all rows in this list"}
                  checked={included === refs.length}
                  ref={(el) => {
                    if (el) el.indeterminate = included > 0 && included < refs.length;
                  }}
                  onChange={(e) => onToggle(refs, e.target.checked)}
                />
              </th>
            )}
            <th className="px-2 py-1.5">Sheet / row</th>
            <th className="px-2 py-1.5">Ref</th>
            <th className="px-2 py-1.5">Enquiry</th>
            <th className="px-2 py-1.5">Customer</th>
            {showChanges ? (
              <th className="px-2 py-1.5">Changes</th>
            ) : (
              <>
                <th className="px-2 py-1.5">Qty</th>
                <th className="px-2 py-1.5">Route</th>
                <th className="px-2 py-1.5">Confirmed</th>
                <th className="px-2 py-1.5 text-right">Sell</th>
                <th className="px-2 py-1.5">Sales</th>
              </>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {shown.map((item) => {
            const { row, changes } = item;
            const out = excluded.has(row.reference);
            return (
            <tr key={row.reference} className={`align-top ${out ? "bg-table-head text-ink-muted" : ""}`}>
              {selectable && (
                <td className="px-2 py-1.5">
                  <input
                    type="checkbox"
                    aria-label={`Import ${row.reference}`}
                    checked={!out}
                    onChange={(e) => onToggle([row.reference], e.target.checked)}
                  />
                </td>
              )}
              <td className="whitespace-nowrap px-2 py-1.5 text-ink-muted">
                {row.sheet}!{row.rowNumber}
              </td>
              <td className="px-2 py-1.5 font-semibold tabular-nums">{row.reference}</td>
              <td className="whitespace-nowrap px-2 py-1.5">{fmtDate(row.enquiry_date)}</td>
              <td className="px-2 py-1.5">
                {row.customer_name}
                {!showChanges && <KeptList item={item} />}
              </td>
              {showChanges ? (
                <td className="px-2 py-1.5">
                  {changes.map((c) => (
                    <div key={c.field}>
                      <span className="text-ink-muted">{c.label}:</span> <span className="text-lost line-through">{c.from}</span> →{" "}
                      <span className="text-confirmed">{c.to}</span>
                    </div>
                  ))}
                  <KeptList item={item} />
                  {out && <div className="font-medium">Left out: not imported</div>}
                </td>
              ) : (
                <>
                  <td className="px-2 py-1.5">
                    {row.trade_type} {row.qty_text}
                  </td>
                  <td className="px-2 py-1.5">
                    {row.pol} → {row.pod}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5">{fmtDate(row.confirmed_date)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtMoney(row.sell_total)}</td>
                  <td className="px-2 py-1.5">{row.sales_person_name}</td>
                </>
              )}
            </tr>
            );
          })}
        </tbody>
      </table>
      {items.length > MAX_ROWS_SHOWN && (
        <p className="mt-2 text-meta text-ink-muted">
          Showing the first {MAX_ROWS_SHOWN} of {items.length}. Find a row by reference or customer to untick it; every ticked row is imported.
        </p>
      )}
    </div>
  );
}

function IssuesTable({ invalid, warned }: { invalid: ParsedRow[]; warned: ParsedRow[] }) {
  const rows = [...invalid.map((r) => ({ r, excluded: true })), ...warned.map((r) => ({ r, excluded: false }))];
  if (!rows.length) return <Empty>No problems found.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-meta">
        <thead className="bg-table-head text-left text-ink-heading font-medium">
          <tr>
            <th className="px-2 py-1.5">Sheet / row</th>
            <th className="px-2 py-1.5">Ref</th>
            <th className="px-2 py-1.5">Customer</th>
            <th className="px-2 py-1.5">Result</th>
            <th className="px-2 py-1.5">Details</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.slice(0, MAX_ROWS_SHOWN).map(({ r, excluded }) => (
            <tr key={`${r.sheet}-${r.rowNumber}-${r.reference}`} className="align-top">
              <td className="whitespace-nowrap px-2 py-1.5 text-ink-muted">
                {r.sheet}!{r.rowNumber}
              </td>
              <td className="px-2 py-1.5 font-semibold tabular-nums">{r.reference}</td>
              <td className="px-2 py-1.5">{r.customer_name}</td>
              <td className="whitespace-nowrap px-2 py-1.5">
                {excluded ? <span className="font-medium text-lost">Skipped</span> : <span className="text-await">Imported</span>}
              </td>
              <td className="px-2 py-1.5">
                {r.issues.map((i, n) => (
                  <div key={n} className={i.level === "error" ? "text-lost" : "text-await"}>
                    {i.message}
                  </div>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > MAX_ROWS_SHOWN && (
        <p className="mt-2 text-meta text-ink-muted">
          Showing the first {MAX_ROWS_SHOWN} of {rows.length}.
        </p>
      )}
    </div>
  );
}
