import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { Alert, Button, Card, Empty, Field, Spinner, StatusBadge, inputClass } from "../components/ui";
import { fetchRegisterAll, fetchSalesPersons, markQuoted, queryRegister, type DateBasis, type RegisterFilters } from "../lib/api";
import { errorMessage, firstOfMonth, fmtDate, fmtMoney, todayIso } from "../lib/format";
import { MODE_LABELS, SHIPMENT_MODES, STATUSES, type EnquiryRow, type ShipmentMode, type Status } from "../lib/types";

const PAGE_SIZE = 100;

const BASIS_LABELS: Record<DateBasis, string> = {
  enquiry_date: "Enquiry date",
  quoted_date: "Quoted date",
  confirmed_date: "Confirmation date",
};

function readFilters(p: URLSearchParams): RegisterFilters {
  return {
    basis: (p.get("basis") as DateBasis | null) ?? "enquiry_date",
    from: p.has("from") ? (p.get("from") ?? "") : firstOfMonth(todayIso()),
    to: p.get("to") ?? "",
    status: (p.get("status") as Status | null) ?? "",
    salesPersonId: p.get("sp") ?? "",
    mode: (p.get("mode") as ShipmentMode | null) ?? "",
    q: p.get("q") ?? "",
  };
}

function writeFilters(f: RegisterFilters, page = 0): URLSearchParams {
  const p = new URLSearchParams();
  p.set("basis", f.basis);
  p.set("from", f.from);
  p.set("to", f.to);
  if (f.status) p.set("status", f.status);
  if (f.salesPersonId) p.set("sp", f.salesPersonId);
  if (f.mode) p.set("mode", f.mode);
  if (f.q) p.set("q", f.q);
  if (page) p.set("page", String(page));
  return p;
}

