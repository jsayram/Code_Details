"use server";

// DEF-G4E3-HANDLE: the dashboard's profile editor saves to
// /api/profiles/<handle>. With Better Auth the client has no handle, so it asks
// here for the session's own one, from the store that PUT writes to: Convex
// (identity:whoami) when profile writes go to Convex, else the Supabase
// profile of the session's account (as getMyShareUsername). No arguments: the
// handle can only be the caller's. Null when signed out or on any error.
import { makeFunctionReference } from "convex/server";
import { projectWritesToConvex } from "@/backend/projects/project-update";
import { viewerQuery } from "@/lib/auth-server";
import { getMyShareUsername } from "./share";

const whoami = makeFunctionReference<"query", Record<string, never>, { username: string | null } | null>("identity:whoami");

export async function getMyProfileHandle(): Promise<string | null> {
  try {
    if (projectWritesToConvex()) return (await viewerQuery(whoami))?.result?.username ?? null;
    return await getMyShareUsername();
  } catch {
    return null;
  }
}
