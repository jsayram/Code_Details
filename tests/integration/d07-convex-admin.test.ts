// D07-d: the admin dashboard's reads and admin:updateUser on the task-owned
// test backend (design: Agent Planning/phase-d07/D07D_DESIGN.md). Every
// admin:* function refuses anyone but a users.role admin. The module is
// enumerated, so a new function fails here until it has a refusal case. No
// read returns an email. updateUser takes a closed patch, follows the owner's
// own username rules and writes an admin.user_updated audit row.
import fs from "node:fs";
import path from "node:path";
import { makeFunctionReference } from "convex/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { generateFixtures } from "../fixtures/generate";
import { adminClient, anonymousClient, clearConvexFixtures, convexAvailable, loadConvexFixtures } from "../fixtures/convex";
import { clientAs } from "../fixtures/convex-auth";

/** A client typed loosely, for calling functions picked by name at run time. */
type Loose = { query: (ref: unknown, args: unknown) => Promise<unknown>; mutation: (ref: unknown, args: unknown) => Promise<unknown> };
const loose = (client: unknown) => client as Loose;
const fn = (name: string) => makeFunctionReference<"query">(name);

/** One valid call per exported admin function (keys must match the module's exports). */
const CALLS: Record<string, { kind: "query" | "mutation"; args: (target: string) => Record<string, unknown> }> = {
  dashboardStats: { kind: "query", args: () => ({}) },
  listUsers: { kind: "query", args: () => ({ page: 1, sortBy: "recent-edit", tierFilter: "all" }) },
  updateUser: { kind: "mutation", args: (target) => ({ targetProfileId: target, patch: { tier: "diamond" } }) },
  topContributors: { kind: "query", args: () => ({ limit: 10 }) },
  tagPipeline: { kind: "query", args: () => ({}) },
};

const whoami = makeFunctionReference<"query", Record<string, never>, { username: string | null; role: string; tier: string } | null>("identity:whoami");
const setRoleByUsername = makeFunctionReference<"mutation", { usernameKey: string; role: "user" | "admin" }>("fixtures:setRoleByUsername");
const auditRows = makeFunctionReference<"query", { kind: string }, { actor: string | null; target: string | null; details: Record<string, unknown> | null }[]>("fixtures:auditRows");
const profileIdOf = makeFunctionReference<"query", { usernameKey: string }, string | null>("fixtures:profileIdOf");
const suggest = makeFunctionReference<"mutation", { projectId: string; name: string }, unknown>("tags:suggest");
const updateUser = makeFunctionReference<"mutation", { targetProfileId: string; patch: Record<string, unknown> }, Record<string, unknown>>("admin:updateUser");
const topPublic = makeFunctionReference<"query", { limit: number }, { username: string; projects_count: number }[]>("profiles:topContributorsPublic");

const set = generateFixtures();
const { a: A, b: B, admin } = set.personas;
const asA = () => clientAs(A.subject!);
const asB = () => clientAs(B.subject!);
const asAdmin = () => clientAs(admin.subject!);
const slug = (c: string) => set.projects.find((p) => p.case === c)!.slug;