export default function RegisterPage() {
  const [params, setParams] = useSearchParams();
  const filters = readFilters(params);
  const page = Math.max(0, Number(params.get("page") ?? "0") || 0);
  const { canEdit } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState(filters.q);
  const [exporting, setExporting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const salesPersons = useQuery({ queryKey: ["sales-persons"], queryFn: fetchSalesPersons, staleTime: 300_000 });
  const register = useQuery({
    queryKey: ["register", filters, page],
    queryFn: () => queryRegister(filters, page, PAGE_SIZE),
    placeholderData: keepPreviousData,
  });

  const quote = useMutation({
    mutationFn: (row: EnquiryRow) => markQuoted(row.id, todayIso()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["register"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => setActionError(errorMessage(e)),
  });

  const update = (patch: Partial<RegisterFilters>) => setParams(writeFilters({ ...filters, ...patch }), { replace: true });
  const goToPage = (n: number) => setParams(writeFilters(filters, n), { replace: true });

  function submitSearch(e: FormEvent) {
    e.preventDefault();
    update({ q: search.trim() });
  }

  async function doExport() {
    setExporting(true);
    setActionError(null);
    try {
      const [rows, { exportRegister }] = await Promise.all([fetchRegisterAll(filters), import("../lib/excel/exportRegister")]);
      const range = `${filters.from ? fmtDate(filters.from) : "START"} TO ${filters.to ? fmtDate(filters.to) : fmtDate(todayIso())}`;
      exportRegister(rows, `JOB ENQUIRIES - ${range}`, `Enquiries ${range.replace(/\./g, "-")}.xlsx`);
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setExporting(false);
    }
  }

  const total = register.data?.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <Card
        title="Enquiry register"
        actions={
          <>
            <Button variant="secondary" onClick={doExport} disabled={exporting || !total}>
              {exporting ? "Exporting…" : "Export to Excel"}
            </Button>
            {canEdit && <Button onClick={() => navigate("/enquiries/new")}>New enquiry</Button>}
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
          <Field label="Date type">
            <select className={inputClass} value={filters.basis} onChange={(e) => update({ basis: e.target.value as DateBasis })}>
              {Object.entries(BASIS_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="From">
            <input type="date" className={inputClass} value={filters.from} onChange={(e) => update({ from: e.target.value })} />
          </Field>
          <Field label="To">
            <input type="date" className={inputClass} value={filters.to} onChange={(e) => update({ to: e.target.value })} />
          </Field>
          <Field label="Status">
            <select className={inputClass} value={filters.status} onChange={(e) => update({ status: e.target.value as Status | "" })}>
              <option value="">All</option>
              {STATUSES.map((s) => (
                <option key={s} value={s} className="capitalize">
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Sales person">
            <select className={inputClass} value={filters.salesPersonId} onChange={(e) => update({ salesPersonId: e.target.value })}>
              <option value="">All</option>
              {salesPersons.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Shipment">
            <select className={inputClass} value={filters.mode} onChange={(e) => update({ mode: e.target.value as ShipmentMode | "" })}>
              <option value="">All</option>
              {SHIPMENT_MODES.map((m) => (
                <option key={m} value={m}>
                  {MODE_LABELS[m]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Search">
            <form onSubmit={submitSearch}>
              <input
                className={inputClass}
                placeholder="Ref, customer, port, agent…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onBlur={() => search.trim() !== filters.q && update({ q: search.trim() })}
              />
            </form>
          </Field>
        </div>
      </Card>

      {(register.error || actionError) && <Alert>{actionError ?? errorMessage(register.error)}</Alert>}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2 text-sm text-slate-600">
          <span>
            {total.toLocaleString()} enquir{total === 1 ? "y" : "ies"}
            {register.isFetching && <span className="ml-2 text-xs text-slate-400">refreshing…</span>}
          </span>
          <span className="flex items-center gap-2">
            <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => goToPage(page - 1)}>
              ‹ Prev
            </Button>
            Page {page + 1} of {pages}
            <Button variant="ghost" size="sm" disabled={page + 1 >= pages} onClick={() => goToPage(page + 1)}>
              Next ›
            </Button>
          </span>
        </div>
        {register.isLoading ? (
          <Spinner />
        ) : !register.data?.rows.length ? (
          <Empty>No enquiries match these filters.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-left uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-2 py-2">Ref</th>
                  <th className="px-2 py-2">Enquiry</th>
                  <th className="px-2 py-2">Quoted</th>
                  <th className="px-2 py-2">Confirmed</th>
                  <th className="px-2 py-2">Customer</th>
                  <th className="px-2 py-2">Subject</th>
                  <th className="px-2 py-2">Mode / Qty</th>
                  <th className="px-2 py-2 text-right">Buy</th>
                  <th className="px-2 py-2 text-right">Sell</th>
                  <th className="px-2 py-2 text-right">Profit</th>
                  <th className="px-2 py-2">Agent</th>
                  <th className="px-2 py-2">Sales</th>
                  <th className="px-2 py-2">Status</th>
                  {canEdit && <th className="px-2 py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {register.data.rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer hover:bg-indigo-50/40" onClick={() => navigate(`/enquiries/${r.id}`)}>
                    <td className="whitespace-nowrap px-2 py-1.5 font-mono">
                      <Link to={`/enquiries/${r.id}`} onClick={(e) => e.stopPropagation()} className="text-indigo-700 hover:underline">
                        {r.reference}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{fmtDate(r.enquiry_date)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{fmtDate(r.quoted_date)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{fmtDate(r.confirmed_date)}</td>
                    <td className="max-w-56 truncate px-2 py-1.5" title={r.customer_name}>
                      {r.customer_name}
                    </td>
                    <td className="max-w-80 truncate px-2 py-1.5 text-slate-600" title={r.subject ?? ""}>
                      {r.subject}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <span className="text-slate-500">{r.trade_type}</span> {r.qty_text}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{fmtMoney(r.buy_total)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{fmtMoney(r.sell_total)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right font-medium tabular-nums">{fmtMoney(r.profit)}</td>
                    <td className="max-w-32 truncate px-2 py-1.5">{r.agent_name}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{r.sales_person_name}</td>
                    <td className="px-2 py-1.5">
                      <StatusBadge status={r.status} />
                    </td>
                    {canEdit && (
                      <td className="whitespace-nowrap px-2 py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
                        {r.status === "new" && (
                          <Button size="sm" variant="secondary" disabled={quote.isPending} onClick={() => quote.mutate(r)}>
                            Mark quoted
                          </Button>
                        )}
                        {(r.status === "new" || r.status === "quoted") && (
                          <Button size="sm" variant="ghost" onClick={() => navigate(`/enquiries/${r.id}?confirm=1`)}>
                            Confirm…
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
