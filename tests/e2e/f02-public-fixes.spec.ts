// F02: small public-sharing fixes ahead of UI03 (UI02 defects 1, 2, 3, 8, 14).
// Synthetic users and synthetic images only. Every test leaves the shared
// fixture set as it found it.
import type { Page } from "@playwright/test";
import { makeFunctionReference } from "convex/server";
import { authState, freshClientIp, linkPersona, releasePersona, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
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
    attach: makeFunctionReference<"mutation", Record<string, unknown>, { ok: boolean; image: { id: string } }>("projectImages:attach"),
    purge: makeFunctionReference<"mutation", { imageId: string }, { ok: boolean }>("projectImages:purge"),
  };
  let imageId = "";
  const stored = (page: Page) => page.locator('#images img[src*="api%2Fstorage"], #images img[src*="/api/storage/"]');
  const editControls = (page: Page) => page.getByRole("button", { name: "Edit Images" });

  test.beforeAll(async () => {
    const owner = clientAs(A.subject!);
    const projectId = (await adminClient().query(fn.bySlug, { slug: SLUG }))!.id;
    const { uploadUrl } = await owner.mutation(fn.uploadUrl, { projectId, kind: "screenshot" });
    const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": "image/png" }, body: new Uint8Array(placeholderPng(64, 40)) });
    const { storageId } = (await res.json()) as { storageId: string };
    imageId = (await owner.mutation(fn.attach, { projectId, storageId, kind: "screenshot", fileName: "f02.png" })).image.id;
  });
  test.afterAll(async () => {
    await clientAs(A.subject!).mutation(fn.purge, { imageId });
    await releasePersona(A.subject!);
  });

  test("signed out: the image loads, no edit control, no owner fields in the response", async ({ page }) => {
    const reply = page.waitForResponse((r) => r.request().method() === "POST" && !!r.request().headers()["next-action"] && r.url().includes(SLUG));
    await page.goto(`/projects/${SLUG}`);
    await expect(page.getByRole("heading", { name: "Project Images" })).toBeVisible();
    const image = stored(page).first();
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
    await expect(editControls(page)).toHaveCount(0);

    const body = await (await reply).text();
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

  test("the owner keeps the edit control", async ({ page }) => {
    await linkPersona(A.subject!, (await authState(await signIn(page, "f02-owner")))!.authUserId);
    await page.goto(`/projects/${SLUG}`);
    await expect(stored(page).first()).toBeVisible();
    await expect(editControls(page)).toBeVisible();
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
    await expect(page.locator("#images")).toBeAttached();
    await expect(page.getByRole("heading", { name: "Project Images" })).toHaveCount(0);
  });
});
