// Convex schema: the full accepted P07 model (D00a), shared by the importer
// (D00b) and every later operation. Field names, types and index names follow
// p07-model/P07_REPORT.md §3; where P07 leaves a type open, the choice is
// recorded in phase-d00a/D00A_REPORT.md. Conventions (§6): schema validation
// stays on (the default); "absent" is a missing field, never null; timestamps
// are explicit ms-since-epoch numbers so imported dates survive; a tightening
// on a table that already holds documents goes through .staged() first.
// Better Auth's component tables arrive with D08. The search index
// `search_public` and the search event tables are deferred to S01/S02.
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const live = v.union(v.literal("current"), v.literal("previous"));

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

  // §3.2 Provider subjects (D01). The only way from a signed-in token to a
  // users row; a mutation keeps (provider, subject) unique. Never linked by email.
  authLinks: defineTable({
    userId: v.id("users"),
    provider: v.union(v.literal("clerk"), v.literal("better-auth")),
    subject: v.string(),
    linkedAt: v.number(),
  })
    .index("by_provider_subject", ["provider", "subject"])
    .index("by_user", ["userId"]),

  // §3.3 Public profile, a separate table so public reads can't touch users.
  // No bio field (Jose, 2026-10-28).
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

  // §3.4 Username claims and history. A previous name stays reserved for its
  // user until reservedUntil (90 days, §5.3).
  usernames: defineTable({
    usernameKey: v.string(),
    userId: v.id("users"),
    state: live,
    claimedAt: v.number(),
    releasedAt: v.optional(v.number()),
    reservedUntil: v.optional(v.number()),
  })
    .index("by_usernameKey_state", ["usernameKey", "state"])
    .index("by_userId_state", ["userId", "state"])
    .index("by_state_reservedUntil", ["state", "reservedUntil"]),

  // §3.5 Projects. listed = status active AND visibility public.
  // links.type is C's addition (the C02 contract carries it); P07 lists url and label.
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
    categoryDataVersion: v.optional(v.number()),
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
    // Only filled if S01 picks native search, so missing until then.
    searchText: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_owner_status_created", ["ownerId", "status", "createdAt"])
    .index("by_owner_listed_created", ["ownerId", "listed", "createdAt"])
    .index("by_owner_listed_ranking", ["ownerId", "listed", "rankingFavoriteCount"])
    .index("by_listed_created", ["listed", "createdAt"])
    .index("by_listed_updated", ["listed", "updatedAt"])
    .index("by_listed_ranking", ["listed", "rankingFavoriteCount"])
    .index("by_listed_title", ["listed", "titleSortKey"])
    .index("by_listed_tagCount", ["listed", "tagCount"])
    .index("by_listed_shuffle", ["listed", "shuffleKey"])
    .index("by_listed_category_created", ["listed", "category", "createdAt"])
    .index("by_listed_category_ranking", ["listed", "category", "rankingFavoriteCount"]),

  // §3.6 Slug history. Every slug, current or previous, stays reserved until purge.
  projectSlugs: defineTable({
    slug: v.string(),
    projectId: v.id("projects"),
    state: live,
    createdAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_project_state", ["projectId", "state"]),

  // §3.7 Tags. listedProjectCount is new on a table that already holds
  // documents, so it is enforced as optional and staged as required; the
  // staged validator is promoted once D00b's import has written every counter.
  tags: defineTable({
    name: v.string(),
    nameKey: v.string(),
    description: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("retired")),
    listedProjectCount: v.optional(v.number()),
    createdAt: v.number(),
  })
    .staged({ listedProjectCount: v.number() })
    .index("by_nameKey", ["nameKey"])
    .index("by_status_name", ["status", "nameKey"])
    .index("by_status_count", ["status", "listedProjectCount"]),

  // §3.7 Reviewed aliases only; starts empty (content belongs to S03).
  tagAliases: defineTable({
    aliasKey: v.string(),
    tagId: v.id("tags"),
    reviewedBy: v.id("users"),
    reviewedAt: v.number(),
  }).index("by_aliasKey", ["aliasKey"]),

  // §3.8 The authoritative project-tag join; projects.tagIds is its copy.
  projectTags: defineTable({
    projectId: v.id("projects"),
    tagId: v.id("tags"),
    position: v.number(),
    listed: v.boolean(),
  })
    .index("by_project_position", ["projectId", "position"])
    .index("by_project_tag", ["projectId", "tagId"])
    .index("by_tag_listed", ["tagId", "listed"]),

  // §3.9 Favorites. Lists are private (§8); listed is copied from the project.
  favorites: defineTable({
    userId: v.id("users"),
    projectId: v.id("projects"),
    createdAt: v.number(),
    listed: v.boolean(),
  })
    .index("by_user_project", ["userId", "projectId"])
    .index("by_user_listed_created", ["userId", "listed", "createdAt"])
    .index("by_project_created", ["projectId", "createdAt"]),

  // §3.10 Project images on _storage. URLs are computed on read, never stored.
  projectImages: defineTable({
    projectId: v.id("projects"),
    storageId: v.id("_storage"),
    kind: v.union(v.literal("cover"), v.literal("screenshot"), v.literal("diagram"), v.literal("logo")),
    displayOrder: v.number(),
    altText: v.optional(v.string()),
    caption: v.optional(v.string()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    aspectRatio: v.optional(v.string()),
    fileName: v.string(),
    mimeType: v.string(),
    size: v.number(),
    uploadedBy: v.id("users"),
    status: v.union(v.literal("active"), v.literal("deleted")),
    deletedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_project_status_order", ["projectId", "status", "displayOrder"])
    .index("by_project_kind_status", ["projectId", "kind", "status"])
    .index("by_storageId", ["storageId"]),

  // §3.11 Tag suggestions. The submitter comes from the session. It is
  // optional because account deletion keeps reviewed suggestions but removes
  // their submitter (§5.7).
  tagSuggestions: defineTable({
    projectId: v.id("projects"),
    submitterId: v.optional(v.id("users")),
    proposedName: v.string(),
    nameKey: v.string(),
    note: v.optional(v.string()),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
    resolvedTagId: v.optional(v.id("tags")),
    reviewerId: v.optional(v.id("users")),
    reviewedAt: v.optional(v.number()),
    adminNotes: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_status_created", ["status", "createdAt"])
    .index("by_project_status", ["projectId", "status"])
    .index("by_project_nameKey", ["projectId", "nameKey"])
    .index("by_submitter_created", ["submitterId", "createdAt"]),

  // §3.12 Audit events, kept 1 year. details holds small scalars only: no
  // emails, no free text.
  auditEvents: defineTable({
    kind: v.union(
      v.literal("project.deleted"),
      v.literal("project.restored"),
      v.literal("project.purged"),
      v.literal("image.purged"),
      v.literal("account.deletion_requested"),
      v.literal("account.deleted"),
      v.literal("role.changed"),
      v.literal("username.changed"),
      v.literal("slug.changed"),
    ),
    actorId: v.optional(v.id("users")),
    subjectTable: v.string(),
    subjectId: v.string(),
    at: v.number(),
    details: v.optional(v.record(v.string(), v.union(v.string(), v.number(), v.boolean()))),
  })
    .index("by_subject", ["subjectTable", "subjectId"])
    .index("by_at", ["at"]),

  // §3.13 Search and analytics outbox, written in the same transaction as the
  // change. The consumer is deferred to S01/S02.
  contentChanges: defineTable({
    entityType: v.union(v.literal("project"), v.literal("profile"), v.literal("tag")),
    entityId: v.string(),
    change: v.union(v.literal("upsert"), v.literal("remove")),
    sourceVersion: v.number(),
    projectionVersion: v.number(),
    createdAt: v.number(),
    processedAt: v.optional(v.number()),
    attempts: v.number(),
  })
    .index("by_processed_created", ["processedAt", "createdAt"])
    .index("by_entity", ["entityType", "entityId"]),

  // §3.15 Import bookkeeping, local development deployment only. Emptied or
  // exported to the private archive before any production data exists (§10).
  importRuns: defineTable({
    sourceCapture: v.string(),
    sourceFingerprint: v.string(),
    startedAt: v.number(),
    step: v.string(),
    // §10: the last source ID of the current step, so a failed run resumes.
    cursor: v.optional(v.string()),
    status: v.union(v.literal("running"), v.literal("failed"), v.literal("complete")),
    counts: v.record(v.string(), v.number()),
  }),

  importMap: defineTable({
    runId: v.id("importRuns"),
    sourceTable: v.string(),
    sourceId: v.string(),
    targetTable: v.string(),
    targetId: v.string(),
    rowHash: v.string(),
  })
    .index("by_source", ["sourceTable", "sourceId"])
    .index("by_run", ["runId"]),

  importRejects: defineTable({
    runId: v.id("importRuns"),
    sourceTable: v.string(),
    sourceId: v.string(),
    reason: v.string(),
  }).index("by_run", ["runId"]),
});
