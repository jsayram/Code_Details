// UI07: search and discovery on the foundations. /search, /tags,
// /tags/<name>, /categories/<key> and the project lists: links instead of
// click handlers, named controls, keyboard pagination, and loading, empty and
// failed states. Synthetic accounts and data only.
import AxeBuilder from "@axe-core/playwright";
import type { Page, Route } from "@playwright/test";
import { freshClientIp, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { BASE_URL, expect, test } from "./support";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const headers = { origin: BASE_URL };
const SEARCH = "Search categories, tags, or users...";

async function signIn(page: Page, label: string) {
  const email = syntheticEmail(label);
  expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
  await verifyEmail(email);
  expect((await page.request.post("/api/auth/sign-in/email", { headers, data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
}

async function searchFor(page: Page, q: string) {
  await page.goto("/search");
  await page.getByPlaceholder(SEARCH).fill(q);
  await expect(page.getByText(/Found \d+ results/)).toBeVisible();
}

/** axe on the page's main content; the shell has its own UI05 checks. */
async function mainAxe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(WCAG).include("main").analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`);
}

/** The real /api/projects answer, but claiming three pages, so pagination shows with the small fixture set. */
async function threePages(route: Route) {
  // The fixture set fills one page, so every page asks for page 1's projects.
  const res = await route.fetch({ url: route.request().url().replace(/([?&]page=)\d+/, "$11") });
  const body = await res.json();
  body.pagination = { ...(body.pagination ?? {}), total: 60, totalPages: 3 };
  await route.fulfill({ response: res, json: body });
}

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
});

test.describe("UI07.1 /search", () => {
  test("one h1, a labelled field, the explore shortcuts are links reached by Tab", async ({ page }) => {
    await page.goto("/search");
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Search Code Details");
    const field = page.getByRole("textbox", { name: "Search Code Details" });
    await expect(field).toBeFocused();
    for (const [name, href] of [["Categories", "/categories"], ["Tags", "/tags"], ["Users", "/users"]]) {
      await expect(page.getByRole("link", { name: new RegExp(`^${name}`) })).toHaveAttribute("href", href);
    }
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: /^Categories/ })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/categories$/);
  });

  test("the mascot is served through the image optimizer, not as the 3.4MB file", async ({ page }) => {
    await page.goto("/search");
    const src = await page.getByRole("img", { name: "Code Details Mascot" }).getAttribute("src");
    expect(src).toContain("/_next/image");
    expect(src).not.toMatch(/^\/images\/mascot\.png$/);
  });

  test("category tiles, tags and people are links; empty ones are not", async ({ page }) => {
    await searchFor(page, "e");
    const panel = page.getByRole("tabpanel");
    const web = panel.getByRole("link", { name: /^Web Applications/ });
    await expect(web).toHaveAttribute("href", "/categories/web");
    // A category with no projects is listed and is not a link.
    const tiles = await panel.locator(".cd-tile").evaluateAll((els) =>
      els.filter((e) => e.querySelector("h3") && !e.closest("[data-testid]")).map((e) => ({ link: e.tagName === "A", count: Number(/\d+/.exec(e.querySelector(".cd-status")?.textContent ?? "0")?.[0] ?? 0) })),
    );
    expect(tiles.length).toBeGreaterThan(0);
    for (const t of tiles) expect(t.link).toBe(t.count > 0);
    await web.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/categories\/web$/);

    await searchFor(page, "rust");
    const rust = page.getByRole("tabpanel").getByRole("link", { name: /^Rust/ });
    await expect(rust).toHaveAttribute("href", "/tags/Rust");
    await rust.click();
    await expect(page).toHaveURL(/\/tags\/Rust$/);
  });

  test("the result count is announced; no match says so", async ({ page }) => {
    await searchFor(page, "zzzqqqnothing");
    await expect(page.getByRole("status").filter({ hasText: "Found 0 results" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "No results found" })).toBeVisible();
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(page.getByRole("heading", { name: "Ready to explore?" })).toBeVisible();
  });

  test("a long query wraps and nothing widens the page", async ({ page }) => {
    await searchFor(page, "Unbrokenprojecttitlewithnospacesatallthatkeepsgoingandgoingandgoing");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("a list that fails to load is reported, with Try again", async ({ page }) => {
    // The people list needs a session; signed out its 401 is not a failure.
    await searchFor(page, "fixture");
    await expect(page.getByRole("alert").filter({ hasText: "Some results didn't load" })).toHaveCount(0);
    await signIn(page, "ui07-search-failure");
    await page.route("**/api/profiles", (r) => r.fulfill({ status: 500, contentType: "application/json", body: '{"success":false,"error":{"detail":"forced"}}' }));
    await searchFor(page, "fixture");
    const alert = page.getByRole("alert").filter({ hasText: "Some results didn't load" });
    await expect(alert).toContainText("people");
    await page.unroute("**/api/profiles");
    await alert.getByRole("button", { name: "Try again" }).click();
    await expect(alert).toHaveCount(0);
  });

  test("tabs work by keyboard", async ({ page }) => {
    await searchFor(page, "fixture");
    const all = page.getByRole("tab", { name: "All" });
    await all.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Categories" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("tab", { name: "Categories" })).toHaveAttribute("aria-selected", "true");
  });
});

test.describe("UI07.2 tags", () => {
  test("/tags: tags with projects are links, by keyboard too", async ({ page }) => {
    await page.goto("/tags");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Browse All Tags");
    const rust = page.getByRole("link", { name: /^Rust\s*\d+$/ });
    await expect(rust).toHaveAttribute("href", "/tags/Rust");
    // Tags no project uses yet are listed but are not links.
    const available = page.getByRole("region", { name: "Available Tags" });
    if (await available.count()) await expect(available.getByRole("link")).toHaveCount(0);
    await rust.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/tags\/Rust$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("rust");
    await expect(page.locator("[data-project-card]", { hasText: "Fixture Bob's Project" }).first()).toBeVisible();
  });
});

test.describe("UI07.3 lists: controls, pagination, states", () => {
  test("the sort and category selects are named and change the list", async ({ page }) => {
    await page.goto("/projects");
    await expect(page.locator("[data-project-card]").first()).toBeVisible();
    const sort = page.getByRole("combobox", { name: /^Sort by/ });
    const category = page.getByRole("combobox", { name: /^Category/ });
    await expect(sort).toBeVisible();
    await expect(category).toHaveAccessibleName(/Category All Categories/);
    const asked: string[] = [];
    page.on("request", (r) => { if (r.url().includes("/api/projects?")) asked.push(r.url()); });
    await category.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("option", { name: "Web Applications" }).click();
    await expect(category).toHaveAccessibleName(/Web Applications/);
    await expect.poll(() => asked.some((u) => u.includes("category=web"))).toBe(true);
    await sort.click();
    await page.getByRole("option", { name: /Oldest/ }).click();
    await expect.poll(() => asked.some((u) => u.includes("sortBy=oldest"))).toBe(true);
  });

  test("pagination: buttons in a named nav, reached by Tab, current page marked", async ({ page }) => {
    await page.route(/\/api\/projects\?/, threePages);
    await page.goto("/projects");
    const nav = page.getByRole("navigation", { name: "Pagination" });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("button", { name: "Page 1" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("button", { name: "Previous page" })).toBeDisabled();
    const asked: string[] = [];
    page.on("request", (r) => { if (r.url().includes("/api/projects?")) asked.push(r.url()); });
    await nav.getByRole("button", { name: "Page 1" }).focus();
    await page.keyboard.press("Tab");
    await expect(nav.getByRole("button", { name: "Page 2" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(() => asked.some((u) => u.includes("page=2"))).toBe(true);
    await expect(page.getByRole("navigation", { name: "Pagination" }).getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
  });

  test("a failed list says so and Try again loads it", async ({ page }) => {
    let fail = true;
    await page.route(/\/api\/projects\?/, (r) => (fail ? r.fulfill({ status: 500, contentType: "application/json", body: '{"success":false,"error":"forced"}' }) : r.continue()));
    await page.goto("/projects");
    const alert = page.getByRole("alert").filter({ hasText: "Projects didn't load" });
    await expect(alert).toBeVisible();
    await expect(page.getByText("It's your time to shine!")).toHaveCount(0);
    fail = false;
    await alert.getByRole("button", { name: "Try again" }).click();
    await expect(page.locator("[data-project-card]").first()).toBeVisible();
  });

  test("table view: pressed state, sort headers and links", async ({ page }) => {
    await page.goto("/projects");
    await expect(page.locator("[data-project-card]").first()).toBeVisible();
    const table = page.getByRole("button", { name: "Table" });
    await expect(table).toHaveAttribute("aria-pressed", "false");
    await table.click();
    await expect(table).toHaveAttribute("aria-pressed", "true");
    const title = page.getByRole("columnheader", { name: "Title" });
    await title.getByRole("button").click();
    await expect(title).toHaveAttribute("aria-sort", "ascending");
    await expect(page.locator("table").getByRole("link", { name: "Fixture Listed Project" }).first()).toHaveAttribute("href", "/projects/fixture-listed");
  });

  test("/categories/<key>: one h1 with the full description, no category filter", async ({ page }) => {
    await page.goto("/categories/backend");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Backend Systems Projects");
    await expect(page.getByText(/Database engines go in Databases & Storage/)).toBeVisible();
    await expect(page.getByRole("combobox", { name: /^Sort by/ })).toBeVisible();
    await expect(page.getByRole("combobox", { name: /^Category/ })).toHaveCount(0);
  });

  test("personal lists stay owner-only; signed in they show the tier", async ({ page }) => {
    for (const path of ["/projects/favorites", "/projects/deleted", "/projects/projects-portfolio"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/sign-in/);
    }
    await signIn(page, "ui07-personal");
    for (const [path, h1] of [["/projects/favorites", "Favorite Projects"], ["/projects/deleted", "Digital Graveyard"], ["/projects/projects-portfolio", "Projects Portfolio"]]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(h1);
      await expect(page.getByText(/\b(free|pro|diamond) member\b/i).first()).toBeVisible();
      await expect(page.locator("h1")).toHaveCount(1);
    }
  });
});

test.describe("UI07 axe, both themes", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`no violations on the discovery pages (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const found: string[] = [];
      for (const [path, q] of [["/search", ""], ["/search", "fixture"], ["/tags", ""], ["/tags/rust", ""], ["/categories/web", ""], ["/projects", ""]] as const) {
        if (q) await searchFor(page, q);
        else await page.goto(path);
        await expect(page.locator("main")).toBeVisible();
        await page.waitForLoadState("networkidle");
        found.push(...(await mainAxe(page)).map((v) => `${path}${q ? `?${q}` : ""} ${v}`));
      }
      expect(found).toEqual([]);
    });
  }
});
