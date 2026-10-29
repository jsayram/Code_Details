// Synthetic test fixtures for the task-owned local deployment (Phase C, C09,
// C09a). Internal functions only (callable with the admin key, never by a
// client), and each one refuses to run unless the deployment has
// CODEDETAILS_FIXTURES_ALLOWED=1, which only tests/convex/up.sh sets. That
// keeps `clear` from ever touching a real deployment this code is pushed to.
import { v } from "convex/values";
import { createFunctionHandle } from "convex/server";
import { components, internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

function assertFixturesAllowed() {
  if (process.env.CODEDETAILS_FIXTURES_ALLOWED !== "1") {
    throw new Error("fixtures are disabled on this deployment");
  }
}

const TABLES = ["projects", "profiles", "tags", "authLinks", "users"] as const;
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
    // D08d: the handover writes account.linked audit rows.
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

// D11: undo a D08d handover for a Clerk-era persona, so a test that links it
// doesn't depend on test order or earlier runs. Removes the persona's
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
