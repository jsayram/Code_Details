import AxeBuilder from "@axe-core/playwright";
import { generateFixtures } from "../fixtures/generate";
import { expect, test } from "./support";

const listed = generateFixtures().projects.find((p) => p.case === "listed")!;
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

// Triaged findings that exist today (Phase B, B07). Each is deferred, not
// fixed: the backend migration preserves the frontend. A new rule or extra node
// fails the test; a fixed one fails too, so this list gets updated on purpose.
// UI03 removed the last one: meta-viewport blocked zoom until decision 10.
const KNOWN: Record<string, Record<string, number>> = {
  "/": {},
  [`/projects/${listed.slug}`]: {},
};

for (const [path, known] of Object.entries(KNOWN)) {
  test(`axe WCAG 2.2 A/AA on ${path} matches the triaged findings`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    // The floating code particles are decorative (aria-hidden) and fade in and
    // out, so axe sometimes caught one mid-fade at 1.01:1 and the test flaked
    // (1–3 runs in 8, Phase C). They're excluded here; whether faint
    // decorative text is acceptable is a design call for the UI work.
    const results = await new AxeBuilder({ page }).withTags(WCAG).exclude('[data-decorative="code-particles"]').analyze();

    const found = Object.fromEntries(results.violations.map((v) => [v.id, v.nodes.length]));
    expect(found).toEqual(known);

    // axe can't decide these (gradient text contrast, for example); they need a person.
    test.info().annotations.push({
      type: "axe-incomplete",
      description: results.incomplete.map((r) => `${r.id} (${r.nodes.length})`).join(", ") || "none",
    });
  });
}

// What axe can't prove: keyboard reachability. Tab from the top of the
// homepage reaches the theme switch and Sign In. Before UI05 the switch was a
// div with no tabIndex (B03's known gap); it's a real button now.
test("keyboard: Tab reaches the theme switch and Sign In", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "{ Details }" })).toBeVisible();

  const reached: string[] = [];
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press("Tab");
    reached.push(
      await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return "body";
        return `${el.getAttribute("role") ?? el.tagName.toLowerCase()}:${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)}`;
      }),
    );
  }
  test.info().annotations.push({ type: "tab-order", description: reached.join(" | ") });
  expect(reached.some((r) => /Sign In/.test(r))).toBe(true);
  expect(reached.some((r) => r.startsWith("switch:"))).toBe(true);
});
