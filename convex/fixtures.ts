// Synthetic test fixtures for the task-owned local deployment (Phase C, C09,
// C09a). Internal functions only (callable with the admin key, never by a
// client), and each one refuses to run unless the deployment has
// CODEDETAILS_FIXTURES_ALLOWED=1, which only tests/convex/up.sh sets. That
// keeps `clear` from ever touching a real deployment this code is pushed to.
import { v } from "convex/values";
import { createFunctionHandle } from "convex/server";
import { components, internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { holdsOnlySignUpRows, removeSignUpAccount } from "./accounts";
import { syncSearchText } from "./searchSync";
import { rewriteQuery } from "../src/backend/search/vocabulary-layer";

function assertFixturesAllowed() {
  if (process.env.CODEDETAILS_FIXTURES_ALLOWED !== "1") {
    throw new Error("fixtures are disabled on this deployment");
  }
}

// D02r: favorites too, for the personal reads.
const TABLES = ["favorites", "projects", "profiles", "tags", "authLinks", "users"] as const;
// D08e: rateLimit too, so one test run's attempts never count against the next.
const AUTH_MODELS = ["session", "account", "verification", "user", "rateLimit"] as const;

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
    // D08c: sign-up claims usernames; the loaded fixtures don't, so this table
    // stays out of TABLES (and of counts/snapshot) and is just emptied here.
    for (const doc of await ctx.db.query("usernames").collect()) await ctx.db.delete(doc._id);
    // D03: image rows (and their files) and tag suggestions added by the lifecycle tests.
    for (const doc of await ctx.db.query("projectImages").collect()) {
      if (await ctx.db.system.get(doc.storageId)) await ctx.storage.delete(doc.storageId);
      await ctx.db.delete(doc._id);
    }
    for (const doc of await ctx.db.query("tagSuggestions").collect()) await ctx.db.delete(doc._id);
    // D02: the project update's own tables (slug history, tag join, search outbox); D07: tag aliases.
    for (const table of ["projectSlugs", "projectTags", "contentChanges", "tagAliases"] as const) {
      for (const doc of await ctx.db.query(table).collect()) await ctx.db.delete(doc._id);
    }
    // D08 /api/llm gate: usage counters and the call log the gate tests write;
    // D10: the search analytics tables.
    for (const table of ["llmDailyUsage", "llmCalls", "searchReceipts", "searchEvents", "searchDaily", "searchDrops"] as const) {
      for (const doc of await ctx.db.query(table).collect()) await ctx.db.delete(doc._id);
    }
    // D08d wrote account.linked audit rows; emptied in case an old run left some.
    for (const doc of await ctx.db.query("auditEvents").collect()) await ctx.db.delete(doc._id);
    // D08a: Better Auth's own tables, so no auth user outlives its app account.
    // The signing keys (jwks) stay; they belong to the deployment.
    for (const model of AUTH_MODELS) {
      await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
        input: { model },
        paginationOpts: { cursor: null, numItems: 1000 },
      });
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
      subject: v.string(),
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
    tags: v.array(v.object({ key: v.string(), name: v.string(), nameKey: v.string(), listedProjectCount: v.number(), createdAt: v.number() })),
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
      previousSlug: optionalString,
      favoriteCount: v.number(),
      rankingFavoriteCount: v.number(),
      shuffleKey: v.number(),
      createdAt: v.number(),
      updatedAt: v.number(),
    })),
    // D02r: favorite rows by persona key and project slug. Optional so older
    // callers keep working; listed is copied from the project (P07 §3.9).
    favorites: v.optional(v.array(v.object({ userKey: v.string(), projectSlug: v.string(), createdAt: v.number() }))),
  },
  handler: async (ctx, args) => {
    assertFixturesAllowed();
    for (const table of TABLES) {
      if (await ctx.db.query(table).first()) throw new Error(`fixture load refused: ${table} is not empty`);
    }
    const users = new Map<string, Id<"users">>();
    for (const u of args.users) {
      const { key, subject, ...doc } = u;
      const userId = await ctx.db.insert("users", doc);
      users.set(key, userId);
      // D01: the synthetic Clerk-era subject, so tests can sign in as this persona.
      await ctx.db.insert("authLinks", { userId, provider: "clerk", subject, linkedAt: doc.createdAt });
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
      const { ownerKey, tagKeys, previousSlug, ...rest } = p;
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
      // D02: slug history and the project-tag join, as the importer writes them.
      const projectId = projects[p.slug];
      await ctx.db.insert("projectSlugs", { slug: p.slug, projectId, state: "current", createdAt: p.createdAt });
      if (previousSlug) await ctx.db.insert("projectSlugs", { slug: previousSlug, projectId, state: "previous", createdAt: p.createdAt });
      const listed = rest.status === "active" && rest.visibility === "public";
      for (const [position, tagId] of tagIds.entries()) await ctx.db.insert("projectTags", { projectId, tagId, position, listed });
    }
    // D09 S02a: searchText as the write paths keep it (the importer leaves it to searchSync:backfillBatch).
    for (const projectId of Object.values(projects)) await syncSearchText(ctx, projectId);
    for (const f of args.favorites ?? []) {
      const userId = users.get(f.userKey);
      const projectId = projects[f.projectSlug];
      if (!userId || !projectId) throw new Error(`favorite ${f.userKey} -> ${f.projectSlug} has an unknown side`);
      const project = await ctx.db.get(projectId);
      await ctx.db.insert("favorites", { userId, projectId, createdAt: f.createdAt, listed: project!.listed });
    }
    return projects;
  },
});

