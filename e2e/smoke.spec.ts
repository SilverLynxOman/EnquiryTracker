import { expect, test } from "@playwright/test";
import * as XLSX from "xlsx";
import { EMAIL, mockSupabase, PASSWORD } from "./supabaseMock";

// The smoke test CI runs on every push: sign in, add an enquiry, import a small register workbook. Supabase is
// mocked (supabaseMock.ts), so this checks the app's own flow, not the database.

/** A register workbook laid out like the office's Excel file: title rows, two header rows, then enquiries. */
function registerWorkbook(): Buffer {
  const H1 = ["SL. NO.", "ENQUIRY DATE", "QUOTED DATE", "CONFIRMATION DATE", "MY REFERENCE", "NAME OF CUSTOMER LOCAL/OVERSEAS", "SUBJECT", "JOB NATURE & QTY", null, "BUY RATE", null, "SELL", null, "PROFIT", "PORT & AGENT DETAILS ", null, null, "SALES PERSON", "REMARKS"];
  const H2 = [null, null, null, null, null, null, null, "MODE", "QTY", "BUY", "TOTAL", "TOTAL", "SELL", null, "POL", "POD", "AGENT", null, null];
  const rows = [
    [1, "02.11.2026", "02.11.2026", null, "SL268001", "SOHAR STEEL LLC", "SL268001 1X40' SHANGHAI CHINA TO SOHAR OMAN", "IMP", "1X40'", null, null, null, null, null, "SHANGHAI CHINA", "SOHAR OMAN", "CONSOL CLUB", "VIVEK", null],
    [2, "03.11.2026", null, null, "SL268002", "MUSCAT FOODS", "SL268002 LCL JEBEL ALI UAE TO SOHAR OMAN", "IMP", "LCL", null, null, null, null, null, "JEBEL ALI UAE", "SOHAR OMAN", null, "ANWAR", "URGENT"],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["SILVER LYNX COMPANY LLC"], ["NOVEMBER JOB ENQUIRIES - 2026"], H1, H2, ...rows]), "NOV");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

test("sign in, add an enquiry, import a workbook", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const calls = await mockSupabase(page);

  await test.step("sign in", async () => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel("E-mail").fill(EMAIL);
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Invalid login credentials")).toBeVisible();

    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Key figures" })).toBeVisible();
    expect(calls.signIns.at(-1)).toEqual({ email: EMAIL, password: PASSWORD });
  });

  await test.step("add an enquiry", async () => {
    await page.getByRole("link", { name: "New enquiry" }).click();
    await expect(page).toHaveURL(/\/enquiries\/new$/);
    await page.getByLabel("Customer *").fill("Gulf Star Industries");
    await page.getByLabel("Sales person").selectOption("VIVEK");
    await page.getByLabel("Qty").fill("2x20'");
    await page.getByLabel("POL").fill("Nhava Sheva India");
    await page.getByLabel("POD").fill("Sohar Oman");
    await page.getByRole("button", { name: "Create enquiry" }).click();

    await expect(page.getByText("Saved SL269001.")).toBeVisible();
    await expect(page).toHaveURL(/\/enquiries\/00000000-0000-4000-8000-000000000001$/);
    expect(calls.saved).toHaveLength(1);
    expect(calls.saved[0]).toMatchObject({
      customer_name: "GULF STAR INDUSTRIES",
      sales_person_name: "VIVEK",
      qty_text: "2X20'",
      shipment_mode: "FCL",
      units: 2,
      pol: "NHAVA SHEVA INDIA",
      pod: "SOHAR OMAN",
    });
  });

  await test.step("import a register workbook", async () => {
    await page.getByRole("link", { name: "Import" }).click();
    await expect(page).toHaveURL(/\/import$/);
    await page.locator('input[type="file"]').setInputFiles({
      name: "Daily Report NOVEMBER 2026.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: registerWorkbook(),
    });
    await page.getByRole("button", { name: /^Analyse/ }).click();
    const importButton = page.getByRole("button", { name: /^Import \d+ new/ });
    await expect(importButton).toHaveText("Import 2 new + 0 changed");
    await importButton.click();
    await expect(page.getByText(/2 new, 0 updated/)).toBeVisible();

    expect(calls.imported.map((r) => r.reference).sort()).toEqual(["SL268001", "SL268002"]);
    expect(calls.imported.find((r) => r.reference === "SL268002")).toMatchObject({ customer_name: "MUSCAT FOODS", sales_person_name: "ANWAR", remarks: "URGENT" });
    expect(calls.batches).toHaveLength(1);
    expect(calls.uploads).toHaveLength(1);
  });

  expect(errors).toEqual([]);
});
