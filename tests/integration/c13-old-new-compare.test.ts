// C13: old versus new for the same synthetic fixtures loaded into both
// backends. Three readers:
//   legacy   getProjectBySlugServer, what the page used before C06
//   supabase supabaseProjectReader (C06), the contract on Supabase
//   convex   projects:getPublicBySlug (C10), the contract on Convex
// What the page renders is compared through toProjectContentProps, so a
// difference here would be a visible difference.
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { toProjectContentProps } from "@/backend/projects/legacy-props";
import type { PublicProject } from "@/backend/projects/public-project";
import { clerkServerDouble, nextCacheDouble } from "../support/next-doubles";
import { connectTestDb, testDbAvailable } from "../support/test-db";
import { convexImportUsername, generateFixtures } from "../fixtures/generate";
import { cleanupFixtures, loadFixtures } from "../fixtures/supabase";
import { anonymousClient, clearConvexFixtures, convexAvailable, getPublicBySlug, loadConvexFixtures } from "../fixtures/convex";

vi.mock("@clerk/nextjs/server", () => clerkServerDouble);
vi.mock("next/cache", () => nextCacheDouble);

const set = generateFixtures();
const anon = anonymousClient();
const ready = testDbAvailable() && convexAvailable();

/** The fields ProjectContent actually renders for a signed-out visitor. */
function rendered(project: Record<string, unknown> | null, profile: Record<string, unknown> | null) {
  if (!project) return null;
  const date = (d: unknown) => (d instanceof Date ? d.toISOString() : d ?? null);
  return {
    title: project.title,
    slug: project.slug,
    description: project.description ?? null,
    category: project.category,
    favorites: `${project.total_favorites || 0}`,
    links: project.url_links ?? [],
    tags: project.tags ?? [],
    categoryFields: Object.fromEntries(
      ((project.field_order as string[] | null) ?? []).map((k) => [k, (project.category_data as Record<string, unknown> | null)?.[k]]),
    ),
    createdAt: date(project.created_at),
    updatedAt: date(project.updated_at),
    displayName: profile?.full_name || (profile?.username as string | undefined)?.split("@")[0] || project.owner_full_name || (project.owner_username as string | undefined)?.split("@")[0] || "Unknown User",
    avatar: profile?.profile_image_url || project.owner_profile_image_url || null,
    profileLinkUsername: profile?.username || project.owner_username || null,
  };
}

const viaContract = (p: PublicProject | null) => {
  if (!p) return null;
  const { project, userProfile } = toProjectContentProps(p);
  return rendered(project as unknown as Record<string, unknown>, userProfile as unknown as Record<string, unknown> | null);
};

describe.skipIf(!ready)("C13 old/new comparison", () => {
  let sql: postgres.Sql;
  let dbActions: typeof import("../../src/db/actions.js");
  let supabase: typeof import("../../src/backend/projects/supabase-reader.js").supabaseProjectReader;

  beforeAll(async () => {
    sql = await connectTestDb();
    dbActions = await import("../../src/db/actions.js");
    supabase = (await import("../../src/backend/projects/supabase-reader.js")).supabaseProjectReader;
    await cleanupFixtures(sql);
    await loadFixtures(sql, set);
    await clearConvexFixtures();
    await loadConvexFixtures(set);
  });

  afterAll(async () => {
    await cleanupFixtures(sql);
    await clearConvexFixtures();
    await sql.end();
  });

  // The private fixture is the one place the backends must differ: the
  // current schema has no visibility column (C03 gap), so Supabase serves it.
  const comparable = set.projects.filter((p) => p.case !== "private");

  // The email-shaped owner is the second intended difference: Supabase
  // publishes the address's local part, Convex the handle its import generated
  // (P07 §5.2), and the legacy read carried the full address.
  const emailOwned = set.projects.find((p) => p.case === "ownedByEmailUsername")!;
  const emailOwner = set.personas[emailOwned.ownerKey];
  const sameEverywhere = comparable.filter((p) => p !== emailOwned);

  it.each(comparable.map((p) => [p.case, p.slug]))("%s: Supabase contract and Convex contract are identical apart from the ID", async (_c, slug) => {
    const s = await supabase.getPublicProjectBySlug(slug);
    const c = await anon.query(getPublicBySlug, { slug });
    expect(c === null).toBe(s === null);
    const owner = (p: PublicProject) =>
      p.owner && slug === emailOwned.slug ? { ...p.owner, username: "<username>" } : p.owner;
    if (s && c) expect({ ...c, id: "<id>", owner: owner(c) }).toEqual({ ...s, id: "<id>", owner: owner(s) });
  });

  it.each(sameEverywhere.map((p) => [p.case, p.slug]))("%s: the page renders the same from the legacy read and from Convex", async (_c, slug) => {
    const legacyProject = await dbActions.getProjectBySlugServer(slug, null, null);
    const legacyProfile = legacyProject ? await dbActions.getProjectUsersProfileBySlugServer(slug) : null;
    const before = rendered(legacyProject as unknown as Record<string, unknown> | null, legacyProfile as unknown as Record<string, unknown> | null);
    const after = viaContract(await anon.query(getPublicBySlug, { slug }));
    expect(after).toEqual(before);
  });

  it("email-shaped owner: the legacy read published the address; Supabase shows its local part and Convex the imported handle", async () => {
    const slug = emailOwned.slug;
    const address = emailOwner.profile!.username;
    const legacyProject = await dbActions.getProjectBySlugServer(slug, null, null);
    const legacyProfile = await dbActions.getProjectUsersProfileBySlugServer(slug);
    const before = rendered(legacyProject as unknown as Record<string, unknown>, legacyProfile as unknown as Record<string, unknown>)!;
    const viaSupabase = viaContract(await supabase.getPublicProjectBySlug(slug))!;
    const viaConvex = viaContract(await anon.query(getPublicBySlug, { slug }))!;
    const handle = convexImportUsername(emailOwner.subject!, address);

    expect(before.displayName).toBe(address.split("@")[0]);
    expect(before.profileLinkUsername).toBe(address);
    expect(viaSupabase).toEqual({ ...before, profileLinkUsername: address.split("@")[0] });
    expect(viaConvex).toEqual({ ...before, displayName: handle, profileLinkUsername: handle });
  });

  it("private project: Supabase still serves it (no visibility column); Convex returns not-found", async () => {
    expect(await supabase.getPublicProjectBySlug("fixture-private")).not.toBeNull();
    expect(await anon.query(getPublicBySlug, { slug: "fixture-private" })).toBeNull();
  });

  it("what the anonymous payload loses compared with the legacy read: identity and private fields only", async () => {
    const legacy = (await dbActions.getProjectBySlugServer("fixture-listed", null, null)) as unknown as Record<string, unknown>;
    const { project } = toProjectContentProps((await anon.query(getPublicBySlug, { slug: "fixture-listed" }))!);
    const dropped = Object.keys(legacy).filter((k) => !(k in (project as object))).sort();
    expect(dropped).toEqual([
      "owner_created_at", "owner_email_address", "owner_id", "owner_tier", "owner_updated_at", "owner_user_id", "user_id",
    ]);
  });
});
