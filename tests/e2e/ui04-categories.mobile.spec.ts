// UI04: /categories on an emulated phone (Pixel 7 in Chrome, not a real device).
import { freshClientIp, TEST_CLIENT_IP_HEADER } from "../fixtures/better-auth";
import { expect, overflowingContent, test } from "./support";

test("emulated phone: one column, no sideways overflow, 44px buttons, tap opens a category", async ({ context, page }) => {
  await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
  await page.route(/\/api\/categories\/counts(\?|$)/, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: { web: 12 } }) }),
  );
  await page.goto("/categories");
  const web = page.locator('[data-category="web"]');
  await expect(web).toContainText("12 projects");
  await expect.poll(() => overflowingContent(page)).toEqual([]);
  const [a, b] = [await web.boundingBox(), await page.locator('[data-category="mobile"]').boundingBox()];
  expect(Math.round(a!.x)).toBe(Math.round(b!.x));
  const browse = page.getByRole("button", { name: "Browse Web Applications" });
  expect(Math.round((await browse.boundingBox())!.height)).toBe(44);
  await browse.tap();
  await expect(page).toHaveURL(/\/categories\/web$/);
});
