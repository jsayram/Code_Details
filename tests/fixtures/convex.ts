// Loads the synthetic fixture set (B09) into the task-owned local Convex
// deployment (Phase C, C09), mapped onto the P07 tables. Same personas,
// projects and tags as tests/fixtures/supabase.ts; here the private project
// really is private and the deleting persona really is deleting. The client
// only talks to 127.0.0.1 and uses the throwaway admin key that
// tests/convex/up.sh wrote, so it can call the internal fixture functions.
import fs from "node:fs";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import type { FixtureSet } from "./generate";
import { convexImportUsername, generateFixtures } from "./generate";

export const CONVEX_PORT = 3210;
export const CONVEX_URL = `http://127.0.0.1:${CONVEX_PORT}`;
const DEPLOYMENT_FILE = path.resolve(__dirname, "../../.test-runtime/convex/deployment.json");

export function convexAvailable(): boolean {
  return fs.existsSync(DEPLOYMENT_FILE);
}

export function adminClient(): ConvexHttpClient {
  const { adminKey } = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8")) as { adminKey: string };
  const client = new ConvexHttpClient(CONVEX_URL, { skipConvexDeploymentUrlCheck: true });
  (client as unknown as { setAdminAuth(key: string): void }).setAdminAuth(adminKey);
  return client;
}

/** A client with no credentials at all: what an anonymous browser could call. */
export function anonymousClient(): ConvexHttpClient {
  return new ConvexHttpClient(CONVEX_URL, { skipConvexDeploymentUrlCheck: true });
}

const ref = {
  clear: makeFunctionReference<"mutation">("fixtures:clear"),
  counts: makeFunctionReference<"query">("fixtures:counts"),
  load: makeFunctionReference<"mutation">("fixtures:load"),
  listedTitleOrder: makeFunctionReference<"query">("fixtures:listedTitleOrder"),
  snapshot: makeFunctionReference<"query">("fixtures:snapshot"),
};
export const getPublicBySlug = makeFunctionReference<"query", { slug: string }>("projects:getPublicBySlug");

const ms = (iso: string) => Date.parse(iso);
const opt = <T>(x: T | null | undefined): T | undefined => (x === null || x === "" ? undefined : (x ?? undefined));

/** Lowercase NFKC, the P07 §9 sort and comparison key. */
export const sortKey = (s: string) => s.normalize("NFKC").toLowerCase();

export type ConvexFixtureArgs = Record<string, unknown[]>;

export function toConvexArgs(set: FixtureSet): ConvexFixtureArgs {
  const personas = Object.values(set.personas).filter((p) => p.subject);
  const users = personas.map((p) => ({
    key: p.key,
    subject: p.subject!,
    role: p.profile?.role === "admin" ? ("admin" as const) : ("user" as const),
    tier: p.profile?.tier ?? "free",
    status: p.accountState,
    createdAt: ms(p.profile?.createdAt ?? "2026-01-01T00:00:00.000Z"),
  }));
  const profiles = personas.filter((p) => p.profile).map((p) => {
    const username = convexImportUsername(p.subject!, p.profile!.username);
    return {
    userKey: p.key,
    username,
    usernameKey: username.toLowerCase(),
    firstName: opt(p.profile!.firstName),
    lastName: opt(p.profile!.lastName),
    fullName: opt(p.profile!.fullName),
    avatarUrl: opt(p.profile!.imageUrl),
    createdAt: ms(p.profile!.createdAt),
    };
  });
  // D00a: tags.listedProjectCount (P07 §3.7) counts the listed projects carrying the tag.
  const isListed = (p: FixtureSet["projects"][number]) => !p.purged && !p.deletedAt && p.visibility === "public";
  const tags = set.tags.map((t) => ({
    key: t.id,
    name: t.name,
    nameKey: sortKey(t.name),
    listedProjectCount: set.projects.filter((p) => isListed(p) && p.tagIds.includes(t.id)).length,
    createdAt: ms("2026-01-01T00:00:00.000Z"),
  }));
  const favorites = (projectId: string) => set.favorites.filter((f) => f.projectId === projectId);
  const projects = set.projects.filter((p) => !p.purged).map((p, i) => ({
    ownerKey: p.ownerKey,
    title: p.title,
    titleSortKey: sortKey(p.title),
    slug: p.slug,
    description: opt(p.description),
    category: p.category,
    categoryData: (p.categoryData as Record<string, string> | null) ?? undefined,
    fieldOrder: undefined,
    links: p.urlLinks.map((l) => ({ url: l.url, label: opt(l.label) })),
    visibility: p.visibility,
    status: p.deletedAt ? ("deleted" as const) : ("active" as const),
    deletedAt: p.deletedAt ? ms(p.deletedAt) : undefined,
    tagKeys: p.tagIds,
    favoriteCount: favorites(p.id).length,
    rankingFavoriteCount: favorites(p.id).filter((f) => f.personaKey !== p.ownerKey).length,
    shuffleKey: (i * 0.618034) % 1,
    createdAt: ms(p.createdAt),
    updatedAt: ms(p.updatedAt),
  }));
  return { users, profiles, tags, projects };
}

export async function clearConvexFixtures(client = adminClient()): Promise<Record<string, number>> {
  return client.mutation(ref.clear, {});
}

export async function convexFixtureCounts(client = adminClient()): Promise<Record<string, number>> {
  return client.query(ref.counts, {});
}

/** Loads the set; returns the Convex project ID for each slug. */
export async function loadConvexFixtures(
  set: FixtureSet = generateFixtures(),
  client = adminClient(),
  extraProjects: ConvexFixtureArgs["projects"] = [],
): Promise<Record<string, string>> {
  const args = toConvexArgs(set);
  return client.mutation(ref.load, { ...args, projects: [...args.projects, ...extraProjects] });
}

export async function listedTitleOrder(client = adminClient()): Promise<string[]> {
  return client.query(ref.listedTitleOrder, {});
}

/** SHA-256 over every fixture-table document (C17). */
export async function convexDigest(client = adminClient()): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(JSON.stringify(await client.query(ref.snapshot, {}))).digest("hex");
}
