// UI03 on an emulated phone (Pixel 7 in Chrome, not a real device). UI11
// removed the design-foundations preview and its phone test.
import { expect, test } from "./support";

test("emulated phone: a pinch gesture really zooms the page", async ({ context, page }) => {
  await page.goto("/");
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.synthesizePinchGesture", { x: 195, y: 300, scaleFactor: 2, gestureSourceType: "touch" });
  await expect.poll(() => page.evaluate(() => window.visualViewport!.scale)).toBeGreaterThan(1.2);
});
