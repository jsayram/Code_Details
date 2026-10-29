// D01: the identity bridge on the task-owned local Convex backend. Every
// signed-in call carries a token from the synthetic issuer, resolved token
// subject -> authLinks -> users inside the function (convex/viewer.ts). The
// denials cover the ways a caller can fail to be somebody: no token, a token
// the deployment didn't issue, an expired or misaddressed one, a subject with
// no link, and an account that is being deleted.
import { makeFunctionReference } from "convex/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateFixtures } from "../fixtures/generate";
import { anonymousClient, clearConvexFixtures, convexAvailable, loadConvexFixtures } from "../fixtures/convex";
import { clientAs, foreignKey, testIssuerAvailable } from "../fixtures/convex-auth";

const set = generateFixtures();
const { a: A, b: B, admin, deleting, noProfile } = set.personas;
const whoami = makeFunctionReference<"query">("identity:whoami");
const getOwnBySlug = makeFunctionReference<"query", { slug: string }>("projects:getOwnBySlug");
const slug = (c: string) => set.projects.find((p) => p.case === c)!.slug;

describe.skipIf(!convexAvailable() || !testIssuerAvailable())("D01 identity bridge", () => {
  beforeAll(async () => {
    await clearConvexFixtures();
    await loadConvexFixtures(set);
  });

  afterAll(async () => {
    await clearConvexFixtures();
  });

  describe("resolves a valid token to the linked user", () => {
    it("A, B and admin each get their own account, nothing more", async () => {
      expect(await clientAs(A.subject!).query(whoami, {})).toEqual({ username: A.profile!.username, role: "user", tier: A.profile!.tier });
      expect(await clientAs(B.subject!).query(whoami, {})).toEqual({ username: B.profile!.username, role: "user", tier: B.profile!.tier });
      expect(await clientAs(admin.subject!).query(whoami, {})).toMatchObject({ username: admin.profile!.username, role: "admin" });
    });

    it("a linked user without a profile still resolves, with no username", async () => {
      expect(await clientAs(noProfile.subject!).query(whoami, {})).toEqual({ username: null, role: "user", tier: "free" });
    });

    it("never returns an email, a provider subject or an internal ID", async () => {
      const text = JSON.stringify(await clientAs(A.subject!).query(whoami, {}));
      expect(text).not.toContain(A.profile!.email);
      expect(text).not.toContain(A.subject!);
      expect(Object.keys(JSON.parse(text)).sort()).toEqual(["role", "tier", "username"]);
    });
  });

  describe("denials: whoami is null", () => {
    it("anonymous (no token)", async () => {
      expect(await anonymousClient().query(whoami, {})).toBeNull();
    });

    it("an account in its deletion grace period", async () => {
      expect(await clientAs(deleting.subject!).query(whoami, {})).toBeNull();
    });

    it("a validly signed subject with no authLinks row (no email or username fallback)", async () => {
      expect(await clientAs("user_fixture_unlinked").query(whoami, {})).toBeNull();
      // The subject string of a profile's username is not a link either.
      expect(await clientAs(A.profile!.username).query(whoami, {})).toBeNull();
    });
  });

  describe("denials: tokens the deployment must refuse", () => {
    // Convex rejects these before the function runs; the client sees an auth error.
    it.each([
      ["signed with a foreign key", { key: foreignKey() }, /InvalidAuthHeader.*Could not decode token/],
      ["expired", { expiresIn: -60 }, /InvalidAuthHeader.*Token expired/],
      ["for another audience", { audience: "some-other-app" }, /NoAuthProvider/],
      ["from another issuer", { issuer: "https://other-issuer.synthetic.invalid" }, /NoAuthProvider/],
    ])("a token %s", async (_name, options, reason) => {
      await expect(clientAs(A.subject!, options).query(whoami, {})).rejects.toThrow(reason);
    });
  });

  describe("owner-gated read: getOwnBySlug", () => {
    it("the owner sees their public, private and deleted projects", async () => {
      const a = clientAs(A.subject!);
      expect(await a.query(getOwnBySlug, { slug: slug("listed") })).toMatchObject({ visibility: "public", status: "active", listed: true });
      expect(await a.query(getOwnBySlug, { slug: slug("private") })).toMatchObject({ visibility: "private", listed: false });
      expect(await a.query(getOwnBySlug, { slug: slug("deletedRecent") })).toMatchObject({ status: "deleted", listed: false });
    });

    it("B gets null for every one of A's projects, the same as for a missing slug", async () => {
      const b = clientAs(B.subject!);
      for (const c of ["listed", "private", "deletedRecent"]) {
        expect(await b.query(getOwnBySlug, { slug: slug(c) })).toBeNull();
      }
      expect(await b.query(getOwnBySlug, { slug: "fixture-no-such-project" })).toBeNull();
      // B's own project still works, so the nulls above are denials, not a broken query.
      expect(await b.query(getOwnBySlug, { slug: slug("ownedByB") })).toMatchObject({ title: "Fixture Bob's Project" });
    });

    it("anonymous, admin (no admin override until D07) and a deleting owner get null", async () => {
      expect(await anonymousClient().query(getOwnBySlug, { slug: slug("private") })).toBeNull();
      expect(await clientAs(admin.subject!).query(getOwnBySlug, { slug: slug("private") })).toBeNull();
      expect(await clientAs(deleting.subject!).query(getOwnBySlug, { slug: slug("private") })).toBeNull();
    });
  });
});
