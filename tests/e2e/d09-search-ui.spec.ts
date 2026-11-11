// D09 S02e/S02f: project results on /search. Search is on by default (S02f):
// with the Convex read, results appear, never include a private project, and
// open the project page. With the Supabase read, or CODEDETAILS_E2E_SEARCH=off
// (the rollback position), the page shows no project section.
// CODEDETAILS_E2E_PREVIEW=1 also writes the before/after screenshots for
// Jose's preview into Agent Planning/phase-d09/preview/.
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { SYNTHETIC_PASSWORD, freshClientIp, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { BASE_URL, expect, test } from "./support";

const searchOn = process.env.CODEDETAILS_E2E_SEARCH !== "off";
const preview = process.env.CODEDETAILS_E2E_PREVIEW === "1";
const PREVIEW_DIR = path.resolve(__dirname, "../../Agent Planning/phase-d09/preview");

async function signIn(page: Page, label: string) {
  const email = syntheticEmail(label);
  const headers = { origin: BASE_URL };
  expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
  await verifyEmail(email);
  expect((await page.request.post("/api/auth/sign-in/email", { headers, data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
}

async function searchFor(page: Page, q: string) {
  await page.goto("/search");
  await page.getByPlaceholder("Search categories, tags, or users...").fill(q);
  await expect(page.getByText(/Found \d+ results/)).toBeVisible();
}

async function shot(page: Page, who: string) {
  if (!preview) return;
  fs.mkdirSync(PREVIEW_DIR, { recursive: true });
  await page.screenshot({ path: path.join(PREVIEW_DIR, `${searchOn ? "after" : "before"}-desktop-${who}.png`), fullPage: true, animations: "disabled" });
}

test.describe("D09 /search project results", () => {
  test.beforeEach(async ({ context }) => {
    await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
  });

  test("signed out: /search opens; projects appear only while search is on", async ({ page }) => {
    await searchFor(page, "fixture");
    const results = page.getByTestId("project-search-results");
    if (searchOn) {
      await expect(results.getByText("Fixture One Tag")).toBeVisible();
      await expect(results.getByText("Fixture Private Project")).toHaveCount(0);
      await expect(results.getByText("Fixture Deleted Recently")).toHaveCount(0);
    } else {
      // Give a switched-on search time to answer; nothing may appear.
      await page.waitForTimeout(2500);
      await expect(results).toHaveCount(0);
    }
    await shot(page, "signed-out");
  });

  test("signed in: the same project results; a result opens its page", async ({ page }) => {
    await signIn(page, "d09-search-ui");
    await searchFor(page, "fixture");
    const results = page.getByTestId("project-search-results");
    if (!searchOn) {
      await page.waitForTimeout(2500);
      await expect(results).toHaveCount(0);
      await shot(page, "signed-in");
      return;
    }
    await expect(results.getByText("Fixture One Tag")).toBeVisible();
    await shot(page, "signed-in");
    await results.getByRole("link", { name: /Fixture One Tag/ }).click();
    await expect(page).toHaveURL(/\/projects\/fixture-one-tag$/);
  });

  test("technology names: c# finds the C# projects only", async ({ page }) => {
    test.skip(!searchOn, "needs the Convex read with search on (the default)");
    await searchFor(page, "c#");
    const results = page.getByTestId("project-search-results");
    await expect(results.getByText("Fixture One Tag")).toBeVisible();
    await expect(results.getByText("Fixture Listed Project")).toHaveCount(0);
  });
});
