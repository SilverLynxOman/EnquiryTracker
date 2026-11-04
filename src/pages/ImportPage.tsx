import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { WorkBook } from "xlsx";
import { useAuth } from "../auth/AuthProvider";
import { Alert, Button, Card, Empty, Spinner } from "../components/ui";
import { createImportBatch, fetchExistingByReferences, fetchImportBatches, runImportChunk, uploadImportFile } from "../lib/api";
import { buildAnalysis, type DiffItem, type ImportAnalysis } from "../lib/excel/diff";
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
  const [result, setResult] = useState<{ fileName: string; inserted: number; updated: number; unchanged: number; failed: number } | null>(null);

  async function onFile(f: File | null) {
    setFile(f);
    setWorkbook(null);
    setSheets([]);
    setSelected([]);
    setAnalysis(null);
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
      const existing = await fetchExistingByReferences([...new Set(parsed.rows.map((r) => r.reference))]);
      const next = buildAnalysis(parsed.rows, existing, parsed.skipped, chosen.map((s) => s.name));
      setAnalysis(next);
      setTab(next.items.some((i) => i.kind === "new") ? "new" : next.items.some((i) => i.kind === "changed") ? "changed" : "issues");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function commit() {
    if (!analysis || !file) return;
    const toSend = analysis.items.filter((i) => i.kind !== "unchanged");
    const unchanged = analysis.items.length - toSend.length;
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
      const warnings = [...analysis.invalid, ...analysis.items.map((i) => i.row)]
        .flatMap((r) => r.issues.map((issue) => ({ sheet: r.sheet, row: r.rowNumber, reference: r.reference, ...issue })))
        .slice(0, 1000);
      const batch = await createImportBatch({
        file_name: file.name,
        sheet_names: analysis.sheetNames,
        rows_in_file: analysis.rowsInFile,
        unchanged,
        skipped: analysis.skipped + analysis.invalid.length,
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
      setResult({ fileName: file.name, inserted, updated, unchanged, failed: 0 });
      setAnalysis(null);
    } catch (e) {
      // Each chunk is its own transaction: chunks before the failing one are saved.
      setError(`Import stopped after ${done} of ${toSend.length} rows: ${errorMessage(e)}. Re-running the import is safe — saved rows will show as unchanged.`);
      if (done) setResult({ fileName: file.name, inserted, updated, unchanged, failed: toSend.length - done });
    } finally {
      setBusy(null);
      queryClient.invalidateQueries({ queryKey: ["import-batches"] });
      queryClient.invalidateQueries({ queryKey: ["register"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      queryClient.invalidateQueries({ queryKey: ["names"] });
      queryClient.invalidateQueries({ queryKey: ["sales-persons"] });
    }
  }

  const counts = analysis && {
    new: analysis.items.filter((i) => i.kind === "new").length,
    changed: analysis.items.filter((i) => i.kind === "changed").length,
    unchanged: analysis.items.filter((i) => i.kind === "unchanged").length,
    errors: analysis.invalid.length,
    warnings: analysis.items.filter((i) => i.row.issues.length > 0).length,
  };

  return (
    <div className="space-y-4">
      <Card title="1. Choose the Excel file">
        <div className="space-y-3 text-sm text-slate-600">
          <p>
            Upload the <b>daily report</b> or the <b>monthly enquiries workbook</b>. The layout must match the register (header row with
            “MY REFERENCE”, columns A–S). Rows are matched on <b>MY REFERENCE</b>:
          </p>
          <ul className="list-inside list-disc space-y-0.5">
            <li>a new reference creates an enquiry; an existing one is updated with the values in the sheet;</li>
            <li>blank cells never erase values already saved (clear values in the app instead);</li>
            <li>rows with errors are listed and skipped; pre-numbered empty rows are ignored;</li>
            <li>nothing is saved until you press <b>Import</b>.</li>
          </ul>
          <input
            type="file"
            accept=".xlsx,.xlsm,.xls"
            disabled={!!busy}
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            className="block text-sm file:mr-3 file:rounded-md file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-indigo-700"
          />
        </div>
      </Card>

      {busy && <Spinner label={busy} />}
      {error && <Alert>{error}</Alert>}
      {result && (
        <Alert kind={result.failed ? "warning" : "success"}>
          <b>{result.fileName}</b>: {result.inserted} new, {result.updated} updated, {result.unchanged} unchanged
          {result.failed ? `, ${result.failed} not imported` : ""}.
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
                className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm ${selected.includes(s.name) ? "border-indigo-300 bg-indigo-50" : "border-slate-200"}`}
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
                <span className="text-xs text-slate-500">
                  {s.candidateRows} rows · {s.contextYear}
                </span>
              </label>
            ))}
          </div>
          {sheets.some((s) => !s.suggested) && (
            <p className="mt-2 text-xs text-slate-500">
              Summary sheets (DATA…) are not pre-selected: their rows repeat the month sheets.
            </p>
          )}
        </Card>
      )}

      {analysis && counts && (
        <Card
          title="3. Review and import"
          actions={
            <Button onClick={commit} disabled={!canEdit || !!busy || counts.new + counts.changed === 0}>
              Import {counts.new} new + {counts.changed} changed
            </Button>
          }
        >
          {!canEdit && <Alert kind="warning">You need the editor role to import.</Alert>}
          <div className="mb-3 flex flex-wrap gap-2 text-sm">
            <TabButton active={tab === "new"} onClick={() => setTab("new")} label="New" count={counts.new} tone="emerald" />
            <TabButton active={tab === "changed"} onClick={() => setTab("changed")} label="Changed" count={counts.changed} tone="amber" />
            <TabButton active={tab === "unchanged"} onClick={() => setTab("unchanged")} label="Unchanged" count={counts.unchanged} tone="slate" />
            <TabButton
              active={tab === "issues"}
              onClick={() => setTab("issues")}
              label="Errors / warnings"
              count={counts.errors + counts.warnings}
              tone={counts.errors ? "rose" : "slate"}
            />
            <span className="ml-auto self-center text-xs text-slate-500">
              {analysis.rowsInFile} rows read · {analysis.skipped} empty pre-numbered rows ignored
            </span>
          </div>
          {tab === "issues" ? (
            <IssuesTable invalid={analysis.invalid} warned={analysis.items.filter((i) => i.row.issues.length > 0).map((i) => i.row)} />
          ) : (
            <DiffTable items={analysis.items.filter((i) => i.kind === tab)} showChanges={tab === "changed"} />
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
              <thead className="text-left text-xs uppercase text-slate-500">
                <tr className="border-b border-slate-200">
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
                  <tr key={b.id} className="border-b border-slate-100">
                    <td className="whitespace-nowrap py-1.5 pr-3">{fmtDateTime(b.created_at)}</td>
                    <td className="pr-3">{b.file_name}</td>
                    <td className="pr-3 text-xs text-slate-500">{b.sheet_names.join(", ")}</td>
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
  emerald: "bg-emerald-100 text-emerald-800",
  amber: "bg-amber-100 text-amber-800",
  rose: "bg-rose-100 text-rose-800",
  slate: "bg-slate-100 text-slate-700",
} as const;

function TabButton({ active, onClick, label, count, tone }: { active: boolean; onClick: () => void; label: string; count: number; tone: keyof typeof TONES }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-md px-3 py-1.5 ${active ? "bg-white shadow ring-1 ring-slate-300" : "text-slate-600 hover:bg-slate-100"}`}
    >
      {label}
      <span className={`rounded-full px-2 text-xs font-semibold ${TONES[tone]}`}>{count}</span>
    </button>
  );
}

function DiffTable({ items, showChanges }: { items: DiffItem[]; showChanges: boolean }) {
  if (!items.length) return <Empty>Nothing in this list.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs">
        <thead className="bg-slate-50 text-left uppercase text-slate-500">
          <tr>
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
        <tbody className="divide-y divide-slate-100">
          {items.slice(0, MAX_ROWS_SHOWN).map(({ row, changes }) => (
            <tr key={row.reference} className="align-top">
              <td className="whitespace-nowrap px-2 py-1.5 text-slate-500">
                {row.sheet}!{row.rowNumber}
              </td>
              <td className="px-2 py-1.5 font-mono">{row.reference}</td>
              <td className="whitespace-nowrap px-2 py-1.5">{fmtDate(row.enquiry_date)}</td>
              <td className="px-2 py-1.5">{row.customer_name}</td>
              {showChanges ? (
                <td className="px-2 py-1.5">
                  {changes.map((c) => (
                    <div key={c.field}>
                      <span className="text-slate-500">{c.label}:</span> <span className="text-rose-700 line-through">{c.from}</span> →{" "}
                      <span className="text-emerald-700">{c.to}</span>
                    </div>
                  ))}
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
          ))}
        </tbody>
      </table>
      {items.length > MAX_ROWS_SHOWN && (
        <p className="mt-2 text-xs text-slate-500">
          Showing the first {MAX_ROWS_SHOWN} of {items.length}. All of them will be imported.
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
      <table className="min-w-full text-xs">
        <thead className="bg-slate-50 text-left uppercase text-slate-500">
          <tr>
            <th className="px-2 py-1.5">Sheet / row</th>
            <th className="px-2 py-1.5">Ref</th>
            <th className="px-2 py-1.5">Customer</th>
            <th className="px-2 py-1.5">Result</th>
            <th className="px-2 py-1.5">Details</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.slice(0, MAX_ROWS_SHOWN).map(({ r, excluded }) => (
            <tr key={`${r.sheet}-${r.rowNumber}-${r.reference}`} className="align-top">
              <td className="whitespace-nowrap px-2 py-1.5 text-slate-500">
                {r.sheet}!{r.rowNumber}
              </td>
              <td className="px-2 py-1.5 font-mono">{r.reference}</td>
              <td className="px-2 py-1.5">{r.customer_name}</td>
              <td className="whitespace-nowrap px-2 py-1.5">
                {excluded ? <span className="font-medium text-rose-700">Skipped</span> : <span className="text-amber-700">Imported</span>}
              </td>
              <td className="px-2 py-1.5">
                {r.issues.map((i, n) => (
                  <div key={n} className={i.level === "error" ? "text-rose-700" : "text-amber-800"}>
                    {i.message}
                  </div>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > MAX_ROWS_SHOWN && (
        <p className="mt-2 text-xs text-slate-500">
          Showing the first {MAX_ROWS_SHOWN} of {rows.length}.
        </p>
      )}
    </div>
  );
}
