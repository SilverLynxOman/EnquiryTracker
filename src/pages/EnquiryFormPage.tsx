import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { EmailView } from "../components/EmailView";
import { Alert, Button, Card, Field, Spinner, StatusBadge, inputClass } from "../components/ui";
import {
  createEnquiryFromDraft,
  deleteEnquiry,
  fetchAudit,
  fetchDraft,
  fetchEnquiry,
  fetchEnquiryEmails,
  fetchInboxCounts,
  fetchNames,
  fetchProfileNames,
  fetchSalesPersons,
  saveEnquiry,
} from "../lib/api";
import { draftToPayload } from "../lib/emailDrafts";
import { errorMessage, fmtDate, fmtDateTime, fmtMoney, todayIso } from "../lib/format";
import { parseQty, round2 } from "../lib/normalize";
import {
  MODE_LABELS,
  SHIPMENT_MODES,
  TRADE_TYPES,
  TRADE_TYPE_LABELS,
  type Closure,
  type EnquiryPayload,
  type EnquiryRow,
  type ShipmentMode,
  type TradeType,
} from "../lib/types";

interface FormState {
  reference: string;
  enquiry_date: string;
  quoted_date: string;
  confirmed_date: string;
  closure: string;
  closure_reason: string;
  customer_name: string;
  sales_person_name: string;
  trade_type: string;
  qty_text: string;
  shipment_mode: string;
  units: string;
  container_type: string;
  currency: string;
  buy_rate: string;
  buy_total: string;
  sell_rate: string;
  sell_total: string;
  pol: string;
  pod: string;
  agent_name: string;
  subject: string;
  remarks: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  requirements: string;
}

type Key = keyof FormState;

/** Free-text fields typed in capitals, as in the Excel register. */
const UPPERCASE_FIELDS: Key[] = ["customer_name", "qty_text", "container_type", "pol", "pod", "agent_name", "subject", "reference"];

const s = (v: string | number | null | undefined) => (v == null ? "" : String(v));

function emptyForm(): FormState {
  return {
    reference: "",
    enquiry_date: todayIso(),
    quoted_date: "",
    confirmed_date: "",
    closure: "",
    closure_reason: "",
    customer_name: "",
    sales_person_name: "",
    trade_type: "IMP",
    qty_text: "",
    shipment_mode: "",
    units: "",
    container_type: "",
    currency: "USD",
    buy_rate: "",
    buy_total: "",
    sell_rate: "",
    sell_total: "",
    pol: "",
    pod: "",
    agent_name: "",
    subject: "",
    remarks: "",
    contact_name: "",
    contact_email: "",
    contact_phone: "",
    requirements: "",
  };
}

function toForm(e: EnquiryRow): FormState {
  return {
    reference: e.reference,
    enquiry_date: e.enquiry_date,
    quoted_date: s(e.quoted_date),
    confirmed_date: s(e.confirmed_date),
    closure: s(e.closure),
    closure_reason: s(e.closure_reason),
    customer_name: e.customer_name,
    sales_person_name: s(e.sales_person_name),
    trade_type: s(e.trade_type),
    qty_text: s(e.qty_text),
    shipment_mode: s(e.shipment_mode),
    units: s(e.units),
    container_type: s(e.container_type),
    currency: e.currency.trim(),
    buy_rate: s(e.buy_rate),
    buy_total: s(e.buy_total),
    sell_rate: s(e.sell_rate),
    sell_total: s(e.sell_total),
    pol: s(e.pol),
    pod: s(e.pod),
    agent_name: s(e.agent_name),
    subject: s(e.subject),
    remarks: s(e.remarks),
    contact_name: s(e.contact_name),
    contact_email: s(e.contact_email),
    contact_phone: s(e.contact_phone),
    requirements: s(e.requirements),
  };
}

/** Form pre-filled from an e-mail enquiry (see src/lib/emailDrafts.ts). */
function payloadToForm(p: EnquiryPayload): FormState {
  return {
    ...emptyForm(),
    enquiry_date: p.enquiry_date,
    customer_name: p.customer_name,
    sales_person_name: s(p.sales_person_name),
    trade_type: s(p.trade_type),
    qty_text: s(p.qty_text),
    shipment_mode: s(p.shipment_mode),
    units: s(p.units),
    container_type: s(p.container_type),
    pol: s(p.pol),
    pod: s(p.pod),
    subject: s(p.subject),
    contact_name: s(p.contact_name),
    contact_email: s(p.contact_email),
    contact_phone: s(p.contact_phone),
    requirements: s(p.requirements),
  };
}

