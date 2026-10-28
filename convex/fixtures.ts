// Synthetic test fixtures for the task-owned local deployment (Phase C, C09,
// C09a). Internal functions only (callable with the admin key, never by a
// client), and each one refuses to run unless the deployment has
// CODEDETAILS_FIXTURES_ALLOWED=1, which only tests/convex/up.sh sets. That
// keeps `clear` from ever touching a real deployment this code is pushed to.
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

function assertFixturesAllowed() {
  if (process.env.CODEDETAILS_FIXTURES_ALLOWED !== "1") {
    throw new Error("fixtures are disabled on this deployment");
  }
}

const TABLES = ["projects", "profiles", "tags", "users"] as const;

export const clear = internalMutation({
  args: {},
  handler: async (ctx) => {
    assertFixturesAllowed();
    const removed: Record<string, number> = {};
    for (const table of TABLES) {
      const docs = await ctx.db.query(table).collect();
      for (const doc of docs) await ctx.db.delete(doc._id);
      removed[table] = docs.length;
    }
    return removed;
  },
});

export const counts = internalQuery({
  args: {},
  handler: async (ctx) => {
    assertFixturesAllowed();
    const out: Record<string, number> = {};
    for (const table of TABLES) out[table] = (await ctx.db.query(table).collect()).length;
    return out;
  },
});

const optionalString = v.optional(v.string());

export const load = internalMutation({
  args: {
    users: v.array(v.object({
      key: v.string(),
      role: v.union(v.literal("user"), v.literal("admin")),
      tier: v.union(v.literal("free"), v.literal("pro"), v.literal("diamond")),
      status: v.union(v.literal("active"), v.literal("deleting")),
      createdAt: v.number(),
    })),
    profiles: v.array(v.object({
      userKey: v.string(),
      username: v.string(),
      usernameKey: v.string(),
      firstName: optionalString,
      lastName: optionalString,
      fullName: optionalString,
      avatarUrl: optionalString,
      createdAt: v.number(),
    })),
    tags: v.array(v.object({ key: v.string(), name: v.string(), nameKey: v.string(), createdAt: v.number() })),
    projects: v.array(v.object({
      ownerKey: v.string(),
      title: v.string(),
      titleSortKey: v.string(),
      slug: v.string(),
      description: optionalString,
      category: v.string(),
      categoryData: v.optional(v.record(v.string(), v.union(v.string(), v.number(), v.boolean(), v.array(v.string())))),
      fieldOrder: v.optional(v.array(v.string())),
      links: v.array(v.object({ url: v.string(), label: optionalString, type: optionalString })),
      visibility: v.union(v.literal("public"), v.literal("private")),
      status: v.union(v.literal("active"), v.literal("deleted")),
      deletedAt: v.optional(v.number()),
      tagKeys: v.array(v.string()),
      favoriteCount: v.number(),
      rankingFavoriteCount: v.number(),
      shuffleKey: v.number(),
      createdAt: v.number(),
      updatedAt: v.number(),
    })),
  },
  handler: async (ctx, args) => {
    assertFixturesAllowed();
    for (const table of TABLES) {
      if (await ctx.db.query(table).first()) throw new Error(`fixture load refused: ${table} is not empty`);
    }
    const users = new Map<string, Id<"users">>();
    for (const u of args.users) {
      const { key, ...doc } = u;
      users.set(key, await ctx.db.insert("users", doc));
    }
    for (const p of args.profiles) {
      const { userKey, avatarUrl, ...rest } = p;
      const userId = users.get(userKey);
      if (!userId) throw new Error(`profile for unknown user ${userKey}`);
      await ctx.db.insert("profiles", {
        ...rest,
        userId,
        avatar: avatarUrl ? { kind: "external", url: avatarUrl } : undefined,
        updatedAt: rest.createdAt,
      });
    }
    const tags = new Map<string, Id<"tags">>();
    for (const t of args.tags) {
      const { key, ...doc } = t;
      tags.set(key, await ctx.db.insert("tags", { ...doc, status: "active" }));
    }
    const projects: Record<string, Id<"projects">> = {};
    for (const p of args.projects) {
      const { ownerKey, tagKeys, ...rest } = p;
      const ownerId = users.get(ownerKey);
      if (!ownerId) throw new Error(`project ${p.slug} has unknown owner ${ownerKey}`);
      const tagIds = tagKeys.map((k) => {
        const id = tags.get(k);
        if (!id) throw new Error(`project ${p.slug} has unknown tag ${k}`);
        return id;
      });
      projects[p.slug] = await ctx.db.insert("projects", {
        ...rest,
        ownerId,
        tagIds,
        tagCount: tagIds.length,
        listed: rest.status === "active" && rest.visibility === "public",
        contentVersion: 1,
      });
    }
    return projects;
  },
});

/** C09a: titleSortKey values of listed projects, in by_listed_title index order. */
export const listedTitleOrder = internalQuery({
  args: {},
  handler: async (ctx) => {
    assertFixturesAllowed();
    const docs = await ctx.db
      .query("projects")
      .withIndex("by_listed_title", (q) => q.eq("listed", true))
      .collect();
    return docs.map((d) => d.titleSortKey);
  },
});
