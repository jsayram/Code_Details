// Deterministic synthetic fixtures (Phase B, B09), following the P07 §10 spec.
// Pure data: no database, no clock, no randomness beyond a fixed seed. The same
// seed always yields byte-identical output, so these can live in Git and CI.
// tests/fixtures/supabase.ts loads them into the current schema; the Convex
// seeder (Phase C) maps the same model onto the new tables.
//
// Nothing here is real: identities use the .invalid TLD and "user_fixture_"
// subjects, and image bytes are generated placeholders.
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { MAX_PROJECT_TAGS, PROJECT_TEXT_LIMITS } from "@/constants/project-limits";

export const FIXTURE_SEED = "codedetails-fixtures-v1";
/** Every fixture UUID starts with this, so leftovers are easy to spot. */
export const FIXTURE_ID_PREFIX = "f1f1f1f1-";
export const FIXTURE_SUBJECT_PREFIX = "user_fixture_";
export const FIXTURE_EMAIL_DOMAIN = "synthetic.invalid";
/** Tags a test creates at runtime must use this prefix so cleanup can find them. */
export const RUNTIME_TAG_PREFIX = "fixture-";

const EPOCH = Date.UTC(2026, 0, 1); // 2026-01-01T00:00:00Z
const DAY = 86_400_000;