const textOrNull = (v: string) => (v.trim() === "" ? null : v.trim());
const numOrNull = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? null : Number(v));

function toPayload(f: FormState): EnquiryPayload {
  return {
    reference: textOrNull(f.reference),
    enquiry_date: f.enquiry_date,
    quoted_date: textOrNull(f.quoted_date),
    confirmed_date: textOrNull(f.confirmed_date),
    closure: (textOrNull(f.closure) as Closure | null) ?? null,
    closure_reason: textOrNull(f.closure_reason),
    customer_name: f.customer_name.trim(),
    subject: textOrNull(f.subject),
    trade_type: (textOrNull(f.trade_type) as TradeType | null) ?? null,
    qty_text: textOrNull(f.qty_text),
    shipment_mode: (textOrNull(f.shipment_mode) as ShipmentMode | null) ?? null,
    units: numOrNull(f.units) == null ? null : Math.round(numOrNull(f.units)!),
    container_type: textOrNull(f.container_type),
    currency: f.currency.trim() || "USD",
    buy_rate: numOrNull(f.buy_rate),
    buy_total: numOrNull(f.buy_total),
    sell_rate: numOrNull(f.sell_rate),
    sell_total: numOrNull(f.sell_total),
    pol: textOrNull(f.pol),
    pod: textOrNull(f.pod),
    agent_name: textOrNull(f.agent_name),
    sales_person_name: textOrNull(f.sales_person_name),
    remarks: textOrNull(f.remarks),
    contact_name: textOrNull(f.contact_name),
    contact_email: textOrNull(f.contact_email)?.toLowerCase() ?? null,
    contact_phone: textOrNull(f.contact_phone),
    requirements: textOrNull(f.requirements),
  };
}

/** rate × units (units default to 1 for air / LCL / courier). */
function calcTotal(rate: string, units: string): string {
  const r = numOrNull(rate);
  if (r == null) return "";
  const u = numOrNull(units) || 1;
  return String(round2(r * u));
}

function totalIsAuto(rate: number | null, units: number | null, total: number | null): boolean {
  if (total == null) return true;
  if (rate == null) return false;
  return Math.abs(round2(rate * (units || 1)) - total) < 0.01;
}

function checkForm(f: FormState) {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!f.enquiry_date) errors.push("Enquiry date is required.");
  if (!f.customer_name.trim()) errors.push("Customer is required.");
  if (f.quoted_date && f.enquiry_date && f.quoted_date < f.enquiry_date) warnings.push("Quoted date is before the enquiry date.");
  if (f.confirmed_date && f.enquiry_date && f.confirmed_date < f.enquiry_date) warnings.push("Confirmation date is before the enquiry date.");
  if (f.confirmed_date && !f.sell_total) warnings.push("Confirmed without a sell amount — profit will be missing from reports.");
  if (f.confirmed_date && f.closure) warnings.push(`A confirmed enquiry is marked ${f.closure}; reports will treat it as ${f.closure === "cancelled" ? "cancelled" : "confirmed"}.`);
  if (!f.sales_person_name) warnings.push("No sales person selected.");
  if (f.contact_email.trim() && !/^[^@\s]+@[^@\s]+$/.test(f.contact_email.trim())) errors.push("The contact e-mail address is not valid.");
  return { errors, warnings };
}

export default function EnquiryFormPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const draftId = id ? null : searchParams.get("draft");
  return <EnquiryForm key={id ?? `new-${draftId ?? ""}`} id={id ?? null} draftId={draftId} />;
}

