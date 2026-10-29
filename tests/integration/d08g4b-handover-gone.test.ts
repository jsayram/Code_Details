// D08g4b: on the task-owned test backend, the D08d handover HTTP action no
// longer exists, and the test-only replacement (fixtures:linkPersona) keeps
// the handover's one safety rule: a login whose account holds more than
// sign-up rows is never moved.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { generateFixtures } from "../fixtures/generate";
import { clearConvexFixtures, convexAvailable, loadConvexFixtures } from "../fixtures/convex";
import { SYNTHETIC_PASSWORD, authState, linkPersona, signUp, syntheticEmail } from "../fixtures/better-auth";
import { TEST_CONVEX_SITE_URL } from "../support/isolation";

const set = generateFixtures();
const { a: A, b: B } = set.personas;

describe.skipIf(!convexAvailable())("D08g4b handover gone", () => {
  beforeEach(async () => {
    await clearConvexFixtures();
    await loadConvexFixtures(set);
  });
  afterAll(async () => {
    await clearConvexFixtures();
  });

  it("POST /account/handover on the deployment's site is 404", async () => {
    const res = await fetch(`${TEST_CONVEX_SITE_URL}/account/handover`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clerkSubject: A.subject }),
    });
    expect(res.status).toBe(404);
  });

  it("linkPersona moves a fresh login to a persona once, and refuses to move it off a persona with content", async () => {
    const email = syntheticEmail("g4b-link");
    expect((await signUp(email, SYNTHETIC_PASSWORD)).status).toBe(200);
    const { authUserId } = (await authState(email))!;
    await linkPersona(A.subject!, authUserId);
    const after = (await authState(email))!;
    expect(after.links.filter((l) => l.provider === "better-auth")).toHaveLength(1);
    await expect(linkPersona(B.subject!, authUserId)).rejects.toThrow(/holds more than sign-up rows/);
  });
});
