// D09 S00.2: a small synthetic corpus and a labeled relevance set. Every name,
// handle and project here is invented. S01 loads the same corpus on test slot 3
// (and scales it up with generated filler) to score each retrieval approach;
// S03 reuses the labels as its regression set.
//
// Labels per query:
//   strong    - must appear in the first page (top 10)
//   weak      - acceptable anywhere, never required
//   forbidden - must never appear: wrong technology, or not eligible
// Eligibility forbids are checked for every query, not just where listed:
// private, deleted and unlisted projects are forbidden everywhere.

import type { SearchSourceOwner, SearchSourceProject, SearchSourceTag } from "@/backend/search/public-search-doc";

export interface CorpusProject {
  project: SearchSourceProject;
  owner: SearchSourceOwner | null;
  tags: SearchSourceTag[];
}

const T0 = Date.UTC(2026, 0, 1);
const day = 86_400_000;

const tag = (name: string, status: SearchSourceTag["status"] = "active"): SearchSourceTag => ({
  id: `tag-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
  name,
  status,
});

const owners: Record<string, SearchSourceOwner> = {
  ada: { username: "ada-builds", fullName: "Ada Fixture" },
  lin: { username: "lin-codes", fullName: "Lin Sample" },
  sam: { username: "sam-ships", fullName: null },
};

let seq = 0;
function p(
  id: string,
  title: string,
  description: string,
  category: string,
  tagNames: string[],
  owner: keyof typeof owners | null,
  extra: Partial<SearchSourceProject> = {},
  retiredTags: string[] = [],
): CorpusProject {
  seq += 1;
  return {
    project: {
      id,
      slug: id,
      title,
      description,
      category,
      categoryData: null,
      fieldOrder: null,
      visibility: "public",
      status: "active",
      listed: true,
      favoriteCount: (seq * 7) % 23,
      rankingFavoriteCount: (seq * 5) % 19,
      contentVersion: 1,
      createdAt: T0 + seq * day,
      updatedAt: T0 + seq * day + 3600_000,
      ...extra,
    },
    owner: owner ? owners[owner] : null,
    tags: [...tagNames.map((n) => tag(n)), ...retiredTags.map((n) => tag(n, "retired"))],
  };
}

export const SEARCH_CORPUS: CorpusProject[] = [
  p("p-next-auth", "Next.js auth starter", "Sign-in flows for a Next.js app with sessions and passkeys", "web", ["Next.js", "TypeScript", "React"], "ada"),
  p("p-next-blog", "Markdown blog on Next.js", "Static blog with MDX and image optimisation", "web", ["Next.js", "React"], "lin"),
  p("p-react-dash", "React analytics dashboard", "Charts and tables for product metrics", "web", ["React", "TypeScript"], "sam"),
  p("p-rn-habits", "Habit tracker in React Native", "Cross-platform mobile app with offline sync", "mobile", ["React Native", "TypeScript"], "ada"),
  p("p-swiftui-notes", "SwiftUI notes app", "Native iOS notes with iCloud sync", "mobile", ["SwiftUI", "Swift"], "lin"),
  p("p-swift-cli", "Swift command line toolkit", "Argument parsing helpers for Swift CLIs", "desktop", ["Swift"], "sam"),
  p("p-cpp-engine", "Tiny C++ game engine", "Entity component system and a software renderer in C++", "desktop", ["C++"], "ada"),
  p("p-c-shell", "Unix shell in C", "A small POSIX shell written in C with job control", "desktop", ["C"], "lin"),
  p("p-csharp-api", "C# inventory API", "ASP.NET Core service on .NET 8 with PostgreSQL", "backend", ["C#", ".NET", "PostgreSQL"], "sam"),
  p("p-dotnet-worker", ".NET background worker", "Queue consumer built on the .NET generic host", "backend", [".NET", "C#"], "ada"),
  p("p-node-queue", "Node.js job queue", "Redis-backed jobs for Node.js services", "backend", ["Node.js", "JavaScript"], "lin"),
  p("p-express-api", "Express REST starter", "Node and Express API with JWT and tests", "backend", ["Node.js", "JavaScript"], "sam"),
  p("p-pg-migrate", "Postgres migration runner", "Versioned SQL migrations for PostgreSQL", "backend", ["PostgreSQL"], "ada"),
  p("p-go-proxy", "Reverse proxy in Go", "HTTP reverse proxy with health checks, written in Golang", "backend", ["Go"], "lin"),
  p("p-k8s-ops", "Kubernetes deploy templates", "Helm charts and k8s manifests for small teams", "cloud-devops", ["Kubernetes", "Docker"], "sam"),
  p("p-docker-dev", "Docker dev environments", "Compose files for local development stacks", "cloud-devops", ["Docker"], "ada"),
  p("p-tauri-clip", "Clipboard manager with Tauri", "Tiny desktop clipboard history app", "desktop", ["Tauri", "TypeScript"], "lin"),
  p("p-electron-md", "Electron markdown editor", "Desktop editor with live preview", "desktop", ["Electron", "JavaScript"], "sam"),
  p("p-py-scraper", "Python web scraper", "Async crawler with rate limits in Python 3", "backend", ["Python"], "ada"),
  p("p-java-bank", "Java banking kata", "Domain modelling exercise in Java", "backend", ["Java"], "lin"),
  p("p-orphan", "Orphaned TypeScript utils", "Helpers left by a deleted account", "web", ["TypeScript"], null),
  p("p-retired-tag", "Legacy browser widgets", "Old widgets kept for reference", "web", ["JavaScript"], "sam", {}, ["jQuery"]),
  // Not eligible: must never appear anywhere.
  p("p-private-next", "Private Next.js client portal", "Unreleased Next.js work", "web", ["Next.js"], "ada", { visibility: "private", listed: false }),
  p("p-deleted-cpp", "Deleted C++ ray tracer", "Removed by its owner", "desktop", ["C++"], "lin", { status: "deleted", listed: false }),
  p("p-unlisted-go", "Unlisted Go experiment", "Not listed in public lists", "backend", ["Go"], "sam", { listed: false }),
];

export const INELIGIBLE_IDS = ["p-private-next", "p-deleted-cpp", "p-unlisted-go"];

export type QueryKind =
  | "exact" | "prefix" | "misspelling" | "alias" | "phrase" | "mixed" | "special"
  | "filter" | "creator" | "no-results" | "people" | "privacy";

export interface RelevanceCase {
  id: string;
  kind: QueryKind;
  query: string;
  /** Optional server-validated scope/filters, as the S00.3 request carries them. */
  scope?: { handle?: string };
  filters?: { category?: string; tags?: string[] };
  strong: string[];
  weak?: string[];
  forbidden?: string[];
  note?: string;
}

export const RELEVANCE_CASES: RelevanceCase[] = [
  { id: "R01", kind: "exact", query: "next.js", strong: ["p-next-auth", "p-next-blog"], forbidden: ["p-private-next"] },
  { id: "R02", kind: "exact", query: "c++", strong: ["p-cpp-engine"], forbidden: ["p-c-shell", "p-csharp-api", "p-deleted-cpp"] },
  { id: "R03", kind: "exact", query: "c#", strong: ["p-csharp-api", "p-dotnet-worker"], forbidden: ["p-cpp-engine", "p-c-shell"] },
  { id: "R04", kind: "special", query: "c", strong: ["p-c-shell"], forbidden: ["p-cpp-engine", "p-csharp-api", "p-dotnet-worker", "p-go-proxy"], note: "single letter: no typo expansion, and C is not C++ or C#" },
  { id: "R05", kind: "special", query: ".net", strong: ["p-csharp-api", "p-dotnet-worker"] },
  { id: "R06", kind: "special", query: "node.js", strong: ["p-node-queue", "p-express-api"] },
  { id: "R07", kind: "alias", query: "postgres", strong: ["p-pg-migrate", "p-csharp-api"] },
  { id: "R08", kind: "alias", query: "golang", strong: ["p-go-proxy"], forbidden: ["p-unlisted-go"] },
  { id: "R09", kind: "alias", query: "k8s", strong: ["p-k8s-ops"] },
  { id: "R10", kind: "alias", query: "nextjs", strong: ["p-next-auth", "p-next-blog"] },
  { id: "R11", kind: "misspelling", query: "kubernets", strong: ["p-k8s-ops"] },
  { id: "R12", kind: "misspelling", query: "typscript", strong: ["p-next-auth", "p-react-dash", "p-tauri-clip"], weak: ["p-rn-habits", "p-orphan"] },
  { id: "R13", kind: "misspelling", query: "electorn", strong: ["p-electron-md"] },
  { id: "R14", kind: "prefix", query: "dash", strong: ["p-react-dash"] },
  { id: "R15", kind: "prefix", query: "swiftu", strong: ["p-swiftui-notes"] },
  { id: "R16", kind: "phrase", query: "react native", strong: ["p-rn-habits"], weak: ["p-react-dash", "p-next-auth", "p-next-blog"] },
  { id: "R17", kind: "phrase", query: "game engine", strong: ["p-cpp-engine"] },
  { id: "R18", kind: "mixed", query: "next.js typescript auth", strong: ["p-next-auth"], weak: ["p-next-blog", "p-react-dash"] },
  { id: "R19", kind: "mixed", query: "swift", strong: ["p-swift-cli", "p-swiftui-notes"], note: "Swift tag is on both; SwiftUI alone is weak elsewhere" },
  { id: "R20", kind: "filter", query: "typescript", filters: { category: "mobile" }, strong: ["p-rn-habits"], forbidden: ["p-next-auth", "p-tauri-clip"] },
  { id: "R21", kind: "filter", query: "", filters: { tags: ["Next.js", "TypeScript"] }, strong: ["p-next-auth"], forbidden: ["p-next-blog"], note: "empty query = browsing, AND across tags" },
  { id: "R22", kind: "creator", query: "app", scope: { handle: "lin-codes" }, strong: ["p-swiftui-notes"], weak: ["p-tauri-clip"], forbidden: ["p-rn-habits", "p-react-dash"] },
  { id: "R23", kind: "creator", query: "next", scope: { handle: "ada-builds" }, strong: ["p-next-auth"], forbidden: ["p-next-blog", "p-private-next"] },
  { id: "R24", kind: "no-results", query: "haskell", strong: [] },
  { id: "R25", kind: "no-results", query: "zzqx", strong: [] },
  { id: "R26", kind: "people", query: "ada-builds", strong: ["p-next-auth", "p-rn-habits", "p-cpp-engine"], weak: ["p-dotnet-worker", "p-pg-migrate", "p-docker-dev", "p-py-scraper"], note: "owner username is in searchText" },
  { id: "R27", kind: "privacy", query: "client portal", strong: [], forbidden: ["p-private-next"] },
  { id: "R28", kind: "privacy", query: "ray tracer", strong: [], forbidden: ["p-deleted-cpp"] },
  { id: "R29", kind: "privacy", query: "jquery", strong: [], forbidden: ["p-retired-tag"], note: "a retired tag never enters searchText" },
  { id: "R30", kind: "privacy", query: "experiment", strong: [], forbidden: ["p-unlisted-go"] },
];
