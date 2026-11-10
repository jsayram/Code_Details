// D00b: the importer's mapping and reject logic (P07 §10), run against an
// in-memory store with synthetic rows only. Real data never enters tests. The
// invalid-relationship sets are the ones §10 names: a favorite to a missing
// project, a tag link to a missing tag, a missing owner and a duplicate
// username key, plus a changed source row and a re-run.
import { describe, expect, it } from "vitest";
import {
  MAX_TAGS, SourceChangedError, USERNAME_RESERVATION_MS, deriveProject, runBatch,
  type ImportStore, type Step, type RowFor,
} from "../../convex/importCore";
import {
  USERNAME_RE, canonicalJson, emailHmac, generatedHandle, mapCategoryData, mapFavorite, mapHistory, mapImage, mapLinks,
  mapProfile, mapProject, mapProjectTags, mapTag, ms, rowHash, sanitizeFileName, shuffleKey, tagNameKey, usernameKey,
  type SrcProfile, type SrcProject,
} from "../../scripts/d00b-import/mapping";

const KEY = Buffer.from("synthetic-d00b-test-key-not-real");

type Doc = Record<string, unknown> & { _id: string };

/** The Convex store's behaviour over plain arrays. */
class MemoryStore implements ImportStore {
  tables = new Map<string, Doc[]>();
  importMap: { sourceTable: string; sourceId: string; targetTable: string; targetId: string; rowHash: string }[] = [];
  rejects: { sourceTable: string; sourceId: string; reason: string }[] = [];
  storage = new Map<string, { sha256Hex: string; size: number; contentType?: string }>();
  private n = 0;
  rows(t: string) { return this.tables.get(t) ?? []; }
  async mapped(st: string, sid: string) { const m = this.importMap.find((x) => x.sourceTable === st && x.sourceId === sid); return m ? { targetId: m.targetId, rowHash: m.rowHash } : null; }
  async map(sourceTable: string, sourceId: string, targetTable: string, targetId: string, rowHash: string) { this.importMap.push({ sourceTable, sourceId, targetTable, targetId, rowHash }); }
  async rejectedReason(st: string, sid: string) { return this.rejects.find((r) => r.sourceTable === st && r.sourceId === sid)?.reason ?? null; }
  async reject(sourceTable: string, sourceId: string, reason: string) { this.rejects.push({ sourceTable, sourceId, reason }); }
  async insert(table: string, doc: Record<string, unknown>) { const _id = `${table}:${++this.n}`; this.tables.set(table, [...this.rows(table), { ...doc, _id }]); return _id; }
  async get(table: string, id: string) { return this.rows(table).find((d) => d._id === id) ?? null; }
  // E03: as convex/importer.ts, through importMap's "profiles.subject" entries (no clerk auth link).
  async userBySubject(s: string) { return (await this.mapped("profiles.subject", s))?.targetId ?? null; }
  async tagByNameKey(k: string) { return this.rows("tags").find((t) => t.nameKey === k)?._id ?? null; }
  async usernameHolder(k: string) {
    return ((this.rows("profiles").find((p) => p.usernameKey === k) ?? this.rows("usernames").find((u) => u.usernameKey === k))?.userId as string) ?? null;
  }
  async slugHolder(s: string) { return (this.rows("projectSlugs").find((x) => x.slug === s)?.projectId as string) ?? null; }
  async favoriteExists(u: string, p: string) { return this.rows("favorites").some((f) => f.userId === u && f.projectId === p); }
  async projectTagCount(p: string) { return this.rows("projectTags").filter((t) => t.projectId === p).length; }
  async projectTagExists(p: string, t: string) { return this.rows("projectTags").some((x) => x.projectId === p && x.tagId === t); }
  async storageMeta(id: string) { return this.storage.get(id) ?? null; }
}

const RUN = { startedAt: Date.UTC(2026, 9, 28) };
const go = <S extends Step>(store: ImportStore, step: S, rows: RowFor<S>[]) => runBatch(store, RUN, step, rows);

