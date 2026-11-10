// UI07 on an emulated phone (Pixel 7 in Chrome, not a real device).
import type { Route } from "@playwright/test";
import { freshClientIp, TEST_CLIENT_IP_HEADER } from "../fixtures/better-auth";
import { expect, overflowingContent, test } from "./support";

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
});

async function threePages(route: Route) {
  // The fixture set fills one page, so every page asks for page 1's projects.
  const res = await route.fetch({ url: route.request().url().replace(/([?&]page=)\d+/, "$11") });
  const body = await res.json();
  body.pagination = { ...(body.pagination ?? {}), total: 60, totalPages: 3 };
  await route.fulfill({ response: res, json: body });
}

test("/search: results fit the screen and a tile opens with a tap", async ({ page }) => {
  await page.goto("/search");
  await page.getByPlaceholder("Search categories, tags, or users...").fill("web");
  await expect(page.getByText(/Found \d+ results/)).toBeVisible();
  await expect.poll(() => overflowingContent(page)).toEqual([]);
  const tile = page.getByRole("tabpanel").getByRole("link", { name: /^Web Applications/ });
  expect(Math.round((await tile.boundingBox())!.height)).toBeGreaterThanOrEqual(44);
  await tile.tap();
  await expect(page).toHaveURL(/\/categories\/web$/);
});

test("/projects: full-width controls, 44px, and the short pager", async ({ page }) => {
  await page.route(/\/api\/projects\?/, threePages);
  await page.goto("/projects");
  await expect(page.locator("[data-project-card]").first()).toBeVisible();
  await expect.poll(() => overflowingContent(page)).toEqual([]);
  const sort = page.getByRole("combobox", { name: /^Sort by/ });
  expect(Math.round((await sort.boundingBox())!.height)).toBeGreaterThanOrEqual(44);
  const nav = page.getByRole("navigation", { name: "Pagination" });
  await expect(nav.getByText("Page 1 of 3")).toBeVisible();
  await nav.getByRole("button", { name: "Next page" }).tap();
  await expect(nav.getByText("Page 2 of 3")).toBeVisible();
});
