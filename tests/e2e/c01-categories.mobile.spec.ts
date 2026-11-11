// C01: the 22 categories on an emulated phone (Pixel 7 in Chrome, not a real
// device). Counts are served in the test's network layer, so no data changes.
import { freshClientIp, TEST_CLIENT_IP_HEADER } from "../fixtures/better-auth";
import { expect, overflowingContent, test } from "./support";

test("emulated phone: 22 categories, the longest new ones wrap without sideways overflow", async ({ context, page }) => {
  await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
  await page.route(/\/api\/categories\/counts(\?|$)/, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: { "ai-agents": 3, "libraries-frameworks": 1 } }) }),
  );
  await page.goto("/categories");
  await expect(page.getByText("22 categories")).toBeVisible();
  await expect(page.locator(".cd-grid > li")).toHaveCount(22);
  await expect(page.locator('[data-category="ai-agents"]')).toContainText("3 projects");
  await expect.poll(() => overflowingContent(page)).toEqual([]);
  const browse = page.getByRole("button", { name: "Browse Libraries & Frameworks" });
  await browse.scrollIntoViewIfNeeded();
  expect(Math.round((await browse.boundingBox())!.height)).toBe(44);
  await browse.tap();
  await expect(page).toHaveURL(/\/categories\/libraries-frameworks$/);
});
