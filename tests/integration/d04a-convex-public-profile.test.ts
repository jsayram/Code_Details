// D04a: the public profile query on the task-owned local Convex backend. Every
// read uses a client with no credentials, which is what an anonymous browser
// could send. No email, provider subject, role or tier in any answer (P08 R07);
// deleting accounts look missing (P07 §8); a previous name redirects only
// inside its 90-day reservation (P07 §5.3).
import { makeFunctionReference } from "convex/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PUBLIC_PROFILE_KEYS } from "@/backend/profiles/public-profile";
import { convexImportUsername, generateFixtures } from "../fixtures/generate";
import { adminClient, anonymousClient, clearConvexFixtures, convexAvailable, loadConvexFixtures } from "../fixtures/convex";

const set = generateFixtures();
const A = set.personas.a;
const legacy = set.personas.emailUsername;
const getPublicByUsername = makeFunctionReference<"query", { handle: string }>("profiles:getPublicByUsername");
const addUsernameClaim = makeFunctionReference<"mutation">("fixtures:addUsernameClaim");
const anon = anonymousClient();
const read = (username: string) => anon.query(getPublicByUsername, { handle: username });
const DAY = 24 * 60 * 60 * 1000;

const PRIVATE = [A.subject!, A.profile!.email, "tier", "role", "email", "userId", "authUserId"];

describe.skipIf(!convexAvailable())("D04a Convex public profile read", () => {
  beforeAll(async () => {
    await clearConvexFixtures();
    await loadConvexFixtures(set);
    const admin = adminClient();
    // A rename inside its reservation, one whose reservation ran out, and one
    // held by an account that is being deleted.
    await admin.mutation(addUsernameClaim, { holderUsernameKey: "fixture-new-name", usernameKey: "fixture-old-name", state: "previous", reservedUntil: Date.now() + 30 * DAY });
    await admin.mutation(addUsernameClaim, { holderUsernameKey: "fixture-bob", usernameKey: "fixture-expired-name", state: "previous", reservedUntil: Date.now() - DAY });
    await admin.mutation(addUsernameClaim, { holderUsernameKey: "fixture-leaving", usernameKey: "fixture-leaving-old", state: "previous", reservedUntil: Date.now() + 30 * DAY });
  });

  afterAll(async () => {
    await clearConvexFixtures();
  });

  it("returns exactly the public fields for a listed profile, nothing private", async () => {
    const res = (await read("fixture-alice")) as { kind: string; profile: Record<string, unknown> };
    expect(res.kind).toBe("profile");
    expect(Object.keys(res.profile).sort()).toEqual([...PUBLIC_PROFILE_KEYS].sort());
    expect(res.profile).toMatchObject({ username: "fixture-alice", fullName: "Alice Fixture", avatarUrl: A.profile!.imageUrl });
    const text = JSON.stringify(res);
    for (const value of PRIVATE) expect(text, value).not.toContain(value);
  });

  it("matches the canonical key (case and surrounding space don't matter)", async () => {
    expect(await read("  FIXTURE-Alice ")).toMatchObject({ kind: "profile", profile: { username: "fixture-alice" } });
  });

  it("hides an account that is being deleted", async () => {
    expect(await read("fixture-leaving")).toBeNull();
  });

  it("returns null for a missing name and for an oversized argument", async () => {
    expect(await read("fixture-nobody")).toBeNull();
    expect(await read("")).toBeNull();
    expect(await read("x".repeat(500))).toBeNull();
  });

  it("never resolves a legacy email address; the account is reachable only by its handle", async () => {
    expect(await read(legacy.profile!.username)).toBeNull();
    const handle = convexImportUsername(legacy.subject!, legacy.profile!.username);
    const res = (await read(handle)) as { kind: string; profile: Record<string, unknown> };
    expect(res).toMatchObject({ kind: "profile", profile: { username: handle } });
    expect(JSON.stringify(res)).not.toContain("@");
  });

  it("redirects a previous name inside its reservation to the current one", async () => {
    expect(await read("fixture-old-name")).toEqual({ kind: "redirect", currentUsername: "fixture-new-name" });
  });

  it("doesn't redirect once the reservation has run out", async () => {
    expect(await read("fixture-expired-name")).toBeNull();
  });

  it("doesn't redirect to an account that is being deleted", async () => {
    expect(await read("fixture-leaving-old")).toBeNull();
  });
});