const profile = (n: number, over: Partial<SrcProfile> = {}): SrcProfile => ({
  id: `00000000-0000-4000-8000-00000000000${n}`, user_id: `synthetic_subject_${n}`, email_address: `person${n}@example.invalid`,
  username: `person${n}`, first_name: "Synthetic", last_name: `Person ${n}`, full_name: null, tier: "free",
  profile_image_url: null, created_at: "2026-01-01T00:00:00+00:00", updated_at: "2026-01-02T00:00:00+00:00", ...over,
});
const project = (n: number, owner: number, over: Partial<SrcProject> = {}): SrcProject => ({
  id: `10000000-0000-4000-8000-00000000000${n}`, title: `Synthetic project ${n}`, slug: `synthetic-project-${n}`, description: null,
  created_at: "2026-02-01T00:00:00+00:00", updated_at: "2026-02-02T00:00:00+00:00", user_id: `synthetic_subject_${owner}`,
  deleted_at: null, category: "web", url_links: [], category_data: null, field_order: null, ...over,
});
const tag = (n: number, name = `tag${n}`) => ({ id: `20000000-0000-4000-8000-00000000000${n}`, name, description: null, created_at: "2026-01-01T00:00:00+00:00" });

async function seeded() {
  const store = new MemoryStore();
  await go(store, "tags", [tag(1, "React"), tag(2, "C++")].map((t) => mapTag(KEY, t).row!));
  await go(store, "users", [profile(1), profile(2)].map((p) => mapProfile(KEY, p).row!));
  await go(store, "projects", [project(1, 1), project(2, 2)].map((p) => mapProject(KEY, p).row!));
  return store;
}

describe("D00b canonical forms", () => {
  it("builds the §5.2 username key and rejects what the target can't hold", () => {
    expect(usernameKey("  JoseR ")).toBe("joser");
    expect(USERNAME_RE.test("ab")).toBe(false);
    expect(USERNAME_RE.test("a".repeat(31))).toBe(false);
    expect(USERNAME_RE.test("josé")).toBe(false);
    expect(USERNAME_RE.test("dev_person-1")).toBe(true);
  });

  it("keeps punctuation in tag keys and folds case and spaces (§5.13)", () => {
    expect(tagNameKey(" React   Native ")).toBe("react native");
    expect(new Set(["C", "C++", "C#"].map(tagNameKey)).size).toBe(3);
  });

  it("reads naive timestamps as UTC and keeps explicit offsets", () => {
    expect(ms("2026-01-01T00:00:00")).toBe(Date.UTC(2026, 0, 1));
    expect(ms("2026-01-01T01:00:00+01:00")).toBe(Date.UTC(2026, 0, 1));
    expect(ms("2026-01-01T00:00:00.123456+00:00")).toBe(Date.UTC(2026, 0, 1) + 123);
    expect(ms(null, 5)).toBe(5);
    expect(() => ms(null)).toThrow();
  });

  it("hashes canonically and with the key", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: undefined, c: 3 }] })).toBe('{"a":[2,{"c":3}],"b":1}');
    expect(rowHash(KEY, "t", { a: 1, b: 2 })).toBe(rowHash(KEY, "t", { b: 2, a: 1 }));
    expect(rowHash(KEY, "t", { a: 1 })).not.toBe(rowHash(Buffer.from("other"), "t", { a: 1 }));
    expect(emailHmac(KEY, " Person@Example.invalid ")).toBe(emailHmac(KEY, "person@example.invalid"));
  });

  it("generates stable handles and shuffle keys", () => {
    const h = generatedHandle(KEY, "x");
    expect(h).toMatch(/^user-[0-9a-z]{6}$/);
    expect(USERNAME_RE.test(h)).toBe(true);
    expect(generatedHandle(KEY, "x")).toBe(h);
    const s = shuffleKey(KEY, "x");
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThan(1);
  });
});