describe.skipIf(!convexAvailable())("D07-d Convex admin", () => {
  let ids: Record<string, string>;
  let bobProfile: string;

  beforeEach(async () => {
    await clearConvexFixtures();
    ids = await loadConvexFixtures(set);
    bobProfile = (await adminClient().query(profileIdOf, { usernameKey: "fixture-bob" }))!;
  });
  afterAll(async () => {
    await clearConvexFixtures();
  });

  const call = (client: unknown, name: string) => {
    const c = CALLS[name];
    return loose(client)[c.kind](fn(`admin:${name}`), c.args(bobProfile));
  };

  it("every exported admin function is listed here", async () => {
    const mod = (await import(path.resolve(__dirname, "../../convex/admin.ts"))) as Record<string, unknown>;
    const exported = Object.entries(mod).filter(([, f]) => typeof f === "function" && (f as { isPublic?: boolean }).isPublic).map(([n]) => n).sort();
    expect(exported).toEqual(Object.keys(CALLS).sort());
  });

  it("every admin function refuses anonymous, B and a demoted admin, and nothing changes", async () => {
    const refusedBy = async (client: unknown) => {
      for (const name of Object.keys(CALLS)) {
        const r = await call(client, name);
        if (CALLS[name].kind === "query") expect(r, name).toBeNull();
        else expect(r, name).toEqual({ ok: false, code: "not_found" });
      }
    };
    await refusedBy(anonymousClient());
    await refusedBy(asB());
    await adminClient().mutation(setRoleByUsername, { usernameKey: "fixture-admin", role: "user" });
    await refusedBy(asAdmin());
    expect(await asB().query(whoami, {})).toMatchObject({ tier: "free" });
    expect(await adminClient().query(auditRows, { kind: "admin.user_updated" })).toEqual([]);
  });

  it("the admin's reads: no emails, active projects only, the fixture totals", async () => {
    const stats = (await call(asAdmin(), "dashboardStats")) as Record<string, unknown> & { totalProjects: number; allProjects: { slug: string }[]; newUsersList: Record<string, unknown>[] };
    const activeSlugs = set.projects.filter((p) => !p.deletedAt && p.case !== "purged").map((p) => p.slug).sort();
    expect(stats.allProjects.map((p) => p.slug).sort()).toEqual(activeSlugs);
    expect(stats.totalProjects).toBe(activeSlugs.length);
    expect(stats.newUsersList.every((u) => !("email_address" in u) && !("user_id" in u))).toBe(true);
    for (const name of Object.keys(CALLS).filter((n) => CALLS[n].kind === "query")) {
      expect(JSON.stringify(await call(asAdmin(), name)), name).not.toMatch(/@synthetic\.invalid|:"user_[A-Za-z0-9]/);
    }
  });

  it("listUsers searches username, name and tier, filters by tier and pages", async () => {
    const list = (args: Record<string, unknown>) =>
      loose(asAdmin()).query(fn("admin:listUsers"), { page: 1, sortBy: "alphabetical", tierFilter: "all", ...args }) as Promise<{ users: { username: string; tier: string }[]; total: number }>;
    expect((await list({ search: "bob" })).users.map((u) => u.username)).toEqual(["fixture-bob"]);
    expect((await list({ tierFilter: "pro" })).users.every((u) => u.tier === "pro")).toBe(true);
    expect((await list({ search: "synthetic.invalid" })).total).toBe(0); // no email search
    const all = await list({});
    expect(all.users.map((u) => u.username)).toEqual([...all.users.map((u) => u.username)].sort((x, y) => x.toLowerCase().localeCompare(y.toLowerCase())));
  });

  it("updateUser: tier, name and username, audited; the owner's username rules apply", async () => {
    expect(await asAdmin().mutation(updateUser, { targetProfileId: bobProfile, patch: { tier: "pro", fullName: "Robert Fixture" } })).toMatchObject({
      ok: true,
      user: { username: "fixture-bob", fullName: "Robert Fixture", tier: "pro" },
    });
    expect(await asB().query(whoami, {})).toMatchObject({ tier: "pro" });
    expect(await adminClient().query(auditRows, { kind: "admin.user_updated" })).toEqual([
      { actor: "fixture-admin", target: "fixture-bob", details: { fields: "fullName,tier", tierFrom: "free", tierTo: "pro" } },
    ]);

    expect(await asAdmin().mutation(updateUser, { targetProfileId: bobProfile, patch: { handle: "fixture-alice" } })).toMatchObject({ ok: false, code: "taken" });
    expect(await asAdmin().mutation(updateUser, { targetProfileId: bobProfile, patch: { fullName: "bob@synthetic.invalid" } })).toMatchObject({ ok: false, code: "invalid" });
    expect(await asAdmin().mutation(updateUser, { targetProfileId: bobProfile, patch: { handle: "fixture-robert" } })).toMatchObject({ ok: true, user: { username: "fixture-robert" } });
    expect(await adminClient().query(auditRows, { kind: "username.changed" })).toEqual([
      { actor: "fixture-admin", target: "fixture-robert", details: { from: "fixture-bob", to: "fixture-robert" } },
    ]);
    // A claimed name stays reserved for Bob after a rename: A can't take it.
    // (Fixture profiles start without claim rows, so the first rename makes one.)
    expect(await asAdmin().mutation(updateUser, { targetProfileId: bobProfile, patch: { handle: "fixture-roberto" } })).toMatchObject({ ok: true });
    const aliceProfile = (await adminClient().query(profileIdOf, { usernameKey: "fixture-alice" }))!;
    expect(await asAdmin().mutation(updateUser, { targetProfileId: aliceProfile, patch: { handle: "fixture-robert" } })).toMatchObject({ ok: false, code: "taken" });
    // No change, no audit row.
    const before = (await adminClient().query(auditRows, { kind: "admin.user_updated" })).length;
    expect(await asAdmin().mutation(updateUser, { targetProfileId: bobProfile, patch: { tier: "pro" } })).toMatchObject({ ok: true });
    expect((await adminClient().query(auditRows, { kind: "admin.user_updated" })).length).toBe(before);
  });

  it("updateUser's patch is closed: role, email and anything else are refused by the validator; bad targets are not_found", async () => {
    for (const patch of [{ role: "admin" }, { email: "x@synthetic.invalid" }, { tier: "platinum" }, { authUserId: "x" }]) {
      await expect(asAdmin().mutation(updateUser, { targetProfileId: bobProfile, patch })).rejects.toThrow();
    }
    expect(await asB().query(whoami, {})).toMatchObject({ role: "user", tier: "free" });
    for (const targetProfileId of ["not-an-id", ids[slug("listed")]]) {
      expect(await asAdmin().mutation(updateUser, { targetProfileId, patch: { tier: "pro" } })).toEqual({ ok: false, code: "not_found" });
    }
  });

  it("tagPipeline counts suggestions by status and names submitters by username", async () => {
    await asB().mutation(suggest, { projectId: ids[slug("listed")], name: "fixture-pipe" });
    const p = (await call(asAdmin(), "tagPipeline")) as { totalSubmissions: number; pendingCount: number; topSubmitters: { submitter_email: string }[] };
    expect(p.pendingCount).toBeGreaterThanOrEqual(1);
    expect(p.topSubmitters.map((s) => s.submitter_email)).toContain("fixture-bob");
  });

  it("the public top-contributors list counts listed projects only and needs no sign-in", async () => {
    const rows = await anonymousClient().query(topPublic, { limit: 100 });
    const alice = rows.find((r) => r.username === "fixture-alice")!;
    const listedOfA = set.projects.filter((p) => p.ownerKey === "a" && !p.deletedAt && p.case !== "purged" && p.visibility === "public").length;
    expect(alice.projects_count).toBe(listedOfA);
    expect(JSON.stringify(rows)).not.toMatch(/@synthetic\.invalid|tier/);
    expect(fs.existsSync(path.resolve(__dirname, "../../convex/admin.ts"))).toBe(true);
  });
});