function EnquiryForm({ id, draftId }: { id: string | null; draftId: string | null }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { canEdit, isAdmin } = useAuth();
  const queryClient = useQueryClient();

  const existing = useQuery({ queryKey: ["enquiry", id], queryFn: () => fetchEnquiry(id!), enabled: !!id });
  const draft = useQuery({ queryKey: ["inbox", "draft", draftId], queryFn: () => fetchDraft(draftId!), enabled: !!draftId });
  const salesPersons = useQuery({ queryKey: ["sales-persons"], queryFn: fetchSalesPersons, staleTime: 300_000 });
  const customers = useQuery({ queryKey: ["names", "customers"], queryFn: () => fetchNames("customers"), staleTime: 300_000 });
  const agents = useQuery({ queryKey: ["names", "agents"], queryFn: () => fetchNames("agents"), staleTime: 300_000 });

  const [form, setForm] = useState<FormState>(emptyForm);
  const [loaded, setLoaded] = useState(!id && !draftId);
  const [autoBuy, setAutoBuy] = useState(true);
  const [autoSell, setAutoSell] = useState(true);
  const savedReference = (location.state as { saved?: string } | null)?.saved;
  const [message, setMessage] = useState<string | null>(savedReference ? `Saved ${savedReference}.` : null);
  const [showChecks, setShowChecks] = useState(false);

  useEffect(() => {
    if (!existing.data || loaded) return;
    const e = existing.data;
    const next = toForm(e);
    if (searchParams.get("confirm") === "1" && !next.confirmed_date) next.confirmed_date = todayIso();
    setForm(next);
    setAutoBuy(totalIsAuto(e.buy_rate, e.units, e.buy_total));
    setAutoSell(totalIsAuto(e.sell_rate, e.units, e.sell_total));
    setLoaded(true);
  }, [existing.data, loaded, searchParams]);

  useEffect(() => {
    if (!draft.data || loaded) return;
    setForm(payloadToForm(draftToPayload(draft.data)));
    setLoaded(true);
  }, [draft.data, loaded]);

  function set(key: Key, raw: string) {
    const value = UPPERCASE_FIELDS.includes(key) ? raw.toUpperCase() : raw;
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "qty_text") {
        const q = parseQty(value || null);
        next.shipment_mode = q.mode ?? "";
        next.units = q.units == null ? "" : String(q.units);
        next.container_type = q.containerType ?? "";
      }
      const unitsChanged = key === "qty_text" || key === "units";
      if (autoBuy && (key === "buy_rate" || unitsChanged)) next.buy_total = calcTotal(next.buy_rate, next.units);
      if (autoSell && (key === "sell_rate" || unitsChanged)) next.sell_total = calcTotal(next.sell_rate, next.units);
      return next;
    });
  }

  function setTotal(key: "buy_total" | "sell_total", value: string) {
    (key === "buy_total" ? setAutoBuy : setAutoSell)(value === "");
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function generateSubject() {
    const route = [form.pol, form.pod].filter(Boolean).join(" TO ");
    const subject = [form.reference, form.qty_text, route].filter(Boolean).join(" ");
    setForm((prev) => ({ ...prev, subject }));
  }

  const save = useMutation({
    mutationFn: () => (draftId ? createEnquiryFromDraft(draftId, toPayload(form)) : saveEnquiry(id, toPayload(form))),
    onSuccess: (row) => {
      if (draftId) queryClient.invalidateQueries({ queryKey: ["inbox"] });
      queryClient.invalidateQueries({ queryKey: ["enquiry-emails"] });
      queryClient.invalidateQueries({ queryKey: ["register"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      queryClient.invalidateQueries({ queryKey: ["window"] });
      queryClient.invalidateQueries({ queryKey: ["voyage"] });
      queryClient.invalidateQueries({ queryKey: ["names"] });
      queryClient.invalidateQueries({ queryKey: ["sales-persons"] });
      queryClient.invalidateQueries({ queryKey: ["audit", row.id] });
      if (!id) {
        navigate(`/enquiries/${row.id}`, { replace: true, state: { saved: row.reference } });
      } else {
        queryClient.invalidateQueries({ queryKey: ["enquiry", id] });
        setForm((prev) => ({ ...prev, subject: row.subject ?? prev.subject }));
        setMessage(`Saved ${row.reference}.`);
      }
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteEnquiry(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["register"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      queryClient.invalidateQueries({ queryKey: ["window"] });
      queryClient.invalidateQueries({ queryKey: ["voyage"] });
      navigate("/enquiries", { replace: true });
    },
  });

  const { errors, warnings } = checkForm(form);

  function submit(e: FormEvent) {
    e.preventDefault();
    setShowChecks(true);
    setMessage(null);
    if (errors.length) return;
    save.mutate();
  }

  if (id && existing.isLoading) return <Spinner />;
  if (id && existing.error) return <Alert>{errorMessage(existing.error)}</Alert>;
  if (draftId && draft.isLoading) return <Spinner />;
  if (draftId && draft.error) return <Alert>{errorMessage(draft.error)}</Alert>;
  if (draft.data && draft.data.status !== "pending") {
    return (
      <Alert kind="info">
        This e-mail enquiry was already handled ({draft.data.status}).{" "}
        {draft.data.enquiry_id ? (
          <Link to={`/enquiries/${draft.data.enquiry_id}`} className="underline">
            Open the enquiry
          </Link>
        ) : (
          <Link to="/inbox" className="underline">
            Back to the inbox
          </Link>
        )}
      </Alert>
    );
  }

  const buy = numOrNull(form.buy_total);
  const sell = numOrNull(form.sell_total);
  const profit = buy == null && sell == null ? null : (sell ?? 0) - (buy ?? 0);
  const input = (key: Key, props: InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input className={inputClass} value={form[key]} onChange={(e) => set(key, e.target.value)} {...props} />
  );
  const dateInput = (key: "enquiry_date" | "quoted_date" | "confirmed_date") => (
    <div className="flex gap-1">
      <input type="date" className={inputClass} value={form[key]} onChange={(e) => set(key, e.target.value)} />
      <Button variant="secondary" size="sm" onClick={() => set(key, todayIso())} title="Set to today">
        Today
      </Button>
      {form[key] && key !== "enquiry_date" && (
        <Button variant="ghost" size="sm" onClick={() => set(key, "")} title="Clear">
          ✕
        </Button>
      )}
    </div>
  );

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/enquiries" className="text-sm text-ink-muted hover:text-ink">
          ← Register
        </Link>
        <h1 className="text-lg font-semibold">
          {id ? (
            <>
              <span className="tabular-nums">{existing.data?.reference}</span> {existing.data && <StatusBadge status={existing.data.status} />}
            </>
          ) : draftId ? (
            "New enquiry from e-mail"
          ) : (
            "New enquiry"
          )}
        </h1>
        <div className="ml-auto flex gap-2">
          {id && isAdmin && (
            <Button
              variant="danger"
              disabled={remove.isPending}
              onClick={() => window.confirm(`Delete ${existing.data?.reference}? This cannot be undone.`) && remove.mutate()}
            >
              Delete
            </Button>
          )}
          {canEdit && (
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : id ? "Save changes" : "Create enquiry"}
            </Button>
          )}
        </div>
      </div>

      {message && <Alert kind="success">{message}</Alert>}
      {draft.data?.summary && (
        <Alert kind="info">
          Read from the e-mail: {draft.data.summary} Check the details, then create the enquiry. The e-mail is shown below.
        </Alert>
      )}
      {(save.error || remove.error) && <Alert>{errorMessage(save.error ?? remove.error)}</Alert>}
      {showChecks && errors.length > 0 && <Alert>{errors.join(" ")}</Alert>}
      {warnings.length > 0 && (showChecks || id) && (
        <Alert kind="warning">
          <ul className="list-inside list-disc">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Alert>
      )}

      <fieldset disabled={!canEdit} className="grid gap-4 xl:grid-cols-3">
        <Card title="Enquiry">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Reference" hint={id ? undefined : "Leave blank to issue the next number automatically"}>
              {input("reference", { readOnly: !!id, placeholder: "auto", className: `${inputClass} tabular-nums` })}
            </Field>
            <Field label="Enquiry date *">{dateInput("enquiry_date")}</Field>
            <Field label="Quoted date">{dateInput("quoted_date")}</Field>
            <Field label="Confirmation date">{dateInput("confirmed_date")}</Field>
            <Field label="Closed as">
              <select className={inputClass} value={form.closure} onChange={(e) => set("closure", e.target.value)}>
                <option value="">— open —</option>
                <option value="lost">Lost</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </Field>
            <Field label="Reason">{input("closure_reason", { disabled: !form.closure || !canEdit, placeholder: "e.g. rate too high" })}</Field>
          </div>
        </Card>

        <Card title="Customer & job">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Customer *" className="sm:col-span-2">
              {input("customer_name", { list: "customer-names", autoComplete: "off" })}
              <datalist id="customer-names">
                {customers.data?.map((n) => <option key={n} value={n} />)}
              </datalist>
            </Field>
            <Field label="Contact person">{input("contact_name", { autoComplete: "off" })}</Field>
            <Field label="Contact phone">{input("contact_phone", { autoComplete: "off" })}</Field>
            <Field label="Contact e-mail" className="sm:col-span-2" hint="Saved to the customer's contacts, so their next e-mails are recognised">
              {input("contact_email", { type: "email", autoComplete: "off" })}
            </Field>
            <Field label="Sales person">
              <select className={inputClass} value={form.sales_person_name} onChange={(e) => set("sales_person_name", e.target.value)}>
                <option value="">—</option>
                {salesPersons.data?.map((p) => (
                  <option key={p.id} value={p.name}>
                    {p.name}
                  </option>
                ))}
                {form.sales_person_name && !salesPersons.data?.some((p) => p.name === form.sales_person_name) && (
                  <option value={form.sales_person_name}>{form.sales_person_name}</option>
                )}
              </select>
            </Field>
            <Field label="Mode">
              <select className={inputClass} value={form.trade_type} onChange={(e) => set("trade_type", e.target.value)}>
                <option value="">—</option>
                {TRADE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TRADE_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Qty" hint="e.g. 1X40', 2X20', 1X40 RF, LCL, AIR, COURIER" className="sm:col-span-2">
              {input("qty_text")}
            </Field>
            <Field label="Shipment">
              <select className={inputClass} value={form.shipment_mode} onChange={(e) => set("shipment_mode", e.target.value)}>
                <option value="">—</option>
                {SHIPMENT_MODES.map((m) => (
                  <option key={m} value={m}>
                    {MODE_LABELS[m]}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Units">{input("units", { type: "number", min: 0, step: 1 })}</Field>
              <Field label="Container">{input("container_type", { placeholder: "40HC" })}</Field>
            </div>
            <Field label="POL">{input("pol", { placeholder: "SHANGHAI CHINA" })}</Field>
            <Field label="POD">{input("pod", { placeholder: "SOHAR OMAN" })}</Field>
            <Field label="Agent" className="sm:col-span-2">
              {input("agent_name", { list: "agent-names", autoComplete: "off" })}
              <datalist id="agent-names">
                {agents.data?.map((n) => <option key={n} value={n} />)}
              </datalist>
            </Field>
          </div>
        </Card>

        <Card title="Rates">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Currency">
              <select className={inputClass} value={form.currency} onChange={(e) => set("currency", e.target.value)}>
                {["USD", "OMR", "AED", "EUR"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <div />
            <Field label="Buy rate (per unit)">{input("buy_rate", { type: "number", step: "any" })}</Field>
            <Field label="Buy total" hint={autoBuy ? "auto: rate × units" : "entered manually"}>
              <input type="number" step="any" className={inputClass} value={form.buy_total} onChange={(e) => setTotal("buy_total", e.target.value)} />
            </Field>
            <Field label="Sell rate (per unit)">{input("sell_rate", { type: "number", step: "any" })}</Field>
            <Field label="Sell total" hint={autoSell ? "auto: rate × units" : "entered manually"}>
              <input type="number" step="any" className={inputClass} value={form.sell_total} onChange={(e) => setTotal("sell_total", e.target.value)} />
            </Field>
          </div>
          <div className="mt-4 flex items-baseline justify-between rounded-md bg-table-head px-3 py-2">
            <span className="text-sm text-ink-muted">Profit</span>
            <span className={`text-xl font-semibold tabular-nums ${profit != null && profit < 0 ? "text-rose-600" : "text-ink"}`}>
              {profit == null ? "—" : `${fmtMoney(round2(profit))} ${form.currency}`}
            </span>
          </div>
        </Card>

        <Card title="Subject, requirements & remarks" className="xl:col-span-3">
          <div className="grid gap-3 md:grid-cols-2">
            <Field
              label="Subject"
              hint={
                <button type="button" onClick={generateSubject} className="text-primary hover:underline">
                  Fill from qty and ports
                </button>
              }
            >
              {input("subject", { placeholder: "1X40' SHANGHAI CHINA TO SOHAR OMAN" })}
            </Field>
            <Field label="Remarks" hint="e.g. COMMISSION OMR 40/CNTR.">
              <textarea rows={2} className={inputClass} value={form.remarks} onChange={(e) => set("remarks", e.target.value)} />
            </Field>
            <Field label="Requirements" hint="Commodity, weight / volume, incoterm, cargo readiness, special handling" className="md:col-span-2">
              <textarea
                rows={Math.min(10, Math.max(3, form.requirements.split("\n").length + 1))}
                className={inputClass}
                value={form.requirements}
                onChange={(e) => set("requirements", e.target.value)}
              />
            </Field>
          </div>
        </Card>
      </fieldset>

      {draft.data && (
        <Card title={`E-mail${draft.data.emails.length > 1 ? `s (${draft.data.emails.length})` : ""}`}>
          <div className="space-y-2">
            {draft.data.emails.map((m) => (
              <EmailView key={m.id} email={m} />
            ))}
          </div>
        </Card>
      )}
      {id && <EnquiryEmails enquiryId={id} />}
      {id && existing.data && <AuditHistory enquiry={existing.data} />}
    </form>
  );
}

const FIELD_LABELS: Record<string, string> = {
  enquiry_date: "Enquiry date",
  quoted_date: "Quoted date",
  confirmed_date: "Confirmation date",
  closure: "Closed as",
  closure_reason: "Reason",
  customer_id: "Customer",
  // Written by merge_customers: names instead of ids, since the old customer no longer exists.
  customer: "Customer",
  subject: "Subject",
  trade_type: "Mode",
  qty_text: "Qty",
  shipment_mode: "Shipment",
  units: "Units",
  container_type: "Container",
  currency: "Currency",
  buy_rate: "Buy rate",
  buy_total: "Buy total",
  sell_rate: "Sell rate",
  sell_total: "Sell total",
  pol: "POL",
  pod: "POD",
  agent_id: "Agent",
  sales_person_id: "Sales person",
  remarks: "Remarks",
  reference: "Reference",
  contact_id: "Contact",
  requirements: "Requirements",
};

function showValue(field: string, v: unknown): ReactNode {
  if (v == null || v === "") return <span className="text-ink-muted">—</span>;
  if (field.endsWith("_id")) return <span className="text-ink-muted">(changed)</span>;
  if (field.endsWith("_date")) return fmtDate(String(v));
  return String(v);
}

function AuditHistory({ enquiry }: { enquiry: EnquiryRow }) {
  const audit = useQuery({ queryKey: ["audit", enquiry.id], queryFn: () => fetchAudit(enquiry.id) });
  const people = useQuery({ queryKey: ["profile-names"], queryFn: fetchProfileNames, staleTime: 300_000 });
  const who = (uid: string | null) => (uid ? (people.data?.get(uid) ?? "Unknown user") : "System");

  return (
    <Card title="History">
      {audit.isLoading ? (
        <Spinner />
      ) : audit.error ? (
        <Alert>{errorMessage(audit.error)}</Alert>
      ) : (
        <ol className="space-y-3 text-sm">
          {audit.data?.map((a) => (
            <li key={a.id} className="border-l-2 border-line pl-3">
              <div className="text-meta text-ink-muted">
                {fmtDateTime(a.changed_at)} · {who(a.changed_by)}
                {a.import_batch_id && <span className="ml-1 rounded bg-table-head px-1">Excel import</span>}
              </div>
              {a.action === "insert" && <div>Created</div>}
              {a.action === "delete" && <div>Deleted</div>}
              {a.action === "update" && a.changes && (
                <ul className="mt-0.5 space-y-0.5">
                  {Object.entries(a.changes as Record<string, { old: unknown; new: unknown; merged?: boolean }>).map(([field, c]) => (
                    <li key={field}>
                      <span className="text-ink-muted">{FIELD_LABELS[field] ?? field}:</span> {showValue(field, c.old)} → {showValue(field, c.new)}
                      {c.merged && <span className="text-ink-muted"> (customers merged)</span>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
          <li className="pl-3 text-meta text-ink-muted">
            Record created {fmtDateTime(enquiry.created_at)} ({enquiry.source === "import" ? "from Excel" : enquiry.source === "email" ? "from an e-mail" : "in the app"})
          </li>
        </ol>
      )}
    </Card>
  );
}

const EMAILS_SHOWN = 5;

/** The enquiry's e-mail history, newest first. */
function EnquiryEmails({ enquiryId }: { enquiryId: string }) {
  const emails = useQuery({ queryKey: ["enquiry-emails", enquiryId], queryFn: () => fetchEnquiryEmails(enquiryId) });
  const counts = useQuery({ queryKey: ["inbox", "counts"], queryFn: fetchInboxCounts, staleTime: 60_000 });
  const [all, setAll] = useState(false);
  if (emails.isLoading) return <Spinner label="Loading e-mails…" />;
  if (emails.error) return <Alert>{errorMessage(emails.error)}</Alert>;
  const list = [...(emails.data ?? [])].reverse();
  if (!list.length) return null;
  const shown = all ? list : list.slice(0, EMAILS_SHOWN);
  return (
    <Card
      title={`E-mails (${list.length})`}
      actions={
        list.length > EMAILS_SHOWN && (
          <Button variant="ghost" size="sm" onClick={() => setAll(!all)}>
            {all ? "Show latest only" : `Show all ${list.length}`}
          </Button>
        )
      }
    >
      <div className="space-y-2">
        {shown.map((m) => (
          <EmailView key={m.id} email={m} mailbox={counts.data?.mailboxes[0]?.email} />
        ))}
      </div>
    </Card>
  );
}
