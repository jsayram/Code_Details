// Which backend serves the public profile read (D04a). It follows the project
// read switch (chooseProjectReadBackend): Convex only in development with a
// loopback URL, Supabase otherwise. Server-side only.
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { chooseProjectReadBackend } from "@/backend/projects";
import { type PublicProfile, type PublicProfileRow, assertPublicProfile, rowFromPublicProfile } from "./public-profile";

type ConvexRead = { kind: "profile"; profile: PublicProfile } | { kind: "redirect"; currentUsername: string } | null;
const getPublicByUsername = makeFunctionReference<"query", { handle: string }, ConvexRead>("profiles:getPublicByUsername");

export type PublicProfileRead =
  | { kind: "profile"; profile: PublicProfileRow }
  | { kind: "redirect"; currentUsername: string; profile: PublicProfileRow | null }
  | null;

let cached: { url: string; client: ConvexHttpClient } | null = null;

async function query(url: string, username: string): Promise<ConvexRead> {
  if (cached?.url !== url) cached = { url, client: new ConvexHttpClient(url, { skipConvexDeploymentUrlCheck: true }) };
  const result = await cached.client.query(getPublicByUsername, { handle: username });
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
