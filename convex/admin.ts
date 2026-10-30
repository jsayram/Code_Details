// D07-d: the admin dashboard's reads and the admin's update of another
// account (P08 R20; design: Agent Planning/phase-d07/D07D_DESIGN.md). Every
// function starts with requireAdmin: the caller comes only from getViewer and
// must have users.role === "admin". Anyone else gets null (queries) or
// not_found (the mutation), the same as for a missing target.
//
// Nothing here returns an email or a provider subject; user rows are
// identified by profile ID. admin:updateUser is the only function that names
// another account. Its target argument is targetProfileId, the one exemption
// in the D01 identity-args scan. Its patch is closed (username, full name,
// tier): no role (internal roles:setRole), no email, no auth fields. Every
// change writes an admin.user_updated audit row.
//
// Reads are capped for the development deployment's size and report what
// they cut (PROJECT_CAP, PROFILE_CAP); a search index replaces the scans in S01.
import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getViewer, type Viewer } from "./viewer";
import { PROFILE_PROJECTION_VERSION, avatarUrlOf, changeUsername, cleanName } from "./profiles";

export const PROJECT_CAP = 2000;
export const PROFILE_CAP = 5000;
const SUGGESTION_CAP = 5000;
const DAY = 86_400_000;
const USERS_PER_PAGE = 100;

async function requireAdmin(ctx: QueryCtx): Promise<Viewer | null> {
  const viewer = await getViewer(ctx);
  return viewer?.role === "admin" ? viewer : null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);

async function activeProjects(ctx: QueryCtx) {
  const rows = await ctx.db.query("projects").take(PROJECT_CAP + 1);
  return { rows: rows.slice(0, PROJECT_CAP).filter((p) => p.status === "active"), capped: rows.length > PROJECT_CAP };
}

async function profilesByUser(ctx: QueryCtx) {
  const rows = await ctx.db.query("profiles").take(PROFILE_CAP + 1);
  const byUser = new Map<Id<"users">, Doc<"profiles">>();
  for (const p of rows.slice(0, PROFILE_CAP)) byUser.set(p.userId, p);
  return { rows: rows.slice(0, PROFILE_CAP), byUser, capped: rows.length > PROFILE_CAP };
}

// ---------------------------------------------------------------------------
// Dashboard