/** C17: every document of the fixture tables, for a before/after digest. */
export const snapshot = internalQuery({
  args: {},
  handler: async (ctx) => {
    assertFixturesAllowed();
    const out: Record<string, unknown[]> = {};
    for (const table of TABLES) out[table] = await ctx.db.query(table).collect();
    return out;
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

/** D08a: Better Auth rows and the app rows that point at them, for one email. */
export const authState = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    assertFixturesAllowed();
    const authUser = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "user",
      where: [{ field: "email", value: email }],
    });
    if (!authUser) return null;
    const sessions = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "session",
      where: [{ field: "userId", value: authUser._id }],
      paginationOpts: { cursor: null, numItems: 100 },
    });
    const users = await ctx.db
      .query("users")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", authUser._id))
      .collect();
    const links = await ctx.db
      .query("authLinks")
      .withIndex("by_provider_subject", (q) => q.eq("provider", "better-auth").eq("subject", authUser._id))
      .collect();
    return { authUserId: authUser._id as string, sessionIds: sessions.page.map((s: { _id: string }) => s._id), users, links };
  },
});

/** D08a: every app document as text, to show no email was copied into one. */
export const appTablesText = internalQuery({
  args: {},
  handler: async (ctx) => {
    assertFixturesAllowed();
    const tables = ["users", "authLinks", "profiles", "usernames", "projects", "auditEvents", "contentChanges"] as const;
    const out: unknown[] = [];
    for (const table of tables) out.push(await ctx.db.query(table).collect());
    return JSON.stringify(out);
  },
});

/**
 * D08a: moves a Better Auth session's expiry into the past, as time would.
 * D08b: or to `expiresAt`, e.g. close to its end to make it due for refresh.
 */
export const expireSession = internalMutation({
  args: { sessionId: v.string(), expiresAt: v.optional(v.number()) },
  handler: async (ctx, { sessionId, expiresAt }) => {
    assertFixturesAllowed();
    await ctx.runMutation(components.betterAuth.adapter.updateOne, {
      input: { model: "session", where: [{ field: "_id", value: sessionId }], update: { expiresAt: expiresAt ?? Date.now() - 1000 } },
    });
  },
});

/** D08a: puts the app account behind a Better Auth user into another status. */
export const setAccountStatus = internalMutation({
  args: { authUserId: v.string(), status: v.union(v.literal("active"), v.literal("deleting")) },
  handler: async (ctx, { authUserId, status }) => {
    assertFixturesAllowed();
    const user = await ctx.db
      .query("users")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", authUserId))
      .unique();
    if (!user) throw new Error("no account for that auth user");
    await ctx.db.patch(user._id, status === "deleting" ? { status, deletionRequestedAt: Date.now() } : { status });
  },
});

/**
 * D08c: turns a normal sign-up into a half-finished one, as if the
 * credential and session writes after the auth user's insert had failed.
 */
// D08g1: make a synthetic account an admin (or back) for the proxy's admin-route tests.
export const setRole = internalMutation({
  args: { authUserId: v.string(), role: v.union(v.literal("user"), v.literal("admin")) },
  handler: async (ctx, { authUserId, role }) => {
    assertFixturesAllowed();
    const user = await ctx.db
      .query("users")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", authUserId))
      .unique();
    if (!user) throw new Error("no account for that auth user");
    await ctx.db.patch(user._id, { role });
  },
});

