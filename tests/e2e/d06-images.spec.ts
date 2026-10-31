// D06-b: with both development switches on (Better Auth and the Convex read),
// the owner uploads a screenshot through the project page's real uploader: the
// server hands out a one-time Convex upload URL, the browser posts the bytes
// there, and projectImages:attach registers it from the session. The image
// shows on the page (served through next/image from the local backend), then
// the owner deletes it, and the file goes on the server, so the shared fixture
// set is as it was. Closes the Phase C carry-forward (no images on the Convex
// project page).
import type { Page } from "@playwright/test";
import { makeFunctionReference } from "convex/server";
import { authState, freshClientIp, linkPersona, releasePersona, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { adminClient, CONVEX_URL } from "../fixtures/convex";
import { generateFixtures, placeholderPng } from "../fixtures/generate";
import { BASE_URL, expect, test } from "./support";

const { b: B } = generateFixtures().personas;
const SLUG = "fixture-bob-project";

type Row = { id: string; storageId: string; status: string };
const imageState = makeFunctionReference<"query", { projectId: string }, Row[]>("fixtures:imageState");
const fileExists = makeFunctionReference<"query", { storageId: string }, boolean>("fixtures:fileExists");
const publicBySlug = makeFunctionReference<"query", { slug: string }, { id: string } | null>("projects:getPublicBySlug");

async function signIn(page: Page, label: string): Promise<string> {
  const email = syntheticEmail(label);
  const headers = { origin: BASE_URL };
  expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
  await verifyEmail(email);
  expect((await page.request.post("/api/auth/sign-in/email", { headers, data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
  return email;
}

/** A gallery image served from the local backend's storage, loaded (decoded) by the browser. */
const storedImages = (page: Page) => page.locator('img[src*="api%2Fstorage"], img[src*="/api/storage/"]');

test.describe.serial("D06 images (Better Auth + Convex read)", () => {

  test.beforeAll(async () => {
    await releasePersona(B.subject!);
  });
  test.afterAll(async () => {
    await releasePersona(B.subject!);
  });
  test.beforeEach(async ({ context }) => {
    await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
    // The harness blocks every origin but the app's. The upload itself goes
    // from the browser to the slot's own Convex backend; let exactly that through.
    await context.route(`${CONVEX_URL}/api/storage/upload**`, (route) => route.continue());
  });

  test("the owner uploads a screenshot, sees it on the project page and deletes it", async ({ page }) => {
    await linkPersona(B.subject!, (await authState(await signIn(page, "d06-uploader")))!.authUserId);
    const project = await adminClient().query(publicBySlug, { slug: SLUG });
    expect(project).not.toBeNull();
    const rows = () => adminClient().query(imageState, { projectId: project!.id });
    expect(await rows()).toEqual([]);

    await page.goto(`/projects/${SLUG}?edit=true`);
    const card = page.locator("#images");
    await expect(card.getByText("Add a cover image and screenshots")).toBeVisible();
    await card.locator('input[type="file"]').first().setInputFiles({
      name: "d06-shot.png",
      mimeType: "image/png",
      buffer: placeholderPng(64, 40),
    });

    await expect.poll(async () => (await rows()).map((r) => r.status)).toEqual(["active"]);
    const [{ storageId }] = await rows();
    await expect(card.getByText("All Images")).toBeVisible();
    await expect(storedImages(page).first()).toBeVisible();

    // View mode: the section renders for the Better Auth viewer and the file loads.
    await page.goto(`/projects/${SLUG}`);
    await expect(page.getByRole("heading", { name: "Project Images" })).toBeVisible();
    const shown = storedImages(page).first();
    await expect(shown).toBeVisible();
    await expect.poll(() => shown.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);

    // Delete it: the row goes at once, the file on the server.
    await page.goto(`/projects/${SLUG}?edit=true`);
    await page.locator("#images").getByTitle("Delete image").first().click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect.poll(rows).toEqual([]);
    await expect.poll(() => adminClient().query(fileExists, { storageId }), { timeout: 10_000 }).toBe(false);
  });
});
