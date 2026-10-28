// Loads the synthetic fixture set into the current Supabase/Postgres schema
// (Phase B, B09) and removes it again (B10). Only for the task-owned test
// database: callers get `sql` from connectTestDb(), which checks the marker.
import { createHash } from "node:crypto";
import type postgres from "postgres";
import { TEST_SUPABASE_URL } from "../support/isolation";
import {
  FIXTURE_EMAIL_DOMAIN,
  FIXTURE_ID_PREFIX,
  FIXTURE_SUBJECT_PREFIX,
  RUNTIME_TAG_PREFIX,
  generateFixtures,
  placeholderPng,
  type FixtureSet,
  type PersonaKey,
} from "./generate";

type Sql = postgres.Sql | postgres.TransactionSql;

const subjectOf = (set: FixtureSet, key: PersonaKey) => set.personas[key].subject!;
const profileIdOf = (set: FixtureSet, key: PersonaKey) => set.personas[key].profile!.id;
const json = (sql: Sql, value: unknown) => sql.json(value as postgres.JSONValue);

/**
 * Inserts the set. Purged projects and personas without a profile are left out,
 * exactly as they'd look in the current schema. Refuses to run if any fixture
 * row is already present: call cleanupFixtures() first.
 */
export async function loadFixtures(sql: Sql, set: FixtureSet = generateFixtures()): Promise<FixtureSet> {
  const leftovers = await countFixtureRows(sql);
  if (Object.values(leftovers).some((n) => n > 0)) {
    throw new Error(`fixture rows already present: ${JSON.stringify(leftovers)}`);
  }

  for (const p of Object.values(set.personas)) {
    if (!p.profile || !p.subject) continue;
    const f = p.profile;
    await sql`insert into profiles (id, user_id, email_address, first_name, last_name, full_name, role, username, tier, profile_image_url, created_at, updated_at)
      values (${f.id}, ${p.subject}, ${f.email}, ${f.firstName}, ${f.lastName}, ${f.fullName}, ${f.role}, ${f.username}, ${f.tier}, ${f.imageUrl}, ${f.createdAt}, ${f.createdAt})`;
  }
  for (const h of set.usernameHistory) {
    await sql`insert into username_history (old_username, user_id, new_username, changed_at)
      values (${h.oldUsername}, ${h.subject}, ${h.newUsername}, ${h.changedAt})`;
  }
  for (const t of set.tags) {
    await sql`insert into tags (id, name) values (${t.id}, ${t.name})`;
  }

  const favoriteCount = (projectId: string) => set.favorites.filter((f) => f.projectId === projectId).length;
  for (const p of set.projects) {
    if (p.purged) continue;
    await sql`insert into projects (id, title, slug, description, user_id, category, created_at, updated_at, deleted_at, total_favorites, url_links, category_data)
      values (${p.id}, ${p.title}, ${p.slug}, ${p.description}, ${subjectOf(set, p.ownerKey)}, ${p.category}, ${p.createdAt}, ${p.updatedAt},
              ${p.deletedAt ? p.deletedAt.replace("Z", "") : null}, ${favoriteCount(p.id)}, ${json(sql, p.urlLinks)},
              ${p.categoryData ? json(sql, p.categoryData) : null})`;
    for (const tagId of p.tagIds) {
      await sql`insert into project_tags (project_id, tag_id) values (${p.id}, ${tagId})`;
    }
  }

  for (const f of set.favorites) {
    await sql`insert into favorites (id, profile_id, project_id, created_at)
      values (${f.id}, ${profileIdOf(set, f.personaKey)}, ${f.projectId}, ${f.createdAt.replace("Z", "")})`;
  }
  for (const i of set.images) {
    const bytes = placeholderPng(8, 8);
    await sql`insert into project_images (id, project_id, storage_path, storage_url, file_name, file_size, mime_type, width, height, image_type, display_order, uploaded_by, deleted_at)
      values (${i.id}, ${i.projectId}, ${i.storagePath}, ${`${TEST_SUPABASE_URL}/storage/v1/object/public/project-images/${i.storagePath}`},
              ${i.fileName}, ${bytes.length}, 'image/png', ${i.width}, ${i.height}, ${i.type}, ${i.displayOrder},
              ${subjectOf(set, i.uploadedByKey)}, ${i.deletedAt ? i.deletedAt.replace("Z", "") : null})`;
  }
  for (const s of set.tagSubmissions) {
    await sql`insert into tag_submissions (id, project_id, tag_name, submitter_email, status)
      values (${s.id}, ${s.projectId}, ${s.tagName}, ${set.personas[s.submitterKey].profile!.email}, ${s.status})`;
  }
  return set;
}