// D11: undo linkPersona (below) for a Clerk-era persona, so a test that links
// it doesn't depend on test order or earlier runs. Removes the persona's
// "better-auth" links only; its Clerk-era link and data stay.
export const releasePersona = internalMutation({
  args: { clerkSubject: v.string() },
  handler: async (ctx, { clerkSubject }) => {
    assertFixturesAllowed();
    const clerk = await ctx.db
      .query("authLinks")
      .withIndex("by_provider_subject", (q) => q.eq("provider", "clerk").eq("subject", clerkSubject))
      .unique();
    if (!clerk) throw new Error("no Clerk-era persona with that subject");
    const links = await ctx.db
      .query("authLinks")
      .withIndex("by_user", (q) => q.eq("userId", clerk.userId))
      .collect();
    let removed = 0;
    for (const link of links) {
      if (link.provider === "better-auth") {
        await ctx.db.delete(link._id);
        removed++;
      }
    }
    return removed;
  },
});

// D08g4b: the D08d handover is gone, so tests that need a Better Auth login
// on a Clerk-era persona (D11's legacySubject) link it here instead. Same end
// state the handover left: the persona takes the login, and the account the
// sign-up made goes away, only if it still holds nothing but sign-up rows.
export const linkPersona = internalMutation({
  args: { clerkSubject: v.string(), authUserId: v.string() },
  handler: async (ctx, { clerkSubject, authUserId }) => {
    assertFixturesAllowed();
    const clerk = await ctx.db
      .query("authLinks")
      .withIndex("by_provider_subject", (q) => q.eq("provider", "clerk").eq("subject", clerkSubject))
      .unique();
    if (!clerk) throw new Error("no Clerk-era persona with that subject");
    for (const link of await ctx.db.query("authLinks").withIndex("by_user", (q) => q.eq("userId", clerk.userId)).collect()) {
      if (link.provider === "better-auth") await ctx.db.delete(link._id);
    }
    const current = await ctx.db
      .query("authLinks")
      .withIndex("by_provider_subject", (q) => q.eq("provider", "better-auth").eq("subject", authUserId))
      .unique();
    if (current) {
      if (!(await holdsOnlySignUpRows(ctx, current.userId))) throw new Error("that login's account holds more than sign-up rows");
      await removeSignUpAccount(ctx, current.userId);
    }
    await ctx.db.insert("authLinks", { userId: clerk.userId, provider: "better-auth", subject: authUserId, linkedAt: Date.now() });
    await ctx.db.patch(clerk.userId, { authUserId });
  },
});

// D08g4c: a Better Auth login whose app account is gone, so its token is
// valid but names no account (what the removed Clerk-era tests called "a
// subject with no link"). Only for a fresh sign-up's account.
export const unlinkLogin = internalMutation({
  args: { authUserId: v.string() },
  handler: async (ctx, { authUserId }) => {
    assertFixturesAllowed();
    const link = await ctx.db
      .query("authLinks")
      .withIndex("by_provider_subject", (q) => q.eq("provider", "better-auth").eq("subject", authUserId))
      .unique();
    if (!link) throw new Error("no account for that auth user");
    if (!(await holdsOnlySignUpRows(ctx, link.userId))) throw new Error("that login's account holds more than sign-up rows");
    await removeSignUpAccount(ctx, link.userId);
  },
});

export const stripCredentials = internalMutation({
  args: { authUserId: v.string() },
  handler: async (ctx, { authUserId }) => {
    assertFixturesAllowed();
    for (const model of ["account", "session"] as const) {
      await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
        input: { model, where: [{ field: "userId", value: authUserId }] },
        paginationOpts: { cursor: null, numItems: 100 },
      });
    }
  },
});

/** D08c: the profile and username claims behind a Better Auth user. */
export const accountRows = internalQuery({
  args: { authUserId: v.string() },
  handler: async (ctx, { authUserId }) => {
    assertFixturesAllowed();
    const user = await ctx.db
      .query("users")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", authUserId))
      .unique();
    if (!user) return null;
    const profiles = await ctx.db.query("profiles").withIndex("by_userId", (q) => q.eq("userId", user._id)).collect();
    const usernames = await ctx.db.query("usernames").withIndex("by_userId_state", (q) => q.eq("userId", user._id)).collect();
    return { userId: user._id as string, profiles, usernames };
  },
});

/** D08e: marks a synthetic user's email verified, as clicking the link would. */
export const verifyEmail = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    assertFixturesAllowed();
    await ctx.runMutation(components.betterAuth.adapter.updateOne, {
      input: { model: "user", where: [{ field: "email", value: email }], update: { emailVerified: true } },
    });
  },
});

/**
 * D08e: the rows a completed GitHub sign-up leaves, written the way the
 * component writes them (auth user through the same onCreate trigger, then a
 * github account row), without contacting GitHub.
 */