export function fixtureId(seed: string, key: string): string {
  const h = createHash("sha256").update(`${seed}:${key}`).digest("hex");
  // f1f1f1f1-xxxx-4xxx-{8..b}xxx-xxxxxxxxxxxx: a valid version-4-shaped UUID.
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${FIXTURE_ID_PREFIX}${h.slice(0, 4)}-4${h.slice(4, 7)}-${variant}${h.slice(7, 10)}-${h.slice(10, 22)}`;
}

const at = (days: number) => new Date(EPOCH + days * DAY).toISOString();

/** What the Supabase reader publishes for a username: an email-shaped one loses everything from the "@". */
export const supabasePublicUsername = (username: string) => (username.includes("@") ? username.split("@")[0] : username);

/** P07 §5.2: the Convex import gives an email-shaped username a generated handle; others are kept. */
export const convexImportUsername = (subject: string, username: string) =>
  username.includes("@") ? `user-${createHash("sha256").update(subject).digest("hex").slice(0, 6)}` : username;

export type PersonaKey = "anonymous" | "a" | "b" | "admin" | "noProfile" | "deleting" | "renamed" | "reserved" | "emailUsername";

export interface Persona {
  key: PersonaKey;
  /** Auth subject; null for the anonymous visitor. */
  subject: string | null;
  /** Null when the persona has no profile row (anonymous, half-finished sign-up). */
  profile: null | {
    id: string;
    email: string;
    username: string;
    firstName: string;
    lastName: string;
    /** Null when the profile has no name, so the page falls back to the username. */
    fullName: string | null;
    role: string | null;
    tier: "free" | "pro";
    imageUrl: string | null;
    createdAt: string;
  };
  /** Account lifecycle in the target model (P07 §5.7). The current schema has no column for it. */
  accountState: "active" | "deleting";
}

export interface UsernameChange {
  subject: string;
  oldUsername: string;
  newUsername: string;
  changedAt: string;
}

export interface Tag {
  id: string;
  name: string;
}

export type ProjectCase =
  | "listed"
  | "private"
  | "deletedRecent"
  | "deletedLongAgo"
  | "purged"
  | "noDescription"
  | "maxLength"
  | "unicode"
  | "fifteenTags"
  | "oneTag"
  | "caseVariantTags"
  | "changedSlug"
  | "ownedByB"
  | "ownedByEmailUsername";

export interface Project {
  case: ProjectCase;
  id: string;
  ownerKey: PersonaKey;
  title: string;
  slug: string;
  /** Earlier slug for the changed-slug case (target model keeps slug history). */
  previousSlug: string | null;
  description: string | null;
  category: string;
  visibility: "public" | "private";
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  /** Purged projects exist only in the manifest; loaders never insert them. */
  purged: boolean;
  tagIds: string[];
  /** Raw tag input a test submits for this case (case-variant duplicates). */
  tagInput: string[];
  urlLinks: { url: string; label: string }[];
  categoryData: Record<string, unknown> | null;
}

export interface Favorite {
  id: string;
  personaKey: PersonaKey;
  projectId: string;
  note: "other" | "self" | "onDeleted";
  createdAt: string;
}

export interface Image {
  id: string;
  projectId: string;
  type: "cover" | "logo" | "screenshot";
  storagePath: string;
  fileName: string;
  width: number;
  height: number;
  displayOrder: number;
  deletedAt: string | null;
  uploadedByKey: PersonaKey;
}

export interface TagSubmission {
  id: string;
  projectId: string;
  tagName: string;
  submitterKey: PersonaKey;
  status: "pending";
}

/** Situations tests create at runtime rather than rows the loader inserts. */
export interface Scenario {
  key: "doubleFavoriteRace" | "reservedUsernameClaim" | "privateImageUpload" | "orphanUpload" | "oversizedUpload" | "wrongTypeUpload";
  description: string;
}

export interface FixtureSet {
  seed: string;
  personas: Record<PersonaKey, Persona>;
  usernameHistory: UsernameChange[];
  tags: Tag[];
  projects: Project[];
  favorites: Favorite[];
  images: Image[];
  tagSubmissions: TagSubmission[];
  scenarios: Scenario[];
}

const TAG_NAMES = [
  "C", "C++", "C#", ".NET", "Node.js", "Next.js", "React Native", "Postgres", "PostgreSQL",
  "@scope/package", "TypeScript 5.7", "React 19", "Python 3.13", "Go", "Rust", "Swift",
];

export function generateFixtures(seed: string = FIXTURE_SEED): FixtureSet {
  const id = (key: string) => fixtureId(seed, key);

  const persona = (
    key: PersonaKey,
    username: string | null,
    first: string,
    last: string,
    extra: Partial<NonNullable<Persona["profile"]>> = {},
    accountState: Persona["accountState"] = "active",
  ): Persona => ({
    key,
    subject: `${FIXTURE_SUBJECT_PREFIX}${key}`,
    accountState,
    profile: username === null ? null : {
      id: id(`profile:${key}`),
      email: `${key.toLowerCase()}@${FIXTURE_EMAIL_DOMAIN}`,
      username,
      firstName: first,
      lastName: last,
      fullName: `${first} ${last}`,
      role: null,
      tier: "free",
      imageUrl: null,
      createdAt: at(0),
      ...extra,
    },
  });

  const personas: Record<PersonaKey, Persona> = {
    anonymous: { key: "anonymous", subject: null, profile: null, accountState: "active" },
    a: persona("a", "fixture-alice", "Alice", "Fixture", { tier: "pro", imageUrl: `https://avatars.${FIXTURE_EMAIL_DOMAIN}/a.png` }),
    b: persona("b", "fixture-bob", "Bob", "Fixture"),
    // The app treats ADMIN_DASHBOARD_MODERATOR's address as admin; isolatedEnv() sets it to this.
    admin: persona("admin", "fixture-admin", "Ada", "Admin", { email: `admin@${FIXTURE_EMAIL_DOMAIN}`, role: "admin" }),
    noProfile: persona("noProfile", null, "", ""),
    deleting: persona("deleting", "fixture-leaving", "Dee", "Parting", {}, "deleting"),
    renamed: persona("renamed", "fixture-new-name", "Rene", "Named"),
    reserved: persona("reserved", "fixture-claimant", "Res", "Erved"),
    // Legacy accounts whose username is their email address and who never set a
    // name (2 such profiles in the local data). The page shows only the local part.
    emailUsername: persona("emailUsername", `fixture.legacy@${FIXTURE_EMAIL_DOMAIN}`, "", "", {
      email: `fixture.legacy@${FIXTURE_EMAIL_DOMAIN}`,
      fullName: null,
    }),
  };

  const usernameHistory: UsernameChange[] = [
    { subject: personas.renamed.subject!, oldUsername: "fixture-old-name", newUsername: "fixture-new-name", changedAt: at(10) },
  ];

  const tags: Tag[] = TAG_NAMES.map((name) => ({ id: id(`tag:${name}`), name }));
  const tagByName = (name: string) => tags.find((t) => t.name === name)!.id;

  const longText = (n: number, unit: string) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);

  const project = (c: ProjectCase, p: Partial<Project> & Pick<Project, "title" | "slug">): Project => ({
    case: c,
    id: id(`project:${c}`),
    ownerKey: "a",
    previousSlug: null,
    description: `Synthetic ${c} project.`,
    category: "web",
    visibility: "public",
    createdAt: at(1),
    updatedAt: at(1),
    deletedAt: null,
    purged: false,
    tagIds: [tagByName("Next.js")],
    tagInput: [],
    urlLinks: [],
    categoryData: null,
    ...p,
  });

  const projects: Project[] = [
    project("listed", {
      title: "Fixture Listed Project",
      slug: "fixture-listed",
      tagIds: [tagByName("Next.js"), tagByName("Postgres")],
      urlLinks: [{ url: `https://repo.${FIXTURE_EMAIL_DOMAIN}/listed`, label: "Repository" }],
    }),
    project("private", { title: "Fixture Private Project", slug: "fixture-private", visibility: "private" }),
    project("deletedRecent", { title: "Fixture Deleted Recently", slug: "fixture-deleted-recent", deletedAt: at(30) }),
    project("deletedLongAgo", {
      title: "Fixture Deleted Long Ago",
      slug: "fixture-deleted-long-ago",
      createdAt: at(-800),
      updatedAt: at(-800),
      deletedAt: at(-730),
    }),
    project("purged", { title: "Fixture Purged Project", slug: "fixture-purged", purged: true, deletedAt: at(5) }),
    project("noDescription", { title: "Fixture No Description", slug: "fixture-no-description", description: null, tagIds: [] }),
    project("maxLength", {
      title: longText(PROJECT_TEXT_LIMITS.MAX_TITLE_LENGTH, "Max "),
      slug: longText(PROJECT_TEXT_LIMITS.MAX_SLUG_LENGTH - "-end".length, "fixture-max-") + "-end",
      description: longText(PROJECT_TEXT_LIMITS.MAX_DESCRIPTION_LENGTH, "Long description. "),
      categoryData: { notes: longText(2000, "category data ") },
      urlLinks: Array.from({ length: 10 }, (_, i) => ({ url: `https://link${i}.${FIXTURE_EMAIL_DOMAIN}/`, label: `Link ${i}` })),
    }),
    project("unicode", {
      title: "Café déjà vu — مرحبا 🚀",
      slug: "fixture-unicode",
      description: "Diacritics: àéîõü ñ ç. RTL: שלום עולם. Emoji: 🧪✨👩🏽‍💻.",
    }),
    project("fifteenTags", {
      title: "Fixture Fifteen Tags",
      slug: "fixture-fifteen-tags",
      tagIds: tags.slice(0, MAX_PROJECT_TAGS).map((t) => t.id),
    }),
    project("oneTag", { title: "Fixture One Tag", slug: "fixture-one-tag", tagIds: [tagByName("C#")] }),
    project("caseVariantTags", {
      title: "Fixture Case Variant Tags",
      slug: "fixture-case-variant-tags",
      tagIds: [tagByName("React 19")],
      tagInput: ["React 19", "react 19", "REACT 19"],
    }),
    project("changedSlug", { title: "Fixture Changed Slug", slug: "fixture-slug-new", previousSlug: "fixture-slug-old" }),
    project("ownedByB", { title: "Fixture Bob's Project", slug: "fixture-bob-project", ownerKey: "b", tagIds: [tagByName("Rust")] }),
    project("ownedByEmailUsername", {
      title: "Fixture Legacy Owner Project",
      slug: "fixture-legacy-owner",
      ownerKey: "emailUsername",
      tagIds: [tagByName("Go")],
    }),
  ];

  const byCase = (c: ProjectCase) => projects.find((p) => p.case === c)!.id;

  const favorites: Favorite[] = [
    { id: id("favorite:b-listed"), personaKey: "b", projectId: byCase("listed"), note: "other", createdAt: at(2) },
    { id: id("favorite:a-listed"), personaKey: "a", projectId: byCase("listed"), note: "self", createdAt: at(2) },
    { id: id("favorite:b-deleted"), personaKey: "b", projectId: byCase("deletedRecent"), note: "onDeleted", createdAt: at(3) },
    { id: id("favorite:a-bob"), personaKey: "a", projectId: byCase("ownedByB"), note: "other", createdAt: at(3) },
  ];

  const image = (key: string, type: Image["type"], order: number, size: [number, number], deletedAt: string | null = null): Image => ({
    id: id(`image:${key}`),
    projectId: byCase("listed"),
    type,
    storagePath: `fixtures/${key}.png`,
    fileName: `${key}.png`,
    width: size[0],
    height: size[1],
    displayOrder: order,
    deletedAt,
    uploadedByKey: "a",
  });

  const images: Image[] = [
    image("cover", "cover", 0, [1200, 630]),
    image("logo", "logo", 0, [512, 512]),
    image("screenshot-1", "screenshot", 1, [1280, 800]),
    image("screenshot-2", "screenshot", 2, [1280, 800]),
    // Soft-deleted: its file must stay until the image row is purged (P07 §5.11).
    image("screenshot-deleted", "screenshot", 3, [1280, 800], at(20)),
  ];

  const tagSubmissions: TagSubmission[] = [
    { id: id("tag-submission:b-on-listed"), projectId: byCase("listed"), tagName: `${RUNTIME_TAG_PREFIX}suggested`, submitterKey: "b", status: "pending" },
  ];

  const scenarios: Scenario[] = [
    { key: "doubleFavoriteRace", description: "B double-clicks favorite on A's oneTag project; exactly one row and a +1 count expected" },
    { key: "reservedUsernameClaim", description: "reserved tries to claim fixture-old-name, which renamed gave up; the target model keeps it reserved for 90 days" },
    { key: "privateImageUpload", description: "Image upload to the private project must be refused (target model)" },
    { key: "orphanUpload", description: "File uploaded without a project_images row; the orphan sweep must find it" },
    { key: "oversizedUpload", description: "Upload one byte over PROJECT_IMAGE_LIMITS.MAX_FILE_SIZE_BYTES; must be refused" },
    { key: "wrongTypeUpload", description: "Upload of a non-image type; must be refused" },
  ];

  return { seed, personas, usernameHistory, tags, projects, favorites, images, tagSubmissions, scenarios };
}

/** Stable SHA-256 over the whole set; changes only when the generator changes. */
export function fixtureDigest(set: FixtureSet): string {
  return createHash("sha256").update(JSON.stringify(set)).digest("hex");
}

/** A solid-colour PNG of the given size; same input, same bytes. */
export function placeholderPng(width: number, height: number, rgb: [number, number, number] = [99, 102, 241]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