export const dashboardStats = query({
  args: {},
  handler: async (ctx) => {
    if (!(await requireAdmin(ctx))) return null;
    const now = Date.now();
    const { rows: projects, capped: projectsCapped } = await activeProjects(ctx);
    const { rows: profiles, byUser, capped: profilesCapped } = await profilesByUser(ctx);
    const owner = (p: Doc<"projects">) => byUser.get(p.ownerId)?.username ?? "Unknown User";
    const byFavorites = [...projects].sort((a, b) => b.favoriteCount - a.favoriteCount);

    const tags = await ctx.db.query("tags").collect();
    const tagUse = new Map<Id<"tags">, number>();
    for (const p of projects) for (const t of p.tagIds) tagUse.set(t, (tagUse.get(t) ?? 0) + 1);

    const categories = new Map<string, number>();
    for (const p of projects) categories.set(p.category, (categories.get(p.category) ?? 0) + 1);

    const attention = projects
      .map((p) => {
        const missingDescription = !p.description || p.description.trim().length === 0;
        const missingTags = p.tagIds.length === 0;
        return { p, missingDescription, missingTags, issueCount: Number(missingDescription) + Number(missingTags) };
      })
      .filter((x) => x.issueCount > 0)
      .sort((a, b) => b.issueCount - a.issueCount || b.p.createdAt - a.p.createdAt);

    const weekAgo = now - 7 * DAY;
    const monthAgo = now - 30 * DAY;
    const activeOwners = new Set(projects.filter((p) => p.updatedAt > weekAgo).map((p) => p.ownerId));
    const totalFavorites = projects.reduce((n, p) => n + p.favoriteCount, 0);
    const totalTagLinks = projects.reduce((n, p) => n + p.tagIds.length, 0);
    const newUsers = profiles.filter((p) => p.createdAt > monthAgo).sort((a, b) => b.createdAt - a.createdAt);
    const users = await Promise.all(newUsers.map((p) => ctx.db.get(p.userId)));

    return {
      totalProjects: projects.length,
      activeUsers: [...activeOwners].filter((id) => byUser.has(id)).length,
      recentActivity: [...projects]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 30)
        .map((p) => ({ id: p._id, title: p.title, slug: p.slug, action: p.createdAt === p.updatedAt ? "created" : "updated", username: owner(p), timestamp: p.updatedAt })),
      projectsNeedingAttention: attention.map(({ p, missingDescription, missingTags, issueCount }) => ({
        id: p._id, title: p.title, slug: p.slug, owner: owner(p), missingDescription, missingTags, issueCount,
      })),
      mostPopularProjects: byFavorites.slice(0, 10).map((p) => ({ id: p._id, title: p.title, slug: p.slug, favorites: p.favoriteCount, owner: owner(p) })),
      projectStats: { totalFavorites, totalTags: tags.length, activeThisWeek: projects.filter((p) => p.updatedAt > weekAgo).length },
      topTags: tags
        .map((t) => ({ name: t.name, count: tagUse.get(t._id) ?? 0 }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      allProjects: byFavorites.map((p) => ({
        id: p._id, title: p.title, slug: p.slug, total_favorites: p.favoriteCount, category: p.category, owner: owner(p), created_at: p.createdAt, tag_count: p.tagIds.length,
      })),
      userGrowth: {
        totalUsers: profiles.length,
        newUsersThisWeek: profiles.filter((p) => p.createdAt > weekAgo).length,
        newUsersThisMonth: newUsers.length,
      },
      newUsersList: await Promise.all(
        newUsers.map(async (p, i) => ({
          id: p._id,
          username: p.username,
          full_name: p.fullName ?? null,
          tier: users[i]?.tier ?? null,
          profile_image_url: await avatarUrlOf(ctx, p),
          created_at: p.createdAt,
        })),
      ),
      categoryDistribution: [...categories.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([category, count]) => ({ category, count, percentage: pct(count, projects.length) })),
      engagementMetrics: {
        avgFavoritesPerProject: projects.length ? round1(totalFavorites / projects.length) : 0,
        avgTagsPerProject: projects.length ? round1(totalTagLinks / projects.length) : 0,
        projectsWithoutFavorites: projects.filter((p) => p.favoriteCount === 0).length,
        projectsWithoutTags: projects.filter((p) => p.tagIds.length === 0).length,
      },
      capped: projectsCapped || profilesCapped,
    };
  },
});

// ---------------------------------------------------------------------------
// Users

export const listUsers = query({
  args: {
    search: v.optional(v.string()),
    page: v.number(),
    sortBy: v.union(v.literal("recent-edit"), v.literal("alphabetical"), v.literal("most-active")),
    tierFilter: v.union(v.literal("all"), v.literal("free"), v.literal("pro"), v.literal("diamond")),
  },
  handler: async (ctx, { search, page, sortBy, tierFilter }) => {
    if (!(await requireAdmin(ctx))) return null;
    const { rows, capped } = await profilesByUser(ctx);
    const term = search?.trim().toLowerCase().slice(0, 200) ?? "";
    const withUsers = await Promise.all(rows.map(async (p) => ({ p, user: await ctx.db.get(p.userId) })));
    const matching = withUsers.filter(({ p, user }) => {
      if (!user || user.status === "deleted") return false;
      if (tierFilter !== "all" && user.tier !== tierFilter) return false;
      if (!term) return true;
      return [p.usernameKey, p.fullName?.toLowerCase() ?? "", user.tier].some((f) => f.includes(term));
    });
    matching.sort((a, b) =>
      sortBy === "alphabetical" ? a.p.usernameKey.localeCompare(b.p.usernameKey) : sortBy === "most-active" ? b.p.createdAt - a.p.createdAt : b.p.updatedAt - a.p.updatedAt,
    );
    const safePage = Math.max(1, Math.floor(page));
    const slice = matching.slice((safePage - 1) * USERS_PER_PAGE, safePage * USERS_PER_PAGE);
    return {
      users: await Promise.all(
        slice.map(async ({ p, user }) => ({
          id: p._id,
          username: p.username,
          fullName: p.fullName ?? null,
          tier: user!.tier,
          avatarUrl: await avatarUrlOf(ctx, p),
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        })),
      ),
      total: matching.length,
      totalPages: Math.ceil(matching.length / USERS_PER_PAGE),
      capped,
    };
  },
});

export type AdminUpdateResult =
  | { ok: true; user: { id: string; username: string; fullName: string | null; tier: string } }
  | { ok: false; code: "not_found" }
  | { ok: false; code: "invalid" | "taken"; field: string; message: string };

export const updateUser = mutation({
  args: {
    // The account the admin acts on: the D01 scan's one allowlisted target.
    targetProfileId: v.string(),
    patch: v.object({
      // The new username ("handle", as in profiles:updateMine: the scan refuses "user*" names).
      handle: v.optional(v.string()),
      fullName: v.optional(v.union(v.string(), v.null())),
      tier: v.optional(v.union(v.literal("free"), v.literal("pro"), v.literal("diamond"))),
    }),
  },
  handler: async (ctx, { targetProfileId, patch }): Promise<AdminUpdateResult> => {
    const admin = await requireAdmin(ctx);
    const id = ctx.db.normalizeId("profiles", targetProfileId);
    const profile = admin && id ? await ctx.db.get(id) : null;
    const user = profile ? await ctx.db.get(profile.userId) : null;
    if (!admin || !profile || !user || user.status === "deleted") return { ok: false, code: "not_found" };

    const now = Date.now();
    const changes: Partial<Doc<"profiles">> = {};
    const fields: string[] = [];
    let unsetFullName = false;
    if (patch.fullName !== undefined) {
      // The owner's own name rules (profiles:updateMine).
      const cleaned = cleanName(patch.fullName);
      if (!cleaned.ok) return { ok: false, code: "invalid", field: "fullName", message: "Names can't contain an email address" };
      const name = cleaned.value;
      if (name !== profile.fullName) {
        if (name === undefined) unsetFullName = true;
        else changes.fullName = name;
        fields.push("fullName");
      }
    }
    if (patch.handle !== undefined && patch.handle !== profile.username) {
      const renamed = await changeUsername(ctx, profile, patch.handle, admin.userId, now);
      if (!renamed.ok) return renamed;
      Object.assign(changes, renamed.changes);
      fields.push("username");
    }
    const tierChanged = patch.tier !== undefined && patch.tier !== user.tier;
    if (tierChanged) {
      await ctx.db.patch(user._id, { tier: patch.tier! });
      fields.push("tier");
    }

    if (fields.length) {
      await ctx.db.patch(profile._id, { ...changes, updatedAt: now });
      if (unsetFullName) await ctx.db.patch(profile._id, { fullName: undefined });
      await ctx.db.insert("auditEvents", {
        kind: "admin.user_updated",
        actorId: admin.userId,
        subjectTable: "profiles",
        subjectId: profile._id,
        at: now,
        details: { fields: fields.join(","), ...(tierChanged ? { tierFrom: user.tier, tierTo: patch.tier! } : {}) },
      });
      await ctx.db.insert("contentChanges", {
        entityType: "profile",
        entityId: profile._id,
        change: "upsert",
        sourceVersion: now,
        projectionVersion: PROFILE_PROJECTION_VERSION,
        createdAt: now,
        attempts: 0,
      });
    }
    const saved = (await ctx.db.get(profile._id))!;
    const savedUser = (await ctx.db.get(user._id))!;
    return { ok: true, user: { id: saved._id, username: saved.username, fullName: saved.fullName ?? null, tier: savedUser.tier } };
  },
});

// ---------------------------------------------------------------------------
// Analytics

export const topContributors = query({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    if (!(await requireAdmin(ctx))) return null;
    const { rows: projects } = await activeProjects(ctx);
    const { rows: profiles } = await profilesByUser(ctx);
    const suggestions = await ctx.db.query("tagSuggestions").take(SUGGESTION_CAP);
    const rows = await Promise.all(
      profiles.map(async (p) => {
        const own = projects.filter((x) => x.ownerId === p.userId);
        const mine = suggestions.filter((s) => s.submitterId === p.userId);
        const projectsCount = own.length;
        const favoritesReceived = own.reduce((n, x) => n + x.favoriteCount, 0);
        const approved = mine.filter((s) => s.status === "approved").length;
        return {
          user_id: p._id,
          username: p.username,
          full_name: p.fullName ?? null,
          profile_image_url: await avatarUrlOf(ctx, p),
          tier: (await ctx.db.get(p.userId))?.tier ?? null,
          projects_count: projectsCount,
          favorites_received: favoritesReceived,
          tag_submissions_count: mine.length,
          approved_tags_count: approved,
          contribution_score: projectsCount * 10 + favoritesReceived * 5 + approved * 5,
        };
      }),
    );
    return rows.sort((a, b) => b.contribution_score - a.contribution_score).slice(0, Math.max(0, Math.min(100, Math.floor(limit))));
  },
});