export const simulateGithubSignUp = internalMutation({
  args: { email: v.string(), githubId: v.string() },
  handler: async (ctx, { email, githubId }) => {
    assertFixturesAllowed();
    const now = Date.now();
    const onCreateHandle = await createFunctionHandle(internal.auth.onCreate);
    const authUser = (await ctx.runMutation(components.betterAuth.adapter.create, {
      input: { model: "user", data: { name: "Synthetic Octocat", email, emailVerified: true, createdAt: now, updatedAt: now } },
      onCreateHandle,
    })) as { _id: string };
    await ctx.runMutation(components.betterAuth.adapter.create, {
      input: { model: "account", data: { accountId: githubId, providerId: "github", userId: authUser._id, createdAt: now, updatedAt: now } },
    });
    return authUser._id;
  },
});

/** D02: one project's update-side rows (slug history, tag join, audit, outbox, its tags' counters), by current or old slug. */
export const projectWriteState = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    assertFixturesAllowed();
    const project = await ctx.db.get(projectId);
    const slugs = await ctx.db.query("projectSlugs").withIndex("by_project_state", (q) => q.eq("projectId", projectId)).collect();
    const joins = await ctx.db.query("projectTags").withIndex("by_project_position", (q) => q.eq("projectId", projectId)).collect();
    const audit = await ctx.db.query("auditEvents").withIndex("by_subject", (q) => q.eq("subjectTable", "projects").eq("subjectId", projectId)).collect();
    const outbox = await ctx.db.query("contentChanges").withIndex("by_entity", (q) => q.eq("entityType", "project").eq("entityId", projectId)).collect();
    const tags = await ctx.db.query("tags").collect();
    return {
      project,
      slugs: slugs.map((s) => ({ slug: s.slug, state: s.state })).sort((a, b) => a.slug.localeCompare(b.slug)),
      joins: joins.map((j) => ({ tagId: j.tagId, position: j.position, listed: j.listed })),
      audit: audit.map((a) => ({ kind: a.kind, actorId: a.actorId, details: a.details })),
      outbox: outbox.map((o) => ({ change: o.change, sourceVersion: o.sourceVersion })),
      tags: tags.map((t) => ({ id: t._id, name: t.name, nameKey: t.nameKey, listedProjectCount: t.listedProjectCount, status: t.status })),
    };
  },
});

// ---------------------------------------------------------------------------
// D03: extra rows around one project for the lifecycle tests (fan-out, purge
// cleanup, file deletion). Synthetic only: placeholder bytes, fixture users.

/** Stores `count` placeholder files and registers them as image rows of the project. */
export const addProjectImages = internalAction({
  args: { projectId: v.id("projects"), count: v.number() },
  handler: async (ctx, { projectId, count }): Promise<Id<"_storage">[]> => {
    assertFixturesAllowed();
    const storageIds: Id<"_storage">[] = [];
    for (let i = 0; i < count; i++) {
      storageIds.push(await ctx.storage.store(new Blob([`d03 synthetic image ${i}`], { type: "image/png" })));
    }
    await ctx.runMutation(internal.fixtures.insertImageRows, { projectId, storageIds });
    return storageIds;
  },
});

export const insertImageRows = internalMutation({
  args: { projectId: v.id("projects"), storageIds: v.array(v.id("_storage")) },
  handler: async (ctx, { projectId, storageIds }) => {
    assertFixturesAllowed();
    const project = await ctx.db.get(projectId);
    if (!project) throw new Error("no such project");
    for (const [i, storageId] of storageIds.entries()) {
      await ctx.db.insert("projectImages", {
        projectId,
        storageId,
        kind: i === 0 ? "cover" : "screenshot",
        displayOrder: i,
        fileName: `d03-${i}.png`,
        mimeType: "image/png",
        size: 22,
        uploadedBy: project.ownerId,
        status: i === storageIds.length - 1 && i > 0 ? "deleted" : "active",
        createdAt: project.createdAt,
      });
    }
  },
});

/** `count` favorite rows on the project from fixture users (repeats allowed: only the fan-out is under test). */
export const addFavorites = internalMutation({
  args: { projectId: v.id("projects"), count: v.number() },
  handler: async (ctx, { projectId, count }) => {
    assertFixturesAllowed();
    const project = await ctx.db.get(projectId);
    if (!project) throw new Error("no such project");
    const users = await ctx.db.query("users").take(10);
    for (let i = 0; i < count; i++) {
      await ctx.db.insert("favorites", { userId: users[i % users.length]._id, projectId, createdAt: project.createdAt + i, listed: project.listed });
    }
  },
});

