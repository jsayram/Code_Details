// F02: small public-sharing fixes ahead of UI03 (UI02 defects 1, 2, 3, 8, 14).
// Synthetic users and synthetic images only. Every test leaves the shared
// fixture set as it found it.
import type { Page } from "@playwright/test";
import { makeFunctionReference } from "convex/server";
import { authState, freshClientIp, linkPersona, releasePersona, setRole, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { adminClient } from "../fixtures/convex";
import { clientAs } from "../fixtures/convex-auth";
import { generateFixtures, placeholderPng } from "../fixtures/generate";
import { BASE_URL, expect, test } from "./support";

const { a: A } = generateFixtures().personas;
const headers = { origin: BASE_URL };

async function signIn(page: Page, label: string): Promise<string> {
  const email = syntheticEmail(label);
  expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
  await verifyEmail(email);
  expect((await page.request.post("/api/auth/sign-in/email", { headers, data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
  return email;
}

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
});

test.describe.serial("F02 images on shared links", () => {
  const SLUG = "fixture-unicode"; // A's, public, no images of its own
  const fn = {
    bySlug: makeFunctionReference<"query", { slug: string }, { id: string } | null>("projects:getPublicBySlug"),
    uploadUrl: makeFunctionReference<"mutation", { projectId: string; kind: string }, { ok: boolean; uploadUrl: string }>("projectImages:generateUploadUrl"),
    attach: makeFunctionReference<"mutation", Record<string, unknown>, { ok: boolean }>("projectImages:attach"),
    state: makeFunctionReference<"query", { projectId: string }, unknown[]>("fixtures:imageState"),
  };
  let projectId = "";
  const stored = (page: Page) => page.locator('#images img[src*="api%2Fstorage"], #images img[src*="/api/storage/"]');
  const editControls = (page: Page) => page.getByRole("button", { name: "Edit Images" });

  test.beforeAll(async () => {
    const owner = clientAs(A.subject!);
    projectId = (await adminClient().query(fn.bySlug, { slug: SLUG }))!.id;
    const { uploadUrl } = await owner.mutation(fn.uploadUrl, { projectId, kind: "screenshot" });
    const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": "image/png" }, body: new Uint8Array(placeholderPng(64, 40)) });
    const { storageId } = (await res.json()) as { storageId: string };
    await owner.mutation(fn.attach, { projectId, storageId, kind: "screenshot", fileName: "f02.png" });
  });
  test.afterAll(async () => {
    await releasePersona(A.subject!);
  });

  test("signed out: the image loads, no edit control, no owner fields in the response", async ({ page }) => {
    // Read as it arrives: the body isn't available once Next reloads the page.
    const reply = page
      .waitForResponse((r) => r.request().method() === "POST" && !!r.request().headers()["next-action"] && r.url().includes(SLUG))
      .then((r) => r.text());
    await page.goto(`/projects/${SLUG}`);
    await expect(page.getByRole("heading", { name: "Project Images" })).toBeVisible();
    const image = stored(page).first();
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
    await expect(editControls(page)).toHaveCount(0);

    const body = await reply;
    expect(body).toContain(`"uploaded_by":""`);
    expect(body).toContain(`"storage_path":""`);
    expect(body).not.toContain(A.subject!);
    expect(body).not.toContain(A.profile!.username);
  });

  test("signed out with ?edit=true: still view only, nothing to upload with", async ({ page }) => {
    await page.goto(`/projects/${SLUG}?edit=true`);
    await expect(stored(page).first()).toBeVisible();
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    await expect(page.getByTitle("Delete image")).toHaveCount(0);
    await expect(editControls(page)).toHaveCount(0);
  });

  test("a signed-in stranger sees the image, with no edit control", async ({ page }) => {
    await signIn(page, "f02-stranger");
    await page.goto(`/projects/${SLUG}`);
    await expect(stored(page).first()).toBeVisible();
    await expect(editControls(page)).toHaveCount(0);
  });

  test("signed out: private and deleted projects stay 404, with no image section", async ({ page }) => {
    for (const slug of ["fixture-private", "fixture-deleted-recent"]) {
      const response = await page.goto(`/projects/${slug}`);
      expect(response?.status(), slug).toBe(404);
      await expect(page.locator("#images")).toHaveCount(0);
    }
  });

  test("signed out: a project with no images shows no image heading", async ({ page }) => {
    await page.goto("/projects/fixture-no-description");
    // UI06: the page loaded (About is there); the images section only exists when there are images.
    await expect(page.locator("#about")).toBeAttached();
    await expect(page.getByRole("heading", { name: "Project Images" })).toHaveCount(0);
    await expect(page.locator("#images")).toHaveCount(0);
  });

  // Last, because it also cleans up: once a login is linked to A, the persona
  // client can't act as A, so the owner deletes the image in the page.
  test("the owner keeps the edit control, and deletes the image", async ({ page }) => {
    await linkPersona(A.subject!, (await authState(await signIn(page, "f02-owner")))!.authUserId);
    await page.goto(`/projects/${SLUG}`);
    await expect(stored(page).first()).toBeVisible();
    await expect(editControls(page)).toBeVisible();

    await page.goto(`/projects/${SLUG}?edit=true`);
    await page.locator("#images").getByTitle("Delete image").first().click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect.poll(async () => (await adminClient().query(fn.state, { projectId })).length).toBe(0);
  });
});

test.describe("F02 public lists", () => {
  const LISTED = "Fixture Listed Project";
  const card = (page: Page, title: string) => page.locator(".project-card", { hasText: title }).first();
  const hidden = ["Fixture Private Project", "Fixture Deleted Recently"];

  async function expectPublicList(page: Page, title: string) {
    await expect(card(page, title)).toBeVisible();
    await expect(page.getByText("Please sign in to view projects")).toHaveCount(0);
    for (const other of hidden) await expect(card(page, other)).toHaveCount(0);
  }

  test("/projects signed out: stays on the page, listed projects only, no personal actions", async ({ page }) => {
    await page.goto("/projects");
    await expectPublicList(page, LISTED);
    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByRole("button", { name: "Create Project" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /to favorites|from favorites/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Update project|Delete project/ })).toHaveCount(0);
  });

  test("/projects table view signed out: the favorite count isn't a control", async ({ page }) => {
    await page.goto("/projects");
    await expect(card(page, LISTED)).toBeVisible();
    await page.getByRole("button", { name: "Table" }).click();
    await expect(page.getByRole("cell", { name: LISTED }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /to favorites|from favorites/ })).toHaveCount(0);
  });

  test("/categories/<name> and /tags/<name> signed out", async ({ page }) => {
    await page.goto("/categories/web");
    await expectPublicList(page, LISTED);
    await page.goto("/tags/rust");
    await expectPublicList(page, "Fixture Bob's Project");
    await expect(page.getByRole("button", { name: /to favorites|from favorites/ })).toHaveCount(0);
  });

  test("a tag on a signed-out card opens the public tag page", async ({ page }) => {
    await page.goto("/projects");
    const bob = card(page, "Fixture Bob's Project");
    await expect(bob).toBeVisible();
    await bob.getByText("Rust", { exact: false }).first().click();
    await expect(page).toHaveURL(/\/tags\/rust$/i);
    await expectPublicList(page, "Fixture Bob's Project");
  });

  test("signed out, no fetch of a personal list, and the API refuses them", async ({ page, request }) => {
    for (const q of ["showFavorites=true", "showDeleted=true", "showAll=false"]) {
      expect((await request.get(`/api/projects?${q}`)).status(), q).toBe(401);
    }
    const asked: string[] = [];
    page.on("request", (r) => { if (r.url().includes("/api/projects?")) asked.push(r.url()); });
    await page.goto("/projects/favorites");
    await expect(page).toHaveURL(/\/sign-in/);
    expect(asked.filter((u) => /showFavorites=true|showDeleted=true|showAll=false/.test(u))).toEqual([]);
  });

  test("signed in: the same pages keep their personal actions", async ({ page }) => {
    await signIn(page, "f02-lists");
    await page.goto("/projects");
    await expect(card(page, LISTED)).toBeVisible();
    await expect(page.getByRole("button", { name: "Create Project" })).toBeVisible();
    await expect(card(page, LISTED).getByRole("button", { name: /to favorites|from favorites/ })).toBeVisible();
    await page.goto("/categories/web");
    await expect(card(page, LISTED).getByRole("button", { name: /to favorites|from favorites/ })).toBeVisible();
  });
});

test.describe("F02 sign-in return and the /projects/users rule", () => {
  /** Signs up by API, so the browser still has no session, and fills in the real form. */
  async function signInByForm(page: Page, label: string) {
    const email = syntheticEmail(label);
    expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
    await verifyEmail(email);
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(SYNTHETIC_PASSWORD);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
  }

  for (const path of ["/projects/new", "/projects/favorites", "/projects/deleted", "/projects/projects-portfolio"]) {
    test(`${path} sends a signed-out visitor to sign in with the way back kept`, async ({ page }) => {
      await page.goto(`${path}?from=f02`);
      await expect(page).toHaveURL(/\/sign-in\?redirect_url=/);
      expect(new URL(page.url()).searchParams.get("redirect_url")).toBe(`${path}?from=f02`);
    });
  }

  test("signing in returns to the page the visitor came from", async ({ page }) => {
    await page.goto("/projects/favorites");
    await expect(page).toHaveURL(/redirect_url=%2Fprojects%2Ffavorites/);
    await signInByForm(page, "f02-return");
    await expect(page).toHaveURL(/\/projects\/favorites$/);
  });

  test("a crafted return address stays on the site", async ({ page }) => {
    for (const bad of ["//evil.example/x", "/.//evil.example/x", "https://evil.example/x"]) {
      await page.context().clearCookies();
      await page.goto(`/sign-in?redirect_url=${encodeURIComponent(bad)}`);
      await signInByForm(page, `f02-evil-${bad.length}`);
      await expect(page).toHaveURL(`${BASE_URL}/`);
    }
  });

  test("/projects/users/<name> is gated at the proxy, with the way back kept", async ({ page, request }) => {
    const reply = await request.get("/projects/users/fixture-alice", { maxRedirects: 0 });
    expect(reply.status()).toBe(307);
    expect(reply.headers().location).toBe("/sign-in?redirect_url=%2Fprojects%2Fusers%2Ffixture-alice");

    await page.goto("/projects/users/fixture-alice");
    await expect(page).toHaveURL(/redirect_url=%2Fprojects%2Fusers%2Ffixture-alice/);
    await signInByForm(page, "f02-user-page");
    await expect(page).toHaveURL(/\/projects\/users\/fixture-alice$/);
    await expect(page.getByText("Authentication Required")).toHaveCount(0);
    await expect(page.locator(".project-card", { hasText: "Fixture Listed Project" }).first()).toBeVisible();
  });

  test("the public way to a person's projects still works signed out", async ({ page }) => {
    await page.goto("/shared-projects/fixture-alice");
    await expect(page.locator(".project-card", { hasText: "Fixture Listed Project" }).first()).toBeVisible();
    await expect(page).toHaveURL(/\/shared-projects\/fixture-alice$/);
  });
});

test.describe("F02 admin tools", () => {
  const PAGES = ["/llm-test", "/scrapper-demo"];
  const crawl = { repoUrl: "https://github.com/synthetic/none" };

  test("signed out: the pages go to sign-in and the crawl API answers 401", async ({ page, request }) => {
    for (const path of PAGES) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`/sign-in\\?redirect_url=${encodeURIComponent(path)}`));
    }
    expect((await request.post("/api/repo/crawl", { data: crawl })).status()).toBe(401);
  });

  test("a regular account goes to /dashboard and the crawl API answers 403", async ({ page }) => {
    await signIn(page, "f02-regular");
    for (const path of PAGES) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/dashboard$/);
    }
    expect((await page.request.post("/api/repo/crawl", { headers, data: crawl })).status()).toBe(403);
  });

  test("an admin reaches both pages", async ({ page }) => {
    const email = await signIn(page, "f02-admin");
    await setRole((await authState(email))!.authUserId, "admin");
    await page.goto("/llm-test");
    await expect(page).toHaveURL(/\/llm-test$/);
    await expect(page.getByRole("button", { name: /send|test|submit/i }).first()).toBeVisible();
    await page.goto("/scrapper-demo");
    await expect(page).toHaveURL(/\/scrapper-demo$/);
    await expect(page.getByPlaceholder(/github/i).first()).toBeVisible();
  });
});