describe("D00b row mapping", () => {
  it("never carries the email over and gives email-shaped or invalid usernames a generated handle (§5.2, §5.5)", () => {
    const p = mapProfile(KEY, profile(1, { username: "person1@example.invalid" }));
    expect(JSON.stringify(p.row)).not.toContain("@");
    expect(p.row!.username).toMatch(/^user-/);
    expect(p.notes).toEqual(["username_email_shaped_generated"]);
    expect(mapProfile(KEY, profile(2, { username: "x".repeat(59) })).notes).toEqual(["username_invalid_generated"]);
    expect(mapProfile(KEY, profile(3, { username: null })).notes).toEqual(["username_missing_generated"]);
    expect(mapProfile(KEY, profile(4)).row!.username).toBe("person4");
  });

  it("drops avatars from hosts outside the allow-list, with a reject", () => {
    expect(mapProfile(KEY, profile(1, { profile_image_url: "https://img.clerk.com/a" })).row!.avatarUrl).toBe("https://img.clerk.com/a");
    expect(mapProfile(KEY, profile(1, { profile_image_url: "https://www.gravatar.com/a" })).row!.avatarUrl).toBeDefined();
    const bad = mapProfile(KEY, profile(1, { profile_image_url: "http://localhost:54321/a.png" }));
    expect(bad.row!.avatarUrl).toBeUndefined();
    expect(bad.rejects.map((r) => r.reason)).toEqual(["avatar_host_not_allowed"]);
  });

  it("keys history rows by HMAC and gives email-shaped old names no row (§5.2, §5.3)", () => {
    const ok = mapHistory(KEY, { old_username: "OldName", user_id: "s", new_username: "new", changed_at: "2026-03-01T00:00:00" });
    expect(ok.row!.sourceId).not.toContain("old");
    expect(ok.row!.usernameKey).toBe("oldname");
    const email = mapHistory(KEY, { old_username: "a@example.invalid", user_id: "s", new_username: "new", changed_at: null });
    expect(email.row).toBeNull();
    expect(email.rejects[0].reason).toBe("username_email_shaped");
    expect(email.rejects[0].sourceId).not.toContain("@");
  });

  it("rejects bad links one by one", () => {
    const { links, rejects } = mapLinks("p", [
      { url: "https://example.invalid", type: "demo", label: "Demo" },
      { url: "javascript:alert(1)", type: "demo" },
      { url: "https://example.invalid/x", type: "unknown" },
      { url: "ftp://example.invalid" },
      "not a link",
    ]);
    expect(links).toEqual([{ url: "https://example.invalid", type: "demo", label: "Demo" }]);
    expect(rejects.map((r) => r.reason)).toEqual(["link_url_invalid", "link_type_invalid", "link_url_invalid", "link_url_invalid"]);
  });

  it("checks category data against the category's fields, field by field (§7)", () => {
    const r = mapCategoryData("p", "web", { techStack: ["React"], features: "x", notAField: "y", targetAudience: 3 }, ["techStack", "nope", "techStack"]);
    expect(r.categoryData).toEqual({ techStack: ["React"], features: "x" });
    expect(r.fieldOrder).toEqual(["techStack"]);
    expect(r.rejects.map((x) => `${x.sourceId}:${x.reason}`).sort()).toEqual(
      ["p:1:field_order_unknown", "p:2:field_order_unknown", "p:notAField:category_field_unknown", "p:targetAudience:category_field_type"],
    );
  });

  it("rejects a project with an unknown category or invalid title", () => {
    expect(mapProject(KEY, project(1, 1, { category: "nope" })).rowReject).toBe("category_unknown");
    expect(mapProject(KEY, project(1, 1, { title: "x".repeat(101) })).rowReject).toBe("title_invalid");
    const p = mapProject(KEY, project(1, 1, { description: "", deleted_at: "2026-03-01T00:00:00" })).row!;
    expect(p.description).toBeUndefined();
    expect(p.status).toBe("deleted");
    expect(p.deletedAt).toBe(Date.UTC(2026, 2, 1));
  });

  it("orders tag links by created_at, then tag name", () => {
    const rows = mapProjectTags(KEY, [
      { project_id: "p", tag_id: "t3", created_at: "2026-01-02T00:00:00+00:00", tag_name: "a" },
      { project_id: "p", tag_id: "t1", created_at: "2026-01-01T00:00:00+00:00", tag_name: "b" },
      { project_id: "p", tag_id: "t2", created_at: "2026-01-01T00:00:00+00:00", tag_name: "B" },
    ]);
    expect(Object.fromEntries(rows.map((r) => [r.tagSourceId, r.position]))).toEqual({ t2: 0, t1: 1, t3: 2 });
  });

  it("sanitizes image file names and needs a storage object", () => {
    expect(sanitizeFileName("a/b/\u0007photo.png")).toBe("photo.png");
    const img = { id: "i", project_id: "p", storage_path: "x", file_name: "f.png", width: null, height: null, image_type: "cover", display_order: null, alt_text: null, caption: null, uploaded_by: "s", created_at: null, deleted_at: null, aspect_ratio: "auto", object_id: null };
    expect(mapImage(KEY, img).rowReject).toBe("file_missing");
    expect(mapImage(KEY, { ...img, image_type: "banner", object_id: "o" }).rowReject).toBe("image_kind_invalid");
    expect(mapImage(KEY, { ...img, object_id: "o" }).row!.displayOrder).toBe(0);
  });
});