export const addTagSuggestion = internalMutation({
  // D04d: optionally by a fixture persona (by username key) and already reviewed.
  args: {
    projectId: v.id("projects"),
    submitterUsernameKey: v.optional(v.string()),
    status: v.optional(v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected"))),
  },
  handler: async (ctx, { projectId, submitterUsernameKey, status }) => {
    assertFixturesAllowed();
    const project = await ctx.db.get(projectId);
    if (!project) throw new Error("no such project");
    let submitterId: Id<"users"> | undefined;
    if (submitterUsernameKey) {
      const profile = await ctx.db.query("profiles").withIndex("by_usernameKey", (q) => q.eq("usernameKey", submitterUsernameKey)).first();
      if (!profile) throw new Error(`no fixture profile ${submitterUsernameKey}`);
      submitterId = profile.userId;
    }
    await ctx.db.insert("tagSuggestions", {
      projectId,
      proposedName: "fixture-d03 idea",
      nameKey: "fixture-d03 idea",
      status: status ?? "pending",
      ...(submitterId ? { submitterId } : {}),
      createdAt: project.createdAt,
    });
  },
});

/** What is left of a project: its row, related rows per table, listed copies, and which of the files still exist. */
export const projectResidue = internalQuery({
  args: { projectId: v.id("projects"), storageIds: v.optional(v.array(v.id("_storage"))) },
  handler: async (ctx, { projectId, storageIds }) => {
    assertFixturesAllowed();
    const tags = await ctx.db.query("projectTags").withIndex("by_project_position", (q) => q.eq("projectId", projectId)).collect();
    const favorites = await ctx.db.query("favorites").withIndex("by_project_created", (q) => q.eq("projectId", projectId)).collect();
    const slugs = await ctx.db.query("projectSlugs").withIndex("by_project_state", (q) => q.eq("projectId", projectId)).collect();
    const suggestions = await ctx.db.query("tagSuggestions").withIndex("by_project_status", (q) => q.eq("projectId", projectId)).collect();
    const images = await ctx.db.query("projectImages").withIndex("by_project_status_order", (q) => q.eq("projectId", projectId)).collect();
    const files: string[] = [];
    for (const id of storageIds ?? []) if (await ctx.db.system.get(id)) files.push(id);
    return {
      project: await ctx.db.get(projectId),
      counts: { projectTags: tags.length, favorites: favorites.length, projectSlugs: slugs.length, tagSuggestions: suggestions.length, projectImages: images.length },
      listedCopies: { projectTags: tags.filter((r) => r.listed).length, favorites: favorites.filter((r) => r.listed).length },
      files,
    };
  },
});

// D04a: username claims for the public profile tests (a previous name, its
// reservation). The loaded fixtures write none; `clear` empties the table.
export const addUsernameClaim = internalMutation({
  args: {
    holderUsernameKey: v.string(),
    usernameKey: v.string(),
    state: v.union(v.literal("current"), v.literal("previous")),
    reservedUntil: v.optional(v.number()),
  },
  handler: async (ctx, { holderUsernameKey, usernameKey, state, reservedUntil }) => {
    assertFixturesAllowed();
    const holder = await ctx.db
      .query("profiles")
      .withIndex("by_usernameKey", (q) => q.eq("usernameKey", holderUsernameKey))
      .first();
    if (!holder) throw new Error(`no fixture profile ${holderUsernameKey}`);
    const now = Date.now();
    await ctx.db.insert("usernames", {
      usernameKey,
      userId: holder.userId,
      state,
      claimedAt: now - 1000,
      ...(state === "previous" ? { releasedAt: now - 500, reservedUntil } : {}),
    });
  },
});

// D04b: what a profile edit wrote, for the profile tests: the profile, every
// username claim of its user, and its audit and outbox rows.
export const profileWriteState = internalQuery({
  args: { userUsernameKey: v.string() },
  handler: async (ctx, { userUsernameKey }) => {
    assertFixturesAllowed();
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_usernameKey", (q) => q.eq("usernameKey", userUsernameKey))
      .first();
    if (!profile) return null;
    const usernames = await ctx.db.query("usernames").withIndex("by_userId_state", (q) => q.eq("userId", profile.userId)).collect();
    const audit = await ctx.db
      .query("auditEvents")
      .withIndex("by_subject", (q) => q.eq("subjectTable", "profiles").eq("subjectId", profile._id))
      .collect();
    const outbox = await ctx.db
      .query("contentChanges")
      .withIndex("by_entity", (q) => q.eq("entityType", "profile").eq("entityId", profile._id))
      .collect();
    return {
      profile: { username: profile.username, usernameKey: profile.usernameKey, fullName: profile.fullName ?? null, avatar: profile.avatar ?? null },
      usernames: usernames.map((u) => ({ usernameKey: u.usernameKey, state: u.state, reservedUntil: u.reservedUntil ?? null })),
      audit: audit.map((a) => ({ kind: a.kind, actorId: a.actorId ?? null, details: a.details ?? null })),
      outbox: outbox.map((o) => ({ change: o.change })),
    };
  },
});

// D04d: move a deleting account's date into the past so the purge can be run
// now, or mark an account deleting with no date at all (never due).
export const backdateDeletion = internalMutation({
  args: { usernameKey: v.string(), deleteAfter: v.optional(v.number()), status: v.optional(v.literal("deleting")) },
  handler: async (ctx, { usernameKey, deleteAfter, status }) => {
    assertFixturesAllowed();
    const profile = await ctx.db.query("profiles").withIndex("by_usernameKey", (q) => q.eq("usernameKey", usernameKey)).first();
    if (!profile) throw new Error(`no fixture profile ${usernameKey}`);
    await ctx.db.patch(profile.userId, { ...(status ? { status } : {}), deleteAfter });
    return profile.userId as string;
  },
});

// D04d: everything an account still has, by users ID (after a purge the profile is gone).
export const accountResidue = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    assertFixturesAllowed();
    const user = await ctx.db.get(userId);
    const count = async (rows: Promise<unknown[]>) => (await rows).length;
    return {
      user: user ? { ...user, _id: undefined, _creationTime: undefined } : null,
      projects: await count(ctx.db.query("projects").withIndex("by_owner_status_created", (q) => q.eq("ownerId", userId)).collect()),
      listedProjects: await count(ctx.db.query("projects").withIndex("by_owner_listed_created", (q) => q.eq("ownerId", userId).eq("listed", true)).collect()),
      favorites: await count(ctx.db.query("favorites").withIndex("by_user_project", (q) => q.eq("userId", userId)).collect()),
      suggestions: (await ctx.db.query("tagSuggestions").withIndex("by_submitter_created", (q) => q.eq("submitterId", userId)).collect()).map((s) => s.status),
      usernames: await count(ctx.db.query("usernames").withIndex("by_userId_state", (q) => q.eq("userId", userId)).collect()),
      profiles: await count(ctx.db.query("profiles").withIndex("by_userId", (q) => q.eq("userId", userId)).collect()),
      authLinks: await count(ctx.db.query("authLinks").withIndex("by_user", (q) => q.eq("userId", userId)).collect()),
      audit: (await ctx.db.query("auditEvents").withIndex("by_subject", (q) => q.eq("subjectTable", "users").eq("subjectId", userId)).collect()).map((a) => a.kind),
    };
  },
});

