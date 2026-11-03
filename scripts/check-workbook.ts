// Runs the app's Excel importer over workbooks without touching the database, and prints what an
// import would do: rows per sheet, errors, warnings and monthly totals for reconciliation.
// Usage: npm run check-workbook -- "C:\path\MONTHLY ENQUIRIES 2026 FINAL.xlsx" [more files]
import { readFileSync } from "node:fs";
import { nameKey } from "../src/lib/normalize";
import { hasErrors, listRegisterSheets, parseWorkbookSheets, readWorkbook } from "../src/lib/excel/register";

const files = process.argv.slice(2).filter((a) => a !== "--");

for (const file of files) {
  const buf = readFileSync(file);
  const wb = readWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const fileName = file.split(/[\\/]/).pop()!;
  const sheets = listRegisterSheets(wb, fileName);
  console.log(`\n##### ${fileName}`);
  for (const s of sheets) {
    console.log(`  sheet ${JSON.stringify(s.name).padEnd(9)} header=R${s.headerRow + 1} offset=${s.offset} year=${s.contextYear} rows=${s.candidateRows} ${s.suggested ? "selected" : "not selected"}`);
  }

  const chosen = sheets.filter((s) => s.suggested);
  const { rows, skipped } = parseWorkbookSheets(wb, chosen);
  const valid = rows.filter((r) => !hasErrors(r));
  const invalid = rows.filter(hasErrors);
  console.log(`  parsed=${rows.length} valid=${valid.length} errors=${invalid.length} skipped(empty pre-numbered)=${skipped}`);

  console.log("  -- rows with errors (excluded):");
  for (const r of invalid) {
    console.log(`     ${r.sheet}!R${r.rowNumber} ${r.reference} ${r.customer_name}: ${r.issues.filter((i) => i.level === "error").map((i) => i.message).join(" | ")}`);
  }

  const categories = new Map<string, { n: number; examples: string[] }>();
  for (const r of valid) {
    for (const i of r.issues) {
      const key = i.message.replace(/"[^"]*"/g, '"â€¦"').replace(/\d[\d.,]*/g, "#").slice(0, 90);
      const c = categories.get(key) ?? { n: 0, examples: [] };
      c.n++;
      c.examples.push(`${r.sheet}!R${r.rowNumber} ${r.reference}: ${i.message}`);
      categories.set(key, c);
    }
  }
  console.log("  -- warnings on imported rows (by kind):");
  for (const [key, c] of [...categories].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`     ${String(c.n).padStart(4)}  ${key}`);
    // Small groups are listed in full so they can be fixed in Excel; large ones are sampled.
    for (const e of c.n <= 15 ? c.examples : c.examples.slice(0, 3)) console.log(`             ${e}`);
  }

  const months = new Map<string, { enq: number; quoted: number; conf: number; buy: number; sell: number; profit: number; fcl: number; air: number; lcl: number; cour: number; other: number; units: number }>();
  for (const r of valid) {
    const m = r.enquiry_date!.slice(0, 7);
    const s = months.get(m) ?? { enq: 0, quoted: 0, conf: 0, buy: 0, sell: 0, profit: 0, fcl: 0, air: 0, lcl: 0, cour: 0, other: 0, units: 0 };
    s.enq++;
    if (r.quoted_date) s.quoted++;
    if (r.confirmed_date) {
      s.conf++;
      s.buy += r.buy_total ?? 0;
      s.sell += r.sell_total ?? 0;
      s.profit += (r.sell_total ?? 0) - (r.buy_total ?? 0);
      if (r.shipment_mode === "FCL") { s.fcl++; s.units += r.units ?? 0; }
      else if (r.shipment_mode === "AIR") s.air++;
      else if (r.shipment_mode === "LCL") s.lcl++;
      else if (r.shipment_mode === "COURIER") s.cour++;
      else s.other++;
    }
    months.set(m, s);
  }
  console.log("  -- by enquiry month (what the app will report):");
  console.log("     MONTH     ENQ QUOTED  CONF      BUY       SELL    PROFIT  FCL UNITS  AIR  LCL COUR OTHER");
  for (const [m, s] of [...months].sort()) {
    console.log(
      `     ${m} ${String(s.enq).padStart(5)} ${String(s.quoted).padStart(6)} ${String(s.conf).padStart(5)} ${Math.round(s.buy).toLocaleString().padStart(9)} ${Math.round(s.sell).toLocaleString().padStart(10)} ${Math.round(s.profit).toLocaleString().padStart(9)} ${String(s.fcl).padStart(4)} ${String(s.units).padStart(5)} ${String(s.air).padStart(4)} ${String(s.lcl).padStart(4)} ${String(s.cour).padStart(4)} ${String(s.other).padStart(5)}`,
    );
  }

  const modes = new Map<string, number>();
  for (const r of valid) modes.set(String(r.shipment_mode), (modes.get(String(r.shipment_mode)) ?? 0) + 1);
  console.log("  -- shipment modes:", JSON.stringify(Object.fromEntries([...modes].sort((a, b) => b[1] - a[1]))));
  const otherQty = new Map<string, number>();
  for (const r of valid) if (r.shipment_mode === "OTHER" || r.shipment_mode === "MULTI") otherQty.set(String(r.qty_text), (otherQty.get(String(r.qty_text)) ?? 0) + 1);
  console.log("  -- qty texts classified OTHER/MULTI:", JSON.stringify(Object.fromEntries([...otherQty].sort((a, b) => b[1] - a[1]))));
  const fclNoUnits = valid.filter((r) => r.shipment_mode === "FCL" && r.units == null).map((r) => r.qty_text);
  console.log("  -- FCL without unit count:", JSON.stringify([...new Set(fclNoUnits)]));

  console.log(
    `  -- distinct: customers=${new Set(valid.map((r) => nameKey(r.customer_name))).size} agents=${new Set(valid.map((r) => nameKey(r.agent_name)).filter(Boolean)).size} sales=${new Set(valid.map((r) => nameKey(r.sales_person_name)).filter(Boolean)).size}`,
  );
  console.log(`  -- trade types: ${JSON.stringify(Object.fromEntries([...valid.reduce((m, r) => m.set(String(r.trade_type), (m.get(String(r.trade_type)) ?? 0) + 1), new Map<string, number>())]))}`);
}
