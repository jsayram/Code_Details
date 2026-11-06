// UI03: the preview on an emulated phone (Pixel 7 in Chrome, not a real device).
import { authState, freshClientIp, setRole, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { BASE_URL, expect, overflowingContent, test } from "./support";

test("emulated phone: no sideways overflow and full-size touch targets", async ({ context, page }) => {
  await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
  const email = syntheticEmail("ui03-phone");
  const headers = { origin: BASE_URL };
  expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
  await verifyEmail(email);
  expect((await page.request.post("/api/auth/sign-in/email", { headers, data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
  await setRole((await authState(email))!.authUserId, "admin");
  await page.goto("/dashboard/admin/design-foundations");
  await expect(page.getByRole("heading", { level: 1, name: "Design foundations" })).toBeVisible();
  await expect.poll(() => overflowingContent(page)).toEqual([]);
  await page.getByRole("button", { name: "Compact" }).tap();
  const input = page.locator("#foundations-title");
  await expect.poll(async () => (await input.boundingBox())!.height).toBeCloseTo(44, 0);
});

test("emulated phone: a pinch gesture really zooms the page", async ({ context, page }) => {
  await page.goto("/");
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.synthesizePinchGesture", { x: 195, y: 300, scaleFactor: 2, gestureSourceType: "touch" });
  await expect.poll(() => page.evaluate(() => window.visualViewport!.scale)).toBeGreaterThan(1.2);
});
