import { expect, test, type Page } from "@playwright/test";
import { sl262784 } from "../src/lib/brief/testkit";
import { EMAIL, mockSupabase, PASSWORD, SALES_PERSONS, type Seed } from "./supabaseMock";

// The enquiry page against a mocked Supabase: an enquiry whose e-mails say more than the register (quoted and won
// by e-mail, still "awaiting quote" in the register), read by a manager, a sales login and a viewer, on a desktop
// and on a phone. The e-mails are the unit tests' fixture, so the page is checked on the same conversation.

/** Mon 09 Nov 2026, 18:00 in Oman: the fixture's conversation ended that afternoon. */
const NOW = new Date("2026-11-09T14:00:00Z");
/** Set ENQUIRY_SHOTS to a folder to keep full-page screenshots of each view. */
const SHOTS = process.env.ENQUIRY_SHOTS;

function seed(profile?: Seed["profile"]): { seed: Seed; id: string; reference: string } {
  const { row, emails } = sl262784();
  const quiet = { ...row, id: "SL262999", reference: "SL262999", customer_id: "c-quiet", customer_name: "GULF STAR INDUSTRIES", subject: "SL262999 LCL SHANGHAI CHINA TO SOHAR OMAN", pol: "SHANGHAI CHINA", enquiry_date: "2026-11-09" };
  return {
    id: row.id,
    reference: row.reference,
    seed: {
      profile,
      enquiries: [row, quiet],
      emails: emails.map((e) => ({ ...e, enquiry_id: row.id })),
      agents: ["FRONTLINE", "CONSOLE CLUB", "YUXING"],
      mailboxes: [{ email: "pricing@silverlynxoman.com", active: true, last_synced_at: NOW.toISOString(), last_error: null, stats: {} }],
    },
  };
}

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
}

async function open(page: Page, s: Seed, id: string) {
  await page.clock.setFixedTime(NOW);
  await mockSupabase(page, s);
  await signIn(page);
  await page.goto(`/enquiries/${id}`);
  await expect(page.getByRole("region", { name: "At a glance" })).toBeVisible();
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("enquiry page", () => {
  test("a manager sees whose move it is, the offer, the margin and one next step", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const { seed: s, id } = seed();
    await open(page, s, id);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Oman Textiles");
    await expect(page.getByText(/E-mails say: won/)).toBeVisible();
    const band = page.getByRole("region", { name: "At a glance" });
    await expect(band.getByText("Whose move")).toBeVisible();
    await expect(band.getByText("471").first()).toBeVisible();
    await expect(band.getByText(/Frontline/i).first()).toBeVisible();
    // The page's one filled button is the Now card's.
    await expect(page.locator("#now-primary")).toHaveText(/Confirm job/);

    const talk = page.locator("#conversation");
    await expect(talk).toBeVisible();
    await expect(talk.getByText(/Oman Textiles/).first()).toBeVisible();
    await expect(talk.getByText(/Frontline/i).first()).toBeVisible();
    await expect(page.locator("#prices")).toBeVisible();
    await expect(page.locator("#shipment-track")).toBeVisible();
    await noSidewaysScroll(page);
    await shot(page, "manager-1440");

    await test.step("the fold at 1366 x 768", async () => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await noSidewaysScroll(page);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/manager-1366-fold.png` });
      await page.setViewportSize({ width: 1440, height: 900 });
    });

    await test.step("confirm job opens the form filled from the e-mails, and saves nothing", async () => {
      await page.locator("#now-primary").click();
      await expect(page).toHaveURL(new RegExp(`/enquiries/${id}/edit`));
      await expect(page.getByText(/Filled from the e-mails/)).toBeVisible();
      await shot(page, "manager-confirm-form");
    });

    expect(errors).toEqual([]);
  });

  test("on a phone nothing scrolls sideways and the next step comes first", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    const { seed: s, id } = seed();
    await open(page, s, id);
    await expect(page.locator("#now-primary")).toBeVisible();
    await noSidewaysScroll(page);
    await shot(page, "manager-390");
    expect(errors).toEqual([]);
  });

  test("a sales login gets no reply buttons, a viewer gets no buttons at all", async ({ page }) => {
    const { seed: sales, id } = seed({ role: "editor", sales_person_id: SALES_PERSONS[0].id });
    await open(page, sales, id);
    const talk = page.locator("#conversation");
    await expect(talk.getByRole("button", { name: /^Reply/ })).toHaveCount(0);
    await expect(page.getByText("Pricing replies from the mailbox").first()).toBeVisible();
    await shot(page, "sales-1440");
  });

  test("a viewer reads everything and can change nothing", async ({ page }) => {
    const { seed: viewer, id } = seed({ role: "viewer" });
    await open(page, viewer, id);
    await expect(page.locator("#now-primary")).toHaveCount(0);
    await expect(page.locator("#conversation").getByRole("button", { name: /^Reply/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
    await shot(page, "viewer-1440");
  });

  test("an enquiry with no e-mail says so and keeps the register's next step", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const { seed: s } = seed();
    await open(page, s, "SL262999");
    await expect(page.getByRole("region", { name: "At a glance" }).getByText(/No e-mails on file/)).toBeVisible();
    await expect(page.locator("#conversation").getByText(/No e-mails are filed here yet/)).toBeVisible();
    await expect(page.locator("#shipment-track")).toHaveCount(0);
    await noSidewaysScroll(page);
    await shot(page, "no-mail-1440");
    expect(errors).toEqual([]);
  });
});