export const tagPipeline = query({
  args: {},
  handler: async (ctx) => {
    if (!(await requireAdmin(ctx))) return null;
    const all = await ctx.db.query("tagSuggestions").take(SUGGESTION_CAP);
    const nameOf = new Map<Id<"users">, string>();
    const username = async (id: Id<"users"> | undefined) => {
      if (!id) return "deleted account";
      if (!nameOf.has(id)) {
        const p = await ctx.db.query("profiles").withIndex("by_userId", (q) => q.eq("userId", id)).first();
        nameOf.set(id, p?.username ?? "deleted account");
      }
      return nameOf.get(id)!;
    };
    const count = (status: string) => all.filter((s) => s.status === status).length;
    const total = all.length;
    const [pending, approved, rejected] = [count("pending"), count("approved"), count("rejected")];
    const reviewHours = (s: Doc<"tagSuggestions">) => (s.reviewedAt ? (s.reviewedAt - s.createdAt) / 3_600_000 : null);
    const reviewed = all.map(reviewHours).filter((h): h is number => h !== null);

    const recent = [...all].sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);
    const bySubmitter = new Map<string, { total: number; approved: number; pending: number; rejected: number }>();
    for (const s of all) {
      const key = await username(s.submitterId);
      const row = bySubmitter.get(key) ?? { total: 0, approved: 0, pending: 0, rejected: 0 };
      row.total++;
      row[s.status]++;
      bySubmitter.set(key, row);
    }
    return {
      totalSubmissions: total,
      pendingCount: pending,
      approvedCount: approved,
      rejectedCount: rejected,
      approvalRate: pct(approved, total),
      rejectionRate: pct(rejected, total),
      avgReviewTimeHours: reviewed.length ? round1(reviewed.reduce((a, b) => a + b, 0) / reviewed.length) : null,
      submissionsByStatus: [
        { status: "pending", count: pending, percentage: pct(pending, total) },
        { status: "approved", count: approved, percentage: pct(approved, total) },
        { status: "rejected", count: rejected, percentage: pct(rejected, total) },
      ],
      recentSubmissions: await Promise.all(
        recent.map(async (s) => {
          const h = reviewHours(s);
          return {
            id: s._id,
            tag_name: s.proposedName,
            // No emails on Convex: the submitter's username.
            submitter_email: await username(s.submitterId),
            status: s.status,
            created_at: s.createdAt,
            reviewed_at: s.reviewedAt ?? null,
            review_time_hours: h === null ? null : round1(h),
          };
        }),
      ),
      topSubmitters: [...bySubmitter.entries()]
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 10)
        .map(([name, r]) => ({ submitter_email: name, total_submissions: r.total, approved: r.approved, pending: r.pending, rejected: r.rejected, approval_rate: pct(r.approved, r.total) })),
    };
  },
});