// D04f: give a synthetic Better Auth account a paid tier, for the tier display test.
export const setTier = internalMutation({
  args: { authUserId: v.string(), tier: v.union(v.literal("free"), v.literal("pro"), v.literal("diamond")) },
  handler: async (ctx, { authUserId, tier }) => {
    assertFixturesAllowed();
    const user = await ctx.db.query("users").withIndex("by_authUserId", (q) => q.eq("authUserId", authUserId)).unique();
    if (!user) throw new Error("no account for that auth user");
    await ctx.db.patch(user._id, { tier });
  },
});

// D05: one project's favorites (who, listed copy), its counters and timestamps, and its outbox rows.
export const favoriteState = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    assertFixturesAllowed();
    const project = await ctx.db.get(projectId);
    const rows = await ctx.db.query("favorites").withIndex("by_project_created", (q) => q.eq("projectId", projectId)).collect();
    const who = [];
    for (const r of rows) {
      const profile = await ctx.db.query("profiles").withIndex("by_userId", (q) => q.eq("userId", r.userId)).unique();
      who.push({ username: profile?.usernameKey ?? null, listed: r.listed, self: r.userId === project?.ownerId });
    }
    const outbox = await ctx.db.query("contentChanges").withIndex("by_entity", (q) => q.eq("entityType", "project").eq("entityId", projectId)).collect();
    return {
      project: project && {
        favoriteCount: project.favoriteCount,
        rankingFavoriteCount: project.rankingFavoriteCount,
        updatedAt: project.updatedAt,
        contentVersion: project.contentVersion,
        listed: project.listed,
      },
      rows: who.sort((a, b) => String(a.username).localeCompare(String(b.username))),
      outbox: outbox.map((o) => ({ change: o.change, sourceVersion: o.sourceVersion })),
    };
  },
});

// D06-b: one project's image rows (every status) with whether each file still
// exists, and a placeholder file stored without an image row (an upload that
// was never attached), for the image tests.
export const imageState = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    assertFixturesAllowed();
    const rows = await ctx.db.query("projectImages").withIndex("by_project_status_order", (q) => q.eq("projectId", projectId)).collect();
    const out = [];
    for (const r of rows) {
      out.push({
        id: r._id,
        storageId: r.storageId,
        kind: r.kind,
        status: r.status,
        displayOrder: r.displayOrder,
        mimeType: r.mimeType,
        size: r.size,
        fileExists: (await ctx.db.system.get(r.storageId)) !== null,
      });
    }
    return out.sort((a, b) => a.kind.localeCompare(b.kind) || a.displayOrder - b.displayOrder);
  },
});

