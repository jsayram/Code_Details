// X1: a Mermaid block in a generated doc must not run script on the viewer
// page. Generated Markdown is untrusted (LLM output over repo files), and
// D11s lets another signed-in user read a doc linked to a project they can
// open. The doc here is persona A's, linked to A's live fixture project, and
// persona B opens it and clicks the diagram node. Synthetic data only, in the
// isolated server's own output root (.test-runtime/docs-output).
import fs from "node:fs";
import path from "node:path";
import type { APIRequestContext } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { authState, clientWithToken, convexToken, freshClientIp, linkPersona, releasePersona, signUp as fixtureSignUp, SYNTHETIC_PASSWORD, syntheticEmail, verifyEmail } from "../fixtures/better-auth";
import { generateFixtures } from "../fixtures/generate";
import { BASE_URL, expect, test } from "./support";
import { TEST_CONVEX_URL } from "../support/isolation";

const FIXTURES = generateFixtures();
const { a: A, b: B } = FIXTURES.personas;
const LISTED = FIXTURES.projects.find((p) => p.slug === "fixture-listed")!;
const OUTPUT = path.resolve(__dirname, "../..", ".test-runtime", "docs-output");
const SLUG = "x1-fixture-mermaid";
const CHAPTER = "01_intro.md";
const getPublicBySlug = makeFunctionReference<"query", { slug: string }, { id: string } | null>("projects:getPublicBySlug");
const docOwner = makeFunctionReference<"query", Record<string, never>, { userId: string } | null>("identity:docOwner");

// A javascript: link on a node, and an HTML label with an inline handler.
// Neither may reach the page as something that runs.
const CHART = [
  "flowchart TD",
  '  A["<img src=x onerror=window.__x1img=1>Start"] --> B["End"]',
  '  click A href "javascript:window.__x1xss=1;void 0"',
].join("\n");

async function signIn(ctx: APIRequestContext, label: string): Promise<string> {
  const headers = { origin: BASE_URL, "x-forwarded-for": freshClientIp() };
  const email = syntheticEmail(label);
  expect((await ctx.post("/api/auth/sign-up/email", { headers, data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
  await verifyEmail(email);
  expect((await ctx.post("/api/auth/sign-in/email", { headers, data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
  return email;
}

test.describe.serial("X1 Mermaid in a linked doc", () => {
  test.beforeAll(async () => {
    const dir = path.join(OUTPUT, SLUG);
    if (fs.existsSync(dir)) throw new Error(`refusing to overwrite ${dir}: remove the leftover test fixture and rerun`);
    const linkedProjectId = (await new ConvexHttpClient(TEST_CONVEX_URL).query(getPublicBySlug, { slug: LISTED.slug }))!.id;
    await releasePersona(A.subject!);
    await releasePersona(B.subject!);
    // Persona A's account ID, read through a throwaway linked login.
    const email = syntheticEmail("x1-account-a");
    const res = await fixtureSignUp(email, SYNTHETIC_PASSWORD);
    expect(res.status).toBe(200);
    await linkPersona(A.subject!, (await authState(email))!.authUserId);
    const owner = (await clientWithToken((await convexToken(res.jar))!).query(docOwner, {}))!.userId;
    await releasePersona(A.subject!);

    fs.mkdirSync(dir, { recursive: true });
    const meta = { projectSlug: SLUG, userId: owner, repoUrl: `https://github.com/synthetic/${SLUG}`, repoOwner: "synthetic", repoName: SLUG, createdAt: "2026-11-10T00:00:00.000Z", chapters: [{ order: 1, title: "Intro", filename: CHAPTER }], llmProvider: "synthetic", llmModel: "synthetic", linkedProjectId, linkedProjectSlug: LISTED.slug, linkedProjectTitle: LISTED.title };
    fs.writeFileSync(path.join(dir, "_meta.json"), JSON.stringify(meta));
    fs.writeFileSync(path.join(dir, CHAPTER), `---\ntitle: Intro\norder: 1\n---\n\nSynthetic chapter.\n\n\`\`\`mermaid\n${CHART}\n\`\`\`\n`);
  });
  test.afterAll(async () => {
    fs.rmSync(path.join(OUTPUT, SLUG), { recursive: true, force: true });
    await releasePersona(A.subject!);
    await releasePersona(B.subject!);
  });

  test("another user opens the diagram and clicks the node: nothing runs", async ({ page }) => {
    const email = await signIn(page.request, "x1-viewer");
    await linkPersona(B.subject!, (await authState(email))!.authUserId);
    await page.goto(`/github-scrapper/docs/${SLUG}/${CHAPTER}`);
    await expect(page.getByText("Synthetic chapter.")).toBeVisible();
    const svg = page.locator("svg[id^='mermaid-']");
    await expect(svg).toBeVisible({ timeout: 15_000 });

    const found = await svg.evaluate((el) => {
      const hrefs = [...el.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? a.getAttribute("xlink:href") ?? "");
      const handlers = [...el.querySelectorAll("*")].flatMap((n) => [...n.attributes].filter((a) => /^on/i.test(a.name)).map((a) => `${n.tagName}.${a.name}`));
      return { hrefs, handlers };
    });

    // Click the node the way a reader would. In strict mode its link is
    // about:blank, so a navigation is fine; script running is not.
    const url = page.url();
    await page.getByText("Start", { exact: true }).first().click({ noWaitAfter: true });
    await page.waitForTimeout(500);
    const ran = page.url() === url ? await page.evaluate(() => ({ xss: (window as unknown as Record<string, unknown>).__x1xss ?? null, img: (window as unknown as Record<string, unknown>).__x1img ?? null })) : { xss: null, img: null };
    expect({
      jsHrefs: found.hrefs.filter((h) => /^\s*javascript:/i.test(h)),
      handlers: found.handlers,
      ran,
    }).toEqual({ jsHrefs: [], handlers: [], ran: { xss: null, img: null } });
  });
});
