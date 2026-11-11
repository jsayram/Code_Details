// The server-rendered HTML of the public project page must hydrate as is.
// TableOfContents used to list every section on the server and only the
// sections present in the DOM on the client, so React threw "Hydration
// failed" and re-rendered the page on every project without a Details section.
import { generateFixtures } from "../fixtures/generate";
import { expect, test } from "./support";

const set = generateFixtures();

for (const c of ["listed", "noDescription", "fifteenTags"] as const) {
  const p = set.projects.find((x) => x.case === c)!;
  test(`project page hydrates without a mismatch: ${c}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.goto(`/projects/${p.slug}`);
    await expect(page.getByRole("heading", { level: 1 }).filter({ visible: true }).first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(errors.filter((e) => /hydrat/i.test(e))).toEqual([]);
    // The list still narrows to the sections that exist once mounted.
    await expect(page.getByRole("button", { name: "Details", exact: true })).toHaveCount(0);
  });
}
