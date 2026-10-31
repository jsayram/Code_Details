// D09 S02e on a phone (Pixel 7 emulation): /search opens signed out, project
// results only while search is on, and the results fit the screen. Screenshots
// for Jose's preview with CODEDETAILS_E2E_PREVIEW=1 (see d09-search-ui.spec.ts).
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { SYNTHETIC_PASSWORD, freshClientIp, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { BASE_URL, expect, test } from "./support";

const searchOn = process.env.CODEDETAILS_E2E_SEARCH === "on" && process.env.CODEDETAILS_E2E_READ_BACKEND === "convex";
const preview = process.env.CODEDETAILS_E2E_PREVIEW === "1";
const PREVIEW_DIR = path.resolve(__dirname, "../../Agent Planning/phase-d09/preview");

async function signIn(page: Page, label: string) {
  const email = syntheticEmail(label);
  const headers = { origin: BASE_URL };
  expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
  await verifyEmail(email);
  expect((await page.request.post("/api/auth/sign-in/email", { headers, data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
}

async function check(page: Page, who: string) {
  await page.goto("/search");
  await page.getByPlaceholder("Search categories, tags, or users...").fill("fixture");
  await expect(page.getByText(/Found \d+ results/)).toBeVisible();
  const results = page.getByTestId("project-search-results");
  if (searchOn) {
    await expect(results.getByText("Fixture One Tag")).toBeVisible();
    const box = await results.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  } else {
    await page.waitForTimeout(2500);
    await expect(results).toHaveCount(0);
  }
  if (preview) {
    fs.mkdirSync(PREVIEW_DIR, { recursive: true });
    await page.screenshot({ path: path.join(PREVIEW_DIR, `${searchOn ? "after" : "before"}-mobile-${who}.png`), fullPage: true, animations: "disabled" });
  }
}

test.describe("D09 /search project results, mobile", () => {
  test.beforeEach(async ({ context }) => {
    await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
  });

  test("signed out", async ({ page }) => {
    await check(page, "signed-out");
  });

  test("signed in", async ({ page }) => {
    await signIn(page, "d09-search-ui-mobile");
    await check(page, "signed-in");
  });
});