describe("D00b batch logic (invalid-relationship sets)", () => {
  it("imports a clean set with its links, slugs and username claims", async () => {
    const store = await seeded();
    expect(store.rows("users")).toHaveLength(2);
    // E03: no auth links; each source subject maps to its user in importMap only.
    expect(store.rows("authLinks")).toEqual([]);
    expect(store.importMap.filter((m) => m.sourceTable === "profiles.subject").map((m) => m.targetTable)).toEqual(["users", "users"]);
    expect(store.rows("usernames").map((u) => u.state)).toEqual(["current", "current"]);
    expect(store.rows("projectSlugs")).toHaveLength(2);
    expect(store.rows("projects").every((p) => p.visibility === "public" && p.listed === true)).toBe(true);
    expect(store.importMap.filter((m) => m.sourceTable === "profiles.email")).toHaveLength(2);
    expect(JSON.stringify([...store.tables.values(), store.importMap])).not.toContain("@");
    expect(store.rejects).toEqual([]);
  });

  it("rejects a project whose owner has no profile, and every row that depends on it (§5.8)", async () => {
    const store = await seeded();
    const orphan = mapProject(KEY, project(3, 9)).row!;
    expect(await go(store, "projects", [orphan])).toEqual({ inserted: 0, skipped: 0, rejected: 1 });
    await go(store, "projectTags", mapProjectTags(KEY, [{ project_id: orphan.sourceId, tag_id: tag(1).id, created_at: null, tag_name: "React" }]));
    await go(store, "favorites", [mapFavorite(KEY, { id: "f1", profile_id: profile(1).id, project_id: orphan.sourceId, created_at: null })]);
    expect(store.rejects.map((r) => `${r.sourceTable}:${r.reason}`)).toEqual(["projects:owner_missing", "project_tags:project_rejected", "favorites:project_rejected"]);
    expect(store.rows("projects")).toHaveLength(2);
  });

  it("rejects a favorite to a missing project and a tag link to a missing tag", async () => {
    const store = await seeded();
    await go(store, "favorites", [mapFavorite(KEY, { id: "f1", profile_id: profile(1).id, project_id: "missing", created_at: null })]);
    await go(store, "projectTags", mapProjectTags(KEY, [{ project_id: project(1, 1).id, tag_id: "missing", created_at: null, tag_name: "x" }]));
    await go(store, "favorites", [mapFavorite(KEY, { id: "f2", profile_id: "missing", project_id: project(1, 1).id, created_at: null })]);
    expect(store.rejects.map((r) => r.reason)).toEqual(["project_missing", "tag_missing", "user_missing"]);
    expect(store.rows("favorites")).toHaveLength(0);
  });

  it("rejects a duplicate username key, subject, slug and tag key instead of merging", async () => {
    const store = await seeded();
    await go(store, "users", [mapProfile(KEY, profile(3, { username: "PERSON1" })).row!, mapProfile(KEY, profile(4, { user_id: "synthetic_subject_1" })).row!]);
    await go(store, "projects", [mapProject(KEY, project(3, 1, { slug: "synthetic-project-2" })).row!]);
    await go(store, "tags", [mapTag(KEY, tag(3, "react")).row!]);
    expect(store.rejects.map((r) => r.reason)).toEqual(["duplicate_username", "duplicate_subject", "duplicate_slug", "duplicate_tag_name"]);
    expect(store.rows("users")).toHaveLength(2);
    expect(store.rows("tags")).toHaveLength(2);
  });

  it("rejects duplicate favorites and project-tag pairs, and more than 15 tags", async () => {
    const store = await seeded();
    const p = project(1, 1).id;
    await go(store, "favorites", [
      mapFavorite(KEY, { id: "f1", profile_id: profile(2).id, project_id: p, created_at: null }),
      mapFavorite(KEY, { id: "f2", profile_id: profile(2).id, project_id: p, created_at: null }),
    ]);
    const tags = Array.from({ length: MAX_TAGS + 1 }, (_, i) => ({ id: `t${i}`, name: `many${i}`, description: null, created_at: null }));
    await go(store, "tags", tags.map((t) => mapTag(KEY, t).row!));
    const links = mapProjectTags(KEY, tags.map((t) => ({ project_id: p, tag_id: t.id, created_at: null, tag_name: t.name })));
    await go(store, "projectTags", [...links, { ...links[0], sourceId: "dup", rowHash: "h" }]);
    expect(store.rejects.map((r) => r.reason)).toEqual(["duplicate_favorite", "too_many_tags", "duplicate_project_tag"]);
  });

  it("rejects history that would take another user's name, and reserves the rest for 90 days (§5.3)", async () => {
    const store = await seeded();
    await go(store, "usernameHistory", [
      mapHistory(KEY, { old_username: "person2", user_id: "synthetic_subject_1", new_username: "person1", changed_at: null }).row!,
      mapHistory(KEY, { old_username: "oldname", user_id: "synthetic_subject_1", new_username: "person1", changed_at: "2026-03-01T00:00:00" }).row!,
      mapHistory(KEY, { old_username: "ghost", user_id: "nobody", new_username: "x", changed_at: null }).row!,
    ]);
    expect(store.rejects.map((r) => r.reason)).toEqual(["username_conflict", "user_missing"]);
    const prev = store.rows("usernames").find((u) => u.state === "previous")!;
    expect(prev.reservedUntil).toBe(RUN.startedAt + USERNAME_RESERVATION_MS);
    expect(prev.releasedAt).toBe(Date.UTC(2026, 2, 1));
  });

  it("checks uploaded files against the capture and refuses images without a mapped file", async () => {
    const store = await seeded();
    store.storage.set("s1", { sha256Hex: "aa", size: 3, contentType: "image/png" });
    await expect(go(store, "files", [{ sourceId: "o1", rowHash: "h", storageId: "s1", sha256Hex: "bb", size: 3 }])).rejects.toThrow(/doesn't match/);
    await go(store, "files", [{ sourceId: "o1", rowHash: "h", storageId: "s1", sha256Hex: "aa", size: 3 }]);
    const img = { id: "i1", project_id: project(1, 1).id, storage_path: "x", file_name: "passport-scan.png", width: 1, height: 1, image_type: "cover", display_order: 0, alt_text: null, caption: null, uploaded_by: "synthetic_subject_1", created_at: null, deleted_at: null, aspect_ratio: null };
    await go(store, "images", [mapImage(KEY, { ...img, object_id: "o1" }).row!, mapImage(KEY, { ...img, id: "i2", object_id: "o2" }).row!, mapImage(KEY, { ...img, id: "i3", object_id: "o1", uploaded_by: "nobody" }).row!]);
    expect(store.rows("projectImages")).toHaveLength(1);
    expect(store.rows("projectImages")[0]).toMatchObject({ mimeType: "image/png", size: 3, status: "active" });
    // H1 privacy: the source's file name isn't stored, only kind.ext.
    expect(store.rows("projectImages")[0].fileName).toBe("cover.png");
    expect(store.rejects.map((r) => r.reason)).toEqual(["file_missing", "uploader_missing"]);
  });

  it("skips every row on a re-run and stops when a source row changed", async () => {
    const store = await seeded();
    const before = JSON.stringify([...store.tables.entries()]);
    expect(await go(store, "projects", [project(1, 1), project(2, 2)].map((p) => mapProject(KEY, p).row!))).toEqual({ inserted: 0, skipped: 2, rejected: 0 });
    expect(await go(store, "users", [profile(1), profile(2)].map((p) => mapProfile(KEY, p).row!))).toEqual({ inserted: 0, skipped: 2, rejected: 0 });
    expect(JSON.stringify([...store.tables.entries()])).toBe(before);
    const changed = mapProject(KEY, project(1, 1, { title: "Edited" })).row!;
    await expect(go(store, "projects", [changed])).rejects.toBeInstanceOf(SourceChangedError);
  });

  it("records orchestrator rejects once per run", async () => {
    const store = new MemoryStore();
    const r = { sourceTable: "projects.url_links", sourceId: "p:0", reason: "link_url_invalid" };
    expect(await go(store, "fieldRejects", [r, r])).toEqual({ inserted: 0, skipped: 1, rejected: 1 });
  });

  it("derives counters, excluding self-favorites from ranking (§5.10)", () => {
    expect(deriveProject("owner", [{ tagId: "b", position: 1 }, { tagId: "a", position: 0 }], ["owner", "u1", "u2"])).toEqual({
      tagIds: ["a", "b"], tagCount: 2, favoriteCount: 3, rankingFavoriteCount: 2,
    });
  });
});