export const fileExists = internalQuery({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    assertFixturesAllowed();
    return (await ctx.db.system.get(storageId)) !== null;
  },
});

export const storeUnattachedFile = internalAction({
  args: { contentType: v.string(), bytes: v.number() },
  handler: async (ctx, { contentType, bytes }): Promise<Id<"_storage">> => {
    assertFixturesAllowed();
    return await ctx.storage.store(new Blob([new Uint8Array(bytes)], { type: contentType }));
  },
});

// D06-c: points a fixture profile's avatar at a stored file (nothing in the app writes stored avatars yet).
export const setStoredAvatar = internalMutation({
  args: { usernameKey: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, { usernameKey, storageId }) => {
    assertFixturesAllowed();
    const profile = await ctx.db.query("profiles").withIndex("by_usernameKey", (q) => q.eq("usernameKey", usernameKey)).unique();
    if (!profile) throw new Error("no such profile");
    await ctx.db.patch(profile._id, { avatar: { kind: "stored", storageId } });
  },
});

// D07: one project's tags as the join, the copy and the counters see them, its
// suggestions, and its outbox; plus every tag's listed counter.
export const tagState = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    assertFixturesAllowed();
    const project = await ctx.db.get(projectId);
    const joins = await ctx.db.query("projectTags").withIndex("by_project_position", (q) => q.eq("projectId", projectId)).collect();
    const nameOf = async (id: Id<"tags">) => (await ctx.db.get(id))?.nameKey ?? null;
    const suggestions = await ctx.db.query("tagSuggestions").withIndex("by_project_status", (q) => q.eq("projectId", projectId)).collect();
    const outbox = await ctx.db.query("contentChanges").withIndex("by_entity", (q) => q.eq("entityType", "project").eq("entityId", projectId)).collect();
    const counts: Record<string, number> = {};
    for (const t of await ctx.db.query("tags").collect()) counts[t.nameKey] = t.listedProjectCount;
    const submitter = async (id: Id<"users"> | undefined) =>
      id ? ((await ctx.db.query("profiles").withIndex("by_userId", (q) => q.eq("userId", id)).first())?.usernameKey ?? null) : null;
    return {
      project: project && { tagCount: project.tagCount, contentVersion: project.contentVersion, updatedAt: project.updatedAt, tags: await Promise.all(project.tagIds.map(nameOf)) },
      joins: await Promise.all(joins.sort((a, b) => a.position - b.position).map(async (j) => ({ tag: await nameOf(j.tagId), position: j.position, listed: j.listed }))),
      suggestions: await Promise.all(
        suggestions.map(async (s) => ({ nameKey: s.nameKey, status: s.status, submitter: await submitter(s.submitterId), reviewer: await submitter(s.reviewerId), adminNotes: s.adminNotes ?? null })),
      ),
      outbox: outbox.map((o) => ({ change: o.change, sourceVersion: o.sourceVersion })),
      counts,
    };
  },
});

// D07: set a fixture persona's role directly (no audit), to stage the role tests.
export const setRoleByUsername = internalMutation({
  args: { usernameKey: v.string(), role: v.union(v.literal("user"), v.literal("admin")) },
  handler: async (ctx, { usernameKey, role }) => {
    assertFixturesAllowed();
    const profile = await ctx.db.query("profiles").withIndex("by_usernameKey", (q) => q.eq("usernameKey", usernameKey)).first();
    if (!profile) throw new Error(`no fixture profile ${usernameKey}`);
    await ctx.db.patch(profile.userId, { role });
  },
});

// D07: role.changed audit rows with the target's username.
export const roleAudit = internalQuery({
  args: {},
  handler: async (ctx) => {
    assertFixturesAllowed();
    const rows = (await ctx.db.query("auditEvents").withIndex("by_at").collect()).filter((a) => a.kind === "role.changed");
    const out = [];
    for (const a of rows) {
      const profile = await ctx.db.query("profiles").withIndex("by_userId", (q) => q.eq("userId", a.subjectId as Id<"users">)).first();
      out.push({ username: profile?.usernameKey ?? null, actorId: a.actorId ?? null, details: a.details });
    }
    return out;
  },
});

