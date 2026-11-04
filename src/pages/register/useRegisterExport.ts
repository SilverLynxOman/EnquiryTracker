import { useState } from "react";
import { useSearchParams } from "react-router";
import { STATUS_META } from "../../components/ui";
import { fetchRegisterAll } from "../../lib/api";
import { errorMessage, fmtDate, todayIso } from "../../lib/format";
import { readRegisterView, viewFilters } from "../../lib/registerView";

const TITLE: Record<string, string> = {
  enquiry_date: "JOB ENQUIRIES",
  quoted_date: "JOB ENQUIRIES QUOTED",
  confirmed_date: "JOB ENQUIRIES CONFIRMED",
};

/** Exports exactly what the register shows: its filters, status tab and sort order, every page. */
export function useRegisterExport() {
  const [params] = useSearchParams();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const view = readRegisterView(params);
      const today = todayIso();
      const f = viewFilters(view, today);
      const [rows, { exportRegister }] = await Promise.all([fetchRegisterAll(f, view.sort), import("../../lib/excel/exportRegister")]);
      if (!rows.length) {
        setError("Nothing to export: no enquiries match these filters.");
        return;
      }
      const range = f.from || f.to ? `${f.from ? fmtDate(f.from) : "START"} TO ${f.to ? fmtDate(f.to) : fmtDate(today)}` : "ALL DATES";
      const status = view.status ? ` (${STATUS_META[view.status].label.toUpperCase()})` : "";
      exportRegister(rows, `${TITLE[view.basis]} - ${range}${status}`, `Enquiries ${range.replace(/\./g, "-")}${status}.xlsx`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRunning(false);
    }
  }

  return { run, running, error, clearError: () => setError(null) };
}
