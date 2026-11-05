import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent, type InputHTMLAttributes } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { EmailView } from "../components/EmailView";
import { Alert, Button, Card, Field, Spinner, StatusBadge, buttonClass, inputClass } from "../components/ui";
import {
  createEnquiryFromDraft,
  deleteEnquiry,
  fetchDraft,
  fetchEnquiry,
  fetchNames,
  fetchPortSummaries,
  fetchSalesPersons,
  saveEnquiry,
} from "../lib/api";
import { draftToPayload } from "../lib/emailDrafts";
import { describeCommission, mentionsCommission, parseCommission } from "../lib/commission";
import { errorMessage, fmtDate, fmtMoney, todayIso } from "../lib/format";
import { parseHouseSubject } from "../lib/houseSubject";
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

/**
 * A new enquiry from the "Waiting for reference" link: ?reference=SL262785, plus ?date= (the day the first
 * e-mail arrived) and ?subject= (a house-style subject: quantity, incoterm and ports). Customer and contact stay
 * empty: these e-mails are mostly agents quoting us, not the customer.
 */
function formFromInbox(params: URLSearchParams): { form: FormState; filled: string[]; date: string | null } | null {
  const ref = (params.get("reference") ?? "").trim().toUpperCase();
  if (!/^SL\d{4,}$/.test(ref)) return null;
  const form: FormState = { ...emptyForm(), reference: ref };
  const filled: string[] = [];

  const raw = params.get("date") ?? "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw)) && raw <= todayIso() ? raw : null;
  if (date) {
    form.enquiry_date = date;
    filled.push("enquiry date");
  }

  const house = parseHouseSubject(params.get("subject"));
  if (house) {
    const qty = parseQty(house.qty_text);
    Object.assign(form, {
      subject: `${ref} ${house.subject}`,
      qty_text: house.qty_text ?? "",
      shipment_mode: qty.mode && house.qty_text ? qty.mode : "",
      units: qty.units == null ? "" : String(qty.units),
      container_type: qty.containerType ?? "",
      pol: house.pol,
      pod: house.pod,
      trade_type: house.trade_type ?? form.trade_type,
      requirements: house.incoterm ? `Incoterm: ${house.incoterm}` : "",
    });
    filled.push(...(house.qty_text ? ["qty"] : []), "POL", "POD", "mode", "subject", ...(house.incoterm ? ["incoterm"] : []));
  }
  return { form, filled, date };
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
  const { canEdit, isAdmin, seesAll, profile } = useAuth();
  const queryClient = useQueryClient();

  const existing = useQuery({ queryKey: ["enquiry", id], queryFn: () => fetchEnquiry(id!), enabled: !!id });
  const draft = useQuery({ queryKey: ["inbox", "draft", draftId], queryFn: () => fetchDraft(draftId!), enabled: !!draftId });
  const salesPersons = useQuery({ queryKey: ["sales-persons"], queryFn: fetchSalesPersons, staleTime: 300_000 });
  const customers = useQuery({ queryKey: ["names", "customers"], queryFn: () => fetchNames("customers"), staleTime: 300_000 });
  const agents = useQuery({ queryKey: ["names", "agents"], queryFn: () => fetchNames("agents"), staleTime: 300_000 });
  // Port suggestions, most used first. Known variant spellings are turned into the standard name on save.
  const ports = useQuery({
    queryKey: ["ports", "summary"],
    queryFn: fetchPortSummaries,
    staleTime: 300_000,
    select: (rows) => [...rows].sort((a, b) => b.enquiries - a.enquiries).map((p) => p.name),
  });

  // ?reference=SL262810&date=…&subject=… starts a new enquiry under a reference the e-mails already cite
  // (Inbox, Waiting for reference), filled from those e-mails.
  const [fromInbox] = useState(() => (!id && !draftId ? formFromInbox(searchParams) : null));
  const [form, setForm] = useState<FormState>(() => fromInbox?.form ?? emptyForm());
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
    // ?confirm=1 confirms today; ?confirm=YYYY-MM-DD on the day the customer said yes (the enquiry page's suggestion).
    const confirmOn = searchParams.get("confirm");
    if (confirmOn && !next.confirmed_date) next.confirmed_date = /^\d{4}-\d{2}-\d{2}$/.test(confirmOn) ? confirmOn : todayIso();
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

  // Sales staff see and enter only their own enquiries (the database refuses others): their sales person, fixed.
  const ownSalesPerson = seesAll ? null : (salesPersons.data?.find((p) => p.id === profile?.sales_person_id) ?? null);
  const salesPersonOptions = ownSalesPerson ? [ownSalesPerson] : (salesPersons.data ?? []);
  useEffect(() => {
    if (id || !ownSalesPerson) return;
    setForm((prev) => (prev.sales_person_name ? prev : { ...prev, sales_person_name: ownSalesPerson.name }));
  }, [id, ownSalesPerson]);

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
      queryClient.invalidateQueries({ queryKey: ["customer-history"] });
      queryClient.invalidateQueries({ queryKey: ["lane-history"] });
      queryClient.invalidateQueries({ queryKey: ["enquiry", row.id] });
      // Back to the enquiry's page, which says it was saved.
      navigate(`/enquiries/${row.id}`, { replace: true, state: { saved: row.reference } });
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
        <Link to={id ? `/enquiries/${id}` : "/enquiries"} className="text-sm text-ink-muted hover:text-ink">
          {id ? "← Back to the enquiry" : "← Register"}
        </Link>
        <h1 className="text-lg font-semibold">
          {id ? (
            <>
              Edit <span className="tabular-nums">{existing.data?.reference}</span> {existing.data && <StatusBadge status={existing.data.status} />}
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
          {id && (
            <Link to={`/enquiries/${id}`} className={buttonClass("secondary")}>
              Cancel
            </Link>
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
      {fromInbox?.filled.length ? (
        <Alert kind="info">
          Filled from the e-mails on {form.reference}: {fromInbox.filled.join(", ")}. They come from the agents, so enter the customer and contact
          yourself, and check the rest.
        </Alert>
      ) : null}
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
            <Field
              label="Enquiry date *"
              hint={fromInbox?.date && form.enquiry_date === fromInbox.date ? `The day the first e-mail on this reference arrived, ${fmtDate(fromInbox.date)}` : undefined}
            >
              {dateInput("enquiry_date")}
            </Field>
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
              <select
                className={inputClass}
                value={form.sales_person_name}
                onChange={(e) => set("sales_person_name", e.target.value)}
                title={ownSalesPerson ? "Your enquiries are always yours" : undefined}
              >
                {!ownSalesPerson && <option value="">—</option>}
                {salesPersonOptions.map((p) => (
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
            <Field label="POL">{input("pol", { placeholder: "SHANGHAI CHINA", list: "port-names", autoComplete: "off" })}</Field>
            <Field label="POD">
              {input("pod", { placeholder: "SOHAR OMAN", list: "port-names", autoComplete: "off" })}
              <datalist id="port-names">
                {ports.data?.map((n) => <option key={n} value={n} />)}
              </datalist>
            </Field>
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
            <Field label="Remarks" hint={<CommissionHint remarks={form.remarks} units={form.units} />}>
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
    </form>
  );
}

/** What the database will read as commission from the remarks, shown while they are typed. */
function CommissionHint({ remarks, units }: { remarks: string; units: string }) {
  const found = parseCommission(remarks);
  const n = Number(units) || null;
  if (found) {
    return (
      <span className="text-ink-heading">
        Commission: <span className="font-medium tabular-nums">{describeCommission(found, n)}</span>
      </span>
    );
  }
  if (mentionsCommission(remarks)) {
    return <span className="text-await">Commission mentioned, but no amount found. Write it like COMMISSION OMR 40/CNTR.</span>;
  }
  return "Commission is read from here, e.g. COMMISSION OMR 40/CNTR.";
}
