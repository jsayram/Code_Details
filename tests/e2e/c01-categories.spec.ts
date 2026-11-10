// C01: 22 categories. The owner creates and edits a project in each new
// category through the real pages, with category fields saving and showing; a
// stored ai-ml project keeps its fields under the new label; /categories,
// the category pages, the search page and the search API know all 22.
// Synthetic data only. The fixtures are reloaded with one extra ai-ml project
// at the start and reloaded plain at the end, so later specs see the usual set.
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { PROJECT_CATEGORIES } from "@/constants/project-categories";
import { authState, freshClientIp, linkPersona, releasePersona, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { clearConvexFixtures, loadConvexFixtures, sortKey } from "../fixtures/convex";
import { generateFixtures } from "../fixtures/generate";
import { BASE_URL, expect, test } from "./support";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const { a: A } = generateFixtures().personas;
const now = Date.now();

// An ai-ml project as it was stored before C01, fields and order included.
const LEGACY = {
  ownerKey: "a",
  title: "Fixture C01 Legacy Model",
  titleSortKey: sortKey("Fixture C01 Legacy Model"),
  slug: "fixture-c01-legacy-model",
  description: "Stored before the category expansion.",
  category: "ai-ml",
  categoryData: { modelType: "generative", modelArchitecture: "GPT-4 fine-tune", accuracy: "F1 0.91" },
  fieldOrder: ["modelType", "modelArchitecture", "accuracy"],
  links: [],
  visibility: "public" as const,
  status: "active" as const,
  tagKeys: [],
  favoriteCount: 0,
  rankingFavoriteCount: 0,
  shuffleKey: 0.42,
  createdAt: now,
  updatedAt: now,
};

interface Case {
  key: "ai-agents" | "generative-ai" | "libraries-frameworks";
  slug: string;
  title: string;
  select: { field: string; option: string };
  text: { field: string; placeholder: string; value: string };
}
const CASES: Case[] = [
  { key: "ai-agents", slug: "fixture-c01-agent", title: "Fixture C01 Agent", select: { field: "Agent Type", option: "MCP Server" }, text: { field: "Models Used", placeholder: "Claude, GPT-4o, Llama 3, a fine-tuned Mistral...", value: "Claude Sonnet" } },
  { key: "generative-ai", slug: "fixture-c01-genai", title: "Fixture C01 GenAI", select: { field: "Model Hosting", option: "Self-hosted" }, text: { field: "Quality & Evaluation", placeholder: "Eval set of 200 questions, 92% judged correct...", value: "Judged 88% correct" } },
  { key: "libraries-frameworks", slug: "fixture-c01-library", title: "Fixture C01 Library", select: { field: "Package Type", option: "SDK" }, text: { field: "Latest Version", placeholder: "2.4.1", value: "3.1.0" } },
];

async function signIn(page: Page, label: string): Promise<string> {
  const email = syntheticEmail(label);
  const headers = { origin: BASE_URL };
  expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
  await verifyEmail(email);
  expect((await page.request.post("/api/auth/sign-in/email", { headers, data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
  return email;
}

async function addField(page: Page, label: string) {
  await page.getByRole("button", { name: "Add Field" }).click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
  await page.keyboard.press("Escape");
}

/** The view-mode category chip and the token it should be colored with. */
async function chipUsesToken(page: Page, key: string) {
  const chip = page.locator(`.cd-cat[data-category="${key}"]`).first();
  await expect(chip).toHaveText(PROJECT_CATEGORIES[key as keyof typeof PROJECT_CATEGORIES].label);
  const [bg, token] = await chip.evaluate((el, k) => {
    const probe = document.createElement("span");
    probe.style.background = `var(--cd-cat-${k}-bg)`;
    el.parentElement!.appendChild(probe);
    const want = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return [getComputedStyle(el).backgroundColor, want];
  }, key);
  expect(token).not.toBe("rgba(0, 0, 0, 0)");
  expect(bg).toBe(token);
}

test.describe.serial("C01 categories", () => {
  test.beforeAll(async () => {
    await clearConvexFixtures();
    await loadConvexFixtures(generateFixtures(), undefined, [LEGACY]);
    await releasePersona(A.subject!);
  });
  test.afterAll(async () => {
    await releasePersona(A.subject!);
    await clearConvexFixtures();
    await loadConvexFixtures(generateFixtures());
  });
  test.beforeEach(async ({ context }) => {
    await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
  });

  test("a stored ai-ml project keeps its fields under the new label", async ({ page }) => {
    await page.goto(`/projects/${LEGACY.slug}`);
    await chipUsesToken(page, "ai-ml");
    const details = page.locator("#category-fields");
    await expect(details.getByRole("heading", { name: "Project Details" })).toBeVisible();
    await expect(details).toContainText("Generative AI");
    await expect(details).toContainText("GPT-4 fine-tune");
    await expect(details).toContainText("F1 0.91");
  });

  test("the owner creates and fills a project in each new category", async ({ page }) => {
    test.setTimeout(300_000);
    await linkPersona(A.subject!, (await authState(await signIn(page, "c01-owner")))!.authUserId);
    for (const c of CASES) {
      await page.goto("/projects/new");
      await page.locator("#title").fill(c.title);
      await page.locator("#slug").fill(c.slug);
      await page.getByRole("combobox").first().click();
      await expect(page.getByRole("option")).toHaveCount(22);
      await page.getByRole("option", { name: PROJECT_CATEGORIES[c.key].label, exact: true }).click();
      await page.getByRole("button", { name: "Create Project" }).click();
      await page.waitForURL(`**/projects/${c.slug}`);
      await chipUsesToken(page, c.key);

      await page.goto(`/projects/${c.slug}?edit=true`);
      await expect(page.getByRole("button", { name: "Add Field" })).toBeVisible();
      await addField(page, c.select.field);
      await page.getByRole("button", { name: "Select an option" }).click();
      await page.getByRole("button", { name: c.select.option, exact: true }).click();
      await addField(page, c.text.field);
      await page.getByPlaceholder(c.text.placeholder, { exact: true }).fill(c.text.value);
      await page.getByRole("button", { name: "Save Changes" }).click();
      await expect(page.getByText("Project updated successfully!").first()).toBeVisible();

      // Saved, not just shown: a fresh load of the public page.
      await page.goto(`/projects/${c.slug}`);
      const details = page.locator("#category-fields");
      await expect(details).toContainText(c.select.field);
      await expect(details).toContainText(c.select.option);
      await expect(details).toContainText(c.text.field);
      await expect(details).toContainText(c.text.value);
    }
  });

  test("re-filing: ML Models & Research to AI Agents & Assistants keeps the shared field", async ({ page }) => {
    // Models Used shares its id with ai-ml's Model Architecture, so the move
    // loses nothing, needs no confirmation and the value shows under the new label.
    await releasePersona(A.subject!);
    await linkPersona(A.subject!, (await authState(await signIn(page, "c01-owner-edit")))!.authUserId);
    await page.goto("/projects/new");
    await page.locator("#title").fill("Fixture C01 Refile");
    await page.locator("#slug").fill("fixture-c01-refile");
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "ML Models & Research", exact: true }).click();
    await page.getByRole("button", { name: "Create Project" }).click();
    await page.waitForURL("**/projects/fixture-c01-refile");
    await page.goto("/projects/fixture-c01-refile?edit=true");
    await addField(page, "Model Architecture");
    await page.getByPlaceholder("Transformer, CNN, LSTM, GPT-4...", { exact: true }).fill("Claude Haiku");
    await page.getByRole("button", { name: "Save Changes" }).click();
    await expect(page.getByText("Project updated successfully!").first()).toBeVisible();

    await page.goto("/projects/fixture-c01-refile?edit=true");
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "AI Agents & Assistants", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Models Used" })).toHaveValue("Claude Haiku");
    await page.getByRole("button", { name: "Save Changes" }).click();
    await expect(page.getByText("Project updated successfully!").first()).toBeVisible();
    await page.goto("/projects/fixture-c01-refile");
    await chipUsesToken(page, "ai-agents");
    await expect(page.locator("#category-fields")).toContainText("Models Used");
    await expect(page.locator("#category-fields")).toContainText("Claude Haiku");
  });

  test("/categories lists 22 with live counts, by keyboard", async ({ page }) => {
    await page.goto("/categories");
    await expect(page.getByText("22 categories")).toBeVisible();
    await expect(page.locator(".cd-grid > li")).toHaveCount(22);
    // The legacy ai-ml project, one created per new category, and the re-filed one.
    for (const [key, n] of [["ai-agents", "2 projects"], ["generative-ai", "1 project"], ["libraries-frameworks", "1 project"], ["ai-ml", "1 project"]]) {
      await expect(page.locator(`[data-category="${key}"]`)).toContainText(n);
    }
    for (const [key, { label }] of Object.entries(PROJECT_CATEGORIES)) {
      await expect(page.locator(`[data-category="${key}"]`).getByRole("heading", { level: 2 })).toHaveText(label);
    }
    const browse = page.getByRole("button", { name: "Browse AI Agents & Assistants" });
    await browse.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/categories\/ai-agents$/);
    await expect(page.locator(".project-card", { hasText: "Fixture C01 Agent" })).toBeVisible();
    await expect(page.locator(".project-card", { hasText: "Fixture C01 GenAI" })).toHaveCount(0);
  });

  test("axe finds nothing on /categories and a new category's page", async ({ page }) => {
    for (const path of ["/categories", "/categories/libraries-frameworks"]) {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      await page.waitForLoadState("networkidle");
      // The list controls (category and sort selects, pagination) are UI07's; UI06 excluded them too.
      const results = await new AxeBuilder({ page }).withTags(WCAG).include("main").exclude('[role="combobox"]').exclude("nav[aria-label='pagination']").analyze();
      expect(results.violations.map((v) => `${path} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    }
  });

  test("the search page finds the new and renamed categories", async ({ page }) => {
    const search = async (q: string) => {
      await page.goto("/search");
      await page.getByPlaceholder("Search categories, tags, or users...").fill(q);
      await expect(page.getByRole("tab", { name: "Categories" })).toBeVisible();
    };
    // "ai" matches the three AI categories by label and key, and nothing else's label.
    await search("ai");
    await page.getByRole("tab", { name: "Categories" }).click();
    const panel = page.getByRole("tabpanel");
    for (const label of ["ML Models & Research", "AI Agents & Assistants", "Generative AI Apps"]) {
      await expect(panel.getByText(label, { exact: true })).toBeVisible();
    }
    // A broad query lists every match (19 of 22 contain an "e").
    await search("e");
    await page.getByRole("tab", { name: "Categories" }).click();
    const misses = new Set(["gaming-graphics", "ar-vr-xr", "automation-scripting"]);
    for (const [key, { label }] of Object.entries(PROJECT_CATEGORIES)) {
      const tile = page.getByRole("tabpanel").getByText(label, { exact: true });
      if (misses.has(key)) await expect(tile).toHaveCount(0);
      else await expect(tile).toBeVisible();
    }

    // Old labels are gone, new ones are found by their words.
    await search("workflows");
    await expect(page.getByText("Automation & Workflows", { exact: true }).first()).toBeVisible();
    await search("scripting");
    await expect(page.getByText("Automation & Workflows", { exact: true }).first()).toBeVisible(); // by its key
    // A category with projects opens from its tile (empty ones don't, as before).
    await search("generative");
    await page.getByText("Generative AI Apps", { exact: true }).first().click();
    await expect(page).toHaveURL(/\/categories\/generative-ai$/);
  });

  test("the search API filters by a new category and still refuses unknown ones", async ({ page }) => {
    await expect
      .poll(async () => (await page.request.get("/api/search?q=Fixture%20C01&category=libraries-frameworks")).text(), { timeout: 30_000 })
      .toContain("fixture-c01-library");
    const body = await (await page.request.get("/api/search?q=Fixture%20C01&category=libraries-frameworks")).text();
    expect(body).not.toContain("fixture-c01-agent");
    expect((await page.request.get("/api/search?q=Fixture&category=ai-stuff")).status()).toBe(400);
  });
});
