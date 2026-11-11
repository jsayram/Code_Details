// D07-d: the admin dashboard on Convex, behind the development switches
// (projectWritesToConvex: both switches on the same local backend). The
// admin:* functions learn the caller from the Better Auth session and check
// users.role themselves; the server actions also keep their own admin check.
// Answers are mapped to the default (Supabase) shapes so the dashboard doesn't
// change, except that Convex keeps no emails or provider subjects: those
// fields come back empty (null / "") and the pipeline names submitters by
// username. Server-side only; src/app/actions/{admin-dashboard,
// user-management,advanced-analytics}.ts call it.
import { makeFunctionReference } from "convex/server";
import { viewerMutation, viewerQueryWithArgs } from "@/lib/auth-server";
import type { DashboardStats } from "@/types/rows";
import type { PaginatedUsers, UpdateProfileData, UserProfile, SortOption, TierFilter } from "@/types/rows";
import type { PublicTopContributor, TagPipelineMetrics, TopContributor } from "@/app/actions/advanced-analytics";

type Tier = "free" | "pro" | "diamond";
type ConvexStats = Omit<DashboardStats, "recentActivity" | "allProjects" | "newUsersList"> & {
  recentActivity: (Omit<DashboardStats["recentActivity"][number], "timestamp"> & { timestamp: number })[];
  allProjects: (Omit<DashboardStats["allProjects"][number], "created_at"> & { created_at: number })[];
  newUsersList: { id: string; username: string; full_name: string | null; tier: string | null; profile_image_url: string | null; created_at: number }[];
};
type ConvexUser = { id: string; username: string; fullName: string | null; tier: string; avatarUrl: string | null; createdAt: number; updatedAt: number };
type ConvexPipeline = Omit<TagPipelineMetrics, "recentSubmissions"> & {
  recentSubmissions: (Omit<TagPipelineMetrics["recentSubmissions"][number], "created_at" | "reviewed_at"> & { created_at: number; reviewed_at: number | null })[];
};
type UpdateResult =
  | { ok: true; user: { id: string; username: string; fullName: string | null; tier: string } }
  | { ok: false; code: "not_found" }
  | { ok: false; code: "invalid" | "taken"; field: string; message: string };

const none = {} as Record<string, never>;
const refs = {
  stats: makeFunctionReference<"query", Record<string, never>, ConvexStats | null>("admin:dashboardStats"),
  listUsers: makeFunctionReference<"query", { search?: string; page: number; sortBy: SortOption; tierFilter: TierFilter }, { users: ConvexUser[]; total: number; totalPages: number } | null>("admin:listUsers"),
  updateUser: makeFunctionReference<"mutation", { targetProfileId: string; patch: { handle?: string; fullName?: string | null; tier?: Tier } }, UpdateResult>("admin:updateUser"),
  topContributors: makeFunctionReference<"query", { limit: number }, TopContributor[] | null>("admin:topContributors"),
  tagPipeline: makeFunctionReference<"query", Record<string, never>, ConvexPipeline | null>("admin:tagPipeline"),
  topPublic: makeFunctionReference<"query", { limit: number }, PublicTopContributor[]>("profiles:topContributorsPublic"),
};

const denied = () => new Error("Unauthorized: Admin access required");

export async function dashboardStatsOnConvex(): Promise<DashboardStats> {
  const s = (await viewerQueryWithArgs(refs.stats, none))?.result;
  if (!s) throw denied();
  return {
    ...s,
    recentActivity: s.recentActivity.map((a) => ({ ...a, timestamp: new Date(a.timestamp) })),
    allProjects: s.allProjects.map((p) => ({ ...p, created_at: new Date(p.created_at) })),
    // No emails or provider subjects on Convex.
    newUsersList: s.newUsersList.map((u) => ({ ...u, user_id: "", email_address: null, created_at: new Date(u.created_at) })),
  };
}

const toUserProfile = (u: { id: string; username: string; fullName: string | null; tier: string; avatarUrl?: string | null; createdAt?: number; updatedAt?: number }): UserProfile => ({
  id: u.id,
  user_id: "",
  username: u.username,
  full_name: u.fullName,
  email_address: null,
  tier: u.tier,
  profile_image_url: u.avatarUrl ?? null,
  created_at: u.createdAt ? new Date(u.createdAt) : null,
  updated_at: u.updatedAt ? new Date(u.updatedAt) : null,
});

export async function listUsersOnConvex(search: string | undefined, page: number, sortBy: SortOption, tierFilter: TierFilter): Promise<PaginatedUsers> {
  const r = (await viewerQueryWithArgs(refs.listUsers, { ...(search ? { search } : {}), page, sortBy, tierFilter }))?.result;
  if (!r) throw denied();
  return { users: r.users.map(toUserProfile), total: r.total, page, limit: 100, totalPages: r.totalPages };
}

/** The admin edit form's fields to the closed Convex patch; an email change is refused (no emails on Convex). */
export async function updateUserOnConvex(profileId: string, updates: UpdateProfileData): Promise<UserProfile> {
  if (updates.email_address) throw new Error("Email can't be changed here");
  const patch: { handle?: string; fullName?: string | null; tier?: Tier } = {};
  if (updates.username !== undefined) patch.handle = updates.username;
  if (updates.full_name !== undefined) patch.fullName = updates.full_name || null;
  if (updates.tier !== undefined) patch.tier = updates.tier as Tier;
  const answer = await viewerMutation(refs.updateUser, { targetProfileId: profileId, patch });
  if (!answer) throw denied();
  const r = answer.result;
  if (r.ok) return toUserProfile(r.user);
  throw new Error(r.code === "not_found" ? "User profile not found" : r.message);
}

export async function topContributorsOnConvex(limit: number): Promise<TopContributor[]> {
  const r = (await viewerQueryWithArgs(refs.topContributors, { limit }))?.result;
  if (!r) throw denied();
  return r;
}

export async function tagPipelineOnConvex(): Promise<TagPipelineMetrics> {
  const r = (await viewerQueryWithArgs(refs.tagPipeline, none))?.result;
  if (!r) throw denied();
  return {
    ...r,
    recentSubmissions: r.recentSubmissions.map((s) => ({ ...s, created_at: new Date(s.created_at), reviewed_at: s.reviewed_at ? new Date(s.reviewed_at) : null })),
  };
}

export async function topContributorsPublicOnConvex(limit: number): Promise<PublicTopContributor[]> {
  return (await viewerQueryWithArgs(refs.topPublic, { limit }))?.result ?? [];
}