// Rows that belong to the fixtures: fixture IDs, fixture subjects or emails,
// and anything a test attached to them (or tags it created with the runtime prefix).
const OWNED = {
  profiles: (sql: Sql) => sql`(id::text like ${FIXTURE_ID_PREFIX + "%"} or user_id like ${FIXTURE_SUBJECT_PREFIX + "%"} or email_address like ${"%@" + FIXTURE_EMAIL_DOMAIN})`,
  projects: (sql: Sql) => sql`(id::text like ${FIXTURE_ID_PREFIX + "%"} or user_id like ${FIXTURE_SUBJECT_PREFIX + "%"})`,
  tags: (sql: Sql) => sql`(id::text like ${FIXTURE_ID_PREFIX + "%"} or name::text like ${RUNTIME_TAG_PREFIX + "%"})`,
};

export async function countFixtureRows(sql: Sql): Promise<Record<string, number>> {
  const [r] = await sql<Record<string, string>[]>`select
    (select count(*) from profiles where ${OWNED.profiles(sql)}) as profiles,
    (select count(*) from username_history where user_id like ${FIXTURE_SUBJECT_PREFIX + "%"}) as username_history,
    (select count(*) from projects where ${OWNED.projects(sql)}) as projects,
    (select count(*) from tags where ${OWNED.tags(sql)}) as tags,
    (select count(*) from project_tags pt where pt.project_id in (select id from projects where ${OWNED.projects(sql)})
       or pt.tag_id in (select id from tags where ${OWNED.tags(sql)})) as project_tags,
    (select count(*) from favorites f where f.profile_id in (select id from profiles where ${OWNED.profiles(sql)})
       or f.project_id in (select id from projects where ${OWNED.projects(sql)})) as favorites,
    (select count(*) from project_images i where i.project_id in (select id from projects where ${OWNED.projects(sql)})
       or i.uploaded_by like ${FIXTURE_SUBJECT_PREFIX + "%"}) as project_images,
    (select count(*) from tag_submissions s where s.id::text like ${FIXTURE_ID_PREFIX + "%"}
       or s.submitter_email like ${"%@" + FIXTURE_EMAIL_DOMAIN}
       or s.project_id in (select id from projects where ${OWNED.projects(sql)})) as tag_submissions`;
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v)]));
}

/**
 * Removes every fixture-owned row and nothing else, children first. Safe to run
 * repeatedly and on a database with no fixtures. Returns what was deleted.
 */
export async function cleanupFixtures(sql: postgres.Sql): Promise<Record<string, number>> {
  return sql.begin(async (tx) => {
    const removed: Record<string, number> = {};
    const ownedProjects = tx`select id from projects where ${OWNED.projects(tx)}`;
    const ownedProfiles = tx`select id from profiles where ${OWNED.profiles(tx)}`;
    const ownedTags = tx`select id from tags where ${OWNED.tags(tx)}`;
    removed.tag_submissions = (await tx`delete from tag_submissions where id::text like ${FIXTURE_ID_PREFIX + "%"}
      or submitter_email like ${"%@" + FIXTURE_EMAIL_DOMAIN} or project_id in (${ownedProjects})`).count;
    removed.favorites = (await tx`delete from favorites where profile_id in (${ownedProfiles}) or project_id in (${ownedProjects})`).count;
    removed.project_images = (await tx`delete from project_images where project_id in (${ownedProjects})
      or uploaded_by like ${FIXTURE_SUBJECT_PREFIX + "%"}`).count;
    removed.project_tags = (await tx`delete from project_tags where project_id in (${ownedProjects}) or tag_id in (${ownedTags})`).count;
    removed.projects = (await tx`delete from projects where ${OWNED.projects(tx)}`).count;
    removed.tags = (await tx`delete from tags where ${OWNED.tags(tx)}`).count;
    removed.username_history = (await tx`delete from username_history where user_id like ${FIXTURE_SUBJECT_PREFIX + "%"}`).count;
    removed.profiles = (await tx`delete from profiles where ${OWNED.profiles(tx)}`).count;
    return removed;
  });
}

/**
 * Order-insensitive hash of every row in the public tables. Used to show that
 * load followed by cleanup leaves the database exactly as it was.
 */
export async function publicTableDigest(sql: Sql): Promise<string> {
  const tables = await sql<{ relname: string }[]>`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' order by 1`;
  const h = createHash("sha256");
  for (const { relname } of tables) {
    const [row] = await sql<{ d: string | null }[]>`
      select md5(coalesce(string_agg(t::text, chr(10) order by t::text collate "C"), '')) as d from ${sql("public." + relname)} t`;
    h.update(`${relname}:${row.d}\n`);
  }
  return h.digest("hex");
}
