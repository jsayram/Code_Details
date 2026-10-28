// Convex schema, Phase C (C08): only the subset of the accepted P07 model that
// the public project read needs. Field names, types and index names follow
// p07-model/P07_REPORT.md §3.1, §3.3, §3.5 and §3.7; tables and fields not
// listed here arrive with the D phases that use them. Schema validation stays
// on (the default). The tables start empty and only ever hold synthetic
// fixtures in C, so there is nothing to stage yet; later tightenings go
// through .staged() validators first (P07 §6).
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // §3.1 Private account record. No public query returns it.
  users: defineTable({
    authUserId: v.optional(v.string()),
    role: v.union(v.literal("user"), v.literal("admin")),
    tier: v.union(v.literal("free"), v.literal("pro"), v.literal("diamond")),
    status: v.union(v.literal("active"), v.literal("deleting"), v.literal("deleted"), v.literal("system")),
    createdAt: v.number(),
    deletionRequestedAt: v.optional(v.number()),
    deleteAfter: v.optional(v.number()),
  })
    .index("by_authUserId", ["authUserId"])
    .index("by_status_deleteAfter", ["status", "deleteAfter"]),

  // §3.3 Public profile, a separate table so public reads can't touch users.
  profiles: defineTable({
    userId: v.id("users"),
    username: v.string(),
    usernameKey: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    fullName: v.optional(v.string()),
    avatar: v.optional(
      v.union(
        v.object({ kind: v.literal("external"), url: v.string() }),
        v.object({ kind: v.literal("stored"), storageId: v.id("_storage") }),
      ),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_usernameKey", ["usernameKey"]),

  // §3.7 Tags, minimal: the page shows tag names. Aliases and counts come later.
  tags: defineTable({
    name: v.string(),
    nameKey: v.string(),
    status: v.union(v.literal("active"), v.literal("retired")),
    createdAt: v.number(),
  }).index("by_nameKey", ["nameKey"]),

  // §3.5 Projects. Indexes: the detail lookup and the alphabetical one C09a measures.
  projects: defineTable({
    ownerId: v.id("users"),
    title: v.string(),
    titleSortKey: v.string(),
    slug: v.string(),
    description: v.optional(v.string()),
    category: v.string(),
    categoryData: v.optional(
      v.record(v.string(), v.union(v.string(), v.number(), v.boolean(), v.array(v.string()))),
    ),
    fieldOrder: v.optional(v.array(v.string())),
    links: v.array(v.object({ url: v.string(), label: v.optional(v.string()), type: v.optional(v.string()) })),
    visibility: v.union(v.literal("public"), v.literal("private")),
    status: v.union(v.literal("active"), v.literal("deleted")),
    deletedAt: v.optional(v.number()),
    listed: v.boolean(),
    tagIds: v.array(v.id("tags")),
    tagCount: v.number(),
    favoriteCount: v.number(),
    rankingFavoriteCount: v.number(),
    contentVersion: v.number(),
    shuffleKey: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_listed_title", ["listed", "titleSortKey"]),
});