// D07: a reviewed alias (aliasKey -> the tag with tagNameKey), reviewed by a fixture persona.
export const addTagAlias = internalMutation({
  args: { aliasKey: v.string(), tagNameKey: v.string(), reviewerUsernameKey: v.string() },
  handler: async (ctx, { aliasKey, tagNameKey, reviewerUsernameKey }) => {
    assertFixturesAllowed();
    const tag = await ctx.db.query("tags").withIndex("by_nameKey", (q) => q.eq("nameKey", tagNameKey)).first();
    const reviewer = await ctx.db.query("profiles").withIndex("by_usernameKey", (q) => q.eq("usernameKey", reviewerUsernameKey)).first();
    if (!tag || !reviewer) throw new Error("no such tag or reviewer");
    await ctx.db.insert("tagAliases", { aliasKey, tagId: tag._id, reviewedBy: reviewer.userId, reviewedAt: Date.now() });
  },
});

// D07-d: audit rows of one kind, with actor and target usernames.
export const auditRows = internalQuery({
  args: { kind: v.string() },
  handler: async (ctx, { kind }) => {
    assertFixturesAllowed();
    const rows = (await ctx.db.query("auditEvents").withIndex("by_at").collect()).filter((a) => a.kind === kind);
    const nameOfUser = async (id: Id<"users"> | undefined) =>
      id ? ((await ctx.db.query("profiles").withIndex("by_userId", (q) => q.eq("userId", id)).first())?.usernameKey ?? null) : null;
    const out = [];
    for (const a of rows) {
      const target = a.subjectTable === "profiles" ? await ctx.db.get(a.subjectId as Id<"profiles">) : null;
      out.push({ actor: await nameOfUser(a.actorId), target: target ? await nameOfUser(target.userId) : null, details: a.details ?? null });
    }
    return out;
  },
});

// D07-d: a fixture persona's profile ID by usernameKey.
export const profileIdOf = internalQuery({
  args: { usernameKey: v.string() },
  handler: async (ctx, { usernameKey }) => {
    assertFixturesAllowed();
    return (await ctx.db.query("profiles").withIndex("by_usernameKey", (q) => q.eq("usernameKey", usernameKey)).first())?._id ?? null;
  },
});

// D08 /api/llm gate: the usage counters and the call log, for the gate tests.
export const llmState = internalQuery({
  args: {},
  handler: async (ctx) => {
    assertFixturesAllowed();
    return {
      usage: (await ctx.db.query("llmDailyUsage").collect()).map(({ day, scope, count }) => ({ day, scope, count })),
      calls: (await ctx.db.query("llmCalls").collect()).map(({ _id, _creationTime, ...row }) => ({ id: _id, ...row })),
    };
  },
});

// D09 S02a: a project's stored searchText, and what the search_public index
// returns for a query run through the vocabulary layer (listed only, as the
// S02b query will ask). Test helpers; the real search query comes in S02b.
export const searchState = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    assertFixturesAllowed();
    const p = await ctx.db.get(projectId);
    return p ? { searchText: p.searchText ?? null, listed: p.listed } : null;
  },
});

export const searchProbe = internalQuery({
  args: { q: v.string() },
  handler: async (ctx, { q }) => {
    assertFixturesAllowed();
    const rows = await ctx.db
      .query("projects")
      .withSearchIndex("search_public", (s) => s.search("searchText", rewriteQuery(q, new Set()).q).eq("listed", true))
      .take(48);
    return rows.map((r) => r.slug);
  },
});

// D10: the search analytics tables, and rows inserted as-is (old or expired
// ones the retention and receipt checks need). Test helpers only.
export const searchAnalyticsState = internalQuery({
  args: {},
  handler: async (ctx) => {
    assertFixturesAllowed();
    const strip = <T extends { _id: unknown; _creationTime: number }>({ _id, _creationTime, ...rest }: T) => (void _id, void _creationTime, rest);
    return {
      events: (await ctx.db.query("searchEvents").collect()).map(strip),
      receipts: (await ctx.db.query("searchReceipts").collect()).map(strip),
      daily: (await ctx.db.query("searchDaily").collect()).map(strip),
      drops: (await ctx.db.query("searchDrops").collect()).map(strip),
    };
  },
});

export const insertSearchAnalyticsRows = internalMutation({
  args: { receipts: v.optional(v.array(v.any())), events: v.optional(v.array(v.any())), daily: v.optional(v.array(v.any())), drops: v.optional(v.array(v.any())) },
  handler: async (ctx, a) => {
    assertFixturesAllowed();
    for (const r of a.receipts ?? []) await ctx.db.insert("searchReceipts", r);
    for (const e of a.events ?? []) await ctx.db.insert("searchEvents", e);
    for (const d of a.daily ?? []) await ctx.db.insert("searchDaily", d);
    for (const d of a.drops ?? []) await ctx.db.insert("searchDrops", d);
    return null;
  },
});
