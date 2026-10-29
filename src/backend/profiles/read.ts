// Which backend serves the public profile read (D04a). It follows the project
// read switch (chooseProjectReadBackend): Convex only in development with a
// loopback URL, Supabase otherwise. Server-side only.
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { chooseProjectReadBackend } from "@/backend/projects";
import type { ProfileStats } from "@/db/profile-read";
import { type PublicProfile, type PublicProfileRow, assertPublicProfile, rowFromPublicProfile } from "./public-profile";

type ConvexRead = { kind: "profile"; profile: PublicProfile } | { kind: "redirect"; currentUsername: string } | null;
const getPublicByUsername = makeFunctionReference<"query", { handle: string }, ConvexRead>("profiles:getPublicByUsername");
type ConvexStats = Omit<ProfileStats, "joinedDate" | "capped"> & { joinedDate: string; capped: boolean };
const getPublicStats = makeFunctionReference<"query", { handle: string }, ConvexStats | null>("profiles:getPublicStats");
type DirectoryRow = PublicProfile & { projectCount: number; totalFavorites: number; lastActivity: string | null };
const listPublic = makeFunctionReference<"query", Record<string, never>, { rows: DirectoryRow[]; capped: boolean }>("profiles:listPublic");

export type PublicProfileRead =
  | { kind: "profile"; profile: PublicProfileRow }
  | { kind: "redirect"; currentUsername: string; profile: PublicProfileRow | null }
  | null;

let cached: { url: string; client: ConvexHttpClient } | null = null;

function client(url: string): ConvexHttpClient {
  if (cached?.url !== url) cached = { url, client: new ConvexHttpClient(url, { skipConvexDeploymentUrlCheck: true }) };
  return cached.client;
}

async function query(url: string, username: string): Promise<ConvexRead> {
  const result = await client(url).query(getPublicByUsername, { handle: username });
  if (result?.kind === "profile") assertPublicProfile(result.profile);
  return result;
}

/**
 * The public profile from Convex when the read switch says Convex; undefined
 * when Supabase serves it, so the caller keeps its own query.
 */
export async function convexPublicProfile(username: string): Promise<PublicProfileRead | undefined> {
  const choice = chooseProjectReadBackend();
  if (choice.backend !== "convex") return undefined;
  const read = await query(choice.url, username);
  if (!read) return null;
  if (read.kind === "profile") return { kind: "profile", profile: rowFromPublicProfile(read.profile) };
  const current = await query(choice.url, read.currentUsername);
  return {
    kind: "redirect",
    currentUsername: read.currentUsername,
    profile: current?.kind === "profile" ? rowFromPublicProfile(current.profile) : null,
  };
}

/** D04c: the profile's public statistics from Convex under the read switch; undefined otherwise. */
export async function convexPublicStats(username: string): Promise<ProfileStats | null | undefined> {
  const choice = chooseProjectReadBackend();
  if (choice.backend !== "convex") return undefined;
  return await client(choice.url).query(getPublicStats, { handle: username });
}

export type DirectoryEntry = PublicProfileRow & { project_count: number; total_favorites: number; last_activity_date: string | null };

/** D04c: the user directory from Convex under the read switch, in /api/profiles' row shape; undefined otherwise. */
export async function convexDirectory(): Promise<DirectoryEntry[] | undefined> {
  const choice = chooseProjectReadBackend();
  if (choice.backend !== "convex") return undefined;
  const { rows, capped } = await client(choice.url).query(listPublic, {});
  if (capped) console.warn("[profiles] directory hit its cap; the list is incomplete");
  return rows.map(({ projectCount, totalFavorites, lastActivity, ...profile }) => {
    assertPublicProfile(profile);
    return { ...rowFromPublicProfile(profile), project_count: projectCount, total_favorites: totalFavorites, last_activity_date: lastActivity };
  });
}
