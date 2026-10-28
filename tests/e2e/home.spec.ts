import { generateFixtures } from "../fixtures/generate";
import { expect, test } from "./support";

const listed = generateFixtures().projects.find((p) => p.case === "listed")!;

// B04: existing pages load and their core content is usable, signed out, on desktop.
test.describe("signed out, desktop", () => {
  test("homepage renders the hero and the theme switch works", async ({ page, blocked }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    const response = await page.goto("/");
    expect(response?.status()).toBe(200);

    await expect(page.getByRole("heading", { level: 1, name: "{ Details }" })).toBeVisible();
    await expect(page.getByText("AUTHENTICATE TO CONTINUE")).toBeVisible();
    // Opens Clerk's modal, which the signed-out stub doesn't render; presence only.
    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();

    const toggle = page.getByRole("switch", { name: "Toggle theme" });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);

    expect(pageErrors).toEqual([]);
    test.info().annotations.push({ type: "blocked-requests", description: JSON.stringify(blocked) });
  });

  test("a public project page shows the fixture project from the test database", async ({ page, blocked }) => {
    const response = await page.goto(`/projects/${listed.slug}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: listed.title }).first()).toBeVisible();
    await expect(page.getByText(listed.description!).first()).toBeVisible();
    test.info().annotations.push({ type: "blocked-requests", description: JSON.stringify(blocked) });
  });
});
